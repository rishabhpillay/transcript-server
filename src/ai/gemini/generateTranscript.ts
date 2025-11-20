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
          // seconds as floating-point numbers
          start: { type: "number" },
          end: { type: "number" },
          notes: { type: "string" },
        },
        required: ["speaker", "text", "start", "end", "notes"],
        additionalProperties: false,
      },
    },
  },
  required: ["transcript"],
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
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const delay = 1000 * Math.pow(2, i); // 1s, 2s, 4s
      console.warn(
        `${label} failed (attempt ${i + 1}/${attempts}). Retrying in ${delay}ms…`,
        err
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

export async function generateTranscript(
  filePath: string,
  mimeType: string
): Promise<{
  transcript: Array<{
    speaker: string;
    text: string;
    start: number;
    end: number;
    notes: string;
  }>;
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

    const promptText = `
You are given an audio/video file. Produce ONLY:

1) A diarized transcript in HINDLISH (Hindi + English mixed) using ROMAN script only (no Devanagari).
   - Example style: "kal 3 PM ko meeting fix karte hain", "client ko follow-up email bhejna hai".
   - Keep technical terms/product names/acronyms in English (e.g., API, SSO, Cloudinary).
   - Use clear punctuation; numbers/times in Arabic numerals (0–9).

General rules:
- **CRITICAL:** If the audio is silent, empty, or contains only noise (no human speech), you MUST return this exact JSON object:
  {
    "transcript": []
  }
- Segment transcript into ~5–20s utterances (longer is fine if uninterrupted).
- Speakers labeled "Speaker 1", "Speaker 2", ...; keep consistent by voice.
- Use SECOND offsets from media start: "start" and "end" (e.g., 12.3, 45.0).
- "notes": non-speech events (e.g., [laughter], [music]), acronym expansions, or key context; else "".
- Return ONLY valid JSON matching the provided schema. No markdown or prose outside JSON.
`.trim();

    console.log(`\nSending structured prompt to ${MODEL_NAME}...`);

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
          config: {
            temperature: 0.2,
            responseMimeType: "application/json",
            responseSchema: DIARIZATION_SCHEMA,
          },
        }),
      "generateContent"
    );

    // Be tolerant of SDK shape differences
    // @ts-ignore
    const raw = (response && response.text) || "";
    const parsed = JSON.parse(raw || "{}");

    // quick shape check
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray(parsed.transcript)
    ) {
      throw new Error("Model did not return the expected JSON structure.");
    }

    // Normalize transcript to ensure proper types and seconds-based timestamps
    const transcript = parsed.transcript.map((item: any) => {
      const hasSeconds =
        typeof item.start === "number" && typeof item.end === "number";
      const hasMs =
        typeof item.start_ms === "number" && typeof item.end_ms === "number";

      const start = hasSeconds
        ? item.start
        : hasMs
        ? item.start_ms / 1000
        : 0;
      const end = hasSeconds ? item.end : hasMs ? item.end_ms / 1000 : 0;

      return {
        speaker: String(item.speaker ?? ""),
        text: String(item.text ?? ""),
        start,
        end,
        notes: typeof item.notes === "string" ? item.notes : "",
      };
    });

    return { transcript };
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
