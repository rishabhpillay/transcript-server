import path from "path";
import fs from "fs-extra";
import dotenv from "dotenv";
dotenv.config();

export const PORT = Number(process.env.PORT || 8000);
export const DATA_ROOT = path.resolve(process.env.DATA_ROOT || "./data");
export const PYTHON_BIN = process.env.PYTHON_BIN || ".venv/bin/python";
export const DIARIZE_SCRIPT = process.env.DIARIZE_SCRIPT || "./py/diarize_chunk.py";
export const HF_TOKEN =
  process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || process.env.HUGGINGFACE_HUB_TOKEN || "";
export const FFMPEG_BIN = process.env.FFMPEG_BIN || ""; // optional
export const KEEP_FILES = (process.env.KEEP_FILES || "false").toLowerCase() === "true";

export const SPEAKER_MATCH_THRESHOLD = Number(process.env.SPEAKER_MATCH_THRESHOLD || 0.78);

// Ensure data root
await fs.ensureDir(DATA_ROOT);
