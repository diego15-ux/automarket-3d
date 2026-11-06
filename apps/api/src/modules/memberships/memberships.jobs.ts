import { recordAudit } from '../../shared/infra/audit.js';
import { prisma, runInTransaction } from '../../shared/infra/prisma.js';
import { emails } from '../../shared/mail/templates.js';
import { EXPIRY_WARNING_DAYS, addDays } from '../../shared/membership.js';
import { deliver, notify } from '../../shared/notifications.js';
import { realtime } from '../../shared/realtime.js';
import { getPlan } from './plans.js';
import { downgradeToFree } from './memberships.service.js';

const DAY_MS = 86_400_000;

/**
 * Tareas periódicas de membresías:
 *   1. Avisos de renovación a ≤10 y ≤3 días (notificación + correo, una sola vez cada uno).
 *   2. Vencimientos → plan Gratis (pausa los anuncios que exceden el límite).
 *   3. Plan Medio: destacado automático mensual si el usuario no eligió uno.
 */
export async function runMembershipJobs(now = new Date()): Promise<void> {
  const expiring = await prisma.user.findMany({
    where: { deletedAt: null, planCode: { not: 'FREE' }, planExpiresAt: { gt: now, lte: addDays(now, EXPIRY_WARNING_DAYS) } },
    take: 500,
  });
  for (const user of expiring) {
    if (!user.planExpiresAt) continue;
    const daysLeft = Math.max(1, Math.ceil((user.planExpiresAt.getTime() - now.getTime()) / DAY_MS));
    const tier = daysLeft <= 3 ? 3 : EXPIRY_WARNING_DAYS;
    const plan = await getPlan(user.planCode);
    const notice = await runInTransaction(tx =>
      notify(tx, {
        userId: user.id,
        type: 'MEMBERSHIP_EXPIRING',
        title: `Tu plan ${plan.name} vence en ${daysLeft} ${daysLeft === 1 ? 'día' : 'días'}`,
        body: 'Renueva para mantener tus publicaciones activas, la prioridad en búsquedas y tus destacados.',
        link: '/cuenta/plan',
        dedupeKey: `plan-expiring:${user.id}:${user.planExpiresAt!.toISOString()}:${tier}`,
        email: emails.membershipExpiring({ to: user.email, name: user.name, planName: plan.name, daysLeft, expiresAt: user.planExpiresAt! }),
      }),
    );
    deliver([notice]);
  }

  const expired = await prisma.user.findMany({ where: { planCode: { not: 'FREE' }, planExpiresAt: { lte: now } }, take: 200 });
  for (const user of expired) {
    const plan = await getPlan(user.planCode);
    const notice = await runInTransaction(async tx => {
      // Releer bajo bloqueo: pudo renovarse justo ahora (webhook concurrente).
      const fresh = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      if (fresh.planCode === 'FREE' || !fresh.planExpiresAt || fresh.planExpiresAt > now) return null;
      await downgradeToFree(tx, user.id, 'SYSTEM', undefined, `Vencimiento del plan ${plan.name}`);
      await recordAudit({ action: 'MEMBERSHIP_EXPIRED', entityType: 'User', entityId: user.id, metadata: { planCode: user.planCode, expiredAt: fresh.planExpiresAt.toISOString() } }, tx);
      return notify(tx, {
        userId: user.id,
        type: 'MEMBERSHIP_EXPIRED',
        title: `Tu plan ${plan.name} venció`,
        body: 'Ahora tienes el plan Gratis. Renueva para reactivar tus anuncios en pausa.',
        link: '/cuenta/plan',
        dedupeKey: `plan-expired:${user.id}:${fresh.planExpiresAt.toISOString()}`,
        email: emails.membershipExpired({ to: user.email, name: user.name, planName: plan.name }),
      });
    });
    deliver([notice]);
  }
  if (expired.length > 0) realtime.statsChanged();

  const month = now.toISOString().slice(0, 7);
  const medium = await prisma.user.findMany({
    where: { deletedAt: null, plan: { monthlyFeaturedCredits: { gt: 0 } }, planExpiresAt: { gt: now }, OR: [{ featureCreditMonth: null }, { featureCreditMonth: { not: month } }] },
    select: { id: true, planExpiresAt: true },
    take: 500,
  });
  for (const user of medium) {
    const notice = await runInTransaction(async tx => {
      if ((await tx.vehicle.count({ where: { sellerId: user.id, deletedAt: null, featuredUntil: { gt: now } } })) > 0) return null;
      const newest = await tx.vehicle.findFirst({ where: { sellerId: user.id, deletedAt: null, status: 'PUBLISHED' }, orderBy: { publishedAt: 'desc' } });
      if (!newest) return null;
      const { count } = await tx.user.updateMany({ where: { id: user.id, OR: [{ featureCreditMonth: null }, { featureCreditMonth: { not: month } }] }, data: { featureCreditMonth: month } });
      if (count === 0) return null;
      const thirtyDays = addDays(now, 30);
      const featuredUntil = user.planExpiresAt && user.planExpiresAt < thirtyDays ? user.planExpiresAt : thirtyDays;
      await tx.vehicle.update({ where: { id: newest.id }, data: { featuredAt: now, featuredUntil } });
      return notify(tx, {
        userId: user.id,
        type: 'VEHICLE_AUTO_FEATURED',
        title: 'Destacamos tu anuncio este mes',
        body: `Tu ${newest.make} ${newest.model} aparece en el carrusel y con prioridad en búsquedas durante 30 días.`,
        link: '/cuenta/anuncios',
      });
    });
    deliver([notice]);
  }
}
