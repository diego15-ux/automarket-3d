import { prisma, runInTransaction } from '../../shared/infra/prisma.js';
import { emails } from '../../shared/mail/templates.js';
import { deliver, notify } from '../../shared/notifications.js';
import { realtime } from '../../shared/realtime.js';

const LISTING_WARNING_DAYS = 7;
const DAY_MS = 86_400_000;

/**
 * Vencimiento de anuncios según la duración del plan (Free 30 d · Básico 60 d · Medio 90 d ·
 * Pro sin vencimiento). Avisa a 7 y 1 día; anuncios con reservas abiertas esperan a que se resuelvan.
 */
export async function runListingJobs(now = new Date()): Promise<void> {
  const expiring = await prisma.vehicle.findMany({
    where: {
      status: 'PUBLISHED',
      deletedAt: null,
      expiresAt: { gt: now, lte: new Date(now.getTime() + LISTING_WARNING_DAYS * DAY_MS) },
      reserves: { none: { openKey: { not: null } } },
    },
    select: {
      id: true,
      sellerId: true,
      make: true,
      model: true,
      year: true,
      expiresAt: true,
      seller: { select: { name: true, email: true } },
    },
    take: 500,
  });

  for (const vehicle of expiring) {
    if (!vehicle.expiresAt) continue;
    const title = `${vehicle.make} ${vehicle.model} ${vehicle.year}`;
    const notice = await runInTransaction(async tx => {
      const current = await tx.vehicle.findUnique({ where: { id: vehicle.id }, select: { status: true, expiresAt: true } });
      if (!current || current.status !== 'PUBLISHED' || !current.expiresAt || current.expiresAt <= now || current.expiresAt > new Date(now.getTime() + LISTING_WARNING_DAYS * DAY_MS)) return null;
      const daysLeft = Math.max(1, Math.ceil((current.expiresAt.getTime() - now.getTime()) / DAY_MS));
      const tier = daysLeft <= 1 ? 1 : LISTING_WARNING_DAYS;
      return notify(tx, {
        userId: vehicle.sellerId,
        type: 'LISTING_EXPIRING',
        title: `Tu anuncio vence en ${daysLeft} ${daysLeft === 1 ? 'día' : 'días'}`,
        body: `${title} dejará de mostrarse al vencer. Renuévalo desde Mis anuncios.`,
        link: '/cuenta/anuncios',
        dedupeKey: `listing-expiring:${vehicle.id}:${current.expiresAt.toISOString()}:${tier}`,
        email: emails.listingExpiring({ to: vehicle.seller.email, name: vehicle.seller.name, vehicle: title, daysLeft, expiresAt: current.expiresAt }),
      });
    });
    deliver([notice]);
  }

  const due = await prisma.vehicle.findMany({
    where: { status: 'PUBLISHED', deletedAt: null, expiresAt: { lte: now }, reserves: { none: { openKey: { not: null } } } },
    select: { id: true, sellerId: true, make: true, model: true, year: true, expiresAt: true },
    take: 500,
  });

  for (const vehicle of due) {
    const notice = await runInTransaction(async tx => {
      const { count } = await tx.vehicle.updateMany({ where: { id: vehicle.id, status: 'PUBLISHED', expiresAt: { lte: now } }, data: { status: 'EXPIRED', featuredUntil: null } });
      if (count === 0) return null;
      return notify(tx, {
        userId: vehicle.sellerId,
        type: 'LISTING_EXPIRED',
        title: 'Tu anuncio venció',
        body: `${vehicle.make} ${vehicle.model} ${vehicle.year} dejó de mostrarse. Renuévalo desde Mis anuncios.`,
        link: '/cuenta/anuncios',
        dedupeKey: `listing-expired:${vehicle.id}:${vehicle.expiresAt?.toISOString() ?? ''}`,
      });
    });
    deliver([notice]);
  }
  if (due.length > 0) realtime.statsChanged();
}
