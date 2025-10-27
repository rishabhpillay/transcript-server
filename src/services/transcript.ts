import { GoogleGenAI, FileState } from "@google/genai";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config();

const MODEL_NAME = "gemini-2.5-flash";

const DIARIZATION_SCHEMA = {
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

// Simple retry helper with exponential backoff
async function withRetries<T>(
  fn: () => Promise<T>,
  label: string,
  attempts = 3
) {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const delay = 1000 * Math.pow(2, i); // 1s, 2s, 4s
      console.warn(
        `${label} failed (attempt ${
          i + 1
        }/${attempts}). Retrying in ${delay}ms…`,
        err
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

export async function generateFullTranscript(
  filePath: string,
  mimeType: string
): Promise<{
  transcript: Array<{
    speaker: string;
    text: string;
    start_ms: number;
    end_ms: number;
    notes: string;
  }>;
  summary: string;
  action: string[];
}> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set in the .env file.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  let uploadedFile: { name?: string; state?: FileState; uri?: string } | null =
    null;
  let uploadedName: string | null = null;
  let uploadedUri: string | null = null;

  try {
    console.log(`Starting upload for: ${path.basename(filePath)}...`);

    uploadedFile = await ai.files.upload({
      file: filePath,
      config: { mimeType, displayName: path.basename(filePath) },
    });

    if (!uploadedFile.name || !uploadedFile.uri) {
      throw new Error("Upload response missing 'name' or 'uri'.");
    }
    uploadedName = uploadedFile.name;
    uploadedUri = uploadedFile.uri;

    console.log(
      `Upload complete. File Name: ${uploadedName}, URI: ${uploadedUri}`
    );

    // Wait for ACTIVE
    if (uploadedFile.state !== FileState.ACTIVE) {
      console.log("File is processing. Waiting for completion...");
      while (uploadedFile.state === FileState.PROCESSING) {
        await sleep(15000);
        uploadedFile = await ai.files.get({ name: uploadedName });
        console.log(`Current file state: ${uploadedFile.state}`);
      }
      if (uploadedFile.state !== FileState.ACTIVE) {
        throw new Error(
          `File processing failed. Final state: ${uploadedFile.state}`
        );
      }
    }

    console.log("File is ready (ACTIVE) for model use. ✅");

    //     const promptText = `
    // You are given an audio/video file. Produce a diarized transcript and concise summary with next actions.

    // Rules:
    // - Segment into ~5–20s utterances (longer is fine if uninterrupted).
    // - Speakers labeled "Speaker 1", "Speaker 2", ...; keep consistent by voice.
    // - Use millisecond offsets from media start: start_ms, end_ms.
    // - notes: non-speech events (laughter/music), acronym expansions, or important context; else "".
    // - summary: 2–4 sentences, crisp and neutral.
    // - action: short list of concrete next steps; imperative phrasing.
    // - Return ONLY valid JSON matching the provided schema. No markdown or prose outside JSON.
    // `.trim();
    const promptText = `
You are given an audio/video file. Produce:
1) A diarized transcript in HINDLISH (Hindi + English mixed) using ROMAN script only (no Devanagari).
   - Example style: "kal 3 PM ko meeting fix karte hain", "client ko follow-up email bhejna hai".
   - Keep technical terms/product names/acronyms in English (e.g., API, SSO, Cloudinary).
   - Use clear punctuation; numbers/times in Arabic numerals (0–9).

2) A concise SUMMARY in ENGLISH (2–4 sentences, crisp and neutral).

3) ACTION items in ENGLISH (imperative, concrete, short).

General rules:
- Segment transcript into ~5–20s utterances (longer is fine if uninterrupted).
- Speakers labeled "Speaker 1", "Speaker 2", ...; keep consistent by voice.
- Use millisecond offsets from media start: start_ms, end_ms.
- notes: non-speech events (e.g., [laughter], [music]), acronym expansions, or key context; else "".
- Return ONLY valid JSON matching the provided schema. No markdown or prose outside JSON.
`.trim();
    console.log(`\nSending structured prompt to ${MODEL_NAME}...`);

    // IMPORTANT: Use a single content with role + parts
    const response = await withRetries(
      () =>
        ai.models.generateContent({
          model: MODEL_NAME,
          contents: [
            {
              role: "user",
              parts: [
                { text: promptText },
                { fileData: { mimeType, fileUri: uploadedUri! } },
              ],
            },
          ],
          // Correct key is "config"
          config: {
            temperature: 0.2,
            responseMimeType: "application/json",
            responseSchema: DIARIZATION_SCHEMA,
          },
        }),
      "generateContent"
    );

    const raw = response.text;
    const parsed = JSON.parse(raw || "");

    // quick shape check
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray(parsed.transcript)
    ) {
      throw new Error("Model did not return the expected JSON structure.");
    }

    return parsed;
  } finally {
    if (uploadedName) {
      try {
        console.log(`\nDeleting file ${uploadedName}...`);
        await ai.files.delete({ name: uploadedName });
        console.log("File deleted successfully. 🗑️");
      } catch (e) {
        console.warn("Failed to delete remote file:", e);
      }
    }
  }
}
