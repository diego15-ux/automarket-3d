import type { MessageType } from '../../generated/prisma/enums.js';
import { AppError } from '../../shared/errors/app-error.js';
import { baseMime } from '../../shared/utils/mime.js';

export type MediaMessageType = Exclude<MessageType, 'TEXT'>;

const MB = 1024 * 1024;

/** Política única para la URL prefirmada y para la validación al enviar el mensaje. */
export const CHAT_MEDIA_POLICY: Record<MediaMessageType, { mimeTypes: readonly string[]; maxBytes: number; maxDurationMs?: number }> = {
  IMAGE: { mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'], maxBytes: 10 * MB },
  VIDEO: { mimeTypes: ['video/mp4', 'video/webm', 'video/quicktime'], maxBytes: 100 * MB, maxDurationMs: 3 * 60_000 },
  // Notas de voz: MediaRecorder produce audio/webm (Chrome/Firefox) o audio/mp4 (Safari)
  AUDIO: { mimeTypes: ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac'], maxBytes: 10 * MB, maxDurationMs: 5 * 60_000 },
};

/**
 * Prefijo S3 obligatorio: impide referenciar archivos de otra conversación o de otro usuario.
 * Las notas de voz van a su propia carpeta (audios-chat/).
 */
export const chatMediaPrefix = (conversationId: string, userId: string, type: MediaMessageType) =>
  `${type === 'AUDIO' ? 'audios-chat' : 'chat'}/${conversationId}/${userId}/`;

export const voiceNotesLocked = () =>
  AppError.forbidden('VOICE_NOTES_LOCKED', 'Las notas de voz se habilitan en el chat directo, cuando el vendedor confirma la reserva.');

export function assertMediaAllowed(type: MediaMessageType, mimeType: string, sizeBytes: number, durationMs?: number): void {
  const policy = CHAT_MEDIA_POLICY[type];

  if (!policy.mimeTypes.includes(baseMime(mimeType))) {
    throw AppError.badRequest('MEDIA_TYPE_NOT_ALLOWED', `Formato no permitido para ${type}.`, { allowed: policy.mimeTypes });
  }
  if (sizeBytes > policy.maxBytes) {
    throw AppError.badRequest('MEDIA_TOO_LARGE', `El archivo supera el máximo de ${policy.maxBytes / MB} MB.`);
  }
  if (durationMs !== undefined && policy.maxDurationMs !== undefined && durationMs > policy.maxDurationMs) {
    throw AppError.badRequest('MEDIA_TOO_LONG', 'La duración supera el máximo permitido.');
  }
}
