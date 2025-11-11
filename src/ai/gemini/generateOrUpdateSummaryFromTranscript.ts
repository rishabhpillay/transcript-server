import { GoogleGenAI } from "@google/genai";
import * as dotenv from "dotenv";

dotenv.config();

const MODEL_NAME = "gemini-2.5-flash";

// ✅ Match the output of generateFullTranscript
export type TranscriptItem = {
  speaker: string;
  text: string;
  start: number; // seconds
  end: number;   // seconds
  notes: string;
};

export type SummaryBlock = {
  summary: string;
  title: string;
  action: string[];
};

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    title: { type: "string" },
    action: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["summary", "title", "action"],
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

/**
 * Build a compact, readable text representation of the transcript.
 * Example line:
 *   #1 [0.0s–0.8s] Speaker 1: Hello
 */
function transcriptToText(transcript: TranscriptItem[]): string {
  if (!transcript.length) return "(empty transcript)";

  return transcript
    .map((t, i) => {
      const startSec = t.start.toFixed(1);
      const endSec = t.end.toFixed(1);
      const speakerLabel = t.speaker || "Speaker";
      return `#${i + 1} [${startSec}s–${endSec}s] ${speakerLabel}: ${t.text}`;
    })
    .join("\n");
}

/**
 * Use Gemini to generate (or update) summary/title/action from transcript.
 *
 * - If previousSummary is NOT provided:
 *     Generate a fresh summary/title/action for the transcript.
 *
 * - If previousSummary IS provided:
 *     Merge the previous summary/title/action with the new transcript
 *     into an updated summary/title/action that covers everything.
 */
export async function generateOrUpdateSummaryFromTranscript(params: {
  transcript: TranscriptItem[];
  previousSummary?: SummaryBlock;
}): Promise<SummaryBlock> {
  const { transcript, previousSummary } = params;

  // Short-circuit if transcript is empty
  if (!transcript || transcript.length === 0) {
    if (previousSummary) {
      // Nothing new: just return previous as-is
      return previousSummary;
    }
    return {
      summary: "No content available in the transcript.",
      title: "Empty Transcript",
      action: [],
    };
  }

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set in the .env file.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const transcriptText = transcriptToText(transcript);
  const hasPrevious = !!previousSummary;

  const baseInstructions = `
You are an assistant that summarizes informal spoken conversations (often in Hindlish: Hindi + English mix).

Your job is to produce strictly this JSON shape:
{
  "summary": string,   // concise paragraph in ENGLISH
  "title": string,     // short, descriptive title in ENGLISH (max 12 words, no trailing punctuation)
  "action": string[]   // list of concrete, imperative action items in ENGLISH
}

Guidelines:
- The SUMMARY:
  - 2–5 sentences, in neutral, clear ENGLISH.
  - Capture key topics, decisions, and context.
- The TITLE:
  - Short, descriptive, in ENGLISH.
  - Max 12 words, no trailing period.
  - E.g., "Planning Weekend Outing After Cricket Match".
- The ACTION array:
  - Each item is an imperative sentence in ENGLISH.
  - Focus on tasks or follow-ups (e.g., "Plan dinner at a Chinese restaurant after the match").
  - If no clear actions, return [] (empty array).

You MUST return ONLY valid JSON matching the schema above.
No markdown, no explanations outside JSON.
`.trim();

  const transcriptBlock = `
NEW TRANSCRIPT (chronological order, seconds-based timestamps):
${transcriptText}
`.trim();

  let userPrompt: string;

  if (hasPrevious) {
    const prev = JSON.stringify(previousSummary, null, 2);

    userPrompt = `
${baseInstructions}

You are given:
1) PREVIOUS SUMMARY BLOCK (running summary from earlier transcript chunks):
${prev}

2) ${transcriptBlock}

Task:
- Treat the previous summary/title/action as an earlier, partial view of the same conversation or topic.
- Read the new transcript carefully.
- Produce an UPDATED "summary", "title", and "action" that:
  - Incorporates all important information from BOTH the previous summary block AND the new transcript.
  - Avoids duplicate actions; merge similar actions into one clear item.
  - Updates or refines the title if needed to reflect the full conversation.
  - Keeps the summary focused and non-repetitive.

Return ONLY the final merged JSON object.
`.trim();
  } else {
    userPrompt = `
${baseInstructions}

You are given ONLY a fresh transcript chunk.

${transcriptBlock}

Task:
- Generate a NEW "summary", "title", and "action" describing ONLY this transcript.
- Do NOT invent extra context.
- If there are no actionable items, return an empty "action": [].

Return ONLY the JSON object.
`.trim();
  }

  const response = await withRetries(
    () =>
      ai.models.generateContent({
        model: MODEL_NAME,
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }],
          },
        ],
        config: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: SUMMARY_SCHEMA,
        },
      }),
    "generateSummaryFromTranscript"
  );

  // Depending on SDK version, this might differ slightly; be tolerant:
  // @ts-ignore
  const raw =
    (response && response.text) || "";
  const parsed = JSON.parse(raw);

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof parsed.summary !== "string" ||
    typeof parsed.title !== "string" ||
    !Array.isArray(parsed.action)
  ) {
    throw new Error("Model did not return the expected summary JSON structure.");
  }

  return {
    summary: parsed.summary,
    title: parsed.title,
    action: parsed.action,
  };
}
