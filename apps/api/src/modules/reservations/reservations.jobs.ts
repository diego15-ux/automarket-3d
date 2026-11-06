import { COMMISSION_LEGAL_WARNING } from '@automarket/contracts';
import { prisma } from '../../shared/infra/prisma.js';
import { emails } from '../../shared/mail/templates.js';
import { deliver, notify } from '../../shared/notifications.js';
import { reservationInclude, reservationsService } from './reservations.service.js';

const DAY = 86_400_000;

/**
 * Tareas periódicas de reservas (bajo el bloqueo global de jobs):
 *   1. Solicitudes sin respuesta del vendedor en plazo → EXPIRED.
 *   2. Reservas confirmadas sin venta al terminar el plazo → EXPIRED y el vehículo vuelve a estar disponible.
 *   3. Comisiones post-venta: recordatorio 2 días antes y aviso (con advertencia legal) al vencer.
 */
export async function runReservationJobs(now = new Date()): Promise<void> {
  const unanswered = await prisma.cartReserve.findMany({
    where: { type: 'RESERVATION', status: 'AWAITING_SELLER', expiresAt: { lte: now } },
    include: reservationInclude,
    take: 100,
  });
  for (const reservation of unanswered) await reservationsService.close(reservation, 'EXPIRED', 'El vendedor no respondió a tiempo.', null);

  const held = await prisma.cartReserve.findMany({
    where: { type: 'RESERVATION', status: 'ACCEPTED', expiresAt: { lte: now } },
    include: reservationInclude,
    take: 100,
  });
  for (const reservation of held) await reservationsService.release(reservation, 'EXPIRED', 'El plazo de la reserva terminó sin concretarse la venta.', null);

  const unpaid = await prisma.cartReserve.findMany({
    where: { status: 'COMPLETED', commissionAmount: { gt: 0 }, commissionPaidAt: null, commissionDueAt: { lte: new Date(now.getTime() + 2 * DAY) } },
    include: reservationInclude,
    take: 200,
  });
  for (const r of unpaid) {
    if (!r.commissionDueAt || !r.commissionAmount) continue;
    const overdue = r.commissionDueAt <= now;
    const vehicle = `${r.vehicle.make} ${r.vehicle.model} ${r.vehicle.year}`;
    const amount = r.commissionAmount.toFixed(2);
    // dedupeKey: cada aviso se envía una sola vez por venta.
    const notice = await notify(prisma, {
      userId: r.sellerId,
      type: overdue ? 'COMMISSION_OVERDUE' : 'COMMISSION_REMINDER',
      title: overdue ? 'Comisión vencida: cuenta bloqueada' : 'Tu comisión vence pronto',
      body: overdue
        ? `La comisión de ${amount} ${r.currency} por el ${vehicle} venció. No puedes publicar ni reservar hasta pagarla. ${COMMISSION_LEGAL_WARNING}`
        : `Paga la comisión de ${amount} ${r.currency} por el ${vehicle} antes del ${r.commissionDueAt.toISOString().slice(0, 10)}.`,
      link: '/cuenta/reservas?tab=ventas',
      dedupeKey: `commission-${overdue ? 'overdue' : 'reminder'}:${r.id}`,
      email: emails.commissionDue({ to: r.seller.email, name: r.seller.name, vehicle, amount, currency: r.currency, dueAt: r.commissionDueAt, overdue, legalWarning: COMMISSION_LEGAL_WARNING }),
    });
    deliver([notice]);
  }
}
