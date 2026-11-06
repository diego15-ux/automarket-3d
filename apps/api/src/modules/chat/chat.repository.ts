import { contactSelect } from '../../shared/contact-card.js';
import { Prisma, type ChatMessage } from '../../generated/prisma/client.js';
import { prisma } from '../../shared/infra/prisma.js';

/** Capa de infraestructura del chat: solo acceso a datos, sin reglas de negocio. */

export type ConversationRef = { id: string; vehicleId: string; buyerId: string; sellerId: string };

const conversationRef = { id: true, vehicleId: true, buyerId: true, sellerId: true } as const;

export const chatRepository = {
  /** Devuelve el hilo solo si el usuario participa en él (autorización en la propia consulta). */
  findConversationForUser(conversationId: string, userId: string): Promise<ConversationRef | null> {
    return prisma.conversation.findFirst({
      where: { id: conversationId, OR: [{ buyerId: userId }, { sellerId: userId }] },
      select: conversationRef,
    });
  },

  findVehicleForConversation(vehicleId: string) {
    return prisma.vehicle.findFirst({
      where: { id: vehicleId, deletedAt: null, status: { in: ['PUBLISHED', 'RESERVED'] } },
      select: { id: true, sellerId: true },
    });
  },

  /** Un hilo por (vehículo, comprador): si ya existe se reutiliza. */
  upsertConversation(vehicleId: string, buyerId: string, sellerId: string): Promise<ConversationRef> {
    return prisma.conversation.upsert({
      where: { vehicleId_buyerId: { vehicleId, buyerId } },
      create: { vehicleId, buyerId, sellerId },
      update: {},
      select: conversationRef,
    });
  },

  listForUser(userId: string) {
    return prisma.conversation.findMany({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 50,
      select: {
        id: true,
        buyerId: true,
        lastMessageAt: true,
        buyerLastReadAt: true,
        sellerLastReadAt: true,
        vehicle: { select: { id: true, slug: true, make: true, model: true, year: true, status: true } },
        buyer: { select: contactSelect },
        seller: { select: contactSelect },
      },
    });
  },

  /** Último mensaje de cada hilo de la bandeja (una sola consulta). */
  async lastMessages(conversationIds: string[]) {
    if (conversationIds.length === 0) return new Map<string, Pick<ChatMessage, 'type' | 'body' | 'senderId' | 'moderationFlags'>>();
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT m.id FROM chat_messages m
      JOIN (
        SELECT conversationId, MAX(createdAt) AS lastAt FROM chat_messages
        WHERE conversationId IN (${Prisma.join(conversationIds)}) AND deletedAt IS NULL
        GROUP BY conversationId
      ) t ON t.conversationId = m.conversationId AND t.lastAt = m.createdAt
      WHERE m.deletedAt IS NULL`;
    const messages = await prisma.chatMessage.findMany({
      where: { id: { in: rows.map(row => row.id) } },
      select: { conversationId: true, type: true, body: true, senderId: true, moderationFlags: true },
    });
    return new Map(messages.map(({ conversationId, ...message }) => [conversationId, message]));
  },

  /** Mensajes de la otra persona que el usuario aún no leyó, por hilo. */
  async unreadCounts(conversationIds: string[], userId: string) {
    if (conversationIds.length === 0) return new Map<string, number>();
    const rows = await prisma.$queryRaw<Array<{ conversationId: string; unread: bigint }>>`
      SELECT c.id AS conversationId, COUNT(m.id) AS unread FROM conversations c
      JOIN chat_messages m ON m.conversationId = c.id
      WHERE c.id IN (${Prisma.join(conversationIds)}) AND m.deletedAt IS NULL AND m.senderId <> ${userId}
        AND m.createdAt > COALESCE(CASE WHEN c.buyerId = ${userId} THEN c.buyerLastReadAt ELSE c.sellerLastReadAt END, '1970-01-01')
      GROUP BY c.id`;
    return new Map(rows.map(row => [row.conversationId, Number(row.unread)]));
  },

  /** Última reserva de cada pareja «vehículo:comprador» (estado del trato en la bandeja). */
  async latestReservations(pairs: Array<{ vehicleId: string; buyerId: string }>) {
    if (pairs.length === 0) return new Map<string, { status: string; negotiatingAt: Date | null }>();
    const rows = await prisma.cartReserve.findMany({
      where: { type: 'RESERVATION', OR: pairs },
      orderBy: { createdAt: 'asc' },
      select: { vehicleId: true, buyerId: true, status: true, negotiatingAt: true },
    });
    return new Map(rows.map(row => [`${row.vehicleId}:${row.buyerId}`, { status: row.status, negotiatingAt: row.negotiatingAt }]));
  },

  /** Historial paginado hacia atrás (cursor = fecha del mensaje más antiguo recibido). */
  listMessages(conversationId: string, { before, limit }: { before?: Date; limit: number }): Promise<ChatMessage[]> {
    return prisma.chatMessage.findMany({
      where: { conversationId, deletedAt: null, ...(before ? { createdAt: { lt: before } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  /** Pares «vehículo:comprador» con reserva confirmada (o venta concretada), en una sola consulta. */
  async confirmedPairs(pairs: Array<{ vehicleId: string; buyerId: string }>): Promise<Set<string>> {
    if (pairs.length === 0) return new Set();
    const rows = await prisma.cartReserve.findMany({
      where: { type: 'RESERVATION', status: { in: ['ACCEPTED', 'COMPLETED'] }, OR: pairs },
      select: { vehicleId: true, buyerId: true },
    });
    return new Set(rows.map(row => `${row.vehicleId}:${row.buyerId}`));
  },

  /** Reserva aceptada (o venta concluida): a partir de ahí se pueden compartir datos de contacto. */
  async hasConfirmedReservation(vehicleId: string, buyerId: string): Promise<boolean> {
    const count = await prisma.cartReserve.count({
      where: { vehicleId, buyerId, type: 'RESERVATION', status: { in: ['ACCEPTED', 'COMPLETED'] } },
    });
    return count > 0;
  },

  /**
   * Inserta el mensaje y actualiza el hilo (último mensaje y lectura del emisor) en una transacción.
   * Idempotente: si (senderId, clientId) ya existe, devuelve el mensaje original.
   */
  async createMessage(data: Prisma.ChatMessageUncheckedCreateInput, conversation: ConversationRef): Promise<{ message: ChatMessage; created: boolean }> {
    const now = new Date();
    const senderRead = conversation.buyerId === data.senderId ? { buyerLastReadAt: now } : { sellerLastReadAt: now };
    try {
      const [message] = await prisma.$transaction([
        prisma.chatMessage.create({ data }),
        prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: now, ...senderRead } }),
      ]);
      return { message, created: true };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const message = await prisma.chatMessage.findUniqueOrThrow({
          where: { senderId_clientId: { senderId: data.senderId, clientId: data.clientId } },
        });
        return { message, created: false };
      }
      throw err;
    }
  },

  async markRead(conversation: ConversationRef, userId: string, readAt: Date): Promise<void> {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: conversation.buyerId === userId ? { buyerLastReadAt: readAt } : { sellerLastReadAt: readAt },
    });
  },
};
