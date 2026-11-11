import sharp from 'sharp';
import { AppError } from './errors';
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export type ProcessedPhoto = { data: Buffer; mime: 'image/webp'; size: number };
export function detectImageType(
  bytes: Uint8Array,
): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  const b = Buffer.from(bytes);
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (
    b.length >= 12 &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  return null;
}
export async function processAuthorizationPhoto(bytes: Uint8Array): Promise<ProcessedPhoto> {
  if (bytes.length > MAX_PHOTO_BYTES)
    throw new AppError('A foto passa de 5 MB. Tire um print menor ou reduza a imagem.');
  if (!detectImageType(bytes)) throw new AppError('Envie uma imagem JPEG, PNG ou WebP.');
  try {
    for (const side of [1600, 1200, 800]) {
      const data = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'error' })
        .rotate()
        .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      if (data.length <= 2 * 1024 * 1024) return { data, mime: 'image/webp', size: data.length };
    }
  } catch {
    throw new AppError('Não foi possível ler esta imagem.');
  }
  throw new AppError('A foto ficou muito grande. Tire um print menor ou reduza a imagem.');
}
