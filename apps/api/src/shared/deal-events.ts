import { prisma } from './infra/prisma.js';
import { realtime } from './realtime.js';

/**
 * Cambió el trato de un auto (reserva pedida, confirmada, en negociación, cancelada o vendida):
 * avisa por socket a las dos partes de cada conversación del auto para que su panel «El trato»
 * y la bandeja se actualicen. Los demás compradores también lo ven (el auto pasa a «Reservado»).
 */
export async function dealChanged(vehicleId: string): Promise<void> {
  try {
    const conversations = await prisma.conversation.findMany({
      where: { vehicleId },
      select: { id: true, buyerId: true, sellerId: true },
      take: 200,
    });
    for (const conversation of conversations) {
      realtime.toUser(conversation.buyerId, 'deal:updated', { conversationId: conversation.id });
      realtime.toUser(conversation.sellerId, 'deal:updated', { conversationId: conversation.id });
    }
  } catch (err) {
    console.error('[deal] No se pudo avisar el cambio del trato', err);
  }
}
