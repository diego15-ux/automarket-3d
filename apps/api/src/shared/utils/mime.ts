const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'audio/webm': 'weba', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac',
  'application/pdf': 'pdf',
};

/** "audio/webm;codecs=opus" → "audio/webm" */
export const baseMime = (mime: string) => (mime.split(';')[0] ?? '').trim().toLowerCase();

export const extensionFor = (mime: string) => EXTENSIONS[baseMime(mime)] ?? 'bin';

/**
 * Tipo real de una imagen según su firma (magic bytes): JPEG FF D8 FF · PNG 89 50 4E 47 ·
 * WebP «RIFF....WEBP». Un archivo renombrado o vacío devuelve null.
 */
export function sniffImageType(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}
