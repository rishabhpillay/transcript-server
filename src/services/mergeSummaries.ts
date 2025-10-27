// // services/mergeSummaries.ts
// import { GoogleGenAI } from "@google/genai";

// /**
//  * Simple sleep utility
//  */
// function sleep(ms: number) {
//   return new Promise((r) => setTimeout(r, ms));
// }

// /**
//  * Retry wrapper with exponential backoff
//  */
// async function withRetries<T>(fn: () => Promise<T>, label: string, attempts = 3) {
//   let lastErr: unknown;
//   for (let i = 0; i < attempts; i++) {
//     try {
//       return await fn();
//     } catch (err) {
//       lastErr = err;
//       const delay = 1000 * Math.pow(2, i); // 1s, 2s, 4s
//       // eslint-disable-next-line no-console
//       console.warn(`${label} failed (attempt ${i + 1}/${attempts}). Retrying in ${delay}ms…`, err);
//       await sleep(delay);
//     }
//   }
//   throw lastErr;
// }

// /**
//  * Non-LLM fallback that tries to keep content without losing details:
//  * - splits into sentences
//  * - de-duplicates (case-insensitive)
//  * - joins back in a sensible order
//  */
// type MergeMode = "summary" | "title";

// function deterministicMerge(
//   prev: string,
//   current: string,
//   mode: MergeMode = "summary"
// ): string {
//   if (mode === "title") {
//     const a = (prev || "").trim();
//     const b = (current || "").trim();
//     if (!a && !b) return "";
//     if (!a) return b;
//     if (!b) return a;
//     if (a.toLowerCase() === b.toLowerCase()) return a;
//     const merged = `${a} / ${b}`;
//     return merged.length <= 80 ? merged : b;
//   }

//   const text = [prev, current].filter(Boolean).join(" ");
//   const sentences = text
//     .split(/(?<=[.!?])\s+/)
//     .map(s => s.trim())
//     .filter(Boolean);

//   const seen = new Set<string>();
//   const deduped: string[] = [];
//   for (const s of sentences) {
//     const key = s.toLowerCase();
//     if (!seen.has(key)) {
//       seen.add(key);
//       deduped.push(s);
//     }
//   }
//   // Keep length reasonable but do not drop info aggressively
//   return deduped.join(" ");
// }

// const MODEL_NAME = "gemini-2.5-flash";

// /**
//  * Merge two summaries into a single concise, non-redundant summary
//  * while preserving all factual details.
//  *
//  * @param prev    Summary A (earlier/running)
//  * @param current Summary B (new chunk)
//  * @returns Merged summary text
//  */
// export async function mergeSummaries(
//   prev: string,
//   current: string,
//   options?: { mode?: MergeMode }
// ): Promise<string> {
//   const mode: MergeMode = options?.mode ?? "summary";
//   const a = (prev || "").trim();
//   const b = (current || "").trim();

//   // Quick exits
//   if (!a && !b) return "";
//   if (!a) return b;
//   if (!b) return a;

//   // If no API key, fall back to deterministic merge
//   if (!process.env.GEMINI_API_KEY) {
//     return deterministicMerge(a, b, mode);
//   }

//   const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

//   const prompt =
//     mode === "title"
//       ? `
// You are given two short titles for the same meeting or conversation (Title A = earlier, Title B = newer). Merge them into ONE clear, specific title that:
// - Preserves the most informative details from both.
// - Stays neutral and professional.
// - Maximum 12 words.
// - No punctuation at the end, no surrounding quotes.

// Title A:
// ${a}

// Title B:
// ${b}
// `.trim()
//       : `
// You are given two summaries (A = earlier, B = newer). Merge them into ONE concise summary that:
// - PRESERVES ALL factual details from A and B (do NOT drop unique info).
// - Removes redundancy and contradictions; if conflicts exist, prefer wording that encompasses both if possible.
// - Is neutral, specific, and readable.
// - 2–6 sentences max. No bullets. Return PLAIN TEXT only.

// Summary A:
// ${a}

// Summary B:
// ${b}
// `.trim();

//   const resp = await withRetries(
//     () =>
//       ai.models.generateContent({
//         model: MODEL_NAME,
//         contents: [{ role: "user", parts: [{ text: prompt }] }],
//         config: {
//           temperature: 0.2,
//           responseMimeType: "text/plain",
//         },
//       }),
//     "mergeSummaries"
//   );

//   // @ts-ignore — SDK returns .text
//   const merged = (resp?.text || "").trim();
//   // Fallback to deterministic if the model returns nothing
//   return merged || deterministicMerge(a, b, mode);
// }


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
export async function mergeTitleAndSummary(
  oldTitle: string,
  oldSummary: string,
  newTitle: string,
  newSummary: string
): Promise<{ title: string; summary: string }> {
  const aTitle = (oldTitle || "").trim();
  const bTitle = (newTitle || "").trim();
  const aSummary = (oldSummary || "").trim();
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

  // fallback if no API key
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
    // fallback if model doesn't return JSON
    return {
      title: deterministicMerge(aTitle, bTitle),
      summary: deterministicMerge(aSummary, bSummary),
    };
  }
}

