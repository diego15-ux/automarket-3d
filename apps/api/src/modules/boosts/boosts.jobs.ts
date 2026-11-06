import { prisma, runInTransaction } from '../../shared/infra/prisma.js';
import { deliver, notify, type PendingNotice } from '../../shared/notifications.js';
import { getSettings } from '../memberships/plans.js';
import { HOME_LABEL, HOME_ZONE, localDay, toDbDate, zoneLabelOf } from './boost-calendar.js';
import { boostCalendar } from './boosts.service.js';

const DAY_MS = 86_400_000;
const WAITLIST_DAYS = 30;

/**
 * Motor de «Destacar» (cada minuto):
 *   1. Vencen los impulsos de zona y portada y los turnos de la pantalla de entrada (11:59 p. m.).
 *   2. Los turnos programados entran en pantalla el día que les toca.
 *   3. La cola de zona y portada avanza por orden de pago cuando se libera un cupo.
 *   4. Un anuncio que se pausó y volvió a publicarse recupera su destacado pagado.
 *   5. Lista de espera: un aviso cuando se abre un cupo; caduca a los 30 días.
 */
export async function runBoostJobs(now = new Date()): Promise<void> {
  const today = toDbDate(localDay(now));
  await prisma.boost.updateMany({ where: { kind: { not: 'LOGIN' }, status: 'ACTIVE', endsAt: { lte: now } }, data: { status: 'EXPIRED' } });
  await prisma.boost.updateMany({ where: { kind: 'LOGIN', status: { in: ['ACTIVE', 'SCHEDULED'] }, endDate: { lt: today } }, data: { status: 'EXPIRED' } });
  await prisma.boost.updateMany({ where: { kind: 'LOGIN', status: 'SCHEDULED', startDate: { lte: today } }, data: { status: 'ACTIVE' } });

  const notices: Array<PendingNotice | null> = [];
  const queued = await prisma.boost.findMany({ where: { kind: { not: 'LOGIN' }, status: 'SCHEDULED' }, orderBy: { paidAt: 'asc' }, take: 100, select: { id: true } });
  for (const { id } of queued) {
    const started = await runInTransaction(async tx => {
      await boostCalendar.lockSettings(tx);
      const settings = await getSettings(tx);
      const boost = await tx.boost.findUnique({ where: { id } });
      if (!boost || boost.status !== 'SCHEDULED' || !boost.zoneKey) return null;
      const entry = (await boostCalendar.zoneUsage(tx, [boost.zoneKey], now)).get(boost.zoneKey)!;
      const total = boost.kind === 'HOME' ? settings.homeBoostSlots : settings.cityBoostSlots;
      // Solo el primero de la cola de su zona (los demás esperan su turno).
      const first = await tx.boost.findFirst({ where: { zoneKey: boost.zoneKey, kind: { not: 'LOGIN' }, status: 'SCHEDULED' }, orderBy: { paidAt: 'asc' }, select: { id: true } });
      if (entry.active >= total || first?.id !== boost.id) return null;
      await boostCalendar.startZoneBoost(tx, boost.id, boost.days, boost.vehicleId, now);
      return tx.boost.findUniqueOrThrow({ where: { id }, include: boostCalendar.boostInclude });
    });
    if (started) {
      notices.push(await boostCalendar.noticeFor(started));
      if (started.kind === 'CITY_7D' || started.kind === 'HOME') await boostCalendar.notifyAlertsFor(started.vehicleId).catch(() => undefined);
    }
  }

  const active = await prisma.boost.findMany({
    where: { kind: { not: 'LOGIN' }, status: 'ACTIVE', endsAt: { gt: now }, vehicle: { status: 'PUBLISHED', deletedAt: null } },
    select: { endsAt: true, startsAt: true, vehicleId: true, vehicle: { select: { featuredUntil: true } } },
    take: 500,
  });
  for (const boost of active) {
    if (boost.vehicle.featuredUntil && boost.endsAt && boost.vehicle.featuredUntil >= boost.endsAt) continue;
    await prisma.vehicle.update({ where: { id: boost.vehicleId }, data: { featuredUntil: boost.endsAt, featuredAt: boost.startsAt ?? now } });
  }

  await prisma.boost.updateMany({ where: { status: 'WAITLISTED', createdAt: { lt: new Date(now.getTime() - WAITLIST_DAYS * DAY_MS) } }, data: { status: 'CANCELLED' } });
  const waiting = await prisma.boost.findMany({
    where: { status: 'WAITLISTED', notifiedAt: null },
    orderBy: { createdAt: 'asc' },
    take: 100,
    include: { vehicle: { select: { id: true, city: true, category: true } } },
  });
  if (waiting.length > 0) {
    const settings = await getSettings();
    const usage = await boostCalendar.zoneUsage(prisma, [...new Set(waiting.map(row => row.zoneKey!))], now);
    for (const row of waiting) {
      const entry = usage.get(row.zoneKey!)!;
      const total = row.zoneKey === HOME_ZONE ? settings.homeBoostSlots : settings.cityBoostSlots;
      if (entry.active + entry.queued >= total) continue;
      const label = row.zoneKey === HOME_ZONE ? HOME_LABEL : zoneLabelOf(row.vehicle);
      await prisma.boost.update({ where: { id: row.id }, data: { notifiedAt: now } });
      notices.push(
        await notify(prisma, {
          userId: row.userId,
          type: 'BOOST_SLOT_OPEN',
          title: `Se abrió un cupo en «${label}»`,
          body: 'Entra a Destacar para pagar y activar el impulso. Los cupos se dan por orden de llegada.',
          link: `/destacar?anuncio=${row.vehicleId}`,
          dedupeKey: `boost:${row.id}:open`,
        }),
      );
    }
  }
  deliver(notices);
}
