import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { authenticate, currentUser } from '../../shared/http/middlewares/auth.middleware.js';
import { validateBody } from '../../shared/http/middlewares/validate.js';
import { presignUpload } from '../../shared/infra/storage.js';
import { baseMime, extensionFor } from '../../shared/utils/mime.js';
import { chatService } from '../chat/chat.service.js';
import { assertMediaAllowed, chatMediaPrefix, voiceNotesLocked } from './media.policy.js';

const ChatUploadSchema = z.object({
  conversationId: z.uuid(),
  type: z.enum(['IMAGE', 'VIDEO', 'AUDIO']),
  mimeType: z.string().min(3).max(100),
  sizeBytes: z.number().int().positive(),
});

export const mediaRouter = Router();

/**
 * Paso 1 del envío multimedia: el cliente pide una URL prefirmada (PUT, 5 min),
 * sube el archivo DIRECTO a S3 y después emite `message:send` con la `key`.
 */
mediaRouter.post('/chat-uploads', authenticate, validateBody(ChatUploadSchema), async (req, res) => {
  const user = currentUser(req);
  const input = req.body as z.infer<typeof ChatUploadSchema>;

  const conversation = await chatService.getConversationOrThrow(input.conversationId, user.id);
  // Las notas de voz no se pueden moderar como el texto: solo en el chat directo (reserva confirmada).
  if (input.type === 'AUDIO' && !(await chatService.isDirect(conversation))) throw voiceNotesLocked();

  const mimeType = baseMime(input.mimeType);
  assertMediaAllowed(input.type, mimeType, input.sizeBytes);

  const key = `${chatMediaPrefix(input.conversationId, user.id, input.type)}${randomUUID()}.${extensionFor(mimeType)}`;
  const expiresIn = 300;
  const uploadUrl = await presignUpload({
    bucket: env.S3_BUCKET_MEDIA,
    key,
    contentType: mimeType,
    contentLength: input.sizeBytes,
    expiresIn,
  });

  res.status(201).json({ data: { key, uploadUrl, method: 'PUT', headers: { 'Content-Type': mimeType }, expiresIn } });
});
