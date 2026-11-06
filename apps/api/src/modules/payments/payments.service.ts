import type { PaymentDTO, PaymentSubmitInput } from '@automarket/contracts';
import { z } from 'zod';
import type { Payment, Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../shared/errors/app-error.js';
import { recordAudit } from '../../shared/infra/audit.js';
import { binancePay } from '../../shared/infra/binance-pay.js';
import { isUniqueViolation, prisma } from '../../shared/infra/prisma.js';
import { deliver, notify } from '../../shared/notifications.js';
import { membershipsService } from '../memberships/memberships.service.js';
import { boostsService } from '../boosts/boosts.service.js';
import { reservationsService } from '../reservations/reservations.service.js';
import { vehicleSalesService } from '../vehicles/vehicle-sales.service.js';
import { closePendingPayment, notifyAdmins, paymentInclude, paymentMethods, queryMerchantStatus, refundPayment, settleRefund, toPaymentDTO } from './payment-gateway.js';

const load = (id: string) => prisma.payment.findUnique({ where: { id }, include: paymentInclude });

/** Estados desde los que un pago puede confirmarse (un pago de Binance Pay puede llegar justo tras caducar). */
const CONFIRMABLE = ['PENDING', 'SUBMITTED', 'EXPIRED', 'CANCELLED'] as const;

// Notificación de Binance Pay: `data` es JSON dentro de un string; bizId puede superar 2^53 (se usa bizIdStr).
const WebhookEnvelope = z.object({
  bizType: z.string(),
  bizId: z.union([z.string(), z.number()]).optional(),
  bizIdStr: z.string().optional(),
  bizStatus: z.string(),
  data: z.string(),
});
const WebhookData = z.object({
  merchantTradeNo: z.string(),
  transactionId: z.string().nullish(),
  refundRequestId: z.string().nullish(),
});

/** Efectos de un pago confirmado según su propósito. Idempotentes: se pueden repetir sin duplicar. */
async function applyPaid(payment: Payment) {
  switch (payment.purpose) {
    case 'MEMBERSHIP':
      await membershipsService.activateFromPayment(payment.id);
      break;
    case 'COMMISSION':
      if (!(await vehicleSalesService.onCommissionPaid(payment.id))) await reservationsService.onCommissionPaid(payment.id);
      break;
    case 'BOOST':
      await boostsService.activateFromPayment(payment.id);
      break;
    case 'RESERVATION':
      // Depósito del modelo anterior pagado tarde: las reservas ya no se cobran por la plataforma.
      await refundPayment(payment.id, payment.amount, 'Las reservas se pagan directamente al vendedor: devolvemos este depósito.');
      break;
  }
}

/** Un cobro que caducó sin pagarse (la deuda de una comisión sigue pendiente: se podrá pagar de nuevo). */
async function expireUnpaid(payment: Payment, reason: string) {
  await closePendingPayment(payment, 'EXPIRED', reason);
  if (payment.purpose === 'COMMISSION') await vehicleSalesService.onCommissionPaymentClosed(payment.id);
  if (payment.purpose === 'BOOST') await boostsService.onPaymentClosed(payment.id);
}

export const paymentsService = {
  methods: paymentMethods,

  /** Estado de un pago (página /pagos/:id). Si es de Binance Pay y sigue pendiente, se consulta a Binance. */
  async get(user: { id: string; role: string }, paymentId: string): Promise<PaymentDTO> {
    let payment = await load(paymentId);
    if (!payment || (payment.userId !== user.id && !['ADMIN', 'ADMIN_ONE'].includes(user.role))) throw AppError.notFound('PAYMENT_NOT_FOUND', 'Pago no encontrado.');
    if (payment.mode === 'MERCHANT' && payment.status === 'PENDING' && Date.now() - payment.updatedAt.getTime() > 10_000) {
      await paymentsService.syncMerchant(payment).catch(err => console.warn('[pagos] consulta a Binance Pay', payment?.reference, err instanceof Error ? err.message : err));
      payment = (await load(paymentId))!;
    }
    return toPaymentDTO(payment);
  },

  /** Consulta la orden en Binance Pay (webhook perdido o usuario que vuelve antes que el webhook). */
  async syncMerchant(payment: Payment) {
    await prisma.payment.update({ where: { id: payment.id }, data: { updatedAt: new Date() } }); // limita la frecuencia de consulta
    const status = await queryMerchantStatus(payment);
    if (status.paid) await paymentsService.markPaid(payment.id, { txId: status.transactionId });
    else if (status.closed) await expireUnpaid(payment, 'La orden de Binance Pay caducó sin pagarse.');
  },

  /**
   * Pago confirmado (webhook, consulta o aprobación del equipo): PENDING/SUBMITTED → PAID y
   * activación de la membresía o avance de la reserva. Idempotente.
   */
  async markPaid(paymentId: string, info: { txId?: string | null; reviewerId?: string; note?: string }) {
    const now = new Date();
    try {
      await prisma.payment.updateMany({
        where: { id: paymentId, status: { in: [...CONFIRMABLE] } },
        data: {
          status: 'PAID',
          paidAt: now,
          ...(info.txId && { txId: info.txId.slice(0, 100) }),
          ...(info.reviewerId && { reviewedById: info.reviewerId, reviewedAt: now, reviewNote: info.note ?? null }),
        },
      });
    } catch (err) {
      if (isUniqueViolation(err, 'txId')) throw AppError.conflict('TX_ALREADY_USED', 'Esa transacción de Binance ya se usó en otro pago.');
      throw err;
    }
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (payment.status === 'PAID') await applyPaid(payment);
  },

  /** Modo manual: el usuario ya pagó a nuestro Pay ID y envía el id de la transacción para verificarla. */
  async submitManual(userId: string, paymentId: string, input: PaymentSubmitInput): Promise<PaymentDTO> {
    const payment = await load(paymentId);
    if (!payment || payment.userId !== userId) throw AppError.notFound('PAYMENT_NOT_FOUND', 'Pago no encontrado.');
    if (payment.mode !== 'MANUAL') throw AppError.badRequest('NOT_MANUAL', 'Este pago se confirma automáticamente con Binance Pay.');
    if (payment.status !== 'PENDING') throw AppError.conflict('INVALID_STATUS', 'Este pago ya no admite comprobantes.');
    if (payment.expiresAt && payment.expiresAt <= new Date()) throw AppError.conflict('PAYMENT_EXPIRED', 'El plazo para pagar venció. Inicia un pago nuevo.');

    try {
      const { count } = await prisma.payment.updateMany({
        where: { id: paymentId, status: 'PENDING' },
        data: { status: 'SUBMITTED', submittedAt: new Date(), txId: input.txId, payerBinanceId: input.payerBinanceId ?? null },
      });
      if (count === 0) throw AppError.conflict('INVALID_STATUS', 'Este pago ya no admite comprobantes.');
    } catch (err) {
      if (isUniqueViolation(err, 'txId')) throw AppError.conflict('TX_ALREADY_USED', 'Esa transacción de Binance ya se usó en otro pago.');
      throw err;
    }
    deliver(
      await notifyAdmins(prisma, {
        type: 'PAYMENT_SUBMITTED',
        title: 'Pago con Binance por verificar',
        body: `${payment.amount.toFixed(2)} ${payment.currency} · ref. ${payment.reference} · transacción ${input.txId}.`,
        link: '/admin/pagos',
      }),
    );
    return toPaymentDTO((await load(paymentId))!);
  },

  /** El usuario abandona un pago pendiente (o pulsa «Cancelar» en Binance Pay). */
  async cancel(userId: string, paymentId: string): Promise<PaymentDTO> {
    const payment = await load(paymentId);
    if (!payment || payment.userId !== userId) throw AppError.notFound('PAYMENT_NOT_FOUND', 'Pago no encontrado.');
    if (payment.status === 'PENDING') {
      await closePendingPayment(payment, 'CANCELLED', 'Pago cancelado por el usuario.');
      if (payment.purpose === 'COMMISSION') await vehicleSalesService.onCommissionPaymentClosed(payment.id);
      if (payment.purpose === 'BOOST') await boostsService.onPaymentClosed(payment.id);
    }
    return toPaymentDTO((await load(paymentId))!);
  },

  /** Verificación de un pago manual por el equipo: aprobar (confirma y aplica) o rechazar. */
  async review(adminId: string, paymentId: string, decision: 'APPROVE' | 'REJECT', note?: string) {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw AppError.notFound('PAYMENT_NOT_FOUND', 'Pago no encontrado.');
    if (payment.mode !== 'MANUAL' || payment.status !== 'SUBMITTED') throw AppError.conflict('INVALID_STATUS', 'Este pago no está pendiente de verificación.');

    if (decision === 'APPROVE') {
      await paymentsService.markPaid(paymentId, { reviewerId: adminId, note });
    } else {
      const reason = note?.trim() || 'No encontramos la transacción en Binance o el importe no coincide.';
      const { count } = await prisma.payment.updateMany({
        where: { id: paymentId, status: 'SUBMITTED' },
        data: { status: 'REJECTED', reviewedById: adminId, reviewedAt: new Date(), reviewNote: reason.slice(0, 500) },
      });
      if (count === 1) {
        if (payment.purpose === 'COMMISSION') await vehicleSalesService.onCommissionPaymentClosed(paymentId);
        if (payment.purpose === 'BOOST') await boostsService.onPaymentClosed(paymentId);
        deliver([
          await notify(prisma, {
            userId: payment.userId,
            type: 'PAYMENT_REJECTED',
            title: 'No pudimos verificar tu pago',
            body: `${reason} Referencia ${payment.reference}. Si crees que es un error, escríbenos.`,
            link: `/pagos/${payment.id}`,
          }),
        ]);
      }
    }
    await recordAudit({ action: 'PAYMENT_REVIEWED', entityType: 'Payment', entityId: paymentId, actorId: adminId, metadata: { decision, note: note ?? null } });
  },

  /** Reembolso manual enviado desde Binance: se registra el id de esa transferencia. */
  async completeManualRefund(adminId: string, paymentId: string, refundTxId: string) {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw AppError.notFound('PAYMENT_NOT_FOUND', 'Pago no encontrado.');
    if (payment.mode !== 'MANUAL' || payment.status !== 'REFUND_PENDING' || !payment.refundDue) {
      throw AppError.conflict('INVALID_STATUS', 'Este pago no tiene un reembolso manual pendiente.');
    }
    await settleRefund(payment, refundTxId);
    await recordAudit({ action: 'REFUND_SENT', entityType: 'Payment', entityId: paymentId, actorId: adminId, metadata: { amount: payment.refundDue.toFixed(2), refundTxId } });
    deliver([
      await notify(prisma, {
        userId: payment.userId,
        type: 'REFUND_SENT',
        title: 'Reembolso enviado',
        body: `Te devolvimos ${payment.refundDue.toFixed(2)} ${payment.currency} por Binance (transacción ${refundTxId}).`,
        link: `/pagos/${payment.id}`,
      }),
    ]);
  },

  /** Cola del panel: pagos por verificar, reembolsos por enviar o todos los recientes. */
  async listForAdmin(view: 'review' | 'refunds' | 'all') {
    const where: Prisma.PaymentWhereInput =
      view === 'review' ? { status: 'SUBMITTED' } : view === 'refunds' ? { status: 'REFUND_PENDING' } : {};
    const rows = await prisma.payment.findMany({
      where,
      orderBy: view === 'all' ? { createdAt: 'desc' } : { updatedAt: 'asc' },
      take: 100,
      include: { ...paymentInclude, user: { select: { name: true, email: true, accountType: true, businessName: true, isVerified: true } } },
    });
    return rows.map(row => ({ ...toPaymentDTO(row), user: row.user, payerBinanceId: row.payerBinanceId, failureReason: row.failureReason }));
  },

  /** Contadores de la bandeja: pagos manuales por verificar y reembolsos por enviar. */
  async adminCounts() {
    const [review, refunds] = await Promise.all([prisma.payment.count({ where: { status: 'SUBMITTED' } }), prisma.payment.count({ where: { status: 'REFUND_PENDING' } })]);
    return { review, refunds };
  },

  /**
   * Notificación de Binance Pay. Firma verificada con su certificado (RSA-SHA256) y registro
   * por evento en payment_webhook_events: cada notificación se aplica exactamente una vez.
   */
  async handleWebhook(headers: Record<string, string | undefined>, rawBody: string) {
    if (!(await binancePay.verifyWebhook(headers, rawBody))) throw AppError.unauthorized('INVALID_SIGNATURE', 'Firma de Binance Pay inválida.');
    const event = WebhookEnvelope.parse(JSON.parse(rawBody));
    const bizId = event.bizIdStr ?? String(event.bizId ?? '');
    const eventId = `${event.bizType}:${bizId}:${event.bizStatus}`.slice(0, 64);
    const seen = await prisma.paymentWebhookEvent.findUnique({ where: { id: eventId }, select: { status: true } });
    if (seen && seen.status !== 'FAILED') return { duplicate: true };

    const record = (status: 'PROCESSED' | 'IGNORED' | 'FAILED', error: string | null = null) =>
      prisma.paymentWebhookEvent.upsert({
        where: { id: eventId },
        create: { id: eventId, eventType: `${event.bizType}:${event.bizStatus}`.slice(0, 80), resourceId: bizId.slice(0, 64) || null, status, payload: JSON.parse(rawBody), error },
        update: { status, error },
      });

    try {
      const data = WebhookData.parse(JSON.parse(event.data));
      const payment = await prisma.payment.findUnique({ where: { reference: data.merchantTradeNo } });
      let changed = false;
      if (payment && event.bizType === 'PAY' && event.bizStatus === 'PAY_SUCCESS') {
        await paymentsService.markPaid(payment.id, { txId: data.transactionId ?? null });
        changed = true;
      } else if (payment && event.bizType === 'PAY' && event.bizStatus === 'PAY_CLOSED' && payment.status === 'PENDING') {
        await expireUnpaid(payment, 'Binance Pay cerró la orden sin pago.');
        changed = true;
      } else if (payment && event.bizType.includes('REFUND') && event.bizStatus === 'REFUND_SUCCESS' && payment.status === 'REFUND_PENDING') {
        await settleRefund(payment, data.refundRequestId ?? `${payment.reference}R`);
        changed = true;
      }
      await record(changed ? 'PROCESSED' : 'IGNORED');
      return { duplicate: false, processed: changed };
    } catch (err) {
      await record('FAILED', (err instanceof Error ? err.message : String(err)).slice(0, 500));
      throw err;
    }
  },
};
