import * as dotenv from "dotenv";
import express from "express";
import multer from "multer";
import { promises as fs } from "fs";
import path from "path";
import { generateFullTranscript } from "../services/transcript.js";

import { v4 as uuidv4 } from "uuid";
import Recording from "../models/Recording.js";
import { uploadAudio } from "../services/cloudinary.js";
import { mergeTitleAndSummary } from "../services/mergeTitleAndSummary.js";
import { dedupeActions } from "../services/actions.js";
import { diarizeSegmentsFromBuffer } from "../services/diarize.js";
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
import { mergeDiarization } from "../services/mergeDiarization.js";
import { speakerDiarize } from "../ai/pyannote/speakerDiarize.js";
import { mergeSegmentsWithTranscript } from "../services/mergeSegmentsWithTranscript.js";
import { notifyDiscord } from "../utils/notifyDiscord.js";
import { mergeTranscriptWithSegments } from "../services/mergeTranscriptWithSegments.js";
import { generateTranscript } from "../ai/gemini/transcript.js";
import { generateOrUpdateSummaryFromTranscript } from "../ai/gemini/generateOrUpdateSummaryFromTranscript.js";

const metaSchema = z.object({
  uid: z.string().min(1).optional(),
  uploadId: z.string().min(1).optional(),
  sequenceId: z.coerce.number().int().positive(),
  lastChunk: z.string(),
  mime: z.string().optional(),
  totalDuration: z.string().optional(),
});

function normalizeMimeForGemini(m: string | undefined): string {
  const mime = (m || "").toLowerCase();
  if (mime === "video/mp4") return "audio/mp4"; // Android commonly sends video/mp4
  if (!mime || mime === "application/octet-stream") return "audio/mp4";
  return mime;
}

router.post("/upload-chunk", upload.any(), async (req, res) => {
  let tmpPath: string | null = null;

  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "No file uploaded." });
    }
    const file = (req.files as Express.Multer.File[])[0];

    const parsed = metaSchema.parse(req.body);

    const uid = parsed.uid;
    if (!uid) return res.status(400).json({ message: "uid is required" });

    const uploadId = parsed.uploadId ?? uuidv4();
    const sequenceId = parsed.sequenceId;
    const lastChunk = parsed.lastChunk === "true";

    /* capture raw client mime, then derive two mimes */
    const rawMime =
      file.mimetype || parsed.mime || "application/octet-stream";
    const cloudinaryMime = rawMime; // what Cloudinary sees
    const geminiMime = normalizeMimeForGemini(rawMime); // what Gemini sees

    await notifyDiscord({
      type: "info",
      title: "upload-chunk api call ",
      step: "received",
      meta: {
        files: req.files,
        file_fieldname: file.fieldname,
        uploadId : parsed.uploadId,
        sequenceId,
        lastChunk,
        mime: rawMime,
      },
    });

    // 1) Find or create the recording document
    let rec = await Recording.findOne({ uploadId });
    if (!rec) {
      rec = await Recording.create({
        uid,
        uploadId,
        audio: [],
        transcript: [],
        summary: "",
        action: [],
        speakers: [],
        isComplete: false,
        title: "",
      });
    }

    // 2) Upload buffer to Cloudinary
    const { publicId, secureUrl } = await uploadAudio(file.buffer, {
      uploadId,
      sequenceId,
      mime: cloudinaryMime,
    });

    // 3) Persist audio item
    rec.audio.push({
      sq: (rec.audio?.length ?? 0) + 1,
      publicId,
      secureUrl,
      sequenceId,
    });

    // 4) Write a temp file for Gemini (since generateFullTranscript expects a path)
    tmpPath = path.join(TMP_DIR, `${uploadId}-${sequenceId}-${Date.now()}.bin`);
    await fs.writeFile(tmpPath, file.buffer);

    // 5) Transcribe + diarize this chunk

    // When using Multer memoryStorage there is no file path; the buffer is in memory
    const fileBuffer = file.buffer;

    await notifyDiscord({
      type: "info",
      title: "upload-chunk",
      step: "Diarize",
      message: "Diarize start"
    });

    const diarizeOut = await speakerDiarize({
      uploadId,
      sequenceId,
      isFinal: lastChunk,
      audio: {
        buffer: fileBuffer,
        mime: geminiMime, // prefer normalized mime
        originalName: file.originalname,
      },
    });

    const segments = diarizeOut?.ok ? diarizeOut.segments : [];

    await notifyDiscord({
      type: "info",      
      title: "upload-chunk",
      step: "Diarize",
      message: "Diarize response",
      meta: {
        segments
      }
    });

    // 6) Transcribe this chunk with Gemini
    await notifyDiscord({
      type: "info",
      title: "upload-chunk",
      step: "Transcribe",
      message: "Transcribe start"
    });
    
    const { transcript } = await generateTranscript(tmpPath, geminiMime);

    await notifyDiscord({
      type: "info",      
      title: "upload-chunk",
      step: "Transcribe",
      message: "Transcribe response",
      meta: {
        transcript
      }
    });

    // 7) Merge diarization segments with transcript speakers
    const { transcript: merged }= mergeTranscriptWithSegments( transcript, segments );

    await notifyDiscord({
      type: "info",      
      title: "upload-chunk",
      step: "mergeSegmentsWithTranscript",
      message: "merged response",
      meta: {
        merged
      }
    });

     // 8) Append merged transcript to recording (tag with current sequence)
     rec.transcript.push(
        ...merged.map((t: any) => ({
        speaker: t.speaker,
        text: t.text,
        start_ms: t.start,
        end_ms: t.end,
        notes: t.notes,
        sq: sequenceId,
      }))
    );

    // 9) Generate / update summary + title + action from transcript
    let summary: string = rec.summary || "";
    let title: string = rec.title || "";
    let action: string[] = Array.isArray(rec.action) ? rec.action : [];

    if (sequenceId === 1 && !rec.summary) {
      // first chunk for this upload: fresh summary
      const result = await generateOrUpdateSummaryFromTranscript({
        transcript: merged,
      });
      summary = result.summary;
      title = result.title;
      action = result.action;
    } else {
      // subsequent chunks: merge with previous summary data
      const result = await generateOrUpdateSummaryFromTranscript({
        transcript: merged,
        previousSummary: {
          summary: rec.summary || "",
          title: rec.title || "",
          action: Array.isArray(rec.action) ? rec.action : [],
        },
      });
      summary = result.summary;
      title = result.title;
      action = result.action;
    }

    // const mergedLines = mergeDiarization(
    //   diarizeResult.transcript,
    //   TranscribeResult.transcript
    // );

   

    // 7) Merge running summary with current chunk summary (LLM merge)
    // const mergeTitleAndSummaryResult = await mergeTitleAndSummary({
    //   previousTitle: TranscribeResult.title,
    //   previousSummary: rec.summary,
    //   newTitle: TranscribeResult.title,
    //   newSummary: TranscribeResult.summary,
    // });

    // 10) Update summary/title/action on the recording
    rec.summary = summary;
    rec.title = title;
    rec.action = action;

    // rec.summary = mergeTitleAndSummaryResult.summary;
    // rec.title = mergeTitleAndSummaryResult.title;

    // 8) Accumulate actions; only dedupe at the end to save LLM calls
    // if (
    //   Array.isArray(TranscribeResult.action) &&
    //   TranscribeResult.action.length
    // ) {
    //   rec.action.push(...TranscribeResult.action);
    // }

    // 11) Mark complete on final chunk
    if (lastChunk) {
      rec.isComplete = true;
      console.log(parsed.totalDuration);
      rec.totalDuration = parsed.totalDuration || "";
    }

    await rec.save();

    // 12) Respond
    if (lastChunk) {
      return res.json({
        text: rec.transcript,
        audio: rec.audio,
        summary: rec.summary || "",
        action: rec.action || [],
        uploadId,
        isComplete: rec.isComplete,
        uid: rec.uid,
        title: rec.title,
        totalDuration: rec.totalDuration
      });
    }

    return res.json({
      success: true,
      uploadId,
      sequenceId,
      text: rec.transcript,
      summary: rec.summary,
      action: rec.action,
      isComplete: rec.isComplete,
      uid: rec.uid,
      title: rec.title,
      totalDuration: rec.totalDuration,
      segments: segments,
      transcript: transcript,

    });
  } catch (err: any) {
    console.error("Chunk ingest error:", err);
    return res.status(400).json({ message: err?.message || "Bad request" });
  } finally {
    // Clean up temp file if created
    if (tmpPath) {
      try {
        await fs.unlink(tmpPath);
      } catch {}
    }
  }
});

export default router;
