// src/services/mergeDiarization.ts
export type DgSegment = { speaker: string; start_ms: number; end_ms: number };
export type GeminiLine = {
  speaker: string; text: string; start_ms: number; end_ms: number; notes: string;
};

const overlapMs = (a0: number, a1: number, b0: number, b1: number) =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/**
 * For each Gemini line, pick the Deepgram segment that overlaps the most.
 * If no overlap, we keep the original Gemini speaker label.
 */
export function mergeDiarization(
  dgSegments: DgSegment[],
  geminiLines: GeminiLine[]
): GeminiLine[] {
  if (!dgSegments?.length || !geminiLines?.length) return geminiLines;

  // optional: sort to be safe
  const segs = [...dgSegments].sort((a, b) => a.start_ms - b.start_ms);
  const lines = [...geminiLines].sort((a, b) => a.start_ms - b.start_ms);

  return lines.map((ln) => {
    let bestSeg: DgSegment | undefined;
    let best = -1;

    for (const s of segs) {
      const ov = overlapMs(ln.start_ms, ln.end_ms, s.start_ms, s.end_ms);
      if (ov > best) {
        best = ov;
        bestSeg = s;
      }
      // early break if seg starts beyond the end of ln (optional micro-opt)
      if (s.start_ms > ln.end_ms && best >= 0) break;
    }

    return bestSeg ? { ...ln, speaker: bestSeg.speaker } : ln;
  });
}
