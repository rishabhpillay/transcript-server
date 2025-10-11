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
router.post('/recordings', async (req, res) => {
  try {
    const { uid } = (req.body ?? {}) as { uid?: string };
    console.log({req});
    
    if (!uid) return res.status(400).json({ message: 'uid is required' });

    const recordings = await Recording.find({ uid })
      .sort({ createdAt: -1 })
      .lean();

    return res.json(recordings);
  } catch (err: any) {
    return res
      .status(500)
      .json({ message: err?.message || 'Failed to fetch recordings' });
  }
});

/**
 * NEW: Single-shot transcription API
 * POST /api/ingest/transcribe
 * multipart/form-data:
 *   - audio: (file) required
 *   - mime:  (string) optional, e.g. audio/webm, audio/m4a
 *
 * Response 200:
 * {
 *   transcript: Array<{ date_time: string; speaker: string; text: string; start_ms?: number; end_ms?: number; notes?: string }>,
 *   summary: string,
 *   action: string[]
 * }
 */
router.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Missing audio file (field name: audio)' });

    const mime = (req.file.mimetype || (req.body?.mime as string) || 'audio/webm') as string;

    // Call Gemini for transcription + diarization
    const recordingStart = new Date();
    const diarized = await transcribeAndDiarize(
      req.file.buffer,
      mime,
      0,                 // chunkStartTimeSec (0 for one-shot)
      recordingStart     // recordingStartTime
    );

    // Support both shapes we've used before:
    // - diarized.text: [{ date_time, speaker, text, start_ms?, end_ms?, notes? }]
    // - diarized.transcript: [{ speaker, text, start_ms?, end_ms?, notes? }]
    const nowIso = new Date().toISOString();
    const rawItems: any[] = Array.isArray((diarized as any)?.text)
      ? (diarized as any).text
      : Array.isArray((diarized as any)?.transcript)
      ? (diarized as any).transcript
      : [];

    const transcript = rawItems.map((seg) => {
      const speaker = seg.speaker || 'Speaker 1';
      const text = seg.text || '';
      const start_ms = typeof seg.start_ms === 'number' ? seg.start_ms : undefined;

      let date_time = seg.date_time || nowIso;
      if (!seg.date_time && typeof start_ms === 'number') {
        date_time = new Date(recordingStart.getTime() + start_ms).toISOString();
      }

      return {
        date_time,
        speaker,
        text,
        start_ms: seg.start_ms,
        end_ms: seg.end_ms,
        notes: seg.notes || '',
      };
    });

    const { summary, action } = await summarizeAndActions(transcript);

    return res.status(200).json({ transcript, summary, action });
  } catch (err: any) {
    return res.status(500).json({ message: err?.message || 'Transcription failed' });
  }
});


export default router;

