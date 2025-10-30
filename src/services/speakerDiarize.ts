// src/services/speakerDiarize.ts
import path from "path";
import fs from "fs-extra";

import { DATA_ROOT, KEEP_FILES, SPEAKER_MATCH_THRESHOLD } from "../config/config.js";
import { cosineSimilarity } from "../utils/math.js";
import { getSession, clearSession, SpeakerEntry, ChunkResult } from "../utils/speakerStore.js";
import { diarizeFile } from "./processChunk.js";

/** Input can be a Buffer or a path on disk */
type AudioInput =
  | { buffer: Buffer; mime?: string; originalName?: string }
  | { path: string; mime?: string };

export type SpeakerDiarizeOutput =
  | {
      ok: true;
      uploadId: string;
      sequenceId: number;
      lastChunk: boolean;
      savedPath: string;
      segments: Array<{
        start: number;
        end: number;
        speakerLabel: string;
        seq: number;
      }>;
      speakersDetected: Array<{ speakerLabel: string; seq: number; similarity?: number }>;
      knownSpeakers: Array<{ seq: number; fingerprintDim: number }>;
      embeddingType?: string;
      cleared?: boolean; // true when session was cleared because lastChunk=true
    }
  | {
      ok: false;
      uploadId: string;
      sequenceId: number;
      lastChunk: boolean;
      error: string;
    };

function seqToPaddedName(seq: number) {
  return String(seq).padStart(6, "0"); // 000001
}

function extFromMime(mime?: string) {
  if (!mime) return ".bin";
  const m = mime.toLowerCase();
  if (m.includes("mpeg")) return ".mp3";
  if (m.includes("wav")) return ".wav";
  if (m.includes("m4a") || m.includes("mp4")) return ".m4a";
  if (m.includes("ogg")) return ".ogg";
  if (m.includes("webm")) return ".webm";
  return ".bin";
}

async function saveAudioToChunkPath(
  uploadId: string,
  sequenceId: number,
  audio: AudioInput
): Promise<string> {
  const baseDir = path.join(DATA_ROOT, uploadId, "chunks");
  await fs.ensureDir(baseDir);

  const ext =
    "path" in audio
      ? path.extname(audio.path) || extFromMime(audio.mime)
      : extFromMime(audio.mime);

  const fileName = `${seqToPaddedName(sequenceId)}${ext}`;
  const outPath = path.join(baseDir, fileName);

  if ("path" in audio) {
    // copy from existing file
    await fs.copy(audio.path, outPath);
  } else {
    // write buffer
    await fs.writeFile(outPath, audio.buffer);
  }
  return outPath;
}

/**
 * Main entry:
 * - Persists audio chunk
 * - Diarizes it
 * - Maps chunk's speaker labels to persistent seq numbers (per uploadId)
 * - On isFinal, clears session memory for that uploadId
 */
export async function speakerDiarize(params: {
  uploadId: string;
  sequenceId: number;
  isFinal: boolean;
  audio: AudioInput;
}): Promise<SpeakerDiarizeOutput> {
  const { uploadId, sequenceId, isFinal, audio } = params;

  try {
    // 1) Save this chunk to canonical path
    const chunkPath = await saveAudioToChunkPath(uploadId, sequenceId, audio);

    // 2) Run diarization (returns labels, segments, fingerprints)
    const dres = await diarizeFile(chunkPath);
    if (!dres?.ok) {
      if (!KEEP_FILES) await fs.remove(chunkPath);
      return {
        ok: false,
        uploadId,
        sequenceId,
        lastChunk: isFinal,
        error: dres?.error || "Diarization failed",
      };
    }

    const labels: string[] = dres.labels || [];
    const fps: Record<string, number[]> = dres.fingerprints || {};
    const segs: Array<{ start: number; end: number; speakerLabel: string }> = dres.segments || [];

    // 3) Session: map speaker labels -> stable sequence numbers
    const session = getSession(uploadId);
    const labelToSeq = new Map<string, number>();
    const matchedDetails: Array<{ speakerLabel: string; seq: number; similarity?: number }> = [];

    function findMatch(vec: number[]): { key: string; entry: SpeakerEntry; sim: number } | null {
      let bestKey = "";
      let best: SpeakerEntry | null = null;
      let bestSim = -1;
      for (const [k, v] of session.speakers.entries()) {
        const sim = cosineSimilarity(v.fingerprint, vec);
        if (sim > bestSim) {
          bestSim = sim;
          best = v;
          bestKey = k;
        }
      }
      if (best && bestSim >= SPEAKER_MATCH_THRESHOLD) {
        return { key: bestKey, entry: best, sim: bestSim };
      }
      return null;
    }

    for (const lab of labels) {
      const vec = fps[lab] || [];
      const match = findMatch(vec);
      if (match) {
        labelToSeq.set(lab, match.entry.seq);
        matchedDetails.push({
          speakerLabel: lab,
          seq: match.entry.seq,
          similarity: Number(match.sim.toFixed(4)),
        });
      } else {
        const newSeq = session.nextSeq++;
        session.speakers.set(`seq:${newSeq}`, { seq: newSeq, fingerprint: vec });
        labelToSeq.set(lab, newSeq);
        matchedDetails.push({ speakerLabel: lab, seq: newSeq });
      }
    }

    const segmentsWithSeq = segs.map((s) => ({
      start: s.start,
      end: s.end,
      speakerLabel: s.speakerLabel,
      seq: labelToSeq.get(s.speakerLabel)!,
    }));

    // 4) Record chunk result in session (optional but useful for final aggregation)
    const chunkResult: ChunkResult = {
      uploadId,
      sequenceId,
      lastChunk: isFinal,
      segments: segmentsWithSeq,
      speakersDetected: matchedDetails,
    };
    session.chunks.push(chunkResult);

    // optional cleanup of media file
    if (!KEEP_FILES) await fs.remove(chunkPath);

    // 5) If this was the last chunk, clear this upload’s session
    let cleared = false;
    if (isFinal) {
      clearSession(uploadId);
      cleared = true;
    }

    return {
      ok: true,
      uploadId,
      sequenceId,
      lastChunk: isFinal,
      savedPath: path.relative(process.cwd(), chunkPath),
      segments: segmentsWithSeq,
      speakersDetected: matchedDetails,
      knownSpeakers: Array.from(getSession(uploadId).speakers.values()).map((s) => ({
        seq: s.seq,
        fingerprintDim: s.fingerprint.length,
      })),
      embeddingType: dres.embeddingType,
      cleared,
    };
  } catch (err: any) {
    return {
      ok: false,
      uploadId,
      sequenceId,
      lastChunk: isFinal,
      error: err?.message || String(err),
    };
  }
}
