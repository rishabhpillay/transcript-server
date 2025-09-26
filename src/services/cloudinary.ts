import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env';

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
});

export async function uploadAudio(
  buffer: Buffer,
  options: { mime?: string; uploadId: string; sequenceId: number }
): Promise<{ publicId: string }> {
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    return { publicId: `dev://${options.uploadId}/${options.sequenceId}` };
  }

  const folder = `audio_chunks/${options.uploadId}`;
  const public_id = `${options.sequenceId}`;

  const res = await new Promise<any>((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'video',
        folder,
        public_id,
        format: options.mime?.includes('webm') ? 'webm' : undefined,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    uploadStream.end(buffer);
  });

  return { publicId: res.public_id as string };
}

