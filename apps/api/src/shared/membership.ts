import type { PublicUser } from '@automarket/contracts';
import type { BillingCycle, PlanCode } from '../generated/prisma/enums.js';

const DAY_MS = 86_400_000;

/** Aviso de renovación (banner + correos) a partir de 10 días del vencimiento. */
export const EXPIRY_WARNING_DAYS = 10;

interface PlanHolder {
  planCode: PlanCode;
  planCycle: BillingCycle | null;
  planExpiresAt: Date | null;
}

/**
 * Plan efectivo: si el pagado ya venció pero el job aún no lo degradó, cuenta como FREE.
 * Así ningún límite depende de que el job se haya ejecutado a tiempo.
 */
export function effectivePlan(user: PlanHolder, now = new Date()): PublicUser['plan'] {
  const active = user.planCode !== 'FREE' && (user.planExpiresAt === null || user.planExpiresAt > now);
  if (!active) return { code: 'FREE', cycle: null, expiresAt: null, daysRemaining: null };
  return {
    code: user.planCode,
    cycle: user.planCycle,
    expiresAt: user.planExpiresAt?.toISOString() ?? null,
    daysRemaining: user.planExpiresAt ? Math.max(0, Math.ceil((user.planExpiresAt.getTime() - now.getTime()) / DAY_MS)) : null,
  };
}

/** Fin de un periodo de facturación. Si se renueva el mismo plan antes de vencer, se acumula. */
export function periodEnd(start: Date, cycle: BillingCycle, periods = 1): Date {
  const end = new Date(start);
  if (cycle === 'MONTHLY') end.setUTCMonth(end.getUTCMonth() + periods);
  else end.setUTCFullYear(end.getUTCFullYear() + periods);
  return end;
}

export const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);
