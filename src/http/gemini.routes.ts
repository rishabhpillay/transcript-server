import * as dotenv from "dotenv";
import express from "express";
import multer from "multer";
import { promises as fs } from "fs";
import path from "path";
import { generateFullTranscript } from "../services/fullTranscript.js";

import { v4 as uuidv4 } from "uuid";
import Recording from "../models/Recording.js";
import { uploadAudio } from "../services/cloudinary.js";
import { mergeSummaries } from "../services/mergeSummaries.js";
import { dedupeActions } from "../services/actions.js";
const toInt = (val: any): number | undefined => {
  const num = parseInt(val, 10);
  return isNaN(num) ? undefined : num;
};

const toBool = (val: any, defaultValue: boolean = false): boolean => {
  if (typeof val === "boolean") {
    return val;
  }
  if (typeof val === "string") {
    const lower = val.toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
  }
  return defaultValue;
};

dotenv.config();

const router = express.Router();

// Ensure the temp dir exists (optional but nice to have)
const TMP_DIR = path.join(process.cwd(), "tmp_uploads");
// Ensure the temporary directory exists
await fs.mkdir(TMP_DIR, { recursive: true });
// const upload = multer({ dest: TMP_DIR });
const upload = multer({ storage: multer.memoryStorage() });

import { z } from "zod";

const metaSchema = z.object({
  uploadId: z.string().min(1).optional(),
  sequenceId: z.coerce.number().int().positive(),
  lastChunk: z.coerce.boolean().default(false),
  mime: z.string().optional(),
});

router.post("/upload-chunk", upload.single("file"), async (req, res) => {
    let tmpPath: string | null = null;
  
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded." });
      }
  
      const parsed = metaSchema.parse(req.body); // assumes your zod schema
      const uploadId = parsed.uploadId ?? uuidv4();
      const sequenceId = parsed.sequenceId;
      const lastChunk = !!parsed.lastChunk;
      const mimeType = req.file.mimetype || parsed.mime || "audio/mpeg";
  
      // 1) Find or create the recording document
      let rec = await Recording.findOne({ uploadId });
      if (!rec) {
        rec = await Recording.create({
          uploadId,
          audio: [],
          transcript: [],
          summary: "",
          action: [],
          speakers: [],
          isComplete: false,
        });
      }
  
      // 2) Upload buffer to Cloudinary
      const { publicId, secure_url } = await uploadAudio(req.file.buffer, {
        uploadId,
        sequenceId,
        mime: mimeType,
      });
  
      // 3) Persist audio item
      rec.audio.push({
        sq: (rec.audio?.length ?? 0) + 1,
        publicId,
        secureUrl: secure_url,
        sequenceId,
      });
  
      // 4) Write a temp file for Gemini (since generateFullTranscript expects a path)
      tmpPath = path.join(TMP_DIR, `${uploadId}-${sequenceId}-${Date.now()}`);
      await fs.writeFile(tmpPath, req.file.buffer);
      
      // 5) Transcribe + diarize this chunk
      const result = await generateFullTranscript(tmpPath, mimeType);
  
      // 6) Append transcript (tag with current sequence for traceability)
      rec.transcript.push(
        ...result.transcript.map(t => ({
          speaker: t.speaker,
          text: t.text,
          start_ms: t.start_ms,
          end_ms: t.end_ms,
          notes: t.notes,
          // optional: store per-chunk seq reference
          sq: sequenceId,
        }))
      );
  
      // 7) Merge running summary with current chunk summary (LLM merge)
      rec.summary = (await mergeSummaries(rec.summary || "", result.summary || "")) || "";
  
      // 8) Accumulate actions; only dedupe at the end to save LLM calls
      if (Array.isArray(result.action) && result.action.length) {
        rec.action.push(...result.action);
      }
  
      // 9) Mark complete on final chunk + dedupe actions once
      if (lastChunk) {
        rec.isComplete = true;
        rec.action = await dedupeActions(rec.action);
      }
  
      await rec.save();
  
      // 10) Respond
      if (lastChunk) {
        return res.json({
          text: rec.transcript,
          audio: rec.audio,
          summary: rec.summary || "",
          action: rec.action || [],
          uploadId,
          isComplete: rec.isComplete,
        });
      }
  
      return res.json({ success: true, uploadId, sequenceId, text: rec.transcript, summary: rec.summary, action: rec.action, isComplete: rec.isComplete });
    } catch (err: any) {
      console.error("Chunk ingest error:", err);
      return res.status(400).json({ message: err?.message || "Bad request" });
    } finally {
      // Clean up temp file if created
      if (tmpPath) {
        try { await fs.unlink(tmpPath); } catch {}
      }
    }
  });

  router.post("/upload-and-transcribe", upload.single("file"),async (req, res) => {
    if (!req.file) {
      return res.status(400).send("No file uploaded.");
    }

    const { path: filePath, mimetype } = req.file;

    try {
      const transcript = await generateFullTranscript(filePath, mimetype);
      return res.json({ transcript });
    } catch (error) {
      console.error("Error processing file:", error);
      return res.status(500).send("Error processing file.");
    } finally {
      // Always try to clean up the local temp file
      try {
        await fs.unlink(filePath);
      } catch (e) {
        // If the file was already removed or not found, swallow the error
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn("Failed to delete temp file:", e);
        }
      }
    }
  }
);
  

export default router;
