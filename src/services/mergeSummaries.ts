// services/mergeSummaries.ts
import { GoogleGenAI } from "@google/genai";

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
function deterministicMerge(prev: string, current: string): string {
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

const MODEL_NAME = "gemini-2.5-flash";

/**
 * Merge two summaries into a single concise, non-redundant summary
 * while preserving all factual details.
 *
 * @param prev    Summary A (earlier/running)
 * @param current Summary B (new chunk)
 * @returns Merged summary text
 */
export async function mergeSummaries(prev: string, current: string): Promise<string> {
  const a = (prev || "").trim();
  const b = (current || "").trim();

  // Quick exits
  if (!a && !b) return "";
  if (!a) return b;
  if (!b) return a;

  // If no API key, fall back to deterministic merge
  if (!process.env.GEMINI_API_KEY) {
    return deterministicMerge(a, b);
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const prompt = `
You are given two summaries (A = earlier, B = newer). Merge them into ONE concise summary that:
- PRESERVES ALL factual details from A and B (do NOT drop unique info).
- Removes redundancy and contradictions; if conflicts exist, prefer wording that encompasses both if possible.
- Is neutral, specific, and readable.
- 2–6 sentences max. No bullets. Return PLAIN TEXT only.

Summary A:
${a}

Summary B:
${b}
`.trim();

  const resp = await withRetries(
    () =>
      ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          temperature: 0.2,
          responseMimeType: "text/plain",
        },
      }),
    "mergeSummaries"
  );

  // @ts-ignore — SDK returns .text
  const merged = (resp?.text || "").trim();
  // Fallback to deterministic if the model returns nothing
  return merged || deterministicMerge(a, b);
}
