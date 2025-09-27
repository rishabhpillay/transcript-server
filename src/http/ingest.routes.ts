import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import Recording from '../models/Recording.js';
import { uploadAudio } from '../services/cloudinary.js';
import { transcribeAndDiarize } from '../services/gemini.js';
import { summarizeAndActions } from '../services/summary.js';

const router = Router();
const upload = multer();

const metaSchema = z.object({
  uploadId: z.string().min(1).optional(),
  sequenceId: z.coerce.number().int().positive(),
  lastChunk: z.coerce.boolean().default(false),
  mime: z.string().optional(),
});

// POST /api/ingest/chunk
// multipart/form-data with fields: uploadId, sequenceId, lastChunk, mime, and file: chunk
router.post('/chunk', upload.single('chunk'), async (req, res) => {
  try {
    const parsed = metaSchema.parse(req.body);
    if (!req.file) return res.status(400).json({ message: 'Missing file' });

    const uploadId = parsed.uploadId ?? uuidv4();
    let rec = await Recording.findOne({ uploadId });
    if (!rec) {
      // Create a new Recording document on the very first chunk (no uploadId provided)
      rec = await Recording.create({
        uploadId,
        audio: [],
        transcript: [],
        summary: '',
        action: [],
        isComplete: false,
      });
    }

    const { publicId } = await uploadAudio(req.file.buffer, {
      uploadId,
      sequenceId: parsed.sequenceId,
      // Prefer actual incoming file type if provided by multer
      mime: req.file.mimetype || parsed.mime,
    });

    // Calculate chunk start time based on sequence and recording start time
    // For now, assume each chunk is approximately 30 seconds
    const chunkStartTime = (parsed.sequenceId - 1) * 30; // seconds from start of recording
    
    const diarized = await transcribeAndDiarize(req.file.buffer, req.file.mimetype || parsed.mime, chunkStartTime, rec.createdAt);
    rec.audio.push({ sq: parsed.sequenceId, publicId, sequenceId: parsed.sequenceId });
    rec.transcript.push(...diarized.text);

    if (parsed.lastChunk) {
      const { summary, action } = await summarizeAndActions(rec.transcript as any);
      rec.summary = summary;
      rec.action = action;
      rec.isComplete = true;
    }
    await rec.save();

    if (parsed.lastChunk) {
      return res.json({
        text: rec.transcript,
        audio: rec.audio,
        summary: rec.summary || '',
        action: rec.action || [],
        uploadId,
      });
    }
    return res.json({ success: true, uploadId, sequenceId: parsed.sequenceId });
  } catch (err: any) {
    return res.status(400).json({ message: err?.message || 'Bad request' });
  }
});

// GET /api/ingest/recordings - list all recordings (newest first)
router.get('/recordings', async (_req, res) => {
  try {
    const recordings = await Recording.find({}).sort({ createdAt: -1 }).lean();
    return res.json(recordings);
  } catch (err: any) {
    return res.status(500).json({ message: err?.message || 'Failed to fetch recordings' });
  }
});

export default router;

