// services/chunkTranscript.ts
import { GoogleGenAI, FileState } from "@google/genai";
import * as path from "path";
import Recording from "../models/Recording.js";

const MODEL_NAME = "gemini-2.5-flash";

export const DIARIZATION_SCHEMA = {
  type: "object",
  properties: {
    transcript: {
      type: "array",
      items: {
        type: "object",
        properties: {
          speaker: { type: "string" },
          text: { type: "string" },
          start_ms: { type: "integer" },
          end_ms: { type: "integer" },
          notes: { type: "string" },
        },
        required: ["speaker", "text", "start_ms", "end_ms", "notes"],
        additionalProperties: false,
      },
    },
    summary: { type: "string" },
    action: { type: "array", items: { type: "string" } },
  },
  required: ["transcript", "summary", "action"],
  additionalProperties: false,
} as const;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetries<T>(fn: () => Promise<T>, label: string, attempts = 3) {
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

function buildKnownSpeakersInstruction(speakers: string[]): string {
  if (!speakers?.length) {
    return `No known speakers yet. Start labeling with "Speaker 1", then "Speaker 2", etc.`;
  }
  return `Known speakers so far (keep labels consistent by voice): ${speakers.join(", ")}.
- If a new voice appears, assign the next number (e.g., "Speaker ${speakers.length + 1}").
- Do NOT reuse a label for a different voice.`;
}

function buildContextPrompt(knownSpeakers: string[], priorSummary: string | undefined) {
  const speakersNote = buildKnownSpeakersInstruction(knownSpeakers);
  const prior = priorSummary?.trim()
    ? `Previous summary:\n${priorSummary.trim()}\n\nUse it as context to keep naming/intent consistent.`
    : `No previous summary.`;
  return `
You will receive an audio/video chunk (part of a longer session).

${speakersNote}

${prior}

Rules:
- Segment into ~5–20s utterances (longer is fine if uninterrupted).
- Speakers labeled exactly "Speaker 1", "Speaker 2", ...; keep consistent across chunks by VOICE.
- Use millisecond offsets RELATIVE TO THIS CHUNK START: start_ms, end_ms.
- notes: non-speech events (laughter/music), acronym expansions, or important context; else "".
- summary: 1–3 sentences about THIS CHUNK only (concise & neutral).
- action: short list (0–6) of concrete next steps from THIS CHUNK; imperative phrasing.
- Return ONLY valid JSON per the response schema. No prose outside JSON.
`.trim();
}

/**
 * Merge two summaries into one crisp, non-redundant 2–4 sentence summary.
 * We call the model because it’s better than naive concatenation.
 */
async function mergeSummaries(ai: GoogleGenAI, prev: string, current: string): Promise<string> {
  const prompt = `
Combine these two summaries into a single concise, non-redundant 2–4 sentence summary:
---
A) ${prev || "(empty)"}
---
B) ${current || "(empty)"}
---
Keep it neutral and specific. Return plain text only.`.trim();

  const resp = await withRetries(
    () =>
      ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { temperature: 0.2, responseMimeType: "text/plain" },
      }),
    "mergeSummaries"
  );
  // @ts-ignore (SDK returns .text)
  return (resp?.text || "").trim();
}

export async function processChunkWithGemini(params: {
  localFilePath: string;
  mimeType: string;
  priorSummary: string | undefined;
  knownSpeakers: string[];
}): Promise<{
  transcript: Array<{ speaker: string; text: string; start_ms: number; end_ms: number; notes: string }>;
  summary: string;
  action: string[];
}> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not set");
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  let uploadedFile: { name?: string; state?: FileState; uri?: string } | null = null;
  let uploadedName: string | null = null;
  let uploadedUri: string | null = null;

  try {
    uploadedFile = await ai.files.upload({
      file: params.localFilePath,
      config: { mimeType: params.mimeType, displayName: path.basename(params.localFilePath) },
    });

    if (!uploadedFile.name || !uploadedFile.uri) {
      throw new Error("Upload response missing 'name' or 'uri'.");
    }
    uploadedName = uploadedFile.name;
    uploadedUri  = uploadedFile.uri;

    if (uploadedFile.state !== FileState.ACTIVE) {
      while (uploadedFile.state === FileState.PROCESSING) {
        await sleep(6000);
        uploadedFile = await ai.files.get({ name: uploadedName });
      }
      if (uploadedFile.state !== FileState.ACTIVE) {
        throw new Error(`File processing failed. Final state: ${uploadedFile.state}`);
      }
    }

    const context = buildContextPrompt(params.knownSpeakers, params.priorSummary);

    const response = await withRetries(
      () =>
        ai.models.generateContent({
          model: MODEL_NAME,
          contents: [
            {
              role: "user",
              parts: [{ text: context }, { fileData: { mimeType: params.mimeType, fileUri: uploadedUri! } }],
            },
          ],
          config: {
            temperature: 0.2,
            responseMimeType: "application/json",
            responseSchema: DIARIZATION_SCHEMA,
          },
        }),
      "generateContent(chunk)"
    );

    // @ts-ignore
    const raw = response?.text || "";
    const parsed = JSON.parse(raw);

    if (!parsed || !Array.isArray(parsed.transcript)) {
      throw new Error("Model did not return expected transcript structure.");
    }

    return parsed;
  } finally {
    if (uploadedName) {
      try {
        await ai.files.delete({ name: uploadedName });
      } catch (e) {
        console.warn("Failed to delete remote file:", e);
      }
    }
  }
}

/**
 * Reconcile speaker labels:
 * - Ensure labels exist in recording.speakers (append any new labels at the end).
 * - Keep the "Speaker N" labels coming from the model as-is, but extend registry
 *   so future chunks know which numbers are already used.
 * (If you ever decide to do voice-embedding matching, you can map here.)
 */
export function reconcileSpeakers(recordingSpeakers: string[], chunkSpeakers: string[]): string[] {
  const set = new Set(recordingSpeakers);
  for (const s of chunkSpeakers) {
    if (!set.has(s)) {
      set.add(s);
      recordingSpeakers.push(s);
    }
  }
  // Return updated registry (mutated in place above)
  return recordingSpeakers;
}

export async function applyChunkResultToRecording(args: {
  uploadId: string;
  result: {
    transcript: Array<{ speaker: string; text: string; start_ms: number; end_ms: number; notes: string }>;
    summary: string;
    action: string[];
  };
  lastChunk: boolean;
}) {
  const rec = await Recording.findOne({ uploadId: args.uploadId });
  if (!rec) throw new Error("Recording not found for uploadId: " + args.uploadId);

  // Extend speaker registry from chunk labels
  const uniqueLabelsInChunk = Array.from(new Set(args.result.transcript.map(t => t.speaker)));
  rec.speakers = reconcileSpeakers(rec.speakers || [], uniqueLabelsInChunk);

  // Append transcript lines (as-is; they are relative to chunk start, which is fine)
  for (const line of args.result.transcript) {
    rec.transcript.push({
      speaker: line.speaker,
      text: line.text,
      start_ms: line.start_ms,
      end_ms: line.end_ms,
      notes: line.notes || "",
    });
  }

  // Merge summary with LLM for concision
  if (rec.summary && args.result.summary) {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    rec.summary = await mergeSummaries(ai, rec.summary, args.result.summary);
  } else if (!rec.summary) {
    rec.summary = args.result.summary || "";
  }

  // Append action items (dedupe, keep order: existing first, then new)
  const existing = new Set(rec.action || []);
  const combined = [...(rec.action || [])];
  for (const a of args.result.action || []) {
    const trimmed = (a || "").trim();
    if (trimmed && !existing.has(trimmed)) {
      existing.add(trimmed);
      combined.push(trimmed);
    }
  }
  rec.action = combined;

  if (args.lastChunk) {
    rec.isComplete = true;
  }

  await rec.save();
  return rec;
}
