import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
});

export async function uploadAudio(
  buffer: Buffer,
  options: { mime?: string; uploadId: string; sequenceId: number }
): Promise<{ publicId: string; secure_url: string }> {
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    return { publicId: `dev://${options.uploadId}/${options.sequenceId}`, secure_url: `dev://${options.uploadId}/${options.sequenceId}` };
  }

  const folder = `audio_chunks/${options.uploadId}`;
  const public_id = `${options.sequenceId}`;

  const tryUpload = (cloudinaryOptions: Record<string, any>) =>
    new Promise<any>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(cloudinaryOptions, (error, result) => {
        if (error) return reject(error);
        resolve(result);
      });
      uploadStream.end(buffer);
    });

  // Prefer auto detection; map common mimes to format hints
  let formatHint: string | undefined;
  if (options.mime?.includes('webm')) {
    formatHint = 'webm';
  } else if (options.mime?.includes('m4a')) {
    formatHint = 'm4a';
  } else if (options.mime?.includes('aac')) {
    formatHint = 'aac';
  } else if (options.mime?.includes('mp3')) {
    formatHint = 'mp3';
  } else if (options.mime?.includes('wav')) {
    formatHint = 'wav';
  }

  try {
    const res = await tryUpload({
      resource_type: 'auto',
      folder,
      public_id,
      format: formatHint,
      allowed_formats: ['webm', 'm4a', 'aac', 'mp3', 'wav', 'ogg'],
    });
    return { publicId: res.public_id as string, secure_url: res.secure_url as string };
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.includes('Unsupported video format') || msg.includes('Unsupported')) {
      // Fallback to raw so we can store bytes regardless of media support
      const res = await tryUpload({ resource_type: 'raw', folder, public_id });
      return { publicId: res.public_id as string, secure_url: res.secure_url as string };
    }
    throw err;
  }
}

