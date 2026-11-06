import type { AdminCopilotDTO, CopilotMonthDTO, ReportCaseReason, StatsBucketDTO } from '@automarket/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../shared/infra/prisma.js';
import { addDays, HOME_ZONE, localDay } from '../boosts/boost-calendar.js';
import { boostCalendar, boostsService } from '../boosts/boosts.service.js';
import { dealersService } from '../dealers/dealers.service.js';
import { adminReports } from './admin.reports.js';
import { cachedAdminStats } from './admin.stats.js';

/**
 * Copiloto del admin: junta las series de Estadísticas con desgloses y alertas que se calculan con
 * reglas sobre la base. Solo lee; las decisiones se toman en cada pantalla del panel.
 */
const TZ = '-04:00';
const CATEGORY_LABEL: Record<string, string> = { SUV: 'SUV', SEDAN: 'Sedán', PICKUP: 'Pickup', HATCHBACK: 'Hatchback', ELECTRIC: 'Eléctrico', SPORTS: 'Deportivo', CONVERTIBLE: 'Convertible' };
const BOOST_LABEL: Record<string, string> = { CITY_3D: 'Impulso de 3 días', CITY_7D: 'Semana destacada', HOME: 'Portada' };
const PLAN_LABEL: Record<string, string> = { PREMIUM: 'Premium', DEALER_BASIC: 'Concesionario Básico', DEALER_PRO: 'Concesionario Pro' };
const REASONS: ReportCaseReason[] = ['FRAUD', 'OFFENSIVE', 'WRONG_INFO', 'SPAM', 'OTHER'];
const num = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));
const monthSql = (column: Prisma.Sql) => Prisma.sql`DATE_FORMAT(CONVERT_TZ(${column}, '+00:00', ${TZ}), '%Y-%m')`;
const displayName = (u: { name: string; businessName: string | null; accountType: string }) => (u.accountType === 'DEALER' && u.businessName ? u.businessName : u.name);

function top(values: string[], limit = 7, other = 'Otras'): StatsBucketDTO[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));
  const head = sorted.slice(0, limit).map(([label, value]) => ({ label, value }));
  const rest = sorted.slice(limit).reduce((sum, [, value]) => sum + value, 0);
  return rest > 0 ? [...head, { label: other, value: rest }] : head;
}

type SaleRow = { m: string; make: string; city: string; category: string; value: unknown; sellerId: string; dealer: unknown };

export async function adminCopilot(adminId: string, now = new Date()): Promise<AdminCopilotDTO> {
  const stats = await cachedAdminStats();
  const keys = stats.months.map(month => month.key);
  const from = new Date(`${keys[0]}-01T00:00:00${TZ}`);
  const lastComplete = keys.at(-2)!;

  // ── Ventas de cada mes con marca, ciudad, tipo y vendedor
  const sales = await prisma.$queryRaw<SaleRow[]>`
    SELECT ${monthSql(Prisma.sql`cr.completedAt`)} AS m, v.make, v.city, v.category, COALESCE(cr.salePrice, v.price) AS value, v.sellerId, (u.accountType = 'DEALER') AS dealer
    FROM cart_reserves cr JOIN vehicles v ON v.id = cr.vehicleId JOIN users u ON u.id = v.sellerId
    WHERE cr.type = 'RESERVATION' AND cr.status = 'COMPLETED' AND cr.completedAt >= ${from}
    UNION ALL
    SELECT ${monthSql(Prisma.sql`vs.completedAt`)} AS m, v.make, v.city, v.category, vs.salePrice AS value, v.sellerId, (u.accountType = 'DEALER') AS dealer
    FROM vehicle_sales vs JOIN vehicles v ON v.id = vs.vehicleId JOIN users u ON u.id = v.sellerId
    WHERE vs.status = 'COMPLETED' AND vs.completedAt >= ${from}`;
  const directory = await dealersService.directory(null);
  const dealerById = new Map(directory.map(dealer => [dealer.id, dealer]));
  const months: CopilotMonthDTO[] = keys.map(key => {
    const rows = sales.filter(row => row.m === key);
    const byCategory = new Map<string, { count: number; total: number }>();
    for (const row of rows) {
      const entry = byCategory.get(row.category) ?? { count: 0, total: 0 };
      entry.count++;
      entry.total += num(row.value);
      byCategory.set(row.category, entry);
    }
    const soldBy = new Map<string, number>();
    for (const row of rows) if (Number(row.dealer) === 1) soldBy.set(row.sellerId, (soldBy.get(row.sellerId) ?? 0) + 1);
    return {
      brands: top(rows.map(row => row.make)),
      cities: top(rows.map(row => row.city), 6),
      categories: [...byCategory]
        .map(([category, entry]) => ({ label: CATEGORY_LABEL[category] ?? category, count: entry.count, avgPrice: Math.round(entry.total / entry.count) }))
        .sort((a, b) => b.count - a.count),
      dealers: [...soldBy]
        .map(([id, sold]) => ({ dealer: dealerById.get(id), sold }))
        .filter(entry => entry.dealer)
        .sort((a, b) => b.sold - a.sold || a.dealer!.name.localeCompare(b.dealer!.name, 'es'))
        .slice(0, 5)
        .map(({ dealer, sold }) => ({ name: dealer!.name, city: dealer!.city, planCode: dealer!.planCode, sold, rating: dealer!.ratingAverage === null ? null : Math.round(dealer!.ratingAverage * 10) / 10 })),
    };
  });

  // ── Países: cuentas y concesionarios verificados
  const [usersByCountry, dealersByCountry] = await Promise.all([
    prisma.user.groupBy({ by: ['country'], where: { role: 'USER', deletedAt: null }, _count: { _all: true } }),
    prisma.user.groupBy({ by: ['country'], where: { role: 'USER', deletedAt: null, accountType: 'DEALER', isVerified: true }, _count: { _all: true } }),
  ]);
  const countries = usersByCountry
    .map(row => ({ code: row.country, users: row._count._all, dealers: dealersByCountry.find(d => d.country === row.country)?._count._all ?? 0 }))
    .sort((a, b) => b.users - a.users || b.dealers - a.dealers);

  // ── Precios de los planes pagos
  const planRows = await prisma.plan.findMany({ where: { code: { in: ['PREMIUM', 'DEALER_BASIC', 'DEALER_PRO'] } } });
  const plans = (['PREMIUM', 'DEALER_BASIC', 'DEALER_PRO'] as const).flatMap(code => {
    const row = planRows.find(plan => plan.code === code);
    return row ? [{ code, name: PLAN_LABEL[code]!, monthly: num(row.priceMonthly), yearly: num(row.priceYearly) }] : [];
  });

  // ── Reportes abiertos (casos agrupados, como en la bandeja)
  const board = await adminReports.board('OPEN');
  const byReason = Object.fromEntries(REASONS.map(reason => [reason, 0])) as Record<ReportCaseReason, number>;
  for (const item of board.items) byReason[item.reason]++;
  const fraud = board.items
    .filter(item => item.reason === 'FRAUD')
    .map(item => ({
      code: item.code,
      title: item.vehicle?.title ?? item.title,
      price: item.vehicle ? Number(item.vehicle.price) : null,
      diffPct: item.vehicle?.market?.diffPct ?? null,
      details: item.details,
      count: item.count,
    }));

  // ── Anuncios repetidos: mismo vendedor, marca, modelo, año y kilometraje
  const repeated = await prisma.$queryRaw<Array<{ sellerId: string; make: string; model: string; year: number; n: bigint }>>`
    SELECT sellerId, make, model, year, COUNT(*) AS n FROM vehicles
    WHERE deletedAt IS NULL AND status IN ('PUBLISHED', 'RESERVED', 'PAUSED')
    GROUP BY sellerId, make, model, year, mileageKm HAVING COUNT(*) >= 2 ORDER BY n DESC LIMIT 5`;
  const sellers = repeated.length
    ? await prisma.user.findMany({ where: { id: { in: repeated.map(row => row.sellerId) } }, select: { id: true, name: true, businessName: true, accountType: true } })
    : [];
  const duplicates = repeated.map(row => {
    const seller = sellers.find(user => user.id === row.sellerId);
    return { seller: seller ? displayName(seller) : 'Un vendedor', title: `${row.make} ${row.model} ${row.year}`, count: num(row.n) };
  });

  // ── Pagos por verificar (Binance manual)
  const pending = await prisma.payment.findMany({
    where: { status: 'SUBMITTED' },
    orderBy: { submittedAt: 'asc' },
    take: 50,
    select: { purpose: true, amount: true, planCode: true, cycle: true, boost: { select: { kind: true, days: true } } },
  });
  const conceptOf = (p: (typeof pending)[number]) => {
    if (p.purpose === 'MEMBERSHIP') return `${PLAN_LABEL[p.planCode ?? ''] ?? 'Plan'} ${p.cycle === 'YEARLY' ? 'anual' : 'mensual'}`;
    if (p.purpose === 'BOOST' && p.boost) {
      if (p.boost.kind === 'LOGIN') return p.boost.days === 1 ? '1 día en la pantalla de entrada' : `${p.boost.days} días en la pantalla de entrada`;
      return BOOST_LABEL[p.boost.kind] ?? 'Destacado';
    }
    if (p.purpose === 'COMMISSION') return 'Comisión por venta';
    return 'Abono de reserva';
  };
  const payments = {
    count: pending.length,
    total: Math.round(pending.reduce((sum, p) => sum + num(p.amount), 0) * 100) / 100,
    items: pending.map(p => ({ concept: conceptOf(p), amount: num(p.amount) })),
  };

  // ── KYC, pantalla de entrada de mañana y Portada
  const kycPending = await prisma.kycDocument.findMany({ where: { status: 'PENDING' }, distinct: ['userId'], select: { userId: true } });
  const spots = await boostsService.loginSpots();
  const tomorrow = addDays(localDay(now), 1);
  const settings = await prisma.platformSettings.findUnique({ where: { id: 1 }, select: { homeBoostSlots: true } });
  const homeUsage = (await boostCalendar.zoneUsage(prisma, [HOME_ZONE], now)).get(HOME_ZONE)!;

  // ── Verificación de las cuentas nuevas del último mes completo
  const [cohort] = await prisma.$queryRaw<Array<{ created: bigint; verified: unknown }>>`
    SELECT COUNT(*) AS created, SUM(verifiedAt IS NOT NULL) AS verified FROM users
    WHERE role = 'USER' AND deletedAt IS NULL AND ${monthSql(Prisma.sql`createdAt`)} = ${lastComplete}`;

  // ── Concesionarios en Básico que ya venden cada semana o llenan su cupo
  const basicLimit = planRows.find(plan => plan.code === 'DEALER_BASIC')?.maxActiveListings ?? null;
  const lastIndex = keys.length - 2;
  const soldLast = new Map<string, number>();
  for (const row of sales) if (row.m === keys[lastIndex] && Number(row.dealer) === 1) soldLast.set(row.sellerId, (soldLast.get(row.sellerId) ?? 0) + 1);
  const upsell = directory
    .filter(dealer => dealer.planCode === 'DEALER_BASIC')
    .map(dealer => ({ name: dealer.name, listings: dealer.activeListings, soldLastMonth: soldLast.get(dealer.id) ?? 0 }))
    .filter(dealer => dealer.soldLastMonth >= 4 || (basicLimit !== null && dealer.listings >= Math.ceil(basicLimit * 0.8)))
    .sort((a, b) => b.soldLastMonth - a.soldLastMonth || b.listings - a.listings)
    .slice(0, 5);

  const admin = await prisma.user.findUnique({ where: { id: adminId }, select: { name: true } });
  const localHour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Caracas' }).format(now));

  return {
    adminName: admin?.name.split(' ')[0] ?? '',
    localHour,
    stats,
    months,
    countries,
    plans,
    reports: { open: board.items.length, byReason, fraud },
    duplicates,
    payments,
    kyc: { pending: kycPending.length },
    login: { date: tomorrow, used: spots.days.find(day => day.date === tomorrow)?.used ?? 0, slots: spots.slots },
    home: { used: homeUsage.active + homeUsage.queued, slots: settings?.homeBoostSlots ?? 10 },
    verification: { created: num(cohort?.created), verified: num(cohort?.verified) },
    upsell,
  };
}
