import { PLAN_ACCOUNT_TYPE, type DealerBadgeDTO, type PaidPlanCode, type VehicleCardDTO, type VehicleDetailDTO, type VehicleMediaDTO } from '@automarket/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { effectivePlan } from '../../shared/membership.js';

/** Selección mínima para pintar una tarjeta del catálogo (1 foto principal). */
export const cardSelect = {
  id: true,
  slug: true,
  make: true,
  model: true,
  version: true,
  year: true,
  condition: true,
  ownersCount: true,
  mileageKm: true,
  price: true,
  currency: true,
  category: true,
  fuelType: true,
  transmission: true,
  country: true,
  city: true,
  status: true,
  featuredUntil: true,
  negotiatingAt: true,
  model3dUrl: true,
  seller: { select: { isVerified: true, accountType: true, businessName: true } },
  media: { where: { kind: 'IMAGE' }, orderBy: { position: 'asc' }, take: 1, select: { url: true } },
} satisfies Prisma.VehicleSelect;

export type CardRow = Prisma.VehicleGetPayload<{ select: typeof cardSelect }>;

export const detailInclude = {
  media: { orderBy: { position: 'asc' } },
  seller: {
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      isVerified: true,
      city: true,
      country: true,
      createdAt: true,
      accountType: true,
      businessName: true,
      taxId: true,
      fiscalAddress: true,
      businessPhone: true,
      planCode: true,
      planCycle: true,
      planExpiresAt: true,
    },
  },
} satisfies Prisma.VehicleInclude;

export type DetailRow = Prisma.VehicleGetPayload<{ include: typeof detailInclude }>;

const isFeatured = (featuredUntil: Date | null) => featuredUntil !== null && featuredUntil > new Date();

/**
 * Insignia del concesionario: la razón social siempre; RIF, dirección fiscal y teléfono
 * corporativo públicos con un plan de concesionario vigente («RIF visible»).
 */
export function dealerBadge(seller: DetailRow['seller']): DealerBadgeDTO | null {
  if (seller.accountType !== 'DEALER' || !seller.businessName) return null;
  const plan = effectivePlan(seller).code;
  const fiscalVisible = plan !== 'FREE' && PLAN_ACCOUNT_TYPE[plan as PaidPlanCode] === 'DEALER';
  return {
    businessName: seller.businessName,
    taxId: fiscalVisible ? seller.taxId : null,
    fiscalAddress: fiscalVisible ? seller.fiscalAddress : null,
    businessPhone: fiscalVisible ? seller.businessPhone : null,
  };
}

export const toCardDTO = (v: CardRow): VehicleCardDTO => ({
  id: v.id,
  slug: v.slug,
  make: v.make,
  model: v.model,
  version: v.version,
  year: v.year,
  condition: v.condition,
  ownersCount: v.ownersCount,
  mileageKm: v.mileageKm,
  price: v.price.toFixed(2),
  currency: v.currency,
  category: v.category,
  fuelType: v.fuelType,
  transmission: v.transmission,
  country: v.country,
  city: v.city,
  isFeatured: isFeatured(v.featuredUntil),
  status: v.status,
  inNegotiation: v.status === 'RESERVED' && v.negotiatingAt !== null,
  coverUrl: v.media[0]?.url ?? null,
  has3d: v.model3dUrl !== null,
  sellerVerified: v.seller.isVerified,
  sellerDealerName: v.seller.accountType === 'DEALER' ? v.seller.businessName : null,
});

export const toMediaDTO = (m: DetailRow['media'][number]): VehicleMediaDTO => ({
  id: m.id,
  kind: m.kind,
  url: m.url,
  mimeType: m.mimeType,
  width: m.width,
  height: m.height,
  durationMs: m.durationMs,
  position: m.position,
});

/** Cifras del vendedor (calificaciones y autos vendidos): se calculan aparte, solo en la ficha pública. */
export interface SellerStats {
  ratingAverage: number | null;
  ratingCount: number;
  soldCount: number;
}
const NO_STATS: SellerStats = { ratingAverage: null, ratingCount: 0, soldCount: 0 };

export const toDetailDTO = (v: DetailRow, stats: SellerStats = NO_STATS): VehicleDetailDTO => ({
  ...toCardDTO({ ...v, seller: v.seller, media: v.media.filter(m => m.kind === 'IMAGE').slice(0, 1) }),
  description: v.description,
  drivetrain: v.drivetrain,
  horsepower: v.horsepower,
  exteriorColor: v.exteriorColor,
  doors: v.doors,
  seats: v.seats,
  publishedAt: v.publishedAt?.toISOString() ?? null,
  expiresAt: v.expiresAt?.toISOString() ?? null,
  model3dUrl: v.model3dUrl,
  model3dPosterUrl: v.model3dPosterUrl,
  reservationAmount: v.reservationAmount?.toFixed(2) ?? null,
  media: v.media.map(toMediaDTO),
  seller: {
    id: v.seller.id,
    name: v.seller.name,
    avatarUrl: v.seller.avatarUrl,
    isVerified: v.seller.isVerified,
    city: v.seller.city,
    country: v.seller.country,
    memberSince: v.seller.createdAt.toISOString(),
    accountType: v.seller.accountType,
    dealer: dealerBadge(v.seller),
    ...stats,
  },
});
