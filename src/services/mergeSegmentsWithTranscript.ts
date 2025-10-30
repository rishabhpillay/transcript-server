type Segment = {
    start: number;           // seconds
    end: number;             // seconds
    speakerLabel: string;
    seq: number;
  };
  
  type TranscriptItem = {
    speaker: string;
    text: string;
    start_ms: number;
    end_ms: number;
    notes?: string;
  };
  
  type MergeOptions = {
    minOverlapMs?: number;
    speakerMap?: Record<string, string>;
    mergeAdjacent?: boolean; // new option
  };
  
  export function mergeSegmentsWithTranscript(
    segments: Segment[],
    transcript: TranscriptItem[],
    options: MergeOptions = {}
  ): Array<Segment & { text: string }> {
    const minOverlapMs = options.minOverlapMs ?? 1;
    const speakerMap = options.speakerMap ?? null;
    const mergeAdjacent = options.mergeAdjacent ?? true;
  
    const segs = [...segments].sort((a, b) => a.start - b.start);
    const trs = [...transcript]
      .filter(t => t.text?.trim())
      .sort((a, b) => a.start_ms - b.start_ms)
      .map(t => ({ ...t, start_s: t.start_ms / 1000, end_s: t.end_ms / 1000 }));
  
    const results: Array<Segment & { text: string }> = [];
  
    let usedTranscripts = new Set<number>();
  
    for (const seg of segs) {
      const segStart = seg.start;
      const segEnd = seg.end;
      const expectedSpeaker = speakerMap ? speakerMap[seg.speakerLabel] : null;
  
      const texts: string[] = [];
  
      trs.forEach((t, idx) => {
        const overlapStart = Math.max(segStart, t.start_s);
        const overlapEnd = Math.min(segEnd, t.end_s);
        const overlapMs = Math.max(0, (overlapEnd - overlapStart) * 1000);
  
        if (overlapMs >= minOverlapMs) {
          if ((!expectedSpeaker || t.speaker === expectedSpeaker) && !usedTranscripts.has(idx)) {
            texts.push(t.text.trim());
            usedTranscripts.add(idx);
          }
        }
      });
  
      const mergedText = normalizeSpaces(texts.join(" ").trim());
      results.push({ ...seg, text: mergedText });
    }
  
    // --- remove duplicates and merge consecutive segments by same speaker ---
    const cleaned: Array<Segment & { text: string }> = [];
    for (const seg of results) {
      if (
        cleaned.length > 0 &&
        mergeAdjacent &&
        cleaned[cleaned.length - 1].speakerLabel === seg.speakerLabel &&
        cleaned[cleaned.length - 1].text === seg.text
      ) {
        // merge adjacent identical entries
        cleaned[cleaned.length - 1].end = Math.max(
          cleaned[cleaned.length - 1].end,
          seg.end
        );
        continue;
      }
      cleaned.push(seg);
    }
  
    return cleaned;
  }
  
  function normalizeSpaces(s: string): string {
    return s.replace(/\s+/g, " ").replace(/\s+([,?.!;:])/g, "$1").trim();
  }
  