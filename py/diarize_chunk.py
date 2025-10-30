#!/usr/bin/env python3
import os
import sys
import json
import argparse
import tempfile
import subprocess
import shutil
import numpy as np
import soundfile as sf
import librosa

# Avoid SpeechBrain torchaudio backend probes that sometimes fail on Macs
os.environ.setdefault("SPEECHBRAIN_DISABLE_TORCHAUDIO_BACKEND_CHECK", "1")

from pyannote.audio.pipelines import SpeakerDiarization
from pyannote.core import Annotation


def which_ffmpeg():
    ff = os.getenv("FFMPEG_BIN")
    if ff and shutil.which(ff):
        return ff
    return shutil.which("ffmpeg")


def ensure_wav_mono_16k(in_path: str) -> tuple[str, str | None]:
    """
    Returns (path_to_wav_16k, cleanup_dir_if_any)
    If input isn't wav mono 16k, transcodes using ffmpeg.
    """
    root, ext = os.path.splitext(in_path.lower())
    if ext == ".wav":
        # we still need to confirm it is mono,16k. Transcode for simplicity.
        pass

    ffmpeg = which_ffmpeg()
    if not ffmpeg:
        raise RuntimeError("FFmpeg not found. Install it (brew install ffmpeg) or set FFMPEG_BIN.")

    tmpdir = tempfile.mkdtemp(prefix="diarize_")
    out_wav = os.path.join(tmpdir, "converted.wav")

    cmd = [ffmpeg, "-y", "-i", in_path, "-ac", "1", "-ar", "16000", out_wav]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0 or not os.path.exists(out_wav):
        raise RuntimeError(f"FFmpeg failed.\ncmd: {' '.join(cmd)}\nstdout:\n{proc.stdout}\n\nstderr:\n{proc.stderr}")
    return out_wav, tmpdir


def mfcc_fingerprint(y: np.ndarray, sr: int, start: float, end: float) -> np.ndarray:
    """Compute a compact, stable MFCC mean vector for [start,end] seconds segment."""
    s = max(0, int(start * sr))
    e = min(len(y), int(end * sr))
    if e <= s:
        return np.zeros(13, dtype=np.float32)
    seg = y[s:e]
    mfcc = librosa.feature.mfcc(y=seg, sr=sr, n_mfcc=13)
    return mfcc.mean(axis=1).astype(np.float32)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--audio", required=True)
    args = p.parse_args()

    in_path = args.audio
    if not os.path.exists(in_path):
        print(json.dumps({"ok": False, "error": f"Audio not found: {in_path}"}))
        sys.exit(1)

    if not (os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_TOKEN") or os.getenv("HUGGINGFACE_HUB_TOKEN")):
        print(json.dumps({"ok": False, "error": "HF token missing (HF_TOKEN/HUGGINGFACE_TOKEN)."}))
        sys.exit(1)

    cleanup_dir = None
    try:
        wav16, cleanup_dir = ensure_wav_mono_16k(in_path)

        # Run pipeline
        pipeline = SpeakerDiarization.from_pretrained("pyannote/speaker-diarization-3.1")
        diar_out = pipeline(wav16)

        # Resolve Annotation
        if isinstance(diar_out, Annotation):
            ann = diar_out
            speaker_embeddings = None
        elif hasattr(diar_out, "speaker_diarization") and isinstance(diar_out.speaker_diarization, Annotation):
            ann = diar_out.speaker_diarization
            speaker_embeddings = getattr(diar_out, "speaker_embeddings", None)
        elif hasattr(diar_out, "exclusive_speaker_diarization") and isinstance(diar_out.exclusive_speaker_diarization, Annotation):
            ann = diar_out.exclusive_speaker_diarization
            speaker_embeddings = getattr(diar_out, "speaker_embeddings", None)
        else:
            raise TypeError(f"Unsupported diarization output type: {type(diar_out)}")

        # Load audio for MFCC fallback & segment slicing
        y, sr = sf.read(wav16, dtype="float32", always_2d=False)
        if y.ndim > 1:
            y = y.mean(axis=1)

        # Build segments and label set
        segments = []
        for segment, _, label in ann.itertracks(yield_label=True):
            segments.append({
                "start": float(segment.start),
                "end": float(segment.end),
                "speakerLabel": str(label),
            })

        # Fingerprints per speakerLabel
        labels = sorted(list(ann.labels()))
        fingerprints = {}

        # Try pyannote embeddings if shape matches
        used_pyannote_embeddings = False
        if speaker_embeddings is not None:
            try:
                emb = np.asarray(speaker_embeddings, dtype=np.float32)
                if emb.ndim == 2 and emb.shape[0] == len(labels):
                    # Map embeddings to sorted labels
                    for i, lab in enumerate(labels):
                        fingerprints[lab] = emb[i, :].astype(np.float32).tolist()
                    used_pyannote_embeddings = True
            except Exception:
                used_pyannote_embeddings = False

        if not used_pyannote_embeddings:
            # Fallback: MFCC mean per label by averaging across its segments
            for lab in labels:
                lab_segments = [s for s in segments if s["speakerLabel"] == lab]
                vecs = []
                for s in lab_segments:
                    vecs.append(mfcc_fingerprint(y, sr, s["start"], s["end"]))
                if len(vecs) == 0:
                    fingerprints[lab] = np.zeros(13, dtype=np.float32).tolist()
                else:
                    avg = np.mean(np.stack(vecs, axis=0), axis=0)
                    fingerprints[lab] = avg.astype(np.float32).tolist()

        print(json.dumps({
            "ok": True,
            "segments": segments,
            "labels": labels,
            "fingerprints": fingerprints,
            "embeddingType": "pyannote256" if used_pyannote_embeddings else "mfcc13"
        }))
        sys.exit(0)

    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)
    finally:
        if cleanup_dir and os.path.isdir(cleanup_dir):
            try:
                shutil.rmtree(cleanup_dir)
            except Exception:
                pass


if __name__ == "__main__":
    main()
