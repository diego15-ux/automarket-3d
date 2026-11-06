import type { CarouselUpdateInput, ContactInput, PublicReviewDTO, VehicleCardDTO } from '@automarket/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../shared/errors/app-error.js';
import { recordAudit } from '../../shared/infra/audit.js';
import { prisma, runInTransaction } from '../../shared/infra/prisma.js';
import { deliver, notify } from '../../shared/notifications.js';
import { assertNoBlockedTerms } from '../../shared/moderation/blocklist.js';
import { cached } from '../../shared/utils/cached.js';
import { cardSelect, toCardDTO } from '../vehicles/vehicles.mapper.js';

const FILTER_STATS_DAYS = 30;

const CAROUSEL_SIZE = 12;
const ADMIN_FEATURED_PREVIEW = 50;
const VISIBLE: Prisma.VehicleWhereInput = { deletedAt: null, status: { in: ['PUBLISHED', 'RESERVED'] } };

type DemandRow = { id: string; contactCount: bigint; reservationCount: bigint };

async function rankVehiclesByDemand(kind: 'FEATURED' | 'RECOMMENDED', limit: number): Promise<DemandRow[]> {
  const safeLimit = Math.max(0, Math.min(50, Math.trunc(limit)));
  if (safeLimit === 0) return [];
  const featuredCondition = kind === 'FEATURED'
    ? Prisma.sql`AND v.featuredUntil > UTC_TIMESTAMP(3)
        AND NOT EXISTS (SELECT 1 FROM carousel_items ci WHERE ci.vehicleId = v.id)`
    : Prisma.sql`AND (v.featuredUntil IS NULL OR v.featuredUntil <= UTC_TIMESTAMP(3))
        AND NOT EXISTS (SELECT 1 FROM carousel_items ci WHERE ci.vehicleId = v.id)`;
  const moderationCondition = kind === 'RECOMMENDED'
    ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM reports rp WHERE rp.vehicleId = v.id AND rp.status = 'OPEN')`
    : Prisma.empty;

  return prisma.$queryRaw<DemandRow[]>`
    WITH contact_demand AS (
      SELECT vehicleId, COUNT(DISTINCT buyerId) AS contactCount
      FROM conversations
      WHERE createdAt >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)
      GROUP BY vehicleId
    ), reservation_demand AS (
      SELECT vehicleId, COUNT(DISTINCT buyerId) AS reservationCount
      FROM cart_reserves
      WHERE createdAt >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)
        AND type = 'RESERVATION' AND status IN ('ACTIVE', 'ACCEPTED', 'COMPLETED')
      GROUP BY vehicleId
    )
    SELECT v.id,
      COALESCE(cd.contactCount, 0) AS contactCount,
      COALESCE(rd.reservationCount, 0) AS reservationCount
    FROM vehicles v
    LEFT JOIN contact_demand cd ON cd.vehicleId = v.id
    LEFT JOIN reservation_demand rd ON rd.vehicleId = v.id
    WHERE v.deletedAt IS NULL AND v.status = 'PUBLISHED'
      AND (v.expiresAt IS NULL OR v.expiresAt > UTC_TIMESTAMP(3))
      ${featuredCondition}
      ${moderationCondition}
      AND (COALESCE(cd.contactCount, 0) + COALESCE(rd.reservationCount, 0) * 3) >= 3
    ORDER BY
      (COALESCE(cd.contactCount, 0) + COALESCE(rd.reservationCount, 0) * 3) DESC,
      COALESCE(rd.reservationCount, 0) DESC,
      COALESCE(cd.contactCount, 0) DESC,
      v.publishedAt DESC,
      v.id
    LIMIT ${Prisma.raw(String(safeLimit))}`;
}

async function vehiclesInDemandOrder(rows: DemandRow[]) {
  if (rows.length === 0) return [];
  const vehicles = await prisma.vehicle.findMany({ where: { id: { in: rows.map(row => row.id) } }, select: cardSelect });
  const byId = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]));
  return rows.flatMap(row => {
    const vehicle = byId.get(row.id);
    return vehicle ? [{
      vehicle: toCardDTO(vehicle),
      contactCount: Number(row.contactCount),
      reservationCount: Number(row.reservationCount),
      influenceScore: Number(row.contactCount) + Number(row.reservationCount) * 3,
    }] : [];
  });
}

/** Vitrina pública de la landing: carrusel, testimonios y formulario de contacto. */
export const showcaseService = {
  /** Carrusel limitado a 12: selección del equipo primero, luego destacados con mayor demanda. */
  async carousel(): Promise<Array<VehicleCardDTO & { source: 'CURATED' | 'FEATURED' }>> {
    // «Portada» pagada en Destacar: primero, por orden de inicio (cupos limitados por el panel).
    const paidHome = await prisma.boost.findMany({
      where: { kind: 'HOME', status: 'ACTIVE', endsAt: { gt: new Date() }, vehicle: { ...VISIBLE, status: 'PUBLISHED' } },
      orderBy: { startsAt: 'asc' },
      take: CAROUSEL_SIZE,
      select: { vehicle: { select: cardSelect } },
    });
    const [curated, featuredRows] = await Promise.all([
      prisma.carouselItem.findMany({
        where: { isActive: true, vehicle: VISIBLE },
        orderBy: { position: 'asc' },
        take: CAROUSEL_SIZE,
        select: { vehicle: { select: cardSelect } },
      }),
      rankVehiclesByDemand('FEATURED', CAROUSEL_SIZE),
    ]);
    const seen = new Set<string>();
    const items: Array<VehicleCardDTO & { source: 'CURATED' | 'FEATURED' }> = [];
    for (const { vehicle } of paidHome) {
      seen.add(vehicle.id);
      items.push({ ...toCardDTO(vehicle), source: 'FEATURED' });
    }
    for (const { vehicle } of curated) {
      if (seen.has(vehicle.id)) continue;
      seen.add(vehicle.id);
      items.push({ ...toCardDTO(vehicle), source: 'CURATED' });
    }
    const featuredRowsToLoad = featuredRows.filter(row => !seen.has(row.id)).slice(0, CAROUSEL_SIZE - items.length);
    const featured = await prisma.vehicle.findMany({
      where: { id: { in: featuredRowsToLoad.map(row => row.id) } },
      select: cardSelect,
    });
    const featuredById = new Map(featured.map(vehicle => [vehicle.id, vehicle]));
    for (const row of featuredRowsToLoad) {
      const vehicle = featuredById.get(row.id);
      if (!vehicle) continue;
      seen.add(vehicle.id);
      items.push({ ...toCardDTO(vehicle), source: 'FEATURED' });
    }
    return items.slice(0, CAROUSEL_SIZE);
  },

  /** Recomendaciones basadas en contactos y reservas reales de los últimos 30 días. */
  async marketRecommendations() {
    return vehiclesInDemandOrder(await rankVehiclesByDemand('RECOMMENDED', 12));
  },

  /** Panel: selección curada + muestra limitada de destacados y total real. */
  async carouselAdmin() {
    const now = new Date();
    const [curated, featured, featuredTotal] = await Promise.all([
      prisma.carouselItem.findMany({ orderBy: { position: 'asc' }, take: CAROUSEL_SIZE, select: { isActive: true, position: true, vehicle: { select: cardSelect } } }),
      prisma.vehicle.findMany({ where: { ...VISIBLE, status: 'PUBLISHED', featuredUntil: { gt: now } }, orderBy: { featuredAt: 'desc' }, take: ADMIN_FEATURED_PREVIEW, select: { ...cardSelect, featuredUntil: true } }),
      prisma.vehicle.count({ where: { ...VISIBLE, status: 'PUBLISHED', featuredUntil: { gt: now } } }),
    ]);
    return {
      curated: curated.map(item => ({ isActive: item.isActive, position: item.position, vehicle: toCardDTO(item.vehicle) })),
      featured: featured.map(vehicle => ({ ...toCardDTO(vehicle), featuredUntil: vehicle.featuredUntil?.toISOString() ?? null })),
      featuredTotal,
    };
  },

  /** Notifica una vez por anuncio a administradores; supervisores mantienen su permiso limitado. */
  async notifyMarketInfluence() {
    const [recommendations, admins] = await Promise.all([
      vehiclesInDemandOrder(await rankVehiclesByDemand('RECOMMENDED', 12)),
      prisma.user.findMany({ where: { role: { in: ['ADMIN', 'ADMIN_ONE'] }, status: 'ACTIVE', deletedAt: null }, select: { id: true } }),
    ]);
    for (const candidate of recommendations.slice(0, 5)) {
      const notices = await Promise.all(admins.map(admin => runInTransaction(tx =>
        notify(tx, {
          userId: admin.id,
          type: 'MARKET_INFLUENCE',
          title: 'Auto con alta demanda en el mercado',
          body: `${candidate.vehicle.make} ${candidate.vehicle.model} ${candidate.vehicle.year}: ${candidate.contactCount} compradores contactaron y ${candidate.reservationCount} solicitaron reserva en los últimos 30 días.`,
          link: '/admin/carrusel',
          dedupeKey: `market-influence:${candidate.vehicle.id}:${admin.id}`,
        }),
      )));
      deliver(notices);
    }
  },

  /** Sustituye la selección curada respetando el orden recibido. */
  async updateCarousel(adminId: string, input: CarouselUpdateInput) {
    const ids = input.items.map(item => item.vehicleId);
    if (new Set(ids).size !== ids.length) throw AppError.badRequest('DUPLICATED_VEHICLE', 'Un vehículo aparece dos veces en el carrusel.');
    const visible = await prisma.vehicle.count({ where: { id: { in: ids }, ...VISIBLE } });
    if (visible !== ids.length) throw AppError.badRequest('VEHICLE_NOT_VISIBLE', 'Solo se pueden añadir vehículos publicados.');

    await runInTransaction(async tx => {
      await tx.carouselItem.deleteMany({});
      if (input.items.length > 0) {
        await tx.carouselItem.createMany({ data: input.items.map((item, position) => ({ vehicleId: item.vehicleId, position, isActive: item.isActive })) });
      }
      await recordAudit({ action: 'CAROUSEL_UPDATED', entityType: 'CarouselItem', entityId: 'carousel', actorId: adminId, metadata: { vehicleIds: ids } }, tx);
    });
    return showcaseService.carouselAdmin();
  },

  /** Testimonios aprobados + valoración media real. */
  /**
   * Lo que hizo el filtro del chat en los últimos 30 días, contado sobre los mensajes reales
   * (cada mensaje guarda las marcas que le puso el moderador). Solo cifras, nunca textos.
   */
  chatFilterStats: cached(60_000, async () => {
    const since = new Date(Date.now() - FILTER_STATS_DAYS * 86_400_000);
    const [row] = await prisma.$queryRaw<Array<{ messages: bigint; conversations: bigint; contact: unknown; profanity: unknown }>>`
      SELECT COUNT(*) AS messages,
             COUNT(DISTINCT conversationId) AS conversations,
             COALESCE(SUM(JSON_CONTAINS(moderationFlags, '"EMAIL"') OR JSON_CONTAINS(moderationFlags, '"PHONE"') OR JSON_CONTAINS(moderationFlags, '"URL"')), 0) AS contact,
             COALESCE(SUM(JSON_CONTAINS(moderationFlags, '"PROFANITY"')), 0) AS profanity
      FROM chat_messages
      WHERE createdAt >= ${since}`;
    return {
      days: FILTER_STATS_DAYS,
      messages: Number(row?.messages ?? 0),
      conversations: Number(row?.conversations ?? 0),
      contactHidden: Number(row?.contact ?? 0),
      profanityHidden: Number(row?.profanity ?? 0),
    };
  }),

  async reviews(): Promise<{ items: PublicReviewDTO[]; average: number | null; total: number }> {
    const [items, stats] = await Promise.all([
      prisma.review.findMany({
        where: { status: 'APPROVED', user: { deletedAt: null } },
        orderBy: { createdAt: 'desc' },
        take: 12,
        include: { user: { select: { name: true, city: true } } },
      }),
      prisma.review.aggregate({ where: { status: 'APPROVED' }, _avg: { rating: true }, _count: true }),
    ]);
    return {
      items: items.map(review => ({ id: review.id, rating: review.rating, comment: review.comment, author: review.user.name, city: review.user.city, createdAt: review.createdAt.toISOString() })),
      average: stats._avg.rating === null ? null : Math.round(stats._avg.rating * 10) / 10,
      total: stats._count,
    };
  },

  async myReview(userId: string) {
    return prisma.review.findUnique({ where: { userId }, select: { rating: true, comment: true, status: true, updatedAt: true } });
  },

  /** Una reseña por usuario; editarla la devuelve a moderación. */
  async submitReview(userId: string, input: { rating: number; comment: string }) {
    await assertNoBlockedTerms({ comment: input.comment });
    return prisma.review.upsert({
      where: { userId },
      create: { userId, rating: input.rating, comment: input.comment },
      update: { rating: input.rating, comment: input.comment, status: 'PENDING', moderatedAt: null, moderatedById: null },
      select: { rating: true, comment: true, status: true, updatedAt: true },
    });
  },

  async contact(input: ContactInput, ctx: { userId: string | null; ip: string | null }) {
    await assertNoBlockedTerms({ name: input.name, subject: input.subject, message: input.message });
    await prisma.contactMessage.create({
      data: { name: input.name, email: input.email, subject: input.subject ?? null, message: input.message, userId: ctx.userId, ip: ctx.ip?.slice(0, 45) ?? null },
    });
  },
};
