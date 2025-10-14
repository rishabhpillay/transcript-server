// deepgramDiarize.ts
import { createClient } from "@deepgram/sdk";
import * as dotenv from "dotenv";
import * as fs from "fs/promises";
import * as path from "path";
import { Readable } from "stream";

dotenv.config();

if (!process.env.DEEPGRAM_API_KEY) {
  throw new Error("DEEPGRAM_API_KEY is not set in the .env file.");
}

const dg = createClient(process.env.DEEPGRAM_API_KEY);

/* ---------------- utils ---------------- */
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetries<T>(
  fn: () => Promise<T>,
  label: string,
  attempts = 3
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const delay = 1000 * Math.pow(2, i);
      console.warn(`${label} failed (attempt ${i + 1}/${attempts}). Retrying in ${delay}ms…`, err);
      await sleep(delay);
    }
  }
  throw lastErr;
}

/* ------------- types you return ------------- */
export type SpeakerSegment = {
  speaker: string;   // "Speaker 1"
  start_ms: number;  // e.g. 0
  end_ms: number;    // e.g. 4200
};

export type DiarizeSegmentsResult = {
  transcript: SpeakerSegment[];
};

/* ------------- file-path variant ------------- */
export async function diarizeSegments(
  filePath: string,
  mimeType: string,
  options?: { model?: string; language?: string }
): Promise<DiarizeSegmentsResult> {
  const model = options?.model ?? "nova-3";
  const language = options?.language ?? "en";

  const abs = path.resolve(filePath);
  const buffer = await fs.readFile(abs);

  const { result, error } = await withRetries(
    () =>
      dg.listen.prerecorded.transcribeFile(
        Readable.from(buffer),
        {
          model,
          language,
          diarize: true,
          utterances: true,   // needed to get speaker-grouped segments
          smart_format: false,
          punctuate: false,
          mimetype: mimeType || "audio/wav" // Move mimetype to options
        }
      ),
    "deepgram.transcribeFile(file)"
  );

  if (error) {
    const detail = typeof error === "object" ? JSON.stringify(error) : String(error);
    throw new Error(`Deepgram diarization failed: ${detail}`);
  }

  const dgUtterances: any[] = (result as any)?.results?.utterances ?? [];

  const transcript: SpeakerSegment[] = dgUtterances.map((u) => ({
    speaker: `Speaker ${Number(u.speaker) + 1}`,
    start_ms: Math.round((u.start ?? 0) * 1000),
    end_ms: Math.round((u.end ?? 0) * 1000),
  }));

  return { transcript };
}

/* ------------- buffer variant (for multipart uploads) ------------- */
export async function diarizeSegmentsFromBuffer(
  audio: { buffer: Buffer; mimeType?: string },
  options?: { model?: string; language?: string }
): Promise<DiarizeSegmentsResult> {
  const model = options?.model ?? "nova-3";
  const language = options?.language ?? "en";

  const { result, error } = await withRetries(
    () =>
      dg.listen.prerecorded.transcribeFile(
        Readable.from(audio.buffer),
        {
          model,
          language,
          diarize: true,
          utterances: true,
          smart_format: false,
          punctuate: false,
          mimetype: audio.mimeType || "audio/wav" // Move mimetype to options
        }
      ),
    "deepgram.transcribeFile(buffer)"
  );

  if (error) {
    const detail = typeof error === "object" ? JSON.stringify(error) : String(error);
    throw new Error(`Deepgram diarization failed: ${detail}`);
  }

  const dgUtterances: any[] = (result as any)?.results?.utterances ?? [];

  const transcript: SpeakerSegment[] = dgUtterances.map((u) => ({
    speaker: `Speaker ${Number(u.speaker) + 1}`,
    start_ms: Math.round((u.start ?? 0) * 1000),
    end_ms: Math.round((u.end ?? 0) * 1000),
  }));

  return { transcript };
}
