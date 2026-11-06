import { env } from '../../config/env.js';
import type { ChatMessage } from '../../generated/prisma/client.js';
import { AppError } from '../../shared/errors/app-error.js';
import { isUniqueViolation } from '../../shared/infra/prisma.js';
import { presignDownload, statObject } from '../../shared/infra/storage.js';
import { baseMime } from '../../shared/utils/mime.js';
import { contactCard } from '../../shared/contact-card.js';
import { assertMediaAllowed, chatMediaPrefix, voiceNotesLocked } from '../media/media.policy.js';
import type { MessageDTO } from './chat.events.js';
import { chatRepository, type ConversationRef } from './chat.repository.js';
import type { SendMessageInput } from './chat.schemas.js';
import { getBlocklist } from '../../shared/moderation/blocklist.js';
import { moderateText } from './moderation/privacy-filter.js';
import { dealStatusOf } from './chat.status.js';

async function toDTO(message: ChatMessage): Promise<MessageDTO> {
  const media =
    message.mediaKey && message.mediaMimeType
      ? {
          url: await presignDownload(env.S3_BUCKET_MEDIA, message.mediaKey),
          mimeType: message.mediaMimeType,
          sizeBytes: message.mediaSizeBytes ?? 0,
          durationMs: message.durationMs,
          width: message.width,
          height: message.height,
        }
      : null;

  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    clientId: message.clientId,
    type: message.type,
    body: message.body,
    media,
    moderationFlags: Array.isArray(message.moderationFlags) ? (message.moderationFlags as string[]) : [],
    createdAt: message.createdAt.toISOString(),
  };
}

/** Casos de uso del chat. No conoce Socket.io ni HTTP: los reutilizan ambos transportes. */
export const chatService = {
  toDTO,

  async getConversationOrThrow(conversationId: string, userId: string): Promise<ConversationRef> {
    const conversation = await chatRepository.findConversationForUser(conversationId, userId);
    if (!conversation) throw AppError.forbidden('NOT_A_PARTICIPANT', 'No participas en esta conversación.');
    return conversation;
  },

  /** "Contactar al vendedor": abre (o reutiliza) el hilo comprador ↔ vendedor del vehículo. */
  async openConversation(vehicleId: string, buyerId: string): Promise<ConversationRef> {
    const vehicle = await chatRepository.findVehicleForConversation(vehicleId);
    if (!vehicle) throw AppError.notFound('VEHICLE_NOT_FOUND', 'Vehículo no encontrado.');
    if (vehicle.sellerId === buyerId) throw AppError.forbidden('OWN_VEHICLE', 'No puedes abrir un chat sobre tu propio vehículo.');

    try {
      return await chatRepository.upsertConversation(vehicleId, buyerId, vehicle.sellerId);
    } catch (err) {
      // Dos clics simultáneos: el segundo upsert choca con el UNIQUE y reintenta leyendo.
      if (isUniqueViolation(err)) return chatRepository.upsertConversation(vehicleId, buyerId, vehicle.sellerId);
      throw err;
    }
  },

  /** Chat directo = hay una reserva confirmada (o venta concretada) entre comprador y vehículo. */
  isDirect(conversation: ConversationRef): Promise<boolean> {
    return chatRepository.hasConfirmedReservation(conversation.vehicleId, conversation.buyerId);
  },

  /**
   * Bandeja de entrada con el interlocutor y si hay mensajes sin leer. En el chat directo se
   * incluyen los datos verificados de la otra parte y se habilitan las notas de voz.
   */
  async inbox(userId: string) {
    const conversations = await chatRepository.listForUser(userId);
    const pairs = conversations.map(c => ({ vehicleId: c.vehicle.id, buyerId: c.buyerId }));
    const ids = conversations.map(c => c.id);
    const [direct, lastMessages, unreadCounts, latest] = await Promise.all([
      chatRepository.confirmedPairs(pairs),
      chatRepository.lastMessages(ids),
      chatRepository.unreadCounts(ids, userId),
      chatRepository.latestReservations(pairs),
    ]);
    return conversations.map(({ buyerId, buyer, seller, buyerLastReadAt, sellerLastReadAt, ...conversation }) => {
      const asBuyer = buyerId === userId;
      const myLastRead = asBuyer ? buyerLastReadAt : sellerLastReadAt;
      const counterpart = asBuyer ? seller : buyer;
      const isDirect = direct.has(`${conversation.vehicle.id}:${buyerId}`);
      const last = lastMessages.get(conversation.id);
      const flags = last && Array.isArray(last.moderationFlags) ? (last.moderationFlags as string[]) : [];
      const { status: vehicleStatus, ...vehicle } = conversation.vehicle;
      return {
        ...conversation,
        vehicle,
        role: asBuyer ? ('BUYER' as const) : ('SELLER' as const),
        unreadCount: unreadCounts.get(conversation.id) ?? 0,
        /** Hasta cuándo leyó la otra persona («Visto»). */
        counterpartLastReadAt: (asBuyer ? sellerLastReadAt : buyerLastReadAt)?.toISOString() ?? null,
        lastMessage: last ? { type: last.type, body: last.body, mine: last.senderId === userId, hidden: flags.some(flag => ['EMAIL', 'PHONE', 'URL'].includes(flag)) } : null,
        dealStatus: dealStatusOf(vehicleStatus, latest.get(`${conversation.vehicle.id}:${buyerId}`) ?? null),
        counterpart: { id: counterpart.id, name: counterpart.name, avatarUrl: counterpart.avatarUrl, isVerified: counterpart.isVerified },
        unread: conversation.lastMessageAt !== null && (myLastRead === null || conversation.lastMessageAt > myLastRead),
        direct: isDirect,
        contact: isDirect ? contactCard(counterpart) : null,
      };
    });
  },

  async history(conversationId: string, userId: string, page: { before?: Date; limit: number }): Promise<MessageDTO[]> {
    await chatService.getConversationOrThrow(conversationId, userId);
    const messages = await chatRepository.listMessages(conversationId, page);
    return Promise.all(messages.map(toDTO));
  },

  async sendMessage(conversation: ConversationRef, senderId: string, input: SendMessageInput) {
    // Los datos de contacto solo se comparten cuando hay una reserva confirmada.
    const [allowContactInfo, blocklist] = await Promise.all([
      chatRepository.hasConfirmedReservation(conversation.vehicleId, conversation.buyerId),
      getBlocklist(),
    ]);
    const base = { conversationId: conversation.id, senderId, clientId: input.clientId };

    if (input.type === 'TEXT') {
      const { text, flags } = moderateText(input.text, { allowContactInfo, blocklist });
      return chatRepository.createMessage({ ...base, type: 'TEXT', body: text, moderationFlags: flags }, conversation);
    }

    // Multimedia: el binario ya está en S3 (subida directa). Verificamos que:
    //   1) la clave pertenece a esta conversación y a este usuario,
    //   2) el tipo y tamaño cumplen la política,
    //   3) el objeto existe y coincide con lo declarado (no confiamos en el cliente).
    const { media } = input;
    if (input.type === 'AUDIO' && !allowContactInfo) throw voiceNotesLocked();
    if (!media.key.startsWith(chatMediaPrefix(conversation.id, senderId, input.type))) {
      throw AppError.forbidden('MEDIA_KEY_FORBIDDEN', 'El archivo no pertenece a esta conversación.');
    }

    const mimeType = baseMime(media.mimeType);
    assertMediaAllowed(input.type, mimeType, media.sizeBytes, media.durationMs);

    const stored = await statObject(env.S3_BUCKET_MEDIA, media.key);
    if (!stored) throw AppError.badRequest('MEDIA_NOT_UPLOADED', 'El archivo aún no termina de subirse.');
    if (stored.sizeBytes !== media.sizeBytes || baseMime(stored.contentType) !== mimeType) {
      throw AppError.badRequest('MEDIA_MISMATCH', 'El archivo subido no coincide con los datos enviados.');
    }

    const caption = input.caption ? moderateText(input.caption, { allowContactInfo, blocklist }) : null;

    return chatRepository.createMessage(
      {
        ...base,
        type: input.type,
        body: caption?.text ?? null,
        mediaKey: media.key,
        mediaMimeType: mimeType,
        mediaSizeBytes: stored.sizeBytes,
        durationMs: media.durationMs ?? null,
        width: media.width ?? null,
        height: media.height ?? null,
        moderationFlags: caption?.flags ?? [],
      },
      conversation,
    );
  },

  async markRead(conversation: ConversationRef, userId: string): Promise<string> {
    const readAt = new Date();
    await chatRepository.markRead(conversation, userId, readAt);
    return readAt.toISOString();
  },
};
