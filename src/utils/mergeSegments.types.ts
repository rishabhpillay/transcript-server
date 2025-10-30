// src/utils/mergeSegments.types.ts

export interface DiarizationSegment {
    start: number;           // seconds
    end: number;             // seconds
    speakerLabel: string;    // e.g., "SPEAKER_00"
    seq: number;             // assigned sequence id
  }
  
  export interface TranscriptUtterance {
    speaker: string;         // "Speaker 1", ...
    text: string;
    start_ms: number;
    end_ms: number;
    notes: string;
  }
  