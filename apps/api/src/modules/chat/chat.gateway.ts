import type { Server, Socket } from 'socket.io';
import type { z } from 'zod';
import { AppError } from '../../shared/errors/app-error.js';
import { createTokenBucket } from '../../shared/utils/rate-limiter.js';
import type { AckResponse, ClientToServerEvents, InterServerEvents, ServerToClientEvents, SocketData } from './chat.events.js';
import { ConversationRefSchema, SendMessageSchema, TypingSchema } from './chat.schemas.js';
import { chatService } from './chat.service.js';

export type ChatServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
export type ChatSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/** Sala por conversación (hilo abierto) y sala personal (notificaciones de bandeja). */
export const conversationRoom = (conversationId: string) => `conversation:${conversationId}`;
export const userRoom = (userId: string) => `user:${userId}`;

function toSocketError(err: unknown) {
  if (err instanceof AppError) return { code: err.code, message: err.message };
  console.error('[chat] Error no controlado:', err);
  return { code: 'INTERNAL', message: 'No se pudo procesar el mensaje. Inténtalo de nuevo.' };
}

/**
 * Envuelve un handler: valida el payload con Zod, captura errores y responde
 * SIEMPRE por ACK con { ok, data | error }. Así el cliente puede hacer
 * `await socket.emitWithAck(...)` con reintentos y timeouts.
 */
function withAck<S extends z.ZodType, R>(schema: S, run: (input: z.infer<S>) => Promise<R>) {
  return async (payload: unknown, ack?: (response: AckResponse<R>) => void): Promise<void> => {
    const reply = typeof ack === 'function' ? ack : () => undefined;

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      reply({ ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Datos inválidos.' } });
      return;
    }

    try {
      reply({ ok: true, data: await run(parsed.data) });
    } catch (err) {
      reply({ ok: false, error: toSocketError(err) });
    }
  };
}

export function registerChatHandlers(io: ChatServer, socket: ChatSocket): void {
  const userId = socket.data.user.id;
  // Ráfagas de hasta 10 mensajes, 1 msg/s sostenido por conexión.
  const sendLimiter = createTokenBucket({ capacity: 10, refillPerSecond: 1 });

  // Abrir un hilo: se verifica la membresía UNA vez y se entra en su sala.
  socket.on(
    'conversation:join',
    withAck(ConversationRefSchema, async ({ conversationId }) => {
      await chatService.getConversationOrThrow(conversationId, userId);
      await socket.join(conversationRoom(conversationId));
      return { conversationId };
    }),
  );

  socket.on('conversation:leave', payload => {
    const parsed = ConversationRefSchema.safeParse(payload);
    if (parsed.success) void socket.leave(conversationRoom(parsed.data.conversationId));
  });

  // Texto, imágenes, vídeo y notas de voz (los binarios ya están en S3).
  socket.on(
    'message:send',
    withAck(SendMessageSchema, async input => {
      if (!sendLimiter.take()) throw AppError.tooManyRequests('RATE_LIMITED', 'Estás enviando mensajes demasiado rápido.');

      const conversation = await chatService.getConversationOrThrow(input.conversationId, userId);
      const { message, created } = await chatService.sendMessage(conversation, userId, input);
      const dto = await chatService.toDTO(message);

      // Un reintento (mismo clientId) no vuelve a notificar a nadie.
      if (created) {
        const room = conversationRoom(conversation.id);
        // Al resto de sockets del hilo (incluidos otros dispositivos del emisor)…
        socket.to(room).emit('message:new', dto);
        // …y a la bandeja del destinatario si no tiene el hilo abierto.
        const recipientId = conversation.buyerId === userId ? conversation.sellerId : conversation.buyerId;
        io.to(userRoom(recipientId)).except(room).emit('inbox:updated', { conversationId: conversation.id, lastMessage: dto });
      }

      // El emisor recibe su mensaje confirmado (con el texto ya filtrado) por ACK.
      return dto;
    }),
  );

  socket.on(
    'message:read',
    withAck(ConversationRefSchema, async ({ conversationId }) => {
      const conversation = await chatService.getConversationOrThrow(conversationId, userId);
      const readAt = await chatService.markRead(conversation, userId);
      socket.to(conversationRoom(conversationId)).emit('message:read', { conversationId, userId, readAt });
      return { readAt };
    }),
  );

  // "Escribiendo…": efímero (volatile) y sin BD; solo si ya está dentro del hilo.
  socket.on('typing', payload => {
    const parsed = TypingSchema.safeParse(payload);
    if (!parsed.success) return;
    const room = conversationRoom(parsed.data.conversationId);
    if (!socket.rooms.has(room)) return;
    socket.to(room).volatile.emit('typing', { ...parsed.data, userId });
  });
}
