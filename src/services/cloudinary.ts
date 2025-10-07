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
): Promise<{ publicId: string; secureUrl: string }> {
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    return {
      publicId: `dev://${options.uploadId}/${options.sequenceId}`,
      secureUrl: `dev://${options.uploadId}/${options.sequenceId}`,
    };
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

  const mime = (options.mime || '').toLowerCase();
  const resource_type =
    mime.startsWith('video/') ? 'video' :
    mime.startsWith('audio/') ? 'auto'  :
    'auto';

  const formatHint =
    mime.includes('webm') ? 'webm' :
    mime.includes('m4a')  ? 'm4a'  :
    mime.includes('aac')  ? 'aac'  :
    mime.includes('mp3')  ? 'mp3'  :
    mime.includes('wav')  ? 'wav'  :
    mime.includes('ogg')  ? 'ogg'  :
    mime.includes('mp4')  ? 'mp4'  :
    undefined;

  try {
    const res = await tryUpload({
      resource_type,
      folder,
      public_id,
      format: formatHint,
      allowed_formats: ['webm', 'm4a', 'aac', 'mp3', 'wav', 'ogg', 'mp4', 'mov', 'mkv', '3gp'],
    });
    return { publicId: res.public_id as string, secureUrl: res.secure_url as string };
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.toLowerCase().includes('unsupported')) {
      const res = await tryUpload({ resource_type: 'raw', folder, public_id });
      return { publicId: res.public_id as string, secureUrl: res.secure_url as string };
    }
    throw err;
  }
}

