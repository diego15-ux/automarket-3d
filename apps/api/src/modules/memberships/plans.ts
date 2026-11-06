import type { PlanDTO, PublicSettingsDTO, TermsDTO } from '@automarket/contracts';
import type { Plan } from '../../generated/prisma/client.js';
import type { PlanCode } from '../../generated/prisma/enums.js';
import { AppError } from '../../shared/errors/app-error.js';
import { prisma, type Db } from '../../shared/infra/prisma.js';
import { DEFAULT_TERMS } from '../../shared/legal/default-terms.js';
import { parseSocialLinks } from '../../shared/platform-config.js';

export const toPlanDTO = (plan: Plan): PlanDTO => ({
  code: plan.code,
  name: plan.name,
  accountType: plan.accountType,
  maxActiveListings: plan.maxActiveListings,
  listingDurationDays: plan.listingDurationDays,
  commissionRate: plan.commissionRate.toNumber(),
  featuredSlots: plan.featuredSlots,
  monthlyFeaturedCredits: plan.monthlyFeaturedCredits,
  searchBoost: plan.searchBoost,
  priceMonthly: plan.priceMonthly.toNumber(),
  priceYearly: plan.priceYearly.toNumber(),
  currency: plan.currency,
});

export async function getPlan(code: PlanCode, db: Db = prisma): Promise<Plan> {
  const plan = await db.plan.findUnique({ where: { code } });
  if (!plan) throw new AppError(500, 'PLAN_MISSING', `El plan ${code} no existe: ejecuta el seed de planes.`);
  return plan;
}

export const listPlans = async () => (await prisma.plan.findMany({ orderBy: { priceMonthly: 'asc' } })).map(toPlanDTO);

/** Ajustes globales (fila única). */
export async function getSettings(db: Db = prisma) {
  return db.platformSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

type Settings = Awaited<ReturnType<typeof getSettings>>;

/** Lo que ve cualquiera: plazos de las reservas, fondo del login, foto de la portada y redes sociales. */
export const toPublicSettings = (settings: Settings): PublicSettingsDTO => ({
  sellerResponseHours: settings.sellerResponseHours,
  reservationHoldDays: settings.reservationHoldDays,
  commissionDueDays: settings.commissionDueDays,
  loginBackgroundUrl: settings.loginBackgroundUrl,
  homeHeroUrl: settings.homeHeroUrl,
  socialLinks: parseSocialLinks(settings.socialLinks),
});

/** Términos vigentes: los del panel o, si aún no se editaron, los iniciales. */
export const toTerms = (settings: Settings): TermsDTO => ({
  content: settings.termsContent ?? DEFAULT_TERMS,
  updatedAt: settings.termsUpdatedAt?.toISOString() ?? null,
});
