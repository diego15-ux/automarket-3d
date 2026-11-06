import { usdText } from '@automarket/contracts';
import { MAX_ALERTS_PER_USER, type AlertNoticeDTO, type AlertsOverviewDTO, type PriceDropAlertDTO, type SearchAlertCreateInput, type SearchAlertDTO } from '@automarket/contracts';
import { Prisma, type SearchAlert } from '../../generated/prisma/client.js';
import { AppError } from '../../shared/errors/app-error.js';
import { prisma } from '../../shared/infra/prisma.js';

/** Tipos de aviso que salen en «Avisos recientes». */
export const ALERT_NOTICE_TYPES = ['SEARCH_ALERT', 'SEARCH_ALERT_DIGEST', 'VEHICLE_AVAILABLE_AGAIN', 'DEALER_NEW_LISTING', 'PRICE_DROP'];

/** Anuncios públicos (publicados, sin borrar) que cumplen la alerta. */
export function alertWhere(alert: Pick<SearchAlert, 'userId' | 'make' | 'model' | 'maxPrice' | 'country' | 'city' | 'yearFrom'>): Prisma.VehicleWhereInput {
  return {
    status: 'PUBLISHED',
    deletedAt: null,
    sellerId: { not: alert.userId },
    ...(alert.make ? { make: alert.make } : {}),
    ...(alert.model ? { model: { contains: alert.model } } : {}),
    ...(alert.maxPrice ? { price: { lte: alert.maxPrice } } : {}),
    ...(alert.country ? { country: alert.country } : {}),
    ...(alert.city ? { city: alert.city } : {}),
    ...(alert.yearFrom ? { year: { gte: alert.yearFrom } } : {}),
  };
}

/** Filtros del catálogo equivalentes (para «Ver autos» y el resumen). */
export function catalogQuery(alert: Pick<SearchAlert, 'make' | 'model' | 'maxPrice' | 'country' | 'city' | 'yearFrom'>): string {
  const params = new URLSearchParams();
  if (alert.make) params.set('make', alert.make);
  if (alert.model) params.set('model', alert.model);
  if (alert.maxPrice) params.set('priceMax', String(Math.round(Number(alert.maxPrice))));
  if (alert.country) params.set('country', alert.country);
  if (alert.city) params.set('city', alert.city);
  if (alert.yearFrom) params.set('yearMin', String(alert.yearFrom));
  params.set('sort', 'newest');
  return params.toString();
}

/** «Toyota Corolla · hasta $19,000» */
export function alertTitle(alert: Pick<SearchAlert, 'make' | 'model' | 'maxPrice'>): string {
  const name = [alert.make, alert.model].filter(Boolean).join(' ') || 'Cualquier auto';
  return alert.maxPrice ? `${name} · hasta ${usdText(Number(alert.maxPrice))}` : name;
}

const SLUG_LINK = /^\/vehiculos\/([a-z0-9-]+)$/;

async function toDTO(alert: SearchAlert): Promise<SearchAlertDTO> {
  const newCount = alert.active ? await prisma.vehicle.count({ where: { ...alertWhere(alert), publishedAt: { gt: alert.lastSeenAt } } }) : 0;
  return {
    id: alert.id,
    make: alert.make,
    model: alert.model,
    maxPrice: alert.maxPrice ? Number(alert.maxPrice) : null,
    country: alert.country,
    city: alert.city,
    yearFrom: alert.yearFrom,
    frequency: alert.frequency,
    active: alert.active,
    newCount,
    createdAt: alert.createdAt.toISOString(),
    catalogQuery: catalogQuery(alert),
  };
}

/** «Bajadas de precio en tus guardados»: guardados vigentes, si está encendida y avisos sin leer. */
async function priceDropsOf(userId: string): Promise<PriceDropAlertDTO> {
  const [user, saved, newCount] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { priceDropAlerts: true } }),
    prisma.vehicleFavorite.count({ where: { userId, vehicle: { deletedAt: null, status: { in: ['PUBLISHED', 'RESERVED'] } } } }),
    prisma.notification.count({ where: { userId, type: 'PRICE_DROP', readAt: null } }),
  ]);
  return { saved, active: user.priceDropAlerts, newCount: user.priceDropAlerts ? newCount : 0 };
}

async function ownAlert(userId: string, id: string) {
  const alert = await prisma.searchAlert.findFirst({ where: { id, userId } });
  if (!alert) throw AppError.notFound('ALERT_NOT_FOUND', 'Alerta no encontrada.');
  return alert;
}

export const alertsService = {
  /** Mis alertas: búsquedas guardadas, autos que espero («Avísame si vuelve») y avisos recientes. */
  async overview(userId: string): Promise<AlertsOverviewDTO> {
    const [alerts, watches, notices, priceDrops] = await Promise.all([
      prisma.searchAlert.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: MAX_ALERTS_PER_USER }),
      prisma.vehicleWatch.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          createdAt: true,
          vehicle: {
            select: {
              id: true, slug: true, make: true, model: true, version: true, year: true, status: true, negotiatingAt: true,
              media: { where: { kind: 'IMAGE' }, orderBy: { position: 'asc' }, take: 1, select: { url: true } },
            },
          },
        },
      }),
      prisma.notification.findMany({ where: { userId, type: { in: ALERT_NOTICE_TYPES } }, orderBy: { createdAt: 'desc' }, take: 8 }),
      priceDropsOf(userId),
    ]);
    // Miniatura del auto de cada aviso (el enlace lleva a su ficha).
    const slugs = [...new Set(notices.map(n => n.link?.match(SLUG_LINK)?.[1]).filter((slug): slug is string => Boolean(slug)))];
    const covers = slugs.length
      ? await prisma.vehicle.findMany({ where: { slug: { in: slugs } }, select: { slug: true, media: { where: { kind: 'IMAGE' }, orderBy: { position: 'asc' }, take: 1, select: { url: true } } } })
      : [];
    const coverOf = new Map(covers.map(c => [c.slug, c.media[0]?.url ?? null]));
    const recent: AlertNoticeDTO[] = notices.map(n => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      coverUrl: coverOf.get(n.link?.match(SLUG_LINK)?.[1] ?? '') ?? null,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    }));
    return {
      alerts: await Promise.all(alerts.map(toDTO)),
      watches: watches.map(({ createdAt, vehicle: v }) => ({
        vehicleId: v.id,
        slug: v.slug,
        title: `${v.make} ${v.model}${v.version ? ` ${v.version}` : ''} ${v.year}`,
        status: v.status,
        inNegotiation: v.status === 'RESERVED' && v.negotiatingAt !== null,
        coverUrl: v.media[0]?.url ?? null,
        createdAt: createdAt.toISOString(),
      })),
      priceDrops,
      recent,
    };
  },

  async create(userId: string, input: SearchAlertCreateInput): Promise<SearchAlertDTO> {
    const [count, user] = await Promise.all([
      prisma.searchAlert.count({ where: { userId } }),
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { country: true } }),
    ]);
    if (count >= MAX_ALERTS_PER_USER) throw AppError.conflict('ALERT_LIMIT', `Puedes tener hasta ${MAX_ALERTS_PER_USER} alertas. Borra alguna para crear otra.`);
    const now = new Date();
    const alert = await prisma.searchAlert.create({
      data: {
        userId,
        make: input.make ?? null,
        model: input.model ?? null,
        maxPrice: input.maxPrice !== undefined ? new Prisma.Decimal(input.maxPrice) : null,
        // La ciudad se busca dentro del país del perfil; sin ciudad, todo el país.
        country: user.country,
        city: input.city ?? null,
        yearFrom: input.yearFrom ?? null,
        frequency: input.frequency,
        lastCheckedAt: now,
        lastSeenAt: now,
      },
    });
    return toDTO(alert);
  },

  async setActive(userId: string, id: string, active: boolean): Promise<SearchAlertDTO> {
    const alert = await ownAlert(userId, id);
    // Al reanudarla no se avisa de lo publicado mientras estuvo en pausa.
    const updated = await prisma.searchAlert.update({ where: { id: alert.id }, data: { active, ...(active && !alert.active ? { lastCheckedAt: new Date() } : {}) } });
    return toDTO(updated);
  },

  async setPriceDrops(userId: string, active: boolean): Promise<PriceDropAlertDTO> {
    await prisma.user.update({ where: { id: userId }, data: { priceDropAlerts: active } });
    return priceDropsOf(userId);
  },

  async remove(userId: string, id: string): Promise<void> {
    const alert = await ownAlert(userId, id);
    await prisma.searchAlert.delete({ where: { id: alert.id } });
  },

  /** «Ver autos»: los nuevos de la alerta quedan vistos. */
  async markSeen(userId: string, id: string): Promise<void> {
    const alert = await ownAlert(userId, id);
    await prisma.searchAlert.update({ where: { id: alert.id }, data: { lastSeenAt: new Date() } });
  },
};
