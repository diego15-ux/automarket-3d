import { usdText } from '@automarket/contracts';
import type { DealerDirectoryEntryDTO } from '@automarket/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../shared/errors/app-error.js';
import { prisma, runInTransaction } from '../../shared/infra/prisma.js';
import { effectivePlan } from '../../shared/membership.js';
import { deliver, notify, type PendingNotice } from '../../shared/notifications.js';
import { cached } from '../../shared/utils/cached.js';

const SIX_MONTHS_MS = 183 * 86_400_000;
/** Tope del directorio y de avisos por publicación (protege la base si crece mucho). */
const MAX_DEALERS = 500;
const MAX_FOLLOWER_NOTICES = 2000;

/** Concesionario aliado: cuenta de agencia activa con el RIF aprobado por cumplimiento. */
export const ALLY_WHERE = {
  accountType: 'DEALER',
  isVerified: true,
  status: 'ACTIVE',
  deletedAt: null,
  businessName: { not: null },
} satisfies Prisma.UserWhereInput;

const money = (value: Prisma.Decimal | number) => usdText(Number(value)).slice(1);

/** Directorio sin «Siguiendo» (igual para todos). */
async function buildDirectory(): Promise<DealerDirectoryEntryDTO[]> {
  const dealers = await prisma.user.findMany({
    where: ALLY_WHERE,
    select: { id: true, businessName: true, avatarUrl: true, city: true, country: true, planCode: true, planCycle: true, planExpiresAt: true, verifiedAt: true, createdAt: true },
    orderBy: { verifiedAt: 'asc' },
    take: MAX_DEALERS,
  });
  if (dealers.length === 0) return [];
  const ids = dealers.map(dealer => dealer.id);
  const since = new Date(Date.now() - SIX_MONTHS_MS);

  const [listings, makes, reviews, reservationSales, directSales] = await Promise.all([
    prisma.vehicle.groupBy({ by: ['sellerId'], where: { sellerId: { in: ids }, deletedAt: null, status: { in: ['PUBLISHED', 'RESERVED'] } }, _count: { _all: true } }),
    prisma.vehicle.groupBy({ by: ['sellerId', 'make'], where: { sellerId: { in: ids }, deletedAt: null, status: { in: ['PUBLISHED', 'RESERVED'] } }, _count: { _all: true } }),
    prisma.sellerReview.groupBy({ by: ['sellerId'], where: { sellerId: { in: ids } }, _avg: { rating: true }, _count: { _all: true } }),
    prisma.cartReserve.groupBy({ by: ['sellerId'], where: { sellerId: { in: ids }, type: 'RESERVATION', status: 'COMPLETED', completedAt: { gte: since } }, _count: { _all: true } }),
    prisma.vehicleSale.groupBy({ by: ['sellerId'], where: { sellerId: { in: ids }, status: 'COMPLETED', completedAt: { gte: since } }, _count: { _all: true } }),
  ]);

  const countOf = (rows: Array<{ sellerId: string; _count: { _all: number } }>) => new Map(rows.map(row => [row.sellerId, row._count._all]));
  const listingCount = countOf(listings);
  const soldByReservation = countOf(reservationSales);
  const soldDirect = countOf(directSales);
  const reviewBy = new Map(reviews.map(row => [row.sellerId, row]));
  const brandsBy = new Map<string, Array<{ make: string; count: number }>>();
  for (const row of makes) {
    const list = brandsBy.get(row.sellerId) ?? [];
    list.push({ make: row.make, count: row._count._all });
    brandsBy.set(row.sellerId, list);
  }

  return dealers.map(dealer => {
    const review = reviewBy.get(dealer.id);
    const brands = (brandsBy.get(dealer.id) ?? [])
      .sort((a, b) => b.count - a.count || a.make.localeCompare(b.make, 'es'))
      .slice(0, 3)
      .map(row => row.make);
    return {
      id: dealer.id,
      name: dealer.businessName ?? '',
      avatarUrl: dealer.avatarUrl,
      city: dealer.city,
      country: dealer.country,
      planCode: effectivePlan(dealer).code,
      activeListings: listingCount.get(dealer.id) ?? 0,
      soldLast6Months: (soldByReservation.get(dealer.id) ?? 0) + (soldDirect.get(dealer.id) ?? 0),
      ratingAverage: review?._avg.rating ?? null,
      ratingCount: review?._count._all ?? 0,
      memberSinceYear: (dealer.verifiedAt ?? dealer.createdAt).getUTCFullYear(),
      brands,
      following: false,
    };
  });
}

/** El directorio es igual para todos salvo «Siguiendo»: se calcula como mucho una vez cada 30 s. */
const directoryBase = cached(30_000, buildDirectory);

export const dealersService = {
  /** Directorio público con cifras reales: inventario, ventas cerradas, reseñas y marcas. */
  async directory(viewerId: string | null): Promise<DealerDirectoryEntryDTO[]> {
    const list = await directoryBase();
    if (!viewerId || list.length === 0) return list.map(entry => ({ ...entry }));
    const follows = await prisma.dealerFollow.findMany({ where: { userId: viewerId, dealerId: { in: list.map(entry => entry.id) } }, select: { dealerId: true } });
    const followed = new Set(follows.map(row => row.dealerId));
    return list.map(entry => ({ ...entry, following: followed.has(entry.id) }));
  },

  /** Seguir a un aliado (idempotente). */
  async follow(userId: string, dealerId: string) {
    if (userId === dealerId) throw AppError.badRequest('OWN_DEALER', 'No puedes seguir tu propia agencia.');
    const dealer = await prisma.user.findFirst({ where: { id: dealerId, ...ALLY_WHERE }, select: { id: true, businessName: true } });
    if (!dealer) throw AppError.notFound('DEALER_NOT_FOUND', 'Concesionario no encontrado.');
    await prisma.dealerFollow.upsert({ where: { userId_dealerId: { userId, dealerId } }, create: { userId, dealerId }, update: {} });
    return { following: true, name: dealer.businessName ?? '' };
  },

  async unfollow(userId: string, dealerId: string) {
    await prisma.dealerFollow.deleteMany({ where: { userId, dealerId } });
    return { following: false };
  },

  /**
   * Aviso a quienes siguen a la agencia cuando publica un auto (una vez por anuncio y persona:
   * pausar y volver a publicar no repite el aviso).
   */
  async notifyFollowers(vehicleId: string) {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { id: true, slug: true, make: true, model: true, version: true, year: true, price: true, city: true, status: true, sellerId: true, seller: { select: { accountType: true, isVerified: true, businessName: true } } },
    });
    if (!vehicle || vehicle.status !== 'PUBLISHED' || vehicle.seller.accountType !== 'DEALER' || !vehicle.seller.isVerified) return;
    const followers = await prisma.dealerFollow.findMany({ where: { dealerId: vehicle.sellerId }, select: { userId: true }, take: MAX_FOLLOWER_NOTICES });
    if (followers.length === 0) return;
    const name = vehicle.seller.businessName ?? 'Un concesionario que sigues';
    const title = [vehicle.make, vehicle.model, vehicle.version, vehicle.year].filter(Boolean).join(' ');
    const notices: Array<PendingNotice | null> = [];
    for (const { userId } of followers) {
      notices.push(
        await runInTransaction(tx =>
          notify(tx, {
            userId,
            type: 'DEALER_NEW_LISTING',
            title: `${name} publicó un auto`,
            body: `${title} · $${money(vehicle.price)} en ${vehicle.city}.`,
            link: `/vehiculos/${vehicle.slug}`,
            dedupeKey: `follow:${vehicle.id}:${userId}`,
          }),
        ),
      );
    }
    deliver(notices);
  },
};
