import type { ManualMembershipInput, MembershipCheckoutInput, MembershipStatusDTO, PaymentDTO } from '@automarket/contracts';
import { env } from '../../config/env.js';
import type { Payment, User } from '../../generated/prisma/client.js';
import type { BillingCycle, MembershipSource, PlanCode } from '../../generated/prisma/enums.js';
import { AppError } from '../../shared/errors/app-error.js';
import { recordAudit } from '../../shared/infra/audit.js';
import { isUniqueViolation, prisma, runInTransaction, type Db } from '../../shared/infra/prisma.js';
import { emails } from '../../shared/mail/templates.js';
import { EXPIRY_WARNING_DAYS, effectivePlan, periodEnd } from '../../shared/membership.js';
import { deliver, notify, type PendingNotice } from '../../shared/notifications.js';
import { realtime } from '../../shared/realtime.js';
import { createCheckout } from '../payments/payment-gateway.js';
import { getPlan, toPlanDTO } from './plans.js';

const lockUser = (tx: Db, userId: string) => tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;

interface GrantInput {
  userId: string;
  planCode: Exclude<PlanCode, 'FREE'>;
  cycle: BillingCycle;
  periods: number;
  source: MembershipSource;
  payment?: Payment;
  grantedById?: string;
  note?: string;
}

/**
 * Alta o renovación de un periodo (pago con Binance o alta manual). Renovar el MISMO plan antes de
 * vencer acumula el tiempo; cambiar de plan empieza ahora (sin prorrateo).
 */
async function grantPeriod(tx: Db, input: GrantInput): Promise<{ user: User; expiresAt: Date; notice: PendingNotice | null }> {
  await lockUser(tx, input.userId);
  const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId } });
  const plan = await getPlan(input.planCode, tx);
  const now = new Date();
  const current = effectivePlan(user, now);
  const start = current.code === input.planCode && user.planExpiresAt && user.planExpiresAt > now ? user.planExpiresAt : now;
  const expiresAt = periodEnd(start, input.cycle, input.periods);

  await tx.membershipPeriod.create({
    data: {
      userId: user.id,
      planCode: input.planCode,
      cycle: input.cycle,
      source: input.source,
      startsAt: start,
      endsAt: expiresAt,
      amount: input.payment?.amount ?? null,
      currency: plan.currency, // el libro y el histórico van en USD (1 USDT = 1 USD)
      paymentId: input.payment?.id ?? null,
      grantedById: input.grantedById ?? null,
      note: input.note ?? null,
    },
  });
  const updated = await tx.user.update({ where: { id: user.id }, data: { planCode: input.planCode, planCycle: input.cycle, planExpiresAt: expiresAt } });
  // La prioridad en búsquedas acompaña al plan en todos sus anuncios.
  await tx.vehicle.updateMany({ where: { sellerId: user.id }, data: { searchBoost: plan.searchBoost } });

  const notice = await notify(tx, {
    userId: user.id,
    type: 'MEMBERSHIP_ACTIVATED',
    title: `Plan ${plan.name} activo`,
    body: `Tu membresía es válida hasta el ${expiresAt.toISOString().slice(0, 10)}.`,
    link: '/cuenta/plan',
    email: emails.membershipActivated({ to: user.email, name: user.name, planName: plan.name, expiresAt }),
  });
  return { user: updated, expiresAt, notice };
}

/**
 * Baja a FREE (vencimiento o decisión del administrador): sin prioridad ni destacados y
 * solo la publicación activa más reciente sigue visible; el resto pasa a PAUSED.
 */
export async function downgradeToFree(tx: Db, userId: string, source: MembershipSource, grantedById?: string, note?: string) {
  await lockUser(tx, userId);
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  const free = await getPlan('FREE', tx);
  const now = new Date();

  await tx.user.update({ where: { id: userId }, data: { planCode: 'FREE', planCycle: null, planExpiresAt: null } });
  await tx.membershipPeriod.create({ data: { userId, planCode: 'FREE', source, startsAt: now, grantedById: grantedById ?? null, note: note ?? null } });
  await tx.vehicle.updateMany({ where: { sellerId: userId }, data: { searchBoost: free.searchBoost, featuredUntil: null } });

  if (free.maxActiveListings !== null) {
    // Los RESERVED y PENDING_SALE nunca se pausan; ambos ocupan cupo del plan.
    const active = await tx.vehicle.findMany({
      where: { sellerId: userId, deletedAt: null, status: { in: ['PUBLISHED', 'RESERVED', 'PENDING_SALE'] } },
      orderBy: [{ status: 'desc' }, { publishedAt: 'desc' }],
      select: { id: true, status: true },
    });
    const held = active.filter(v => v.status === 'RESERVED' || v.status === 'PENDING_SALE').length;
    const keepPublished = Math.max(0, free.maxActiveListings - held);
    const toPause = active.filter(v => v.status === 'PUBLISHED').slice(keepPublished).map(v => v.id);
    if (toPause.length > 0) await tx.vehicle.updateMany({ where: { id: { in: toPause } }, data: { status: 'PAUSED' } });
  }
  return user;
}

export const membershipsService = {
  async status(userId: string): Promise<MembershipStatusDTO> {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const current = effectivePlan(user);
    const now = new Date();
    const [plan, activeListings, featuredInUse, history] = await Promise.all([
      getPlan(current.code),
      prisma.vehicle.count({ where: { sellerId: userId, deletedAt: null, status: { in: ['PUBLISHED', 'RESERVED'] } } }),
      prisma.vehicle.count({ where: { sellerId: userId, deletedAt: null, featuredUntil: { gt: now } } }),
      prisma.membershipPeriod.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    return {
      plan: toPlanDTO(plan),
      cycle: current.cycle,
      expiresAt: current.expiresAt,
      daysRemaining: current.daysRemaining,
      expiringSoon: current.daysRemaining !== null && current.daysRemaining <= EXPIRY_WARNING_DAYS,
      activeListings,
      featuredInUse,
      history: history.map(period => ({
        id: period.id,
        planCode: period.planCode,
        cycle: period.cycle,
        source: period.source,
        startsAt: period.startsAt.toISOString(),
        endsAt: period.endsAt?.toISOString() ?? null,
        amount: period.amount?.toFixed(2) ?? null,
      })),
    };
  },

  /**
   * Pago por periodo (mes o año) con Binance a la cuenta de la empresa: Binance Pay (QR y
   * confirmación automática) o transferencia al Pay ID verificada por un administrador.
   */
  async checkout(userId: string, input: MembershipCheckoutInput): Promise<PaymentDTO> {
    const [plan, user] = await Promise.all([getPlan(input.planCode), prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { accountType: true } })]);
    // Premium es para personas naturales; los planes de concesionario, para concesionarios.
    if (plan.accountType && plan.accountType !== user.accountType) {
      throw AppError.forbidden(
        'PLAN_NOT_FOR_ACCOUNT',
        plan.accountType === 'DEALER' ? 'Este plan es para concesionarios. Cambia tu tipo de cuenta en tu perfil.' : 'Este plan es para personas naturales. Elige un plan de concesionario.',
      );
    }
    const amount = input.cycle === 'MONTHLY' ? plan.priceMonthly : plan.priceYearly;
    if (amount.lte(0)) throw AppError.badRequest('PLAN_NOT_PURCHASABLE', 'Este plan no tiene precio configurado.');
    return createCheckout({
      userId,
      purpose: 'MEMBERSHIP',
      method: input.method,
      amount,
      description: `AutoMarket · Plan ${plan.name} (${input.cycle === 'MONTHLY' ? 'mensual' : 'anual'})`,
      windowMinutes: env.MANUAL_PAYMENT_WINDOW_HOURS * 60,
      planCode: plan.code,
      cycle: input.cycle,
    });
  },

  /**
   * Activa la membresía de un pago YA confirmado (webhook, consulta a Binance o aprobación del
   * administrador). Idempotente: membership_periods.paymentId es UNIQUE.
   */
  async activateFromPayment(paymentId: string): Promise<{ activated: boolean }> {
    try {
      const result = await runInTransaction(async tx => {
        const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
        if (payment.purpose !== 'MEMBERSHIP' || payment.status !== 'PAID') return { notice: null, activated: false };
        if (await tx.membershipPeriod.findUnique({ where: { paymentId }, select: { id: true } })) return { notice: null, activated: false };
        if (!payment.planCode || payment.planCode === 'FREE' || !payment.cycle) throw new AppError(500, 'INVALID_PAYMENT', 'Pago de membresía sin plan.');

        const granted = await grantPeriod(tx, { userId: payment.userId, planCode: payment.planCode, cycle: payment.cycle, periods: 1, source: 'BINANCE', payment });
        await tx.ledgerEntry.create({
          data: { type: 'MEMBERSHIP_REVENUE', amount: payment.amount, currency: 'USD', userId: payment.userId, paymentId: payment.id, description: `Membresía ${payment.planCode} ${payment.cycle} · ${payment.reference}` },
        });
        await recordAudit({ action: 'MEMBERSHIP_ACTIVATED', entityType: 'Payment', entityId: payment.id, metadata: { planCode: payment.planCode, cycle: payment.cycle, mode: payment.mode, expiresAt: granted.expiresAt.toISOString() } }, tx);
        return { notice: granted.notice, activated: true };
      });
      deliver([result.notice]);
      return { activated: result.activated };
    } catch (err) {
      if (isUniqueViolation(err, 'paymentId')) return { activated: false }; // activación concurrente
      throw err;
    }
  },

  /** Alta, renovación o baja manual desde el panel (pagos fuera de la plataforma, cortesías…). */
  async grantManually(adminId: string, userId: string, input: ManualMembershipInput, ip: string | null) {
    const notices: Array<PendingNotice | null> = [];
    await runInTransaction(async tx => {
      if (!(await tx.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw AppError.notFound('USER_NOT_FOUND', 'Usuario no encontrado.');
      if (input.planCode === 'FREE') {
        await downgradeToFree(tx, userId, 'ADMIN', adminId, input.note);
      } else {
        const granted = await grantPeriod(tx, { userId, planCode: input.planCode, cycle: input.cycle, periods: input.periods, source: 'ADMIN', grantedById: adminId, note: input.note });
        notices.push(granted.notice);
      }
      await recordAudit({ action: 'MEMBERSHIP_GRANTED_MANUALLY', entityType: 'User', entityId: userId, actorId: adminId, ip, metadata: { ...input } }, tx);
    });
    deliver(notices);
    realtime.statsChanged();
  },
};
