import { PLAN_ACCOUNT_TYPE, type DealerPageDTO, type DealerPageReviewDTO, type PaidPlanCode } from '@automarket/contracts';
import { AppError } from '../../shared/errors/app-error.js';
import { prisma } from '../../shared/infra/prisma.js';
import { effectivePlan } from '../../shared/membership.js';
import { kycRepository } from '../kyc/kyc.repository.js';
import { cardSelect, toCardDTO } from '../vehicles/vehicles.mapper.js';
import { ALLY_WHERE } from './dealers.service.js';

const DAY_MS = 86_400_000;
/** Ventana y topes del cálculo de «Responde en» (protegen la base si la agencia tiene mucho chat). */
const RESPONSE_WINDOW_DAYS = 90;
const MAX_CONVERSATIONS = 200;
const MESSAGES_PER_CONVERSATION = 30;
const MIN_RESPONSE_SAMPLES = 3;
const MAX_VEHICLES = 60;
const MAX_REVIEWS = 30;

/** «Ana R.»: nombre y la inicial del apellido (nunca el nombre completo de quien compró). */
export function shortName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Comprador';
  const first = parts[0]!;
  const last = parts.length > 1 ? ` ${parts[parts.length - 1]!.charAt(0).toUpperCase()}.` : '';
  return `${first}${last}`;
}

/** Iniciales de la agencia para el logo cuando no tiene foto («Autos del Centro» → «AC»). */
export function dealerInitials(name: string) {
  const words = name
    .replace(/\b(C\.?\s?A\.?|S\.?\s?A\.?|S\.?\s?R\.?\s?L\.?)$/i, '')
    .split(/\s+/)
    .filter(word => word.length > 2 || /^[A-ZÁÉÍÓÚÑ0-9]/.test(word))
    .filter(word => !/^(de|del|la|las|los|el|y)$/i.test(word));
  const letters = words.map(word => word.charAt(0).toUpperCase()).join('');
  return (letters || name.charAt(0).toUpperCase()).slice(0, 2);
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * Minutos hasta la primera respuesta de la agencia: por conversación, desde el primer mensaje del
 * comprador hasta el primer mensaje de la agencia después de él. Mediana de los últimos 90 días.
 */
async function responseMinutes(dealerId: string): Promise<number | null> {
  const conversations = await prisma.conversation.findMany({
    where: { sellerId: dealerId, createdAt: { gte: new Date(Date.now() - RESPONSE_WINDOW_DAYS * DAY_MS) } },
    select: {
      buyerId: true,
      messages: { where: { deletedAt: null }, select: { senderId: true, createdAt: true }, orderBy: { createdAt: 'asc' }, take: MESSAGES_PER_CONVERSATION },
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_CONVERSATIONS,
  });
  const waits: number[] = [];
  for (const conversation of conversations) {
    const asked = conversation.messages.find(message => message.senderId === conversation.buyerId);
    if (!asked) continue;
    const answered = conversation.messages.find(message => message.senderId === dealerId && message.createdAt >= asked.createdAt);
    if (answered) waits.push((answered.createdAt.getTime() - asked.createdAt.getTime()) / 60_000);
  }
  return waits.length >= MIN_RESPONSE_SAMPLES ? Math.round(median(waits)) : null;
}

export const dealerPage = {
  /** Página pública de una agencia con cifras reales (inventario, ventas, reseñas y tiempo de respuesta). */
  async page(dealerId: string, viewerId: string | null): Promise<DealerPageDTO> {
    await kycRepository.invalidateExpiredIdentity(dealerId);
    const dealer = await prisma.user.findFirst({
      where: { id: dealerId, accountType: 'DEALER', status: 'ACTIVE', deletedAt: null },
      select: {
        id: true,
        name: true,
        businessName: true,
        avatarUrl: true,
        isVerified: true,
        city: true,
        country: true,
        fiscalAddress: true,
        businessHours: true,
        bio: true,
        taxId: true,
        createdAt: true,
        planCode: true,
        planCycle: true,
        planExpiresAt: true,
      },
    });
    if (!dealer) throw AppError.notFound('DEALER_NOT_FOUND', 'Concesionario no encontrado.');

    const visible = { sellerId: dealerId, status: { in: ['PUBLISHED', 'RESERVED'] as Array<'PUBLISHED' | 'RESERVED'> }, deletedAt: null };
    const [ally, rating, activeListings, reservationSales, directSales, vehicles, reviews, following, minutes] = await Promise.all([
      prisma.user.count({ where: { id: dealerId, ...ALLY_WHERE } }),
      prisma.sellerReview.aggregate({ where: { sellerId: dealerId }, _avg: { rating: true }, _count: { _all: true } }),
      prisma.vehicle.count({ where: visible }),
      prisma.cartReserve.count({ where: { sellerId: dealerId, type: 'RESERVATION', status: 'COMPLETED' } }),
      prisma.vehicleSale.count({ where: { sellerId: dealerId, status: 'COMPLETED' } }),
      prisma.vehicle.findMany({ where: visible, select: cardSelect, orderBy: [{ featuredUntil: { sort: 'desc', nulls: 'last' } }, { publishedAt: 'desc' }], take: MAX_VEHICLES }),
      prisma.sellerReview.findMany({
        where: { sellerId: dealerId },
        select: {
          id: true,
          rating: true,
          comment: true,
          createdAt: true,
          buyer: { select: { name: true } },
          reservation: { select: { vehicle: { select: { make: true, model: true, year: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: MAX_REVIEWS,
      }),
      viewerId ? prisma.dealerFollow.count({ where: { dealerId, userId: viewerId } }) : Promise.resolve(0),
      responseMinutes(dealerId),
    ]);

    const name = dealer.businessName ?? dealer.name;
    // Igual que en la ficha: RIF y dirección fiscal públicos solo con un plan de concesionario vigente.
    const plan = effectivePlan(dealer).code;
    const fiscalVisible = plan !== 'FREE' && PLAN_ACCOUNT_TYPE[plan as PaidPlanCode] === 'DEALER';
    const reviewList: DealerPageReviewDTO[] = reviews.map(review => ({
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      buyer: shortName(review.buyer.name),
      vehicleTitle: `${review.reservation.vehicle.make} ${review.reservation.vehicle.model} ${review.reservation.vehicle.year}`,
      createdAt: review.createdAt.toISOString(),
    }));
    // Los destacados vigentes van primero; el orden de la base ya los pone arriba si siguen activos.
    const cards = vehicles.map(toCardDTO).sort((a, b) => Number(b.isFeatured) - Number(a.isFeatured));

    return {
      id: dealer.id,
      name,
      initials: dealerInitials(name),
      avatarUrl: dealer.avatarUrl,
      verified: dealer.isVerified,
      ally: ally > 0,
      city: dealer.city,
      country: dealer.country,
      address: fiscalVisible ? dealer.fiscalAddress : null,
      hours: dealer.businessHours,
      bio: dealer.bio,
      taxId: fiscalVisible ? dealer.taxId : null,
      memberSince: dealer.createdAt.toISOString(),
      ratingAverage: rating._avg.rating,
      ratingCount: rating._count._all,
      activeListings,
      soldCount: reservationSales + directSales,
      responseMinutes: minutes,
      following: following > 0,
      isOwner: viewerId === dealer.id,
      vehicles: cards,
      reviews: reviewList,
    };
  },
};
