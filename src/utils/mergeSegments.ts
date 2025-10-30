// src/utils/mergeSegments.ts
import type { DiarizationSegment, TranscriptUtterance } from "./mergeSegments.types.js";

/**
 * Merge diarization segments with transcript utterances by time overlap.
 * Returns one object per diarization segment with concatenated text from
 * all transcript utterances that overlap that segment.
 *
 * Overlap is considered if either:
 * - absolute overlap >= minOverlapMs, OR
 * - relative overlap >= overlapRatioThreshold of the shorter span.
 */
export function mergeSegmentsAndTranscript(
  diarSegments: DiarizationSegment[],
  transcript: TranscriptUtterance[],
  opts?: {
    minOverlapMs?: number;           // default 250ms
    overlapRatioThreshold?: number;  // default 0.2 (20% of shorter span)
    includeNotes?: boolean;          // default true -> append notes in []
    trimText?: boolean;              // default true -> trim final text
  }
): Array<DiarizationSegment & { text: string }> {
  const {
    minOverlapMs = 250,
    overlapRatioThreshold = 0.2,
    includeNotes = true,
    trimText = true,
  } = opts || {};

  const toMs = (s: number) => Math.max(0, Math.round(s * 1000));

  // Pre-convert transcript bounds to ms for cheaper math
  const tx = transcript.map(u => ({
    ...u,
    start: Math.max(0, u.start_ms),
    end: Math.max(u.start_ms, u.end_ms),
  }));

  const merged = diarSegments.map(seg => {
    const sMs = toMs(seg.start);
    const eMs = toMs(seg.end);
    const segDur = Math.max(1, eMs - sMs); // avoid zero

    const parts: string[] = [];

    for (const utt of tx) {
      const left = Math.max(sMs, utt.start);
      const right = Math.min(eMs, utt.end);
      const overlap = Math.max(0, right - left);
      if (overlap <= 0) continue;

      const shorter = Math.min(segDur, Math.max(1, utt.end - utt.start));
      const ratio = overlap / shorter;

      if (overlap >= minOverlapMs || ratio >= overlapRatioThreshold) {
        // Build utterance text (optionally include notes)
        const text = includeNotes && utt.notes
          ? `${utt.text} [${utt.notes}]`
          : utt.text;
        if (text && text.trim()) parts.push(text.trim());
      }
    }

    let text = parts.join(" ");
    if (trimText) text = text.trim();

    return {
      ...seg,
      text,
    };
  });

  return merged;
}
