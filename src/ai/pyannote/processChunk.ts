import path from "path";
import fs from "fs-extra";
import { spawn } from "node:child_process";
import { DATA_ROOT, DIARIZE_SCRIPT, PYTHON_BIN, HF_TOKEN } from "../../config/config.js";

export type DiarizeChunkResult = {
  ok: boolean;
  segments?: Array<{ start: number; end: number; speakerLabel: string }>;
  labels?: string[];
  fingerprints?: Record<string, number[]>;
  embeddingType?: "pyannote256" | "mfcc13";
  error?: string;
  raw?: { stdout: string; stderr: string };
};

export async function saveChunkFile(
  uploadId: string,
  seqId: number,
  file: Express.Multer.File
): Promise<{ chunkPath: string; uploadDir: string }> {
  const uploadDir = path.join(DATA_ROOT, uploadId, "chunks");
  await fs.ensureDir(uploadDir);
  const filename = String(seqId).padStart(6, "0") + path.extname(file.originalname || ".m4a");
  const chunkPath = path.join(uploadDir, filename);
  await fs.move(file.path, chunkPath, { overwrite: true });
  return { chunkPath, uploadDir };
}

export async function diarizeFile(audioPath: string): Promise<DiarizeChunkResult> {
  return new Promise<DiarizeChunkResult>((resolve) => {
    const env = { ...process.env, HF_TOKEN };
    const args = [DIARIZE_SCRIPT, "--audio", audioPath];

    const child = spawn(PYTHON_BIN, args, { env });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("close", (code) => {
      if (code !== 0) {
        return resolve({
          ok: false,
          error: `diarize_chunk.py exited ${code}`,
          raw: { stdout, stderr },
        });
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed as DiarizeChunkResult);
      } catch (e) {
        resolve({
          ok: false,
          error: `Failed to parse diarize output: ${(e as Error).message}`,
          raw: { stdout, stderr },
        });
      }
    });
  });
}
