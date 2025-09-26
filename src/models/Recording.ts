import { Schema, model } from 'mongoose';

const TranscriptSchema = new Schema(
  {
    date_time: { type: String, default: '' },
    speaker: { type: String, required: true },
    text: { type: String, required: true },
  },
  { _id: false }
);

const AudioItemSchema = new Schema(
  {
    sq: { type: Number, required: true },
    publicId: { type: String, required: true },
    sequenceId: { type: Number, required: true },
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
    isComplete: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default model('Recording', RecordingSchema);

