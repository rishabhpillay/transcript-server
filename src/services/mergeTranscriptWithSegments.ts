/**
 * Merge diarization segments into transcript data.
 * 
 * @param transcript - Array of transcript objects with { speaker, text, start, end, notes }
 * @param segments - Array of diarization segments with { start, end, speakerLabel }
 * 
 * @returns A new transcript array where each entry's speaker is updated
 *          to the consistent "Speaker N" name based on diarization labels.
 */
export function mergeTranscriptWithSegments(
    transcript: Array<{
      speaker: string;
      text: string;
      start: number;
      end: number;
      notes: string;
    }>,
    segments: Array<{
      start: number;
      end: number;
      speakerLabel: string;
      seq?: number;
    }>
  ) {
    // --- Step 1: Build consistent label → readable speaker mapping ---
    const labelToSpeaker = new Map<string, string>();
    let nextSpeakerNum = 1;
  
    // Helper to get or assign readable name like "Speaker 1"
    function getReadableSpeaker(label: string): string {
      if (!labelToSpeaker.has(label)) {
        labelToSpeaker.set(label, `Speaker ${nextSpeakerNum++}`);
      }
      return labelToSpeaker.get(label)!;
    }
  
    // --- Step 2: For each transcript entry, find the segment that overlaps in time ---
    const mergedTranscript = transcript.map((t) => {
      // Find best matching segment by temporal overlap
      const match = segments.find(
        (s) =>
          (t.start >= s.start && t.start <= s.end) ||
          (t.end >= s.start && t.end <= s.end) ||
          (s.start >= t.start && s.end <= t.end) // full overlap
      );
  
      // If found, replace speaker label with readable name
      if (match) {
        const readable = getReadableSpeaker(match.speakerLabel);
        return { ...t, speaker: readable };
      } else {
        // If no matching segment, preserve the original speaker
        return t;
      }
    });
  
    // --- Step 3: Return merged transcript + mapping table for debugging ---
    return {
      transcript: mergedTranscript,
      mapping: Object.fromEntries(labelToSpeaker),
    };
  }
  