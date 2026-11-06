import { type PaymentDTO, type PaymentMethod, type ReservationDTO, type SaleCommissionCheckoutInput } from '@automarket/contracts';
import { env } from '../../config/env.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../shared/errors/app-error.js';
import { recordAudit, type AuditAction } from '../../shared/infra/audit.js';
import { isUniqueViolation, prisma, runInTransaction, type Db } from '../../shared/infra/prisma.js';
import { emails } from '../../shared/mail/templates.js';
import { effectivePlan } from '../../shared/membership.js';
import { assertNoBlockedTerms } from '../../shared/moderation/blocklist.js';
import { deliver, notify, type PendingNotice } from '../../shared/notifications.js';
import { realtime } from '../../shared/realtime.js';
import { clearWatchers, notifyWatchersAvailable } from '../../shared/vehicle-watches.js';
import { dealChanged } from '../../shared/deal-events.js';
import { assertCanTransact } from '../../shared/trust.js';
import { contactCard, contactSelect } from '../../shared/contact-card.js';
import { percentOf } from '../../shared/utils/money.js';
import { chatService } from '../chat/chat.service.js';
import { getPlan, getSettings } from '../memberships/plans.js';
import { closePendingPayment, paymentInclude, prepareCheckout, refundPayment, toPaymentDTO } from '../payments/payment-gateway.js';

/**
 * Reserva P2P con confirmación del vendedor. AutoMarket NO cobra ni custodia el abono: el
 * comprador se lo paga directamente al vendedor. La plataforma cobra con Binance solo la
 * comisión post-venta (y las membresías).
 *
 *   AWAITING_SELLER ──(vendedor confirma: bloqueo atómico del vehículo)──▶ ACCEPTED ──(venta concretada)──▶ COMPLETED
 *   AWAITING_SELLER ──(rechazo · plazo vencido · cancelación del comprador)──▶ REJECTED / EXPIRED / CANCELLED
 *   ACCEPTED ──(cancelación o fin del plazo de reserva sin venta)──▶ CANCELLED / EXPIRED (vuelve a estar disponible)
 *
 * El bloqueo es un UPDATE condicional sobre vehicles.lockedReservationId (UNIQUE): nunca dos
 * reservas confirmadas para el mismo vehículo. Si la venta no se concreta, el vendedor debe
 * devolver el 100 % del abono (aviso legal aceptado por el comprador al reservar).
 */

export const reservationInclude = {
  vehicle: {
    select: {
      id: true, slug: true, make: true, model: true, year: true, price: true, currency: true, status: true, reservationAmount: true,
      media: { where: { kind: 'IMAGE' }, orderBy: { position: 'asc' }, take: 1, select: { url: true } },
    },
  },
  buyer: { select: contactSelect },
  seller: { select: contactSelect },
  payment: true,
  sellerReview: { select: { rating: true } },
} satisfies Prisma.CartReserveInclude;

export type ReservationRow = Prisma.CartReserveGetPayload<{ include: typeof reservationInclude }>;

const toDTO = (r: ReservationRow, viewerId?: string): ReservationDTO => {
  const direct = r.status === 'ACCEPTED' || r.status === 'COMPLETED';
  const counterpart = viewerId === r.buyerId ? r.seller : viewerId === r.sellerId ? r.buyer : null;
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    depositAmount: r.depositAmount?.toFixed(2) ?? null,
    salePrice: r.salePrice?.toFixed(2) ?? null,
    commissionRate: r.commissionRate?.toNumber() ?? null,
    commissionAmount: r.commissionAmount?.toFixed(2) ?? null,
    commissionDueAt: r.commissionDueAt?.toISOString() ?? null,
    commissionPaidAt: r.commissionPaidAt?.toISOString() ?? null,
    currency: r.currency,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    acceptedAt: r.acceptedAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    negotiatingAt: r.negotiatingAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    decisionNote: r.decisionNote,
    sellerReviewRating: viewerId === r.buyerId ? r.sellerReview?.rating ?? null : null,
    // El intento de pago de la comisión solo le interesa al vendedor.
    payment: r.payment && viewerId !== r.buyerId ? { id: r.payment.id, status: r.payment.status, mode: r.payment.mode } : null,
    vehicle: {
      id: r.vehicle.id, slug: r.vehicle.slug, make: r.vehicle.make, model: r.vehicle.model, year: r.vehicle.year,
      price: r.vehicle.price.toFixed(2), currency: r.vehicle.currency, status: r.vehicle.status, coverUrl: r.vehicle.media[0]?.url ?? null,
    },
    buyer: { id: r.buyer.id, name: r.buyer.name, avatarUrl: r.buyer.avatarUrl },
    seller: { id: r.seller.id, name: r.seller.name, avatarUrl: r.seller.avatarUrl },
    contact: direct && counterpart ? contactCard(counterpart) : null,
  };
};

const title = (r: ReservationRow) => `${r.vehicle.make} ${r.vehicle.model} ${r.vehicle.year}`;
const openKeyOf = (buyerId: string, vehicleId: string) => `${buyerId}:${vehicleId}`;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const money = (amount: Prisma.Decimal | null) => amount?.toFixed(2) ?? '0.00';

async function load(id: string, db: Db = prisma): Promise<ReservationRow> {
  const reservation = await db.cartReserve.findUnique({ where: { id }, include: reservationInclude });
  if (!reservation || reservation.type !== 'RESERVATION') throw AppError.notFound('RESERVATION_NOT_FOUND', 'Reserva no encontrada.');
  return reservation;
}

async function audit(action: AuditAction, r: ReservationRow, actorId: string | null, metadata: Record<string, string | number | null>, db: Db = prisma) {
  await recordAudit({ action, entityType: 'CartReserve', entityId: r.id, actorId, metadata }, db);
}

export const reservationsService = {
  toDTO,

  async list(userId: string, as: 'buyer' | 'seller') {
    const rows = await prisma.cartReserve.findMany({
      where: { type: 'RESERVATION', ...(as === 'buyer' ? { buyerId: userId } : { sellerId: userId }) },
      include: reservationInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(row => toDTO(row, userId));
  },

  async rateSeller(buyerId: string, reservationId: string, rating: number, comment?: string) {
    const reservation = await prisma.cartReserve.findUnique({
      where: { id: reservationId },
      select: { id: true, buyerId: true, sellerId: true, status: true, type: true },
    });
    if (!reservation || reservation.type !== 'RESERVATION') throw AppError.notFound('RESERVATION_NOT_FOUND', 'Reserva no encontrada.');
    if (reservation.buyerId !== buyerId) throw AppError.forbidden('NOT_BUYER', 'Solo el comprador de la reserva puede valorar al vendedor.');
    if (reservation.status !== 'COMPLETED') throw AppError.conflict('SALE_NOT_COMPLETED', 'Solo puedes valorar una venta concretada.');
    // El comentario es opcional: sin el campo se conserva el que había; vacío lo borra.
    if (comment) await assertNoBlockedTerms({ comment });
    const text = comment === undefined ? undefined : comment || null;
    const review = await prisma.sellerReview.upsert({
      where: { reservationId },
      create: { reservationId, buyerId, sellerId: reservation.sellerId, rating, comment: text ?? null },
      update: { rating, ...(text !== undefined && { comment: text }) },
      select: { rating: true, comment: true },
    });
    return review;
  },

  /** Estado de la reserva del usuario sobre un vehículo (ficha del vehículo). */
  async mineForVehicle(userId: string, vehicleId: string) {
    const row = await prisma.cartReserve.findFirst({ where: { type: 'RESERVATION', buyerId: userId, vehicleId }, include: reservationInclude, orderBy: { createdAt: 'desc' } });
    return row ? toDTO(row, userId) : null;
  },

  /**
   * El comprador (identidad verificada) solicita la reserva tras aceptar el aviso legal. No hay
   * cobro: el abono que fijó el vendedor se le paga directamente a él cuando confirme.
   */
  async create(buyerId: string, vehicleId: string): Promise<ReservationDTO> {
    const [buyer, vehicle, settings] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: buyerId }, select: { id: true, isVerified: true } }),
      prisma.vehicle.findUnique({ where: { id: vehicleId }, include: { seller: { select: { status: true, isVerified: true } } } }),
      getSettings(),
    ]);
    await assertCanTransact(buyer, 'reserve');
    if (!vehicle || vehicle.deletedAt || vehicle.status !== 'PUBLISHED' || vehicle.lockedReservationId) {
      throw AppError.conflict('VEHICLE_NOT_AVAILABLE', 'Este vehículo no está disponible para reservar.');
    }
    if (vehicle.sellerId === buyerId) throw AppError.badRequest('OWN_VEHICLE', 'No puedes reservar tu propio vehículo.');
    if (vehicle.seller.status !== 'ACTIVE') throw AppError.conflict('SELLER_UNAVAILABLE', 'El vendedor no está disponible.');
    if (!vehicle.seller.isVerified) {
      throw AppError.conflict('SELLER_NOT_VERIFIED', 'El vendedor aún no verificó su identidad: todavía no puede recibir reservas. Escríbele por el chat.');
    }
    if (!vehicle.reservationAmount) {
      throw AppError.conflict('RESERVATION_AMOUNT_MISSING', 'El vendedor aún no fijó el abono de reserva de este vehículo. Escríbele por el chat.');
    }

    const now = new Date();
    const deadline = new Date(now.getTime() + settings.sellerResponseHours * HOUR);
    const notices: Array<PendingNotice | null> = [];
    let created: ReservationRow;
    try {
      created = await runInTransaction(async tx => {
        const row = await tx.cartReserve.create({
          data: {
            buyerId, sellerId: vehicle.sellerId, vehicleId, type: 'RESERVATION', status: 'AWAITING_SELLER', openKey: openKeyOf(buyerId, vehicleId),
            depositAmount: vehicle.reservationAmount, currency: vehicle.currency, legalAcceptedAt: now, expiresAt: deadline,
          },
          include: reservationInclude,
        });
        notices.push(
          await notify(tx, {
            userId: row.sellerId,
            type: 'RESERVATION_REQUESTED',
            title: 'Nueva solicitud de reserva',
            body: `${row.buyer.name} (identidad verificada) quiere reservar tu ${title(row)}. Confírmala o recházala antes del ${deadline.toISOString().slice(0, 10)}.`,
            link: '/cuenta/reservas?tab=ventas',
            email: emails.reservationRequested({ to: row.seller.email, name: row.seller.name, vehicle: title(row), deposit: money(row.depositAmount), currency: row.currency, deadline }),
          }),
        );
        return row;
      });
    } catch (err) {
      if (isUniqueViolation(err, 'openKey')) throw AppError.conflict('ALREADY_RESERVED', 'Ya tienes una reserva en curso para este vehículo.');
      throw err;
    }
    deliver(notices);
    // El hilo de chat comprador ↔ vendedor queda abierto para coordinar.
    await chatService.openConversation(vehicleId, buyerId).catch(() => undefined);
    void dealChanged(vehicleId);
    return toDTO(created, buyerId);
  },

  /**
   * El vendedor confirma: bloqueo atómico del vehículo durante el plazo de reserva y chat directo
   * con los datos verificados. El resto de solicitudes del vehículo se rechazan.
   */
  async accept(sellerId: string, reservationId: string, note?: string) {
    const accepted = await runInTransaction(async tx => {
      await tx.$queryRaw`SELECT id FROM cart_reserves WHERE id = ${reservationId} FOR UPDATE`;
      const r = await load(reservationId, tx);
      if (r.sellerId !== sellerId) throw AppError.forbidden('NOT_SELLER', 'Esta reserva no es de uno de tus vehículos.');
      if (r.status !== 'AWAITING_SELLER') throw AppError.conflict('INVALID_STATUS', 'Esta solicitud ya no está pendiente de tu respuesta.');
      if (r.expiresAt && r.expiresAt <= new Date()) throw AppError.conflict('RESERVATION_EXPIRED', 'El plazo para responder a esta solicitud venció.');
      const seller = await tx.user.findUniqueOrThrow({ where: { id: sellerId } });
      await assertCanTransact(seller, 'accept', tx);

      // Bloqueo: solo una reserva confirmada por vehículo (UPDATE condicional + UNIQUE).
      const { count } = await tx.vehicle.updateMany({
        where: { id: r.vehicleId, status: 'PUBLISHED', lockedReservationId: null, deletedAt: null },
        data: { status: 'RESERVED', lockedReservationId: r.id },
      });
      if (count !== 1) throw AppError.conflict('VEHICLE_ALREADY_RESERVED', 'El vehículo ya está reservado o no está publicado.');

      const [plan, settings] = await Promise.all([getPlan(effectivePlan(seller).code, tx), getSettings(tx)]);
      const now = new Date();
      const updated = await tx.cartReserve.update({
        where: { id: r.id },
        data: {
          status: 'ACCEPTED', acceptedAt: now, decidedAt: now, decisionNote: note ?? null,
          // Plazo de la reserva: si la venta no se concreta, el vehículo vuelve a estar disponible.
          expiresAt: new Date(now.getTime() + settings.reservationHoldDays * DAY),
          // Tasa de comisión del plan vigente al confirmar (se cobra al concretarse la venta).
          commissionRate: plan.commissionRate,
        },
        include: reservationInclude,
      });
      const notice = await notify(tx, {
        userId: updated.buyerId,
        type: 'RESERVATION_ACCEPTED',
        title: '¡Reserva confirmada!',
        body: `El vendedor confirmó tu reserva del ${title(updated)}. Coordina el abono (${money(updated.depositAmount)} ${updated.currency}) por el chat directo: ya ves sus datos verificados.`,
        link: '/cuenta/reservas',
        email: emails.reservationDecision({ to: updated.buyer.email, name: updated.buyer.name, vehicle: title(updated), accepted: true, deposit: money(updated.depositAmount), currency: updated.currency, note: updated.decisionNote }),
      });
      await audit('RESERVATION_ACCEPTED', updated, sellerId, { deposit: money(updated.depositAmount) }, tx);
      return { updated, notice };
    });
    deliver([accepted.notice]);
    await reservationsService.closeCompeting(accepted.updated.vehicleId, accepted.updated.id);
    void dealChanged(accepted.updated.vehicleId);
    realtime.statsChanged();
    return toDTO(await load(accepted.updated.id), sellerId);
  },

  /** Al confirmar una solicitud, el resto de solicitudes abiertas del vehículo se rechazan. */
  async closeCompeting(vehicleId: string, acceptedId: string) {
    const others = await prisma.cartReserve.findMany({ where: { vehicleId, type: 'RESERVATION', status: 'AWAITING_SELLER', id: { not: acceptedId } }, include: reservationInclude });
    for (const other of others) {
      await reservationsService.close(other, 'REJECTED', 'El vendedor confirmó otra solicitud de reserva para este vehículo.', null);
    }
  },

  /** Cierra una solicitud aún NO confirmada (rechazo, cancelación del comprador, caducidad). */
  async close(r: ReservationRow, status: 'REJECTED' | 'CANCELLED' | 'EXPIRED', note: string, actorId: string | null) {
    const notices: Array<PendingNotice | null> = [];
    const closed = await runInTransaction(async tx => {
      const now = new Date();
      const { count } = await tx.cartReserve.updateMany({
        where: { id: r.id, status: 'AWAITING_SELLER' },
        data: { status, openKey: null, decisionNote: note.slice(0, 500), ...(status === 'CANCELLED' ? { cancelledAt: now, cancelledById: actorId } : { decidedAt: now }) },
      });
      if (count === 0) return false;
      const rejected = status === 'REJECTED';
      if (actorId !== r.buyerId) {
        notices.push(
          await notify(tx, {
            userId: r.buyerId,
            type: rejected ? 'RESERVATION_REJECTED' : 'RESERVATION_CLOSED',
            title: rejected ? 'Reserva no aceptada' : 'Solicitud de reserva vencida',
            body: `${title(r)}: ${note}`,
            link: '/cuenta/reservas',
            ...(rejected && { email: emails.reservationDecision({ to: r.buyer.email, name: r.buyer.name, vehicle: title(r), accepted: false, note }) }),
          }),
        );
      }
      if (!rejected) notices.push(await notify(tx, { userId: r.sellerId, type: 'RESERVATION_CLOSED', title: 'Solicitud de reserva cerrada', body: `${title(r)}: ${note}`, link: '/cuenta/reservas?tab=ventas' }));
      if (rejected) await audit('RESERVATION_REJECTED', r, actorId, { note }, tx);
      return true;
    });
    if (closed) {
      deliver(notices);
      void dealChanged(r.vehicleId);
    }
    return closed;
  },

  /**
   * Una reserva confirmada termina sin venta (cancelación o fin del plazo): el vehículo vuelve a
   * estar disponible y se recuerda al vendedor que debe devolver el 100 % del abono.
   */
  async release(r: ReservationRow, status: 'CANCELLED' | 'EXPIRED', note: string, actorId: string | null) {
    const notices: Array<PendingNotice | null> = [];
    const released = await runInTransaction(async tx => {
      const now = new Date();
      const { count } = await tx.cartReserve.updateMany({
        where: { id: r.id, status: 'ACCEPTED' },
        data: { status, openKey: null, decisionNote: note.slice(0, 500), ...(status === 'CANCELLED' ? { cancelledAt: now, cancelledById: actorId } : { decidedAt: now }) },
      });
      if (count === 0) return false;
      const back = await tx.vehicle.updateMany({ where: { id: r.vehicleId, lockedReservationId: r.id }, data: { status: 'PUBLISHED', lockedReservationId: null, negotiatingAt: null } });
      // «Avísame si vuelve»: quienes esperaban este auto ya pueden reservarlo.
      if (back.count === 1) notices.push(...(await notifyWatchersAvailable(tx, r.vehicle)));
      for (const party of [r.buyer, r.seller]) {
        const isSeller = party.id === r.sellerId;
        notices.push(
          await notify(tx, {
            userId: party.id,
            type: status === 'CANCELLED' ? 'RESERVATION_CANCELLED' : 'RESERVATION_EXPIRED',
            title: status === 'CANCELLED' ? 'Reserva cancelada' : 'Reserva vencida sin venta',
            body: `${title(r)}: ${note} ${isSeller ? 'Debes devolver el 100 % del abono si ya lo recibiste.' : 'El vendedor debe devolverte el 100 % del abono si ya lo pagaste.'}`,
            link: isSeller ? '/cuenta/reservas?tab=ventas' : '/cuenta/reservas',
            email: emails.reservationReleased({ to: party.email, name: party.name, vehicle: title(r), deposit: money(r.depositAmount), currency: r.currency, reason: note, isSeller }),
          }),
        );
      }
      await audit(status === 'CANCELLED' ? 'RESERVATION_CANCELLED' : 'RESERVATION_EXPIRED', r, actorId, { reason: note }, tx);
      return true;
    });
    if (!released) return false;
    deliver(notices);
    void dealChanged(r.vehicleId);
    realtime.statsChanged();
    return true;
  },

  async reject(sellerId: string, reservationId: string, note?: string) {
    const r = await load(reservationId);
    if (r.sellerId !== sellerId) throw AppError.forbidden('NOT_SELLER', 'Esta reserva no es de uno de tus vehículos.');
    if (r.status !== 'AWAITING_SELLER') throw AppError.conflict('INVALID_STATUS', 'Esta solicitud ya no está pendiente de tu respuesta.');
    await reservationsService.close(r, 'REJECTED', note?.trim() || 'El vendedor no aceptó la reserva.', sellerId);
    return toDTO(await load(reservationId), sellerId);
  },

  /**
   * Cancelación. Antes de confirmar: el comprador retira su solicitud. Después de confirmar:
   * comprador, vendedor o administrador; el vehículo vuelve a estar disponible y el vendedor debe
   * devolver el abono íntegro.
   */
  async cancel(actor: { id: string; role: string }, reservationId: string, reason?: string) {
    const r = await load(reservationId);
    const isAdmin = actor.role === 'ADMIN' || actor.role === 'ADMIN_ONE';
    const isBuyer = r.buyerId === actor.id;
    const isSeller = r.sellerId === actor.id;
    if (!isAdmin && !isBuyer && !isSeller) throw AppError.forbidden('NOT_A_PARTY', 'No participas en esta reserva.');

    if (r.status === 'AWAITING_SELLER') {
      if (!isBuyer && !isAdmin) throw AppError.forbidden('USE_REJECT', 'Para declinar una solicitud usa «Rechazar».');
      await reservationsService.close(r, 'CANCELLED', reason?.trim() || 'El comprador retiró la solicitud.', actor.id);
      return toDTO(await load(reservationId), actor.id);
    }
    if (r.status !== 'ACCEPTED') throw AppError.conflict('INVALID_STATUS', 'Esta reserva ya está cerrada.');
    const note = reason?.trim() || `Cancelada por ${isAdmin ? 'el equipo de AutoMarket' : isBuyer ? 'el comprador' : 'el vendedor'}.`;
    if (!(await reservationsService.release(r, 'CANCELLED', note, actor.id))) throw AppError.conflict('INVALID_STATUS', 'La reserva ya fue cerrada.');
    return toDTO(await load(reservationId), actor.id);
  },

  /** Solo finaliza sin pago si el plan no cobra comisión. */
  async complete(actor: { id: string; role: string }, reservationId: string, salePriceInput: string) {
    const r = await load(reservationId);
    if (r.sellerId !== actor.id && actor.role !== 'ADMIN' && actor.role !== 'ADMIN_ONE') throw AppError.forbidden('NOT_SELLER', 'Solo el vendedor puede marcar la venta como concretada.');
    if (r.status !== 'ACCEPTED') throw AppError.conflict('INVALID_STATUS', 'Solo se concretan ventas de reservas confirmadas.');

    const salePrice = new Prisma.Decimal(salePriceInput);
    const rate = r.commissionRate ?? (await getPlan(effectivePlan(await prisma.user.findUniqueOrThrow({ where: { id: r.sellerId } })).code)).commissionRate;
    const commission = percentOf(salePrice, rate);
    if (commission.gt(0)) throw AppError.conflict('COMMISSION_PAYMENT_REQUIRED', 'Paga la comisión y espera la aprobación de Binance antes de finalizar la venta.');
    const now = new Date();
    const notices: Array<PendingNotice | null> = [];
    await runInTransaction(async tx => {
      const { count } = await tx.cartReserve.updateMany({
        where: { id: r.id, status: 'ACCEPTED' },
        data: { status: 'COMPLETED', openKey: null, completedAt: now, expiresAt: null, salePrice, commissionRate: rate, commissionAmount: commission, commissionPaidAt: now },
      });
      if (count === 0) throw AppError.conflict('INVALID_STATUS', 'La reserva ya fue cerrada.');
      await tx.vehicle.update({ where: { id: r.vehicleId }, data: { status: 'SOLD', featuredUntil: null, negotiatingAt: null } });
      await clearWatchers(tx, r.vehicleId);
      await tx.carouselItem.deleteMany({ where: { vehicleId: r.vehicleId } });
      notices.push(await notify(tx, { userId: r.buyerId, type: 'RESERVATION_COMPLETED', title: 'Venta concretada', body: `El vendedor marcó como concretada la venta del ${title(r)}. ¡Disfrútalo!`, link: '/cuenta/reservas' }));
      await audit('RESERVATION_COMPLETED', r, actor.id, { salePrice: salePrice.toFixed(2), commission: commission.toFixed(2) }, tx);
    });
    deliver(notices);
    void dealChanged(r.vehicleId);
    realtime.statsChanged();
    return toDTO(await load(reservationId), actor.id);
  },

  /**
   * «En negociación»: con la reserva confirmada, el vendedor avisa que está cerrando la venta.
   * El público lo ve «En negociación»; si no se concreta, se cancela la reserva y el auto
   * vuelve a estar disponible (avisando a quienes pidieron «Avísame si vuelve»).
   */
  async negotiate(sellerId: string, reservationId: string) {
    const r = await load(reservationId);
    if (r.sellerId !== sellerId) throw AppError.forbidden('NOT_SELLER', 'Esta reserva no es de uno de tus vehículos.');
    if (r.status !== 'ACCEPTED') throw AppError.conflict('INVALID_STATUS', 'Solo puedes poner en negociación una reserva confirmada.');
    if (!r.negotiatingAt) {
      const notices: Array<PendingNotice | null> = [];
      const changed = await runInTransaction(async tx => {
        const now = new Date();
        const { count } = await tx.cartReserve.updateMany({ where: { id: r.id, status: 'ACCEPTED', negotiatingAt: null }, data: { negotiatingAt: now } });
        if (count === 0) return false;
        await tx.vehicle.updateMany({ where: { id: r.vehicleId, lockedReservationId: r.id }, data: { negotiatingAt: now } });
        notices.push(
          await notify(tx, {
            userId: r.buyerId,
            type: 'RESERVATION_NEGOTIATING',
            title: 'Auto en negociación',
            body: `${r.seller.name} puso el ${title(r)} en negociación: está cerrando la venta contigo.`,
            link: '/mensajes',
          }),
        );
        await audit('RESERVATION_NEGOTIATING', r, sellerId, {}, tx);
        return true;
      });
      if (changed) {
        deliver(notices);
        void dealChanged(r.vehicleId);
      }
    }
    return toDTO(await load(reservationId), sellerId);
  },

  /**
   * El vendedor paga la comisión post-venta con Binance. Solo hay un intento vivo: uno pendiente
   * se sustituye y uno en verificación bloquea otro nuevo.
   */
  async payCommission(sellerId: string, reservationId: string, input: SaleCommissionCheckoutInput): Promise<PaymentDTO> {
    const r = await load(reservationId);
    if (r.sellerId !== sellerId) throw AppError.forbidden('NOT_SELLER', 'Esta venta no es tuya.');
    if (!['ACCEPTED', 'COMPLETED'].includes(r.status)) throw AppError.conflict('NO_COMMISSION', 'Esta venta no tiene comisión pendiente.');
    const salePrice = r.status === 'COMPLETED' ? r.salePrice : new Prisma.Decimal(input.salePrice);
    const rate = r.commissionRate ?? (await getPlan(effectivePlan(await prisma.user.findUniqueOrThrow({ where: { id: r.sellerId } })).code)).commissionRate;
    const commission = r.status === 'COMPLETED' ? r.commissionAmount : percentOf(salePrice ?? 0, rate);
    if (!salePrice || !commission || commission.lte(0)) throw AppError.conflict('NO_COMMISSION', 'Esta venta no tiene comisión pendiente.');
    if (r.commissionPaidAt) throw AppError.conflict('COMMISSION_ALREADY_PAID', 'La comisión de esta venta ya está pagada.');
    if (r.payment?.status === 'SUBMITTED') throw AppError.conflict('PAYMENT_UNDER_REVIEW', 'Tu pago de esta comisión está en verificación. Te avisaremos en cuanto se confirme.');
    if (!input.method) throw AppError.badRequest('PAYMENT_METHOD_REQUIRED', 'Elige un método de pago Binance.');
    if (r.payment?.status === 'PENDING') {
      if (r.payment.mode === input.method && r.payment.amount.eq(commission) && (r.status === 'COMPLETED' || r.salePrice?.eq(salePrice))) {
        return toPaymentDTO(await prisma.payment.findUniqueOrThrow({ where: { id: r.payment.id }, include: paymentInclude }));
      }
      await closePendingPayment(r.payment, 'CANCELLED', 'Sustituido por otro método de pago.');
    }

    const payment = await prepareCheckout({
      userId: sellerId,
      purpose: 'COMMISSION',
      method: input.method,
      amount: commission,
      description: `AutoMarket · Comisión post-venta · ${title(r)}`,
      windowMinutes: env.MANUAL_PAYMENT_WINDOW_HOURS * 60,
    });
    await runInTransaction(async tx => {
      await tx.payment.create({ data: payment });
      await tx.cartReserve.update({
        where: { id: r.id },
        data: {
          paymentId: payment.id,
          ...(r.status === 'ACCEPTED' ? { salePrice, commissionRate: rate, commissionAmount: commission, commissionDueAt: null } : {}),
        },
      });
    });
    return toPaymentDTO(await prisma.payment.findUniqueOrThrow({ where: { id: payment.id! }, include: paymentInclude }));
  },

  /** Comisión confirmada: una reserva aceptada se finaliza solo tras aprobar el pago. */
  async onCommissionPaid(paymentId: string) {
    const notices: Array<PendingNotice | null> = [];
    let soldVehicleId = null as string | null;
    const outcome = await runInTransaction(async tx => {
      const r = await tx.cartReserve.findUnique({ where: { paymentId }, include: reservationInclude });
      if (!r) return 'orphan' as const;
      if (r.commissionPaidAt) return 'done' as const;
      if (r.status !== 'ACCEPTED' && r.status !== 'COMPLETED') return 'orphan' as const;
      soldVehicleId = r.vehicleId;
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      const paidAt = payment.paidAt ?? new Date();
      if (r.status === 'ACCEPTED') {
        const { count } = await tx.cartReserve.updateMany({
          where: { id: r.id, status: 'ACCEPTED' },
          data: { status: 'COMPLETED', openKey: null, completedAt: paidAt, expiresAt: null, commissionPaidAt: paidAt },
        });
        if (count === 0) return 'orphan' as const;
        const { count: vehicleCount } = await tx.vehicle.updateMany({
          where: { id: r.vehicleId, status: 'RESERVED', lockedReservationId: r.id },
          data: { status: 'SOLD', featuredUntil: null, negotiatingAt: null },
        });
        await clearWatchers(tx, r.vehicleId);
        if (vehicleCount !== 1) throw AppError.conflict('VEHICLE_STATE_CHANGED', 'El vehículo cambió de estado antes de aprobar la comisión.');
        await tx.carouselItem.deleteMany({ where: { vehicleId: r.vehicleId } });
        notices.push(await notify(tx, { userId: r.buyerId, type: 'RESERVATION_COMPLETED', title: 'Venta concretada', body: `La comisión fue aprobada y la venta del ${title(r)} quedó finalizada.`, link: '/cuenta/reservas' }));
        await audit('RESERVATION_COMPLETED', r, null, { salePrice: money(r.salePrice), commission: money(r.commissionAmount) }, tx);
      } else {
        await tx.cartReserve.update({ where: { id: r.id }, data: { commissionPaidAt: paidAt } });
      }
      try {
        await tx.ledgerEntry.create({
          data: { type: 'SALE_COMMISSION', amount: payment.amount, currency: 'USD', userId: r.sellerId, reservationId: r.id, paymentId, description: `Comisión post-venta · ${title(r)} · ${payment.reference}` },
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err; // ya contabilizada
      }
      notices.push(await notify(tx, { userId: r.sellerId, type: 'COMMISSION_PAID', title: 'Comisión pagada', body: `Recibimos la comisión de la venta del ${title(r)}. ¡Gracias!`, link: '/cuenta/reservas?tab=ventas' }));
      await audit('COMMISSION_PAID', r, null, { paymentId, amount: payment.amount.toFixed(2) }, tx);
      return 'paid' as const;
    });
    deliver(notices);
    if (outcome === 'orphan') {
      // Un intento sustituido que el usuario pagó igualmente: no hay deuda que saldar, se devuelve.
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      await refundPayment(paymentId, payment.amount, 'Pago de comisión duplicado o sustituido por otro intento.');
    }
    if (outcome === 'paid') {
      if (soldVehicleId) void dealChanged(soldVehicleId);
      realtime.statsChanged();
    }
  },
};
