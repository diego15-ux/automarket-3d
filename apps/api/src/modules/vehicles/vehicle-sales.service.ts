import { randomUUID } from 'node:crypto';
import { type PaymentDTO, type SaleCommissionCheckoutInput, type VehicleSaleCheckoutDTO } from '@automarket/contracts';
import { env } from '../../config/env.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../shared/errors/app-error.js';
import { recordAudit } from '../../shared/infra/audit.js';
import { isUniqueViolation, prisma, runInTransaction } from '../../shared/infra/prisma.js';
import { deliver, notify, type PendingNotice } from '../../shared/notifications.js';
import { effectivePlan } from '../../shared/membership.js';
import { realtime } from '../../shared/realtime.js';
import { percentOf } from '../../shared/utils/money.js';
import { getPlan } from '../memberships/plans.js';
import { closePendingPayment, paymentInclude, prepareCheckout, refundPayment, toPaymentDTO } from '../payments/payment-gateway.js';

const TITLE = (vehicle: { make: string; model: string; year: number }) => `${vehicle.make} ${vehicle.model} ${vehicle.year}`;
const AVAILABLE_STATUSES = ['PUBLISHED', 'PAUSED', 'EXPIRED'] as const;
const lockVehicle = (tx: Prisma.TransactionClient, vehicleId: string) => tx.$queryRaw`SELECT id FROM vehicles WHERE id = ${vehicleId} FOR UPDATE`;

async function loadPayment(paymentId: string): Promise<PaymentDTO> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: paymentInclude });
  if (!payment) throw AppError.notFound('PAYMENT_NOT_FOUND', 'Pago no encontrado.');
  return toPaymentDTO(payment);
}

export const vehicleSalesService = {
  /** Cobra primero comisión Binance; aprobación automática o administrativa finaliza el anuncio. */
  async checkout(vehicleId: string, sellerId: string, input: SaleCommissionCheckoutInput): Promise<VehicleSaleCheckoutDTO> {
    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle || vehicle.deletedAt) throw AppError.notFound('VEHICLE_NOT_FOUND', 'Anuncio no encontrado.');
    if (vehicle.sellerId !== sellerId) throw AppError.forbidden('NOT_OWNER', 'Este anuncio no es tuyo.');
    if (!(AVAILABLE_STATUSES as readonly string[]).includes(vehicle.status)) {
      throw AppError.conflict('INVALID_STATUS', 'Solo puedes registrar la venta de anuncios publicados, pausados o vencidos sin reserva activa.');
    }

    const seller = await prisma.user.findUniqueOrThrow({ where: { id: sellerId } });
    const plan = await getPlan(effectivePlan(seller).code);
    const salePrice = new Prisma.Decimal(input.salePrice);
    const commission = percentOf(salePrice, plan.commissionRate);
    const rate = plan.commissionRate;
    if (commission.gt(0) && !input.method) throw AppError.badRequest('PAYMENT_METHOD_REQUIRED', 'Elige un método de pago Binance.');

    const checkout = commission.gt(0)
      ? await prepareCheckout({
          userId: sellerId,
          purpose: 'COMMISSION',
          method: input.method!,
          amount: commission,
          description: `AutoMarket · Comisión por venta · ${TITLE(vehicle)}`,
          windowMinutes: env.MANUAL_PAYMENT_WINDOW_HOURS * 60,
        })
      : null;

    const saleId = randomUUID();
    const now = new Date();
    let paymentId: string | null = null;
    const notices: Array<PendingNotice | null> = [];
    await runInTransaction(async tx => {
      await lockVehicle(tx, vehicleId);
      const current = await tx.vehicle.findUnique({ where: { id: vehicleId } });
      if (!current || current.deletedAt || current.sellerId !== sellerId) throw AppError.notFound('VEHICLE_NOT_FOUND', 'Anuncio no encontrado.');
      if (!(AVAILABLE_STATUSES as readonly string[]).includes(current.status)) {
        throw AppError.conflict('INVALID_STATUS', 'El anuncio ya no está disponible para registrar esta venta.');
      }
      if (await tx.cartReserve.count({ where: { vehicleId, type: 'RESERVATION', openKey: { not: null } } })) {
        throw AppError.conflict('VEHICLE_HAS_OPEN_RESERVATIONS', 'Resuelve las reservas abiertas antes de registrar una venta externa.');
      }
      if (await tx.vehicleSale.count({ where: { vehicleId, status: 'PENDING_PAYMENT' } })) {
        throw AppError.conflict('SALE_PAYMENT_PENDING', 'Ya existe una comisión pendiente para este anuncio.');
      }

      if (checkout) {
        const payment = await tx.payment.create({ data: checkout });
        paymentId = payment.id;
      }
      await tx.vehicleSale.create({
        data: {
          id: saleId,
          sellerId,
          vehicleId,
          paymentId,
          status: checkout ? 'PENDING_PAYMENT' : 'COMPLETED',
          previousStatus: current.status,
          salePrice,
          commissionRate: rate,
          commissionAmount: commission,
          currency: current.currency,
          completedAt: checkout ? null : now,
        },
      });
      await tx.vehicle.update({ where: { id: vehicleId }, data: { status: checkout ? 'PENDING_SALE' : 'SOLD', featuredUntil: null } });
      await tx.carouselItem.deleteMany({ where: { vehicleId } });
      await recordAudit({
        action: checkout ? 'VEHICLE_SALE_CHECKOUT' : 'VEHICLE_SALE_COMPLETED',
        entityType: 'Vehicle',
        entityId: vehicleId,
        actorId: sellerId,
        metadata: { saleId, salePrice: salePrice.toFixed(2), commission: commission.toFixed(2) },
      }, tx);
      if (!checkout) {
        notices.push(await notify(tx, {
          userId: sellerId,
          type: 'VEHICLE_SALE_COMPLETED',
          title: 'Venta registrada',
          body: `${TITLE(current)} quedó finalizado. No se generó comisión para tu plan.`,
          link: '/cuenta/anuncios',
        }));
      }
    });
    deliver(notices);

    if (paymentId) {
      const payment = await loadPayment(paymentId);
      return { saleId, salePrice: salePrice.toFixed(2), commissionRate: rate.toNumber(), commissionAmount: commission.toFixed(2), payment };
    }
    realtime.statsChanged();
    return { saleId, salePrice: salePrice.toFixed(2), commissionRate: rate.toNumber(), commissionAmount: commission.toFixed(2), payment: null };
  },

  /** Un pago aprobado completa venta e inventario en una sola transacción. */
  async onCommissionPaid(paymentId: string): Promise<boolean> {
    const initial = await prisma.vehicleSale.findUnique({ where: { paymentId }, include: { vehicle: true } });
    if (!initial) return false;
    if (initial.status !== 'PENDING_PAYMENT') {
      if (initial.status === 'CANCELLED') {
        const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
        await refundPayment(paymentId, payment.amount, 'Pago recibido después de cancelar la venta.');
      }
      return true;
    }

    const notices: Array<PendingNotice | null> = [];
    const outcome = await runInTransaction(async tx => {
      await lockVehicle(tx, initial.vehicleId);
      const sale = await tx.vehicleSale.findUnique({ where: { id: initial.id }, include: { vehicle: true } });
      if (!sale || sale.status === 'CANCELLED') return 'closed' as const;
      if (sale.status === 'COMPLETED') return 'done' as const;
      if (sale.vehicle.status !== 'PENDING_SALE') throw AppError.conflict('SALE_STATE_CHANGED', 'El estado del anuncio cambió antes de confirmar la comisión.');

      const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      const completedAt = payment.paidAt ?? new Date();
      await tx.vehicleSale.update({ where: { id: sale.id }, data: { status: 'COMPLETED', completedAt } });
      await tx.vehicle.update({ where: { id: sale.vehicleId }, data: { status: 'SOLD', featuredUntil: null } });
      try {
        await tx.ledgerEntry.create({
          data: {
            type: 'SALE_COMMISSION',
            amount: payment.amount,
            currency: 'USD',
            userId: sale.sellerId,
            vehicleSaleId: sale.id,
            paymentId,
            description: `Comisión por venta · ${TITLE(sale.vehicle)} · ${payment.reference}`,
          },
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
      notices.push(await notify(tx, {
        userId: sale.sellerId,
        type: 'COMMISSION_PAID',
        title: 'Comisión aprobada y venta finalizada',
        body: `Recibimos ${payment.amount.toFixed(2)} ${payment.currency}. ${TITLE(sale.vehicle)} ya figura como vendido.`,
        link: '/cuenta/anuncios',
      }));
      await recordAudit({
        action: 'VEHICLE_SALE_COMPLETED',
        entityType: 'Vehicle',
        entityId: sale.vehicleId,
        actorId: null,
        metadata: { saleId: sale.id, paymentId, reference: payment.reference },
      }, tx);
      return 'completed' as const;
    });
    if (outcome === 'closed') {
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      await refundPayment(paymentId, payment.amount, 'Pago recibido después de cerrar la venta.');
      return true;
    }
    if (outcome === 'done') return true;
    deliver(notices);
    realtime.statsChanged();
    return true;
  },

  /** Libera anuncio al cancelar, vencer o rechazar comprobante; no crea una deuda ni sanción. */
  async onCommissionPaymentClosed(paymentId: string): Promise<void> {
    const sale = await prisma.vehicleSale.findUnique({ where: { paymentId } });
    if (!sale || sale.status !== 'PENDING_PAYMENT') return;

    const released = await runInTransaction(async tx => {
      await lockVehicle(tx, sale.vehicleId);
      const { count } = await tx.vehicleSale.updateMany({
        where: { id: sale.id, status: 'PENDING_PAYMENT' },
        data: { status: 'CANCELLED' },
      });
      if (count === 0) return false;
      await tx.vehicle.updateMany({
        where: { id: sale.vehicleId, status: 'PENDING_SALE' },
        data: { status: sale.previousStatus },
      });
      return true;
    });
    if (released) realtime.statsChanged();
  },
};
