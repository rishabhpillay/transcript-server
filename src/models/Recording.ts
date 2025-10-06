import { Schema, model } from 'mongoose';

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
    secure_url: { type: String, required: false },
    sequenceId: { type: Number },
    assetId: { type: String, required: false },
    bytes: { type: Number, required: false },
    durationMs: { type: Number, required: false },
    format: { type: String, required: false },
  },
  { _id: false }
);

const RecordingSchema = new Schema(
  {
    uploadId: { type: String, index: true, unique: true },
    audio: { type: [AudioItemSchema], default: [] },
    transcript: { type: [TranscriptSchema], default: [] },
    summary: { type: String, default: '' },
    action: { type: [String], default: [] },
    speakers: { type: [String], default: [] },
    isComplete: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default model('Recording', RecordingSchema);

