

// services/mergeTitleAndSummary.ts
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
      const delay = 1000 * Math.pow(2, i);
      console.warn(`${label} failed (attempt ${i + 1}/${attempts}). Retrying in ${delay}ms…`, err);
      await sleep(delay);
    }
  }
  throw lastErr;
}

/**
 * Simple deterministic merge fallback for text
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
  return deduped.join(" ");
}

const MODEL_NAME = "gemini-2.5-flash";

/**
 * Merge two title/summary pairs into updated concise versions.
 *
 * @param oldTitle     Previous title
 * @param oldSummary   Previous summary
 * @param newTitle     New title
 * @param newSummary   New summary
 * @returns {Promise<{ title: string, summary: string }>}
 */
export async function mergeTitleAndSummary({
  previousTitle,
  previousSummary,
  newTitle,
  newSummary,
}: {
  previousTitle: string;
  previousSummary: string;
  newTitle: string;
  newSummary: string;
}): Promise<{ title: string; summary: string }> {
  const aTitle = (previousTitle || "").trim();
  const bTitle = (newTitle || "").trim();
  const aSummary = (previousSummary || "").trim();
  const bSummary = (newSummary || "").trim();

  // quick exits
  if (!aSummary && !bSummary) {
    return { title: bTitle || aTitle, summary: "" };
  }
  if (!aSummary) {
    return { title: bTitle || aTitle, summary: bSummary };
  }
  if (!bSummary) {
    return { title: aTitle || bTitle, summary: aSummary };
  }

  if (!process.env.GEMINI_API_KEY) {
    return {
      title: deterministicMerge(aTitle, bTitle),
      summary: deterministicMerge(aSummary, bSummary),
    };
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const prompt = `
You are given two title+summary pairs (A = earlier, B = newer). 
Merge them into ONE updated pair.

Rules:
- Preserve all factual details from both A and B.
- Remove redundancy and contradictions.
- Prefer clarity, neutrality, and informativeness.
- Keep the title short (max 12 words) and relevant to the merged summary.
- The summary should be concise (2–6 sentences), readable, and factual.
- Output as valid JSON: {"title": "...", "summary": "..."}

Title A: ${aTitle}
Summary A: ${aSummary}

Title B: ${bTitle}
Summary B: ${bSummary}
`.trim();

  const resp = await withRetries(
    () =>
      ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { temperature: 0.2, responseMimeType: "application/json" },
      }),
    "mergeTitleAndSummary"
  );

  // @ts-ignore
  let text = (resp?.text || "").trim();

  try {
    const parsed = JSON.parse(text);
    return {
      title: parsed.title?.trim() || deterministicMerge(aTitle, bTitle),
      summary: parsed.summary?.trim() || deterministicMerge(aSummary, bSummary),
    };
  } catch {
    return {
      title: deterministicMerge(aTitle, bTitle),
      summary: deterministicMerge(aSummary, bSummary),
    };
  }
}

