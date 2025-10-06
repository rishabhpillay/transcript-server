export interface StartSessionResponse {
  uploadId: string;
}

export interface TranscriptLine {
  date_time: string;
  speaker: string;
  text: string;
  start_ms: number;
  end_ms: number;
  notes: string;
  sq?: number;
}

export interface AudioItem {
  sq: number;
  publicId: string;
  secureUrl: string;
  assetId?: string;
  bytes?: number;
  durationMs?: number;
  format?: string;
  sequenceId: number;
}

// export interface FinalResultPayload {
//   text: TranscriptLine[];
//   audio: AudioItem[];
//   summary: string;
//   action: string[];
// }

export interface FinalResultPayload {
  transcript: TranscriptLine[];
  audio: AudioItem[];
  summary: string;
  action: string[];
  speakers: string[];
  isComplete: boolean;
  uploadId: string;
  createdAt?: string;
  updatedAt?: string;
}

