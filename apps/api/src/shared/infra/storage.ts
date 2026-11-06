import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../config/env.js';

/**
 * Adaptador de almacenamiento (S3 o compatible: MinIO, Cloudflare R2, LocalStack).
 * Los archivos NUNCA pasan por la API: el cliente sube directo a S3 con una URL
 * prefirmada y aquí solo firmamos y verificamos metadatos.
 */
export const s3 = new S3Client({
  region: env.AWS_REGION,
  // Sin esto, el SDK (≥ 3.729) incrusta en las URLs prefirmadas un CRC32 del cuerpo VACÍO
  // (x-amz-checksum-crc32) y S3 rechaza la subida real del navegador por checksum inválido.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
});

interface PresignUploadParams {
  bucket: string;
  key: string;
  contentType: string;
  /** Se firma: S3 rechaza la subida si el tamaño real no coincide. */
  contentLength: number;
  expiresIn?: number;
}

export function presignUpload({ bucket, key, contentType, contentLength, expiresIn = 300 }: PresignUploadParams) {
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ContentLength: contentLength });
  return getSignedUrl(s3, command, { expiresIn });
}

export function presignDownload(bucket: string, key: string, expiresIn = 3600) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}

/** Devuelve tamaño y tipo reales del objeto, o null si todavía no existe. */
export async function statObject(bucket: string, key: string) {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { sizeBytes: head.ContentLength ?? 0, contentType: head.ContentType ?? '' };
  } catch (err) {
    if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404) return null;
    throw err;
  }
}

export async function deleteObject(bucket: string, key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** Primeros bytes del objeto (firma del formato): el tipo declarado por el navegador no basta. */
export async function readObjectStart(bucket: string, key: string, bytes = 16): Promise<Uint8Array> {
  const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${bytes - 1}` }));
  const body = await object.Body?.transformToByteArray();
  return body ? body.subarray(0, bytes) : new Uint8Array();
}

/** URL pública (CDN) de un objeto del bucket de medios. */
export const publicMediaUrl = (key: string) => `${env.MEDIA_PUBLIC_BASE_URL}/${key}`;
