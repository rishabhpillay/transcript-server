import { env } from '../config/env.js';
import type { TranscriptLine } from '../types/shared.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function summarizeAndActions(
  fullTranscript: TranscriptLine[]
): Promise<{ summary: string; action: string[] }> {
  if (!env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY missing');
  }
  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: env.GEMINI_MODEL });
  const combined = fullTranscript.map((l) => `${l.speaker}: ${l.text}`).join('\n');
  const prompt = `Return only JSON with keys summary (string) and action (string[]). Create a concise 2–4 sentence summary and 1–5 actionable, imperative items from the following transcript. No prose outside JSON. Transcript:\n\n${combined}`;
  const res = await model.generateContent([{ text: prompt }] as any);
  let text = res.response.text();
  // Normalize code-fenced JSON blocks
  if (text.startsWith('```')) {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last !== -1) text = text.slice(first, last + 1);
  }
  try {
    const parsed = JSON.parse(text);
    return { summary: parsed.summary || '', action: Array.isArray(parsed.action) ? parsed.action : [] };
  } catch {
    // Try extracting summary field via regex if JSON parsing failed
    const m = text.match(/"summary"\s*:\s*"([\s\S]*?)"/);
    if (m) {
      const extracted = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
      return { summary: extracted, action: [] };
    }
    return { summary: text, action: [] };
  }
}

