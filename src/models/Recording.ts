import { Schema, model, Document, Types } from 'mongoose';

export interface ITranscript {
  date_time?: string;
  speaker?: string;
  text?: string;
  start_ms?: number;
  end_ms?: number;
  notes?: string;
  sq?: number;
}

export interface IAudioItem {
  sq?: number;
  publicId?: string;
  secureUrl?: string;
  sequenceId?: number;
  assetId?: string;
  bytes?: number;
  durationMs?: number;
  format?: string;
}

export interface IRecording extends Document {
  userId: Types.ObjectId;
  uploadId?: string;
  audio: IAudioItem[];
  transcript: ITranscript[];
  summary: string;
  action: string[];
  todo: string[];
  done: string[];
  speakers: string[];
  isComplete: boolean;
  title: string;
  totalDuration: string;
  createdAt: Date;
  updatedAt: Date;
}

const TranscriptSchema = new Schema(
  {
    date_time: { type: String, default: '' },
    speaker: { type: String }, // "Speaker 1", "Speaker 2", ...
    text: { type: String },
    start_ms: { type: Number, default: 0 },
    end_ms: { type: Number, default: 0 },
    notes: { type: String, default: "" },
    sq: { type: Number },
  },
  { _id: false }
);

const AudioItemSchema = new Schema(
  {
    sq: { type: Number },
    publicId: { type: String },
    secureUrl: { type: String, required: false },
    sequenceId: { type: Number },
    assetId: { type: String, required: false },
    bytes: { type: Number, required: false },
    durationMs: { type: Number, required: false },
    format: { type: String, required: false },
  },
  { _id: false }
);

const RecordingSchema = new Schema<IRecording>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    uploadId: { type: String, index: true, unique: true },
    audio: { type: [AudioItemSchema], default: [] },
    transcript: { type: [TranscriptSchema], default: [] },
    summary: { type: String, default: '' },
    action: { type: [String], default: [] },
    todo: { type: [String], default: [] },
    done: { type: [String], default: [] },
    speakers: { type: [String], default: [] },
    isComplete: { type: Boolean, default: false },
    title: { type: String, default: "" },
    totalDuration: { type:String, default: "00:00" }
  },
  { timestamps: true }
);

export default model<IRecording>('Recording', RecordingSchema);
