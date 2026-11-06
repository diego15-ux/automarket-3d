import { prisma } from '../../shared/infra/prisma.js';
import { vehicleSalesService } from '../vehicles/vehicle-sales.service.js';
import { closePendingPayment, retryMerchantRefund } from './payment-gateway.js';
import { paymentsService } from './payments.service.js';

const GRACE_MS = 2 * 60_000;

/**
 * Tareas periódicas de pagos (bajo el bloqueo global de jobs):
 *   1. Cobros vencidos → EXPIRED; ventas sin pago quedan abiertas para volver a intentar.
 *   2. Órdenes de Binance Pay pendientes: se consulta su estado por si el webhook no llegó.
 *   3. Reembolsos automáticos de Binance Pay pendientes → se reintentan.
 */
export async function runPaymentJobs(now = new Date()): Promise<void> {
  const stale = await prisma.payment.findMany({ where: { status: 'PENDING', expiresAt: { lte: now } }, take: 200 });
  for (const payment of stale) {
    const closed = await closePendingPayment(payment, 'EXPIRED', 'No se completó el pago a tiempo.');
    if (closed && payment.purpose === 'COMMISSION') await vehicleSalesService.onCommissionPaymentClosed(payment.id);
  }

  const before = new Date(now.getTime() - GRACE_MS);
  const pending = await prisma.payment.findMany({ where: { mode: 'MERCHANT', status: 'PENDING', updatedAt: { lte: before } }, take: 50 });
  for (const payment of pending) {
    await paymentsService.syncMerchant(payment).catch(err => console.warn('[jobs] consulta a Binance Pay', payment.reference, err instanceof Error ? err.message : err));
  }

  const refunds = await prisma.payment.findMany({ where: { mode: 'MERCHANT', status: 'REFUND_PENDING', updatedAt: { lte: before } }, select: { id: true }, take: 50 });
  for (const { id } of refunds) await retryMerchantRefund(id);
}
