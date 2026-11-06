import { UserReportSchema, type SellerProfileDTO, type SellerRatingOpportunityDTO } from '@automarket/contracts';
import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error.js';
import { authenticate, currentUser } from '../../shared/http/middlewares/auth.middleware.js';
import { isUniqueViolation, prisma } from '../../shared/infra/prisma.js';
import { rateLimit } from '../../shared/http/middlewares/rate-limit.js';
import { validateBody } from '../../shared/http/middlewares/validate.js';
import { assertNoBlockedTerms } from '../../shared/moderation/blocklist.js';
import { kycRepository } from '../kyc/kyc.repository.js';
import { cardSelect, toCardDTO } from '../vehicles/vehicles.mapper.js';

const UserIdParams = z.object({ id: z.uuid() });

export const usersRouter = Router();

usersRouter.get('/:id/profile', async (req, res) => {
  const { id } = UserIdParams.parse(req.params);
  await kycRepository.invalidateExpiredIdentity(id);
  const user = await prisma.user.findFirst({
    where: { id, status: 'ACTIVE', deletedAt: null },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      bio: true,
      city: true,
      country: true,
      createdAt: true,
      accountType: true,
      isVerified: true,
      businessName: true,
    },
  });
  if (!user) throw AppError.notFound('USER_NOT_FOUND', 'Vendedor no encontrado.');

  const [rating, byStars, soldCount, vehicles] = await Promise.all([
    prisma.sellerReview.aggregate({ where: { sellerId: id }, _avg: { rating: true }, _count: { _all: true } }),
    prisma.sellerReview.groupBy({ by: ['rating'], where: { sellerId: id }, _count: { _all: true } }),
    prisma.cartReserve.count({ where: { sellerId: id, type: 'RESERVATION', status: 'COMPLETED' } }),
    // Publicados y reservados (con su estado: «Reservado» o «En negociación»).
    prisma.vehicle.findMany({
      where: { sellerId: id, status: { in: ['PUBLISHED', 'RESERVED'] }, deletedAt: null },
      select: cardSelect,
      orderBy: { publishedAt: 'desc' },
      take: 48,
    }),
  ]);
  const stars = (n: number) => byStars.find(row => row.rating === n)?._count._all ?? 0;
  const profile: SellerProfileDTO = {
    id: user.id,
    name: user.name,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    city: user.city,
    country: user.country,
    memberSince: user.createdAt.toISOString(),
    accountType: user.accountType,
    isVerified: user.isVerified,
    dealerName: user.accountType === 'DEALER' ? user.businessName : null,
    ratingAverage: rating._avg.rating,
    ratingCount: rating._count._all,
    ratingDistribution: [stars(5), stars(4), stars(3), stars(2), stars(1)],
    soldCount,
    vehicles: vehicles.map(toCardDTO),
  };
  res.json({ data: profile });
});

usersRouter.get('/:id/rating-opportunities', authenticate, async (req, res) => {
  const { id } = UserIdParams.parse(req.params);
  const reservations = await prisma.cartReserve.findMany({
    where: {
      buyerId: currentUser(req).id,
      sellerId: id,
      type: 'RESERVATION',
      status: 'COMPLETED',
    },
    select: {
      id: true,
      completedAt: true,
      sellerReview: { select: { rating: true, comment: true } },
      vehicle: { select: { make: true, model: true, year: true } },
    },
    orderBy: { completedAt: 'desc' },
    take: 100,
  });
  const opportunities: SellerRatingOpportunityDTO[] = reservations.flatMap(reservation =>
    reservation.completedAt
      ? [{
          reservationId: reservation.id,
          vehicleTitle: `${reservation.vehicle.make} ${reservation.vehicle.model} ${reservation.vehicle.year}`,
          completedAt: reservation.completedAt.toISOString(),
          rating: reservation.sellerReview?.rating ?? null,
          comment: reservation.sellerReview?.comment ?? null,
        }]
      : [],
  );
  res.json({ data: opportunities });
});

// Denuncias de perfiles: máximo 10 por usuario y hora.
const reportLimiter = rateLimit({ name: 'user-report', windowMs: 60 * 60_000, max: 10, key: req => currentUser(req).id });

/** Denuncia anónima de un perfil (la revisa el equipo en Moderación). */
usersRouter.post('/:id/report', authenticate, reportLimiter, validateBody(UserReportSchema), async (req, res) => {
  const { id } = UserIdParams.parse(req.params);
  const reporterId = currentUser(req).id;
  const input = req.body as z.infer<typeof UserReportSchema>;
  if (id === reporterId) throw AppError.badRequest('OWN_PROFILE', 'No puedes denunciar tu propio perfil.');
  await assertNoBlockedTerms({ details: input.details });
  const target = await prisma.user.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!target) throw AppError.notFound('USER_NOT_FOUND', 'Perfil no encontrado.');
  try {
    await prisma.report.create({ data: { kind: 'USER', reportedUserId: id, reporterId, dedupeKey: `U:${id}:${reporterId}`, reason: input.reason, details: input.details ?? null } });
  } catch (err) {
    if (isUniqueViolation(err)) throw AppError.conflict('ALREADY_REPORTED', 'Ya denunciaste este perfil; el equipo lo está revisando.');
    throw err;
  }
  res.status(201).json({ data: { message: 'Denuncia enviada. El equipo revisa cada caso.' } });
});
