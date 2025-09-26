export interface StartSessionResponse {
  uploadId: string;
}

export interface TranscriptLine {
  date_time: string;
  speaker: string;
  text: string;
}

export interface AudioItem {
  sq: number;
  publicId: string;
  sequenceId: number;
}

export interface FinalResultPayload {
  text: TranscriptLine[];
  audio: AudioItem[];
  summary: string;
  action: string[];
}

