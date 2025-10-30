// src/routes/chunks.ts
import { Router } from "express";
import multer from "multer";
import path from "path";
import { z } from "zod";
import { DATA_ROOT } from "../config/config.js";
import { speakerDiarize } from "../services/speakerDiarize.js";
import fs from "fs-extra";
import { generateFullTranscript } from "../services/transcript.js";
import { mergeSegmentsWithTranscript } from "../services/mergeSegmentsWithTranscript.js";

const upload = multer({ dest: path.join(DATA_ROOT, "_tmp") });
const router = Router();

const metaSchema = z.object({
  uploadId: z.string().min(1),
  sequenceId: z.coerce.number().int().positive(),
  lastChunk: z.coerce.boolean(), // allows "true"/"false" strings from form-data
  mime: z.string().optional(),
});

function normalizeMimeForGemini(m?: string): string {
  const mime = (m || "").toLowerCase();
  if (mime === "video/mp4") return "audio/mp4"; // Android commonly sends video/mp4
  if (!mime || mime === "application/octet-stream") return "audio/mp4";
  return mime;
}

// keep tmp files in a known place and make sure it exists
const TMP_DIR = path.join(process.cwd(), "tmp_uploads");

router.post("/chunks", upload.single("audio"), async (req, res) => {
  let tmpPath: string | null = null;

  try {
    // 1) validate & coerce metadata (including boolean lastChunk)
    const parsed = metaSchema.parse(req.body);

    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Missing audio file" });
    }

    await fs.ensureDir(TMP_DIR);

    const uploadId = parsed.uploadId;
    const sequenceId = parsed.sequenceId;
    const lastChunk = parsed.lastChunk;

    const rawMime = req.file.mimetype || parsed.mime || "application/octet-stream";
    const geminiMime = normalizeMimeForGemini(rawMime);

    // 2) read the buffer from multer's disk file (since dest=... uses DiskStorage)
    const fileBuffer = await fs.readFile(req.file.path);

    // 3) call diarization using consistent, validated values
    const out = await speakerDiarize({
      uploadId,
      sequenceId,
      isFinal: lastChunk,
      audio: {
        buffer: fileBuffer,
        mime: geminiMime, // prefer normalized mime
        originalName: req.file.originalname,
      },
    });

    // 4) persist a tmp copy for the transcription step (optional, but your code uses a path)
    tmpPath = path.join(TMP_DIR, `${uploadId}-${sequenceId}-${Date.now()}.bin`);
    await fs.writeFile(tmpPath, fileBuffer);

    // 5) transcribe this chunk
    const TranscribeResult = await generateFullTranscript(tmpPath, geminiMime);


    // ---- STEP 3: merge segments + transcript ----
    const segments = out?.ok ? out.segments : [];
    const transcript = TranscribeResult?.transcript || [];

    const merged = mergeSegmentsWithTranscript(segments, transcript);


    // 6) clean up multer temp file
    try {
      await fs.remove(req.file.path);
    } catch {
      /* swallow cleanup error */
    }

    return res.status(out.ok ? 200 : 500).json({ out, TranscribeResult, merged });
  } catch (e: any) {
    // best-effort cleanup of our own tmp file
    if (tmpPath) {
      try {
        await fs.remove(tmpPath);
      } catch {
        /* ignore */
      }
    }
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

export default router;
