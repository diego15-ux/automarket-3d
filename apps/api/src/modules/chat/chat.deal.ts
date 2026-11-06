import type { CHAT_REPORT_REASONS, ChatDealDTO, DealEventDTO } from '@automarket/contracts';
import { AppError } from '../../shared/errors/app-error.js';
import { isUniqueViolation, prisma } from '../../shared/infra/prisma.js';
import { effectivePlan } from '../../shared/membership.js';
import { assertNoBlockedTerms } from '../../shared/moderation/blocklist.js';
import { getPlan, getSettings } from '../memberships/plans.js';
import { reservationInclude, reservationsService, type ReservationRow } from '../reservations/reservations.service.js';
import { chatService } from './chat.service.js';
import { dealStatusOf, publicStatusOf } from './chat.status.js';

const OTHER_ACCEPTED_NOTE = 'El vendedor confirmó otra solicitud';
const DAY = 86_400_000;

/** Eventos del hilo: la consulta inicial y lo que pasó con cada reserva entre ambos (en orden). */
function eventsOf(conversation: { id: string; createdAt: Date; buyerId: string; sellerId: string }, reservations: ReservationRow[], holdDays: number): DealEventDTO[] {
  // La consulta abre el hilo; si la reserva se pidió desde la ficha, el hilo nace un instante después.
  const first = reservations[0]?.createdAt;
  const askedAt = first && first < conversation.createdAt ? new Date(first.getTime() - 1) : conversation.createdAt;
  const events: DealEventDTO[] = [{ id: `${conversation.id}:asked`, kind: 'ASKED', at: askedAt.toISOString(), by: 'BUYER', amount: null, until: null }];
  const byOf = (userId: string | null): DealEventDTO['by'] => (userId === conversation.buyerId ? 'BUYER' : userId === conversation.sellerId ? 'SELLER' : userId ? 'TEAM' : null);
  for (const r of reservations) {
    const deposit = r.depositAmount?.toFixed(2) ?? null;
    const push = (kind: DealEventDTO['kind'], at: Date | null, by: DealEventDTO['by'], extra: Partial<DealEventDTO> = {}) => {
      if (at) events.push({ id: `${r.id}:${kind}`, kind, at: at.toISOString(), by, amount: null, until: null, ...extra });
    };
    push('REQUESTED', r.createdAt, 'BUYER', { amount: deposit });
    if (r.acceptedAt) {
      const until = r.status === 'ACCEPTED' && r.expiresAt ? r.expiresAt : new Date(r.acceptedAt.getTime() + holdDays * DAY);
      push('ACCEPTED', r.acceptedAt, 'SELLER', { amount: deposit, until: until.toISOString() });
    }
    push('NEGOTIATING', r.negotiatingAt, 'SELLER');
    if (r.status === 'REJECTED') {
      push(r.decisionNote?.startsWith(OTHER_ACCEPTED_NOTE) ? 'REJECTED_OTHER' : 'REJECTED', r.decidedAt, r.decisionNote?.startsWith(OTHER_ACCEPTED_NOTE) ? null : 'SELLER');
    } else if (r.status === 'CANCELLED') {
      const by = byOf(r.cancelledById);
      if (!r.acceptedAt) push('WITHDRAWN', r.cancelledAt, by);
      else push(r.negotiatingAt && by === 'SELLER' ? 'NOT_CONCLUDED' : 'CANCELLED', r.cancelledAt, by);
    } else if (r.status === 'EXPIRED') {
      push(r.acceptedAt ? 'EXPIRED' : 'REQUEST_EXPIRED', r.decidedAt, null);
    } else if (r.status === 'COMPLETED') {
      push('SOLD', r.completedAt, 'SELLER', { amount: r.salePrice?.toFixed(2) ?? null });
    }
  }
  return events.sort((a, b) => a.at.localeCompare(b.at));
}

export const chatDeal = {
  /** «El trato»: estado, auto, última reserva, eventos del hilo y plazos. Solo para las dos partes. */
  async deal(conversationId: string, userId: string): Promise<ChatDealDTO> {
    const ref = await chatService.getConversationOrThrow(conversationId, userId);
    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: ref.id },
      select: {
        id: true,
        createdAt: true,
        buyerId: true,
        sellerId: true,
        buyer: { select: { id: true, name: true } },
        seller: { select: { id: true, name: true, isVerified: true, planCode: true, planCycle: true, planExpiresAt: true } },
        vehicle: {
          select: {
            id: true, slug: true, make: true, model: true, version: true, year: true, mileageKm: true, transmission: true, city: true, country: true,
            price: true, currency: true, status: true, negotiatingAt: true, reservationAmount: true,
            media: { where: { kind: 'IMAGE' }, orderBy: { position: 'asc' }, take: 1, select: { url: true } },
          },
        },
      },
    });
    const [reservations, watchers, settings] = await Promise.all([
      prisma.cartReserve.findMany({
        where: { type: 'RESERVATION', vehicleId: conversation.vehicle.id, buyerId: conversation.buyerId },
        include: reservationInclude,
        orderBy: { createdAt: 'asc' },
        take: 50,
      }),
      prisma.vehicleWatch.count({ where: { vehicleId: conversation.vehicle.id } }),
      getSettings(),
    ]);
    const latest = reservations.at(-1) ?? null;
    const isSeller = conversation.sellerId === userId;
    let commissionRate: number | null = null;
    if (isSeller) {
      commissionRate = latest?.commissionRate ? latest.commissionRate.toNumber() : Number((await getPlan(effectivePlan(conversation.seller).code)).commissionRate);
    }
    const v = conversation.vehicle;
    return {
      conversationId: conversation.id,
      role: isSeller ? 'SELLER' : 'BUYER',
      status: dealStatusOf(v.status, latest),
      publicStatus: publicStatusOf(v),
      vehicle: {
        id: v.id, slug: v.slug, make: v.make, model: v.model, version: v.version, year: v.year, mileageKm: v.mileageKm, transmission: v.transmission,
        city: v.city, country: v.country, price: v.price.toFixed(2), currency: v.currency, status: v.status, coverUrl: v.media[0]?.url ?? null,
        reservationAmount: v.reservationAmount?.toFixed(2) ?? null,
      },
      buyer: conversation.buyer,
      seller: { id: conversation.seller.id, name: conversation.seller.name, isVerified: conversation.seller.isVerified },
      reservation: latest ? reservationsService.toDTO(latest, userId) : null,
      events: eventsOf(conversation, reservations, settings.reservationHoldDays),
      watchers,
      rules: { sellerResponseHours: settings.sellerResponseHours, reservationHoldDays: settings.reservationHoldDays },
      commissionRate,
    };
  },

  /** Reporte anónimo de la otra persona de la conversación (el equipo lo revisa en Moderación). */
  async report(conversationId: string, userId: string, input: { reason: (typeof CHAT_REPORT_REASONS)[number]; details?: string }) {
    const conversation = await chatService.getConversationOrThrow(conversationId, userId);
    await assertNoBlockedTerms({ details: input.details });
    const reportedUserId = conversation.buyerId === userId ? conversation.sellerId : conversation.buyerId;
    try {
      await prisma.report.create({
        data: {
          kind: 'CHAT',
          vehicleId: conversation.vehicleId,
          conversationId: conversation.id,
          reportedUserId,
          reporterId: userId,
          dedupeKey: `C:${conversation.id}:${userId}`,
          reason: input.reason,
          details: input.details || null,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict('ALREADY_REPORTED', 'Ya reportaste esta conversación; el equipo la está revisando.');
      throw err;
    }
  },
};
