import { usdText } from '@automarket/contracts';
import { prisma } from '../../shared/infra/prisma.js';
import { deliver, notify, type PendingNotice } from '../../shared/notifications.js';
import { alertTitle, alertWhere, catalogQuery } from './alerts.service.js';

const DAY = 86_400_000;
const PER_RUN = 200;
const MAX_INSTANT_PER_ALERT = 5;

/**
 * Motor de «Mis alertas»: revisa lo publicado desde la última pasada de cada alerta activa.
 * Al instante: un aviso por auto nuevo (máximo 5 por pasada). Diario / semanal: un resumen con
 * el total y un enlace al catálogo con los filtros de la alerta.
 */
export async function runAlertJobs(now = new Date()): Promise<void> {
  const alerts = await prisma.searchAlert.findMany({ where: { active: true, lastCheckedAt: { lt: now } }, orderBy: { lastCheckedAt: 'asc' }, take: PER_RUN });
  const notices: Array<PendingNotice | null> = [];
  for (const alert of alerts) {
    if (alert.frequency === 'INSTANT') {
      const found = await prisma.vehicle.findMany({
        where: { ...alertWhere(alert), publishedAt: { gt: alert.lastCheckedAt, lte: now } },
        orderBy: { publishedAt: 'asc' },
        take: MAX_INSTANT_PER_ALERT,
        select: { id: true, slug: true, make: true, model: true, version: true, year: true, price: true, city: true, mileageKm: true },
      });
      for (const v of found) {
        notices.push(
          await notify(prisma, {
            userId: alert.userId,
            type: 'SEARCH_ALERT',
            title: `Nuevo: ${v.make} ${v.model}${v.version ? ` ${v.version}` : ''} ${v.year}`,
            body: `${usdText(Number(v.price))} en ${v.city}, ${v.mileageKm.toLocaleString('de-DE')} km`,
            link: `/vehiculos/${v.slug}`,
            dedupeKey: `alert:${alert.id}:${v.id}`,
          }),
        );
      }
      await prisma.searchAlert.update({ where: { id: alert.id }, data: { lastCheckedAt: now } });
      continue;
    }
    // Resumen: solo cuando pasó el día o la semana desde el último (o desde que se creó).
    const every = alert.frequency === 'DAILY' ? DAY : 7 * DAY;
    const since = alert.lastNotifiedAt ?? alert.createdAt;
    if (now.getTime() - since.getTime() < every) continue;
    const count = await prisma.vehicle.count({ where: { ...alertWhere(alert), publishedAt: { gt: alert.lastCheckedAt, lte: now } } });
    if (count > 0) {
      notices.push(
        await notify(prisma, {
          userId: alert.userId,
          type: 'SEARCH_ALERT_DIGEST',
          title: `${count} ${count === 1 ? 'auto nuevo' : 'autos nuevos'}: ${alertTitle(alert)}`,
          body: alert.frequency === 'DAILY' ? 'Tu resumen del día.' : 'Tu resumen de la semana.',
          link: `/vehiculos?${catalogQuery(alert)}`,
          dedupeKey: `alert-digest:${alert.id}:${now.toISOString().slice(0, 10)}`,
        }),
      );
    }
    await prisma.searchAlert.update({ where: { id: alert.id }, data: { lastCheckedAt: now, lastNotifiedAt: now } });
  }
  deliver(notices);
}
