import { randomBytes } from 'node:crypto';
import type { PaymentDTO, PaymentMethod, PaymentMethodsDTO } from '@automarket/contracts';
import { env } from '../../config/env.js';
import { Prisma, type Payment } from '../../generated/prisma/client.js';
import type { BillingCycle, PaymentPurpose, PlanCode } from '../../generated/prisma/enums.js';
import { AppError } from '../../shared/errors/app-error.js';
import { recordAudit } from '../../shared/infra/audit.js';
import { BinancePayError, binanceMerchantConfigured, binancePay } from '../../shared/infra/binance-pay.js';
import { isUniqueViolation, prisma, type Db } from '../../shared/infra/prisma.js';
import { deliver, notify, type PendingNotice } from '../../shared/notifications.js';
import { money, toAmountString as toAmount, uuidv7 } from '../../shared/utils/money.js';
import { currentPayee, freshPayee } from '../../shared/platform-config.js';

/**
 * Operaciones de bajo nivel sobre pagos con Binance, compartidas por membresías y reservas
 * (sin depender de ellas): crear el cobro, devolver dinero y cerrar cobros caducados.
 */

const MERCHANT_MAX_WINDOW_MINUTES = 60; // las órdenes de Binance Pay caducan como mucho en 1 h

/** Referencia legible y sin caracteres ambiguos: AM + 8 (va en la nota del pago). */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newReference = () => `AM${[...randomBytes(8)].map(byte => ALPHABET[byte % ALPHABET.length]).join('')}`;

/**
 * Cuenta de cobro para el pago manual: la del panel (solo la cambia el administrador
 * principal) o, si nunca se configuró allí, la del .env. Nadie más puede indicar otra.
 */
export const manualInstructions = () => currentPayee();

/**
 * Instrucciones de un pago concreto: las de la cuenta con la que se creó (instantánea), así
 * un cambio posterior en el panel no altera lo que el usuario ya vio ni lo que se verifica.
 */
const instructionsOf = (p: Pick<Payment, 'payeePayId' | 'payeeName'>) => {
  const current = currentPayee();
  if (!p.payeePayId) return current;
  return { payId: p.payeePayId, payName: p.payeeName, qrImageUrl: current?.payId === p.payeePayId ? current.qrImageUrl : null };
};

export const paymentMethods = (): PaymentMethodsDTO => ({ currency: env.PAYMENT_CURRENCY, merchant: binanceMerchantConfigured(), manual: manualInstructions() });

export const paymentInclude = {
  reservation: { select: { id: true, status: true, vehicle: { select: { slug: true, make: true, model: true, year: true } } } },
  vehicleSale: { select: { id: true, status: true, vehicle: { select: { slug: true, make: true, model: true, year: true } } } },
  boost: { select: { id: true, kind: true, days: true, status: true, vehicle: { select: { slug: true, make: true, model: true, year: true } } } },
} satisfies Prisma.PaymentInclude;
export type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

export const toPaymentDTO = (p: PaymentRow): PaymentDTO => ({
  id: p.id,
  purpose: p.purpose,
  mode: p.mode,
  status: p.status,
  amount: p.amount.toFixed(2),
  currency: p.currency,
  reference: p.reference,
  expiresAt: p.expiresAt?.toISOString() ?? null,
  createdAt: p.createdAt.toISOString(),
  submittedAt: p.submittedAt?.toISOString() ?? null,
  paidAt: p.paidAt?.toISOString() ?? null,
  txId: p.txId,
  reviewNote: p.reviewNote,
  refundDue: p.refundDue?.toFixed(2) ?? null,
  refundedAmount: p.refundedAmount.toFixed(2),
  merchant: p.mode === 'MERCHANT' ? { checkoutUrl: p.checkoutUrl, qrcodeLink: p.qrcodeLink, qrContent: p.qrContent, deeplink: p.deeplink } : null,
  manual: p.mode === 'MANUAL' ? instructionsOf(p) : null,
  plan: p.planCode && p.cycle ? { code: p.planCode, cycle: p.cycle } : null,
  reservation: p.reservation
    ? { id: p.reservation.id, status: p.reservation.status, vehicleSlug: p.reservation.vehicle.slug, vehicleTitle: `${p.reservation.vehicle.make} ${p.reservation.vehicle.model} ${p.reservation.vehicle.year}` }
    : null,
  vehicleSale: p.vehicleSale
    ? { id: p.vehicleSale.id, status: p.vehicleSale.status, vehicleSlug: p.vehicleSale.vehicle.slug, vehicleTitle: `${p.vehicleSale.vehicle.make} ${p.vehicleSale.vehicle.model} ${p.vehicleSale.vehicle.year}` }
    : null,
  boost: p.boost
    ? { id: p.boost.id, kind: p.boost.kind, days: p.boost.days, status: p.boost.status, vehicleSlug: p.boost.vehicle.slug, vehicleTitle: `${p.boost.vehicle.make} ${p.boost.vehicle.model} ${p.boost.vehicle.year}` }
    : null,
});

export interface CheckoutInput {
  userId: string;
  purpose: PaymentPurpose;
  method: PaymentMethod;
  amount: Prisma.Decimal;
  description: string;
  windowMinutes: number;
  planCode?: PlanCode;
  cycle?: BillingCycle;
}

/**
 * Prepara un cobro. En modo comercio crea la orden en Binance Pay (QR + enlaces) ANTES de
 * guardar nada; el llamador inserta el pago en su propia transacción (junto a la reserva).
 */
export async function prepareCheckout(input: CheckoutInput): Promise<Prisma.PaymentUncheckedCreateInput> {
  if (input.method === 'MERCHANT' && !binanceMerchantConfigured()) {
    throw AppError.badRequest('METHOD_UNAVAILABLE', 'El pago automático con Binance Pay no está disponible. Usa el pago al Pay ID.');
  }
  const payee = input.method === 'MANUAL' ? await freshPayee() : null;
  if (input.method === 'MANUAL' && !payee) {
    throw AppError.badRequest('METHOD_UNAVAILABLE', 'El pago al Pay ID de Binance no está disponible.');
  }
  const id = uuidv7();
  const reference = newReference();
  const amount = money(input.amount);
  const minutes = input.method === 'MERCHANT' ? Math.min(input.windowMinutes, MERCHANT_MAX_WINDOW_MINUTES) : input.windowMinutes;
  const expiresAt = new Date(Date.now() + minutes * 60_000);
  const base = {
    id,
    userId: input.userId,
    purpose: input.purpose,
    mode: input.method,
    reference,
    amount,
    currency: env.PAYMENT_CURRENCY,
    planCode: input.planCode ?? null,
    cycle: input.cycle ?? null,
    expiresAt,
    payeePayId: payee?.payId ?? null,
    payeeName: payee?.payName ?? null,
  } satisfies Prisma.PaymentUncheckedCreateInput;

  if (input.method === 'MANUAL') return base;

  try {
    const order = await binancePay.createOrder({
      merchantTradeNo: reference,
      amount: toAmount(amount),
      currency: env.PAYMENT_CURRENCY,
      description: input.description,
      returnUrl: `${env.WEB_URL}/pagos/${id}`,
      cancelUrl: `${env.WEB_URL}/pagos/${id}?cancelado=1`,
      expiresAt,
      webhookUrl: env.API_PUBLIC_URL ? `${env.API_PUBLIC_URL}/api/payments/binance/webhook` : undefined,
    });
    return {
      ...base,
      prepayId: order.prepayId,
      checkoutUrl: order.checkoutUrl ?? order.universalUrl ?? null,
      qrcodeLink: order.qrcodeLink ?? null,
      qrContent: order.qrContent ?? null,
      deeplink: order.deeplink ?? null,
    };
  } catch (err) {
    if (err instanceof BinancePayError) throw new AppError(502, 'BINANCE_PAY_ERROR', `Binance Pay no pudo crear la orden (${err.code}). Inténtalo de nuevo o usa el pago al Pay ID.`);
    throw err;
  }
}

/** Crea el pago de una compra que no necesita otras filas (membresías). */
export async function createCheckout(input: CheckoutInput): Promise<PaymentDTO> {
  const data = await prepareCheckout(input);
  for (let attempt = 0; ; attempt++) {
    try {
      const payment = await prisma.payment.create({ data, include: paymentInclude });
      return toPaymentDTO(payment);
    } catch (err) {
      // Colisión de referencia (≈ 1 entre 10^12): solo es posible en modo manual (sin orden externa).
      if (attempt < 2 && data.mode === 'MANUAL' && isUniqueViolation(err, 'reference')) {
        data.reference = newReference();
        continue;
      }
      throw err;
    }
  }
}

/** Avisa a todos los administradores (p. ej. pago manual por verificar o reembolso por enviar). */
export async function notifyAdmins(db: Db, input: { type: string; title: string; body: string; link: string }): Promise<Array<PendingNotice | null>> {
  const admins = await db.user.findMany({ where: { role: { in: ['ADMIN', 'ADMIN_ONE'] }, status: 'ACTIVE', deletedAt: null }, select: { id: true } });
  const notices: Array<PendingNotice | null> = [];
  for (const admin of admins) notices.push(await notify(db, { userId: admin.id, ...input }));
  return notices;
}

/**
 * Devuelve dinero de un pago cobrado (total o parcial).
 *   · Comercio: reembolso por la API de Binance Pay; si falla queda REFUND_PENDING y el job reintenta.
 *   · Manual: queda REFUND_PENDING y un administrador envía la transferencia desde Binance.
 */
export async function refundPayment(paymentId: string, amount: Prisma.Decimal, reason: string): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) return;
  const refundable = money(payment.amount.minus(payment.refundedAmount));
  const due = Prisma.Decimal.min(money(amount), refundable);
  if (due.lte(0)) return;

  // Marca el reembolso como debido (condicional: dos llamadas simultáneas no duplican la devolución).
  const { count } = await prisma.payment.updateMany({
    where: { id: paymentId, status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } },
    data: { status: 'REFUND_PENDING', refundDue: due, failureReason: reason.slice(0, 500) },
  });
  if (count === 0) return;

  if (payment.mode === 'MANUAL') {
    const notices = await notifyAdmins(prisma, {
      type: 'REFUND_PENDING',
      title: 'Reembolso pendiente de enviar',
      body: `${due.toFixed(2)} ${payment.currency} al Pay ID ${payment.payerBinanceId ?? '(no indicado)'} · ref. ${payment.reference}.`,
      link: '/admin/pagos?tab=reembolsos',
    });
    deliver(notices);
    return;
  }
  await retryMerchantRefund(paymentId);
}

/** Ejecuta (o reintenta) un reembolso pendiente en Binance Pay. Idempotente por refundRequestId. */
export async function retryMerchantRefund(paymentId: string): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.mode !== 'MERCHANT' || payment.status !== 'REFUND_PENDING' || !payment.refundDue || !payment.prepayId) return;
  const refundRequestId = `${payment.reference}R${payment.refundedAmount.gt(0) ? '2' : '1'}`;
  try {
    await binancePay.refund({ refundRequestId, prepayId: payment.prepayId, amount: toAmount(payment.refundDue), reason: payment.failureReason ?? 'Reembolso AutoMarket' });
    await settleRefund(payment, refundRequestId);
  } catch (err) {
    const reason = err instanceof BinancePayError ? `${err.code}: ${err.message}` : 'error de red';
    console.error('[pagos] reembolso pendiente', payment.id, reason);
    await recordAudit({ action: 'PAYMENT_REQUIRES_ATTENTION', entityType: 'Payment', entityId: payment.id, metadata: { reason: `Reembolso no completado (${reason})` } });
  }
}

/** Registra un reembolso completado (API, webhook o administrador). */
export async function settleRefund(payment: Payment, refundTxId: string) {
  if (!payment.refundDue) return;
  const refunded = money(payment.refundedAmount.plus(payment.refundDue));
  await prisma.payment.updateMany({
    where: { id: payment.id, status: 'REFUND_PENDING' },
    data: { status: refunded.gte(payment.amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED', refundedAmount: refunded, refundDue: null, refundTxId: refundTxId.slice(0, 100), refundedAt: new Date() },
  });
}

/** Cierra un cobro que nadie pagó (caducado o cancelado). En comercio también cierra la orden en Binance. */
export async function closePendingPayment(payment: Payment, status: 'EXPIRED' | 'CANCELLED', reason: string): Promise<boolean> {
  const { count } = await prisma.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status, failureReason: reason.slice(0, 500) } });
  if (count === 1 && payment.mode === 'MERCHANT') {
    await binancePay.closeOrder(payment.reference).catch(err => console.warn('[pagos] no se pudo cerrar la orden', payment.reference, err instanceof Error ? err.message : err));
  }
  return count === 1;
}

/** Consulta en Binance Pay el estado real de una orden pendiente (vuelta del usuario o webhook perdido). */
export async function queryMerchantStatus(payment: Payment): Promise<{ paid: boolean; closed: boolean; transactionId: string | null; payerId: string | null }> {
  const order = await binancePay.queryOrder(payment.reference);
  return {
    paid: order.status === 'PAID',
    closed: ['CANCELED', 'EXPIRED', 'ERROR'].includes(order.status),
    transactionId: order.transactionId ?? null,
    payerId: order.openUserId ?? null,
  };
}
