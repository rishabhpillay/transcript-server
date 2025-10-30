export type SpeakerEntry = {
    seq: number;            // assigned sequence number (1..N)
    fingerprint: number[];  // vector
  };
  
  export type ChunkResult = {
    uploadId: string;
    sequenceId: number;
    lastChunk: boolean;
    totalDuration?: number;
    segments: Array<{
      start: number;
      end: number;
      speakerLabel: string;  // SPEAKER_00 from pyannote
      seq: number;           // mapped seq number from store
    }>;
    speakersDetected: Array<{
      speakerLabel: string;
      seq: number;
      similarity?: number;   // to the matched known speaker
    }>;
  };
  
  export type UploadSession = {
    speakers: Map<string, SpeakerEntry>; // key is internal ID (we'll store as "seq:<n>")
    nextSeq: number;
    chunks: ChunkResult[];
  };
  
  const sessions = new Map<string, UploadSession>();
  
  export function getSession(uploadId: string): UploadSession {
    let s = sessions.get(uploadId);
    if (!s) {
      s = {
        speakers: new Map<string, SpeakerEntry>(),
        nextSeq: 1,
        chunks: [],
      };
      sessions.set(uploadId, s);
    }
    return s;
  }
  
  export function clearSession(uploadId: string) {
    sessions.delete(uploadId);
  }
  