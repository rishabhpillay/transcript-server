// services/mergeSummaries.ts
import { GoogleGenAI } from "@google/genai";

type SummaryMergeInput = {
  summary?: string | null;
  title?: string | null;
};

type SummaryMergeResult = {
  summary: string;
  title: string;
};

/**
 * Simple sleep utility
 */
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Retry wrapper with exponential backoff
 */
async function withRetries<T>(fn: () => Promise<T>, label: string, attempts = 3) {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const delay = 1000 * Math.pow(2, i); // 1s, 2s, 4s
      // eslint-disable-next-line no-console
      console.warn(`${label} failed (attempt ${i + 1}/${attempts}). Retrying in ${delay}ms…`, err);
      await sleep(delay);
    }
  }
  throw lastErr;
}

/**
 * Non-LLM fallback that tries to keep content without losing details:
 * - splits into sentences
 * - de-duplicates (case-insensitive)
 * - joins back in a sensible order
 */
function deterministicSummary(prev: string, current: string): string {
  const text = [prev, current].filter(Boolean).join(" ");
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const s of sentences) {
    const key = s.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(s);
    }
  }
  // Keep length reasonable but do not drop info aggressively
  return deduped.join(" ");
}

function deriveTitleFromSummary(summary: string): string {
  if (!summary) return "";
  const firstSentence = summary.split(/(?<=[.!?])\s+/).find(Boolean);
  if (!firstSentence) return "";
  return firstSentence
    .replace(/["“”]/g, "")
    .slice(0, 80)
    .trim();
}

function deterministicTitle(prev: string, current: string, mergedSummary: string): string {
  const a = prev.trim();
  const b = current.trim();
  if (a && !b) return a;
  if (!a && b) return b;
  if (!a && !b) return deriveTitleFromSummary(mergedSummary);
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  if (lowerA === lowerB) return a;
  if (lowerA.includes(lowerB)) return a;
  if (lowerB.includes(lowerA)) return b;
  return `${a} / ${b}`.slice(0, 80);
}

const MODEL_NAME = "gemini-2.5-flash";
const MERGE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    title: { type: "string" },
  },
  required: ["summary", "title"],
  additionalProperties: false,
} as const;

/**
 * Merge two summaries into a single concise, non-redundant summary
 * while preserving all factual details.
 *
 * @param prev    { summary, title } for Summary A (earlier/running)
 * @param current { summary, title } for Summary B (new chunk)
 * @returns Merged summary + title
 */
export async function mergeSummaries(
  prev: SummaryMergeInput,
  current: SummaryMergeInput
): Promise<SummaryMergeResult> {
  const summaryA = (prev.summary || "").trim();
  const summaryB = (current.summary || "").trim();
  const titleA = (prev.title || "").trim();
  const titleB = (current.title || "").trim();

  const fallback = () => {
    const summary =
      summaryA && summaryB
        ? deterministicSummary(summaryA, summaryB)
        : summaryA || summaryB;
    const title = deterministicTitle(titleA, titleB, summary);
    return { summary: summary || "", title: title || "" };
  };

  // Quick exits
  if (!summaryA && !summaryB) {
    return { summary: "", title: deterministicTitle(titleA, titleB, "") };
  }
  if (!summaryA) {
    return {
      summary: summaryB,
      title: titleB || deterministicTitle(titleA, "", summaryB),
    };
  }
  if (!summaryB) {
    return {
      summary: summaryA,
      title: titleA || deterministicTitle("", titleB, summaryA),
    };
  }

  // If no API key, fall back to deterministic merge
  if (!process.env.GEMINI_API_KEY) {
    return fallback();
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const prompt = `
You are given two partial transcript summaries with titles (A = earlier/running, B = newer chunk). Combine them into a single updated view.

Requirements:
- Preserve every concrete detail that appears in either summary.
- Remove redundancy and resolve conflicts by preferring wording that encompasses both perspectives.
- Produce 2–6 sentences in neutral English.
- Generate a single descriptive English title (≤8 words) that reflects the merged conversation so far.
- Respond ONLY with JSON that matches this schema: { "summary": string, "title": string }.

Summary A: ${summaryA || "(none provided)"}
Title A: ${titleA || "(none provided)"}

Summary B: ${summaryB || "(none provided)"}
Title B: ${titleB || "(none provided)"}
`.trim();

  const resp = await withRetries(
    () =>
      ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: MERGE_SCHEMA,
        },
      }),
    "mergeSummaries"
  );

  try {
    // @ts-ignore — SDK returns .text
    const mergedText = (resp?.text || "").trim();
    const parsed = JSON.parse(mergedText);
    if (
      parsed &&
      typeof parsed.summary === "string" &&
      typeof parsed.title === "string"
    ) {
      return {
        summary: parsed.summary.trim(),
        title: parsed.title.trim(),
      };
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("Failed to parse merged summary response, using fallback", err);
  }

  return fallback();
}
