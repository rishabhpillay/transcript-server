import { env } from '../config/env.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface DiarizedText {
  text: Array<{ date_time: string; speaker: string; text: string }>;
}

const genAI = env.GEMINI_API_KEY ? new GoogleGenerativeAI(env.GEMINI_API_KEY) : undefined;

export async function transcribeAndDiarize(buffer: Buffer, mime?: string, chunkStartTime?: number, recordingStartTime?: Date): Promise<DiarizedText> {
  if (!genAI) {
    throw new Error('GEMINI_API_KEY missing');
  }
  const model = genAI.getGenerativeModel({ model: env.GEMINI_MODEL });
  const now = new Date().toISOString();
  const SYSTEM_PROMPT = `You are a precise transcription cleaner and diarization formatter.

Task:
- Transcribe the provided audio and produce a clean, readable conversation with speaker diarization.
- Language: Auto-detect. Output in either Hinglish or English (pick the dominant).
- Output must be ONLY JSON following the exact schema below. Do not include any prose outside the JSON.

Diarization & cleanup rules:
1) Identify and consistently label speakers as Speaker 1, Speaker 2, Speaker 3, etc. Keep labels consistent throughout.
2) Merge tiny fragments from the same speaker into coherent sentences.
3) Fix obvious disfluencies (um/uh) and filler words when they don’t change meaning. Keep important hesitations if they matter.
4) Preserve meaning, tone, and proper nouns.
5) If you can infer timestamps, include start_ms and end_ms in milliseconds; otherwise omit both for that item.
6) Add brief notes only when helpful, e.g., [laughter], [crosstalk], [music].

Return only JSON with this schema:
{
  "transcript": [
    {
      "speaker": "Speaker 1",
      "text": "…",
      "start_ms": 0,
      "end_ms": 1240,
      "notes": ""
    }
  ],
  "summary": "Concise 2–4 sentence summary of the conversation.",
  "speakers": ["Speaker 1","Speaker 2","Speaker 3"]
}`.trim();

  const res = await model.generateContent([
    { text: SYSTEM_PROMPT },
    mime
      ? { inlineData: { data: buffer.toString('base64'), mimeType: mime } }
      : { inlineData: { data: buffer.toString('base64'), mimeType: 'audio/webm' } },
  ] as any);

  let raw = res.response.text();
  // Strip markdown fences if present
  if (raw.startsWith('```')) {
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first !== -1 && last !== -1) raw = raw.slice(first, last + 1);
  }

  try {
    const parsed = JSON.parse(raw) as {
      transcript: Array<{ speaker: string; text: string; start_ms?: number; end_ms?: number; notes?: string }>;
      summary?: string;
      speakers?: string[];
    };

    const lines: DiarizedText['text'] = (parsed.transcript || [])
      .map((item) => {
        // Calculate proper timestamp based on audio position
        let timestamp = now;
        if (item.start_ms !== undefined && chunkStartTime !== undefined && recordingStartTime) {
          // Calculate absolute timestamp: recording start + chunk offset + segment offset
          const totalOffsetMs = (chunkStartTime * 1000) + item.start_ms;
          timestamp = new Date(recordingStartTime.getTime() + totalOffsetMs).toISOString();
        } else if (item.start_ms !== undefined && chunkStartTime !== undefined) {
          // Fallback: use chunk start time + segment offset
          const audioTimeInSeconds = chunkStartTime + (item.start_ms / 1000);
          timestamp = new Date(audioTimeInSeconds * 1000).toISOString();
        } else if (item.start_ms !== undefined) {
          // If no chunk start time provided, use relative time from start of recording
          timestamp = new Date(item.start_ms).toISOString();
        }
        
        return {
          date_time: timestamp,
          speaker: item.speaker || 'Speaker 1',
          text: typeof item.text === 'string' ? item.text : '',
        };
      })
      .filter((l) => l.text.trim().length > 0);

    if (lines.length === 0) {
      return { text: [{ date_time: now, speaker: 'Speaker 1', text: parsed.summary || raw }] };
    }
    return { text: lines };
  } catch {
    // Fallback: treat model output as a single speaker line
    return { text: [{ date_time: now, speaker: 'Speaker 1', text: raw }] };
  }
}

