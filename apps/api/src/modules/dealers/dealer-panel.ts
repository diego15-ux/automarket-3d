import { usdText } from '@automarket/contracts';
import { PLAN_LABELS, type DealerDashboardDTO, type DealerInventoryItemDTO, type DealerTipDTO } from '@automarket/contracts';
import { AppError } from '../../shared/errors/app-error.js';
import { prisma } from '../../shared/infra/prisma.js';
import { effectivePlan } from '../../shared/membership.js';
import { addDays as addLocalDays, localDay, toDbDate } from '../boosts/boost-calendar.js';
import { getPlan } from '../memberships/plans.js';
import { vehicleInsights } from '../vehicles/vehicles.insights.js';

/**
 * Panel del concesionario con datos reales: vistas contadas por día (vehicle_view_days),
 * contactos = conversaciones que abren los compradores, reservas, inventario con su precio
 * comparado contra autos parecidos de AutoMarket y sugerencias con reglas (sin IA).
 */
const DAY_MS = 86_400_000;
const TZ = '-04:00';
const STALE_DAYS = 45;
const MAX_PRICE_CHECKS = 30;
const title = (v: { make: string; model: string; version: string | null; year: number }) => [v.make, v.model, v.version, v.year].filter(Boolean).join(' ');
const usd = (value: number) => usdText(value);

export const dealerPanel = {
  async dashboard(userId: string): Promise<DealerDashboardDTO> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, businessName: true, taxId: true, isVerified: true, accountType: true, city: true, planCode: true, planCycle: true, planExpiresAt: true, featureCreditMonth: true },
    });
    if (!user) throw AppError.notFound('USER_NOT_FOUND', 'Cuenta no encontrada.');
    if (user.accountType !== 'DEALER') throw AppError.forbidden('DEALER_ONLY', 'El panel es para cuentas de concesionario.');
    const now = new Date();
    const today = localDay(now);
    const current = effectivePlan(user, now);
    const plan = await getPlan(current.code);
    const first = addLocalDays(today, -13);
    const prevStart = addLocalDays(today, -13);
    const weekStart = addLocalDays(today, -6);

    const vehicles = await prisma.vehicle.findMany({
      where: { sellerId: userId, deletedAt: null, status: { in: ['PUBLISHED', 'RESERVED', 'PAUSED'] } },
      orderBy: { publishedAt: 'desc' },
      select: {
        id: true,
        slug: true,
        make: true,
        model: true,
        version: true,
        year: true,
        mileageKm: true,
        transmission: true,
        price: true,
        status: true,
        category: true,
        publishedAt: true,
        createdAt: true,
        featuredUntil: true,
        media: { where: { kind: 'IMAGE' }, orderBy: { position: 'asc' }, take: 1, select: { url: true } },
      },
    });
    const ids = vehicles.map(v => v.id);

    const [viewTotals, viewDays, contactTotals, contactDays, firstView, activeReservations, pendingReservations, conversations, unread] = await Promise.all([
      ids.length ? prisma.vehicleViewDay.groupBy({ by: ['vehicleId'], where: { vehicleId: { in: ids } }, _sum: { views: true } }) : [],
      prisma.$queryRaw<Array<{ d: Date; views: unknown }>>`
        SELECT vd.day AS d, SUM(vd.views) AS views FROM vehicle_view_days vd JOIN vehicles v ON v.id = vd.vehicleId
        WHERE v.sellerId = ${userId} AND vd.day >= ${toDbDate(first)} GROUP BY vd.day`,
      ids.length ? prisma.conversation.groupBy({ by: ['vehicleId'], where: { vehicleId: { in: ids } }, _count: { _all: true } }) : [],
      prisma.$queryRaw<Array<{ d: string; n: bigint }>>`
        SELECT DATE_FORMAT(CONVERT_TZ(createdAt, '+00:00', ${TZ}), '%Y-%m-%d') AS d, COUNT(*) AS n FROM conversations
        WHERE sellerId = ${userId} AND createdAt >= ${new Date(`${prevStart}T00:00:00${TZ}`)} GROUP BY d`,
      prisma.$queryRaw<Array<{ d: Date | null }>>`
        SELECT MIN(vd.day) AS d FROM vehicle_view_days vd JOIN vehicles v ON v.id = vd.vehicleId WHERE v.sellerId = ${userId}`,
      prisma.cartReserve.count({ where: { sellerId: userId, type: 'RESERVATION', status: 'ACCEPTED' } }),
      prisma.cartReserve.count({ where: { sellerId: userId, type: 'RESERVATION', status: 'AWAITING_SELLER' } }),
      prisma.conversation.findMany({
        where: { sellerId: userId, lastMessageAt: { not: null } },
        orderBy: { lastMessageAt: 'desc' },
        take: 4,
        select: {
          id: true,
          lastMessageAt: true,
          sellerLastReadAt: true,
          buyerId: true,
          buyer: { select: { name: true } },
          vehicle: { select: { make: true, model: true, version: true, year: true } },
          messages: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1, select: { body: true, type: true, senderId: true, createdAt: true } },
        },
      }),
      prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(DISTINCT c.id) AS n FROM conversations c JOIN chat_messages m ON m.conversationId = c.id
        WHERE c.sellerId = ${userId} AND m.senderId <> ${userId} AND m.deletedAt IS NULL AND m.createdAt > COALESCE(c.sellerLastReadAt, '1970-01-01')`,
    ]);

    // ── Serie de 14 días y semanas para los indicadores
    const viewsByDay = new Map(viewDays.map(row => [row.d.toISOString().slice(0, 10), Number(row.views)]));
    const contactsByDay = new Map(contactDays.map(row => [row.d, Number(row.n)]));
    const series = Array.from({ length: 14 }, (_, i) => {
      const day = addLocalDays(first, i);
      return { day, views: viewsByDay.get(day) ?? 0, contacts: contactsByDay.get(day) ?? 0 };
    });
    const sum = (rows: typeof series, key: 'views' | 'contacts') => rows.reduce((total, row) => total + row[key], 0);
    const week = series.filter(row => row.day >= weekStart);
    const previous = series.filter(row => row.day < weekStart);

    // ── Inventario
    const viewsOf = new Map(viewTotals.map(row => [row.vehicleId, row._sum.views ?? 0]));
    const contactsOf = new Map(contactTotals.map(row => [row.vehicleId, row._count._all]));
    // Precio contra el mercado: de 5 en 5 a la vez (no satura la base ni espera uno por uno).
    const insights: Array<Awaited<ReturnType<typeof vehicleInsights>> | null> = [];
    const checked = vehicles.slice(0, MAX_PRICE_CHECKS);
    for (let start = 0; start < checked.length; start += 5) {
      insights.push(
        ...(await Promise.all(
          checked.slice(start, start + 5).map(v => vehicleInsights({ make: v.make, model: v.model, year: v.year, mileageKm: v.mileageKm, transmission: v.transmission, excludeId: v.id })),
        )),
      );
    }
    const inventory: DealerInventoryItemDTO[] = [];
    for (const [i, v] of vehicles.entries()) {
      let priceCheck: DealerInventoryItemDTO['priceCheck'] = null;
      const insight = insights[i] ?? null;
      if (insight) {
        if (insight.market) {
          const diffPct = Math.round((Number(v.price) / insight.market.value - 1) * 100);
          priceCheck = { level: diffPct <= -5 ? 'GOOD' : diffPct >= 5 ? 'HIGH' : 'FAIR', diffPct, market: insight.market.value, sample: insight.market.sample };
        }
      }
      const since = v.publishedAt ?? v.createdAt;
      inventory.push({
        id: v.id,
        slug: v.slug,
        title: title(v),
        make: v.make,
        model: v.model,
        year: v.year,
        mileageKm: v.mileageKm,
        manual: v.transmission === 'MANUAL',
        price: Number(v.price),
        status: v.status === 'PUBLISHED' ? 'ACTIVE' : v.status === 'RESERVED' ? 'RESERVED' : 'PAUSED',
        views: viewsOf.get(v.id) ?? 0,
        contacts: contactsOf.get(v.id) ?? 0,
        days: Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY_MS)),
        category: v.category,
        coverUrl: v.media[0]?.url ?? null,
        featuredDaysLeft: v.featuredUntil && v.featuredUntil > now ? Math.max(1, Math.ceil((v.featuredUntil.getTime() - now.getTime()) / DAY_MS)) : null,
        priceCheck,
      });
    }
    const activeListings = inventory.filter(item => item.status !== 'PAUSED').length;
    const featuredInUse = inventory.filter(item => item.featuredDaysLeft !== null).length;
    const month = now.toISOString().slice(0, 7);
    const creditUsedThisMonth = plan.monthlyFeaturedCredits > 0 && user.featureCreditMonth === month;

    // ── Sugerencias con reglas sobre los datos de arriba
    const tips: DealerTipDTO[] = [];
    const stale = inventory.filter(item => item.status === 'ACTIVE' && item.days > STALE_DAYS);
    if (stale.length) {
      tips.push({ kind: 'STALE', count: stale.length, text: `${stale.length === 1 ? '1 auto lleva' : `${stale.length} autos llevan`} más de ${STALE_DAYS} días publicado${stale.length === 1 ? '' : 's'}. Revisa su precio y sus fotos.` });
    }
    const high = inventory.filter(item => item.status === 'ACTIVE' && item.priceCheck?.level === 'HIGH').sort((a, b) => b.priceCheck!.diffPct - a.priceCheck!.diffPct)[0];
    if (high?.priceCheck) {
      tips.push({
        kind: 'PRICE',
        vehicleId: high.id,
        title: `${high.model} ${high.year}`,
        suggestedPrice: Math.round(high.priceCheck.market / 100) * 100,
        text: `Tu ${high.model} ${high.year} está ${high.priceCheck.diffPct} % arriba de ${high.priceCheck.sample} autos parecidos en AutoMarket. Precio sugerido: ${usd(Math.round(high.priceCheck.market / 100) * 100)}.`,
      });
    }
    const slotsLeft = plan.featuredSlots - featuredInUse;
    const canFeature = slotsLeft > 0 && !creditUsedThisMonth;
    const candidates = inventory.filter(item => item.status === 'ACTIVE' && item.featuredDaysLeft === null && item.views >= 20);
    const best = candidates.sort((a, b) => b.contacts / b.views - a.contacts / a.views)[0];
    if (canFeature && best && best.contacts > 0) {
      tips.push({
        kind: 'FEATURE',
        vehicleId: best.id,
        title: `${best.model}`,
        text: `Te ${slotsLeft === 1 ? 'queda 1 destacado' : `quedan ${slotsLeft} destacados`} del plan. El ${best.model} ${best.year} es el que más contactos recibe por vista.`,
      });
    }

    return {
      dealer: {
        id: user.id,
        name: user.businessName ?? user.name,
        taxId: user.taxId,
        verified: user.isVerified,
        planCode: current.code,
        planName: PLAN_LABELS[current.code],
        city: user.city,
        planExpiresAt: current.expiresAt,
        commissionRate: plan.commissionRate.toNumber(),
      },
      today,
      viewsSince: firstView[0]?.d ? firstView[0].d.toISOString().slice(0, 10) : null,
      badges: { activeListings, unreadMessages: Number(unread[0]?.n ?? 0), pendingReservations },
      kpis: { views7: sum(week, 'views'), viewsPrev7: sum(previous, 'views'), contacts7: sum(week, 'contacts'), contactsPrev7: sum(previous, 'contacts'), activeReservations, activeListings, maxListings: plan.maxActiveListings },
      series,
      inventory,
      contacts: conversations.map(c => {
        const last = c.messages[0];
        return {
          conversationId: c.id,
          buyerName: c.buyer.name,
          vehicleTitle: title(c.vehicle),
          lastMessage: last ? (last.type === 'TEXT' ? last.body : last.type === 'IMAGE' ? 'Envió una foto' : last.type === 'VIDEO' ? 'Envió un vídeo' : last.type === 'AUDIO' ? 'Envió una nota de voz' : 'Mensaje') : null,
          at: (c.lastMessageAt ?? last?.createdAt ?? now).toISOString(),
          unread: !!last && last.senderId !== userId && (!c.sellerLastReadAt || c.sellerLastReadAt < last.createdAt),
        };
      }),
      plan: { featuredSlots: plan.featuredSlots, featuredInUse, monthlyCredits: plan.monthlyFeaturedCredits, creditUsedThisMonth },
      tips,
    };
  },
};
