// services/dedupeActions.ts
import { GoogleGenAI } from "@google/genai";

/** Basic, deterministic dedupe (keeps first phrasing). */
function basicDedupe(actions: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of actions) {
    const s = (a ?? "").trim();
    if (!s) continue;
    // Normalize lightly for matching (space/punct/case)
    const key = s.replace(/\s+/g, " ").replace(/[.:;,\-]+$/u, "").toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

/**
 * Dedupe/merge one list of actions.
 * - If GEMINI_API_KEY exists, ask Gemini to merge near-duplicates semantically.
 * - Otherwise (or on any error), return a basic deterministic dedupe.
 */
export async function dedupeActions(actions: string[]): Promise<string[]> {
  // Clean empty entries up-front
  const flat = (actions || []).map(a => (a ?? "").trim()).filter(Boolean);
  if (flat.length === 0) return [];

  const baseline = basicDedupe(flat);

  // No API key → just return baseline
  if (!process.env.GEMINI_API_KEY) return baseline;

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const prompt = `
You are given a list of "action items".
Create a single deduplicated list where:
- Semantically similar items are merged into ONE clear, imperative line.
- Keep all distinct tasks.
- Keep phrasing concise and specific.
- Return ONLY a JSON array of strings (no extra text).

Raw actions:
${JSON.stringify(flat, null, 2)}

A simple baseline (already deduped by surface form) you may refine:
${JSON.stringify(baseline, null, 2)}
`.trim();

    const resp = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: { type: "array", items: { type: "string" } } as const,
      },
    });

    // @ts-ignore Gemini SDK provides .text
    const text = (resp?.text || "").trim();
    const parsed = JSON.parse(text);

    // Validate and do one last simple dedupe/trim
    if (Array.isArray(parsed) && parsed.every(x => typeof x === "string")) {
      return basicDedupe(parsed.map(s => s.trim()));
    }

    // If model returned something unexpected, use baseline
    return baseline;
  } catch {
    // Any error → safe fallback
    return baseline;
  }
}
