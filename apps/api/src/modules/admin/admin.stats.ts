import type { AdminStatsDTO, StatsBucketDTO } from '@automarket/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../shared/infra/prisma.js';
import { localDay } from '../boosts/boost-calendar.js';
import { cached } from '../../shared/utils/cached.js';
import { dealersService } from '../dealers/dealers.service.js';

/**
 * Estadísticas del panel con datos reales, por mes de Venezuela (UTC-4): ventas (reservas
 * concretadas + ventas directas con comisión), reservas, inventario, cuentas, ingresos del libro
 * contable y concesionarios. Los «activos al cierre» de meses pasados son una aproximación (no
 * hay fotos históricas): anuncios creados y publicados antes del cierre, sin retirar ni vender.
 */
const TZ = '-04:00';
const MONTHS = 6;
const CATEGORY_LABEL: Record<string, string> = { SUV: 'SUV', SEDAN: 'Sedán', PICKUP: 'Pickup', HATCHBACK: 'Hatchback', ELECTRIC: 'Eléctrico', SPORTS: 'Deportivo', CONVERTIBLE: 'Convertible' };

const monthSql = (column: Prisma.Sql) => Prisma.sql`DATE_FORMAT(CONVERT_TZ(${column}, '+00:00', ${TZ}), '%Y-%m')`;
const num = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));

function monthKeys(now = new Date()) {
  const [year, month] = localDay(now).split('-').map(Number) as [number, number];
  const keys: string[] = [];
  for (let offset = MONTHS - 1; offset >= 0; offset--) {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1));
    keys.push(date.toISOString().slice(0, 7));
  }
  return keys;
}
const startOf = (key: string) => new Date(`${key}-01T00:00:00${TZ}`);
const endOf = (key: string) => {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return new Date(`${new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7)}-01T00:00:00${TZ}`);
};

/** Agrupa filas «etiqueta» en los 6 más frecuentes + «Otras». */
function top(values: string[], limit = 6, other = 'Otras'): StatsBucketDTO[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));
  const head = sorted.slice(0, limit).map(([label, value]) => ({ label, value }));
  const rest = sorted.slice(limit).reduce((sum, [, value]) => sum + value, 0);
  return rest > 0 ? [...head, { label: other, value: rest }] : head;
}

type SaleRow = { m: string; make: string; city: string; value: unknown; days: unknown; dealer: number; sellerId: string };

export async function adminStats(now = new Date()): Promise<AdminStatsDTO> {
  const keys = monthKeys(now);
  const from = startOf(keys[0]!);
  const lastComplete = keys[MONTHS - 2]!;
  const ends = keys.map((key, index) => (index === MONTHS - 1 ? now : endOf(key)));
  const index = new Map(keys.map((key, i) => [key, i]));
  const blank = <T>(make: () => T) => keys.map(() => make());

  // ── Ventas: reservas concretadas + ventas directas confirmadas
  const sales = await prisma.$queryRaw<SaleRow[]>`
    SELECT ${monthSql(Prisma.sql`cr.completedAt`)} AS m, v.make, v.city, COALESCE(cr.salePrice, v.price) AS value,
      GREATEST(0, TIMESTAMPDIFF(HOUR, v.publishedAt, cr.completedAt)) / 24 AS days, (u.accountType = 'DEALER') AS dealer, v.sellerId
    FROM cart_reserves cr JOIN vehicles v ON v.id = cr.vehicleId JOIN users u ON u.id = v.sellerId
    WHERE cr.type = 'RESERVATION' AND cr.status = 'COMPLETED' AND cr.completedAt >= ${from}
    UNION ALL
    SELECT ${monthSql(Prisma.sql`vs.completedAt`)} AS m, v.make, v.city, vs.salePrice AS value,
      GREATEST(0, TIMESTAMPDIFF(HOUR, v.publishedAt, vs.completedAt)) / 24 AS days, (u.accountType = 'DEALER') AS dealer, v.sellerId
    FROM vehicle_sales vs JOIN vehicles v ON v.id = vs.vehicleId JOIN users u ON u.id = v.sellerId
    WHERE vs.status = 'COMPLETED' AND vs.completedAt >= ${from}`;
  const salesMonths = blank(() => ({ count: 0, value: 0, daysSum: 0, daysN: 0 }));
  for (const row of sales) {
    const i = index.get(row.m);
    if (i === undefined) continue;
    salesMonths[i]!.count++;
    salesMonths[i]!.value += num(row.value);
    if (row.days !== null) {
      salesMonths[i]!.daysSum += num(row.days);
      salesMonths[i]!.daysN++;
    }
  }
  const lastSales = sales.filter(row => row.m === lastComplete);

  // ── Reservas con abono (por mes en que se pidieron)
  const reservations = await prisma.$queryRaw<Array<{ m: string; n: bigint; completed: unknown; cancelled: unknown; open: unknown; deposit: unknown }>>`
    SELECT ${monthSql(Prisma.sql`createdAt`)} AS m, COUNT(*) AS n,
      SUM(status = 'COMPLETED') AS completed, SUM(status IN ('REJECTED', 'CANCELLED', 'EXPIRED')) AS cancelled,
      SUM(status IN ('ACTIVE', 'AWAITING_SELLER', 'ACCEPTED')) AS open, AVG(depositAmount) AS deposit
    FROM cart_reserves WHERE type = 'RESERVATION' AND createdAt >= ${from} GROUP BY m`;
  const purchases = blank(() => ({ reservations: 0, completed: 0, cancelled: 0, avgDeposit: null as number | null }));
  let outcome = { completed: 0, cancelled: 0, open: 0 };
  for (const row of reservations) {
    const i = index.get(row.m);
    if (i === undefined) continue;
    purchases[i] = { reservations: num(row.n), completed: num(row.completed), cancelled: num(row.cancelled), avgDeposit: row.deposit === null ? null : Math.round(num(row.deposit)) };
    if (row.m === lastComplete) outcome = { completed: num(row.completed), cancelled: num(row.cancelled), open: num(row.open) };
  }

  // ── Inventario
  const created = await prisma.$queryRaw<Array<{ m: string; n: bigint }>>`
    SELECT ${monthSql(Prisma.sql`createdAt`)} AS m, COUNT(*) AS n FROM vehicles WHERE publishedAt IS NOT NULL AND createdAt >= ${from} GROUP BY m`;
  const carsMonths = blank(() => ({ created: 0, active: 0 }));
  for (const row of created) {
    const i = index.get(row.m);
    if (i !== undefined) carsMonths[i]!.created = num(row.n);
  }
  // Los meses se consultan a la vez (antes, uno detrás de otro).
  await Promise.all(
    ends.map(async (end, i) => {
      if (i === MONTHS - 1) {
        carsMonths[i]!.active = await prisma.vehicle.count({ where: { deletedAt: null, status: { in: ['PUBLISHED', 'RESERVED'] } } });
        return;
      }
      const [row] = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(*) AS n FROM vehicles v
        WHERE v.publishedAt IS NOT NULL AND v.createdAt < ${end} AND (v.deletedAt IS NULL OR v.deletedAt >= ${end})
          AND NOT EXISTS (SELECT 1 FROM cart_reserves cr WHERE cr.vehicleId = v.id AND cr.status = 'COMPLETED' AND cr.completedAt < ${end})
          AND NOT EXISTS (SELECT 1 FROM vehicle_sales vs WHERE vs.vehicleId = v.id AND vs.status = 'COMPLETED' AND vs.completedAt < ${end})`;
      carsMonths[i]!.active = num(row?.n);
    }),
  );
  const [published, reservedAll, negotiating, activeByCategory] = await Promise.all([
    prisma.vehicle.count({ where: { deletedAt: null, status: 'PUBLISHED' } }),
    prisma.vehicle.count({ where: { deletedAt: null, status: 'RESERVED' } }),
    prisma.vehicle.count({ where: { deletedAt: null, status: 'RESERVED', negotiatingAt: { not: null } } }),
    prisma.vehicle.groupBy({ by: ['category'], where: { deletedAt: null, status: { in: ['PUBLISHED', 'RESERVED'] } }, _count: { _all: true } }),
  ]);

  // ── Cuentas (personas y concesionarios; sin el equipo)
  const users = await prisma.$queryRaw<Array<{ m: string; n: bigint }>>`
    SELECT ${monthSql(Prisma.sql`createdAt`)} AS m, COUNT(*) AS n FROM users WHERE role = 'USER' AND deletedAt IS NULL AND createdAt >= ${from} GROUP BY m`;
  const verified = await prisma.$queryRaw<Array<{ m: string; n: bigint }>>`
    SELECT ${monthSql(Prisma.sql`verifiedAt`)} AS m, COUNT(*) AS n FROM users WHERE role = 'USER' AND deletedAt IS NULL AND verifiedAt >= ${from} GROUP BY m`;
  const usersMonths = blank(() => ({ created: 0, verified: 0, total: 0 }));
  for (const row of users) {
    const i = index.get(row.m);
    if (i !== undefined) usersMonths[i]!.created = num(row.n);
  }
  for (const row of verified) {
    const i = index.get(row.m);
    if (i !== undefined) usersMonths[i]!.verified = num(row.n);
  }
  await Promise.all(
    ends.map(async (end, i) => {
      usersMonths[i]!.total = await prisma.user.count({ where: { role: 'USER', deletedAt: null, createdAt: { lt: end } } });
    }),
  );
  const byCountry = await prisma.user.groupBy({ by: ['country'], where: { role: 'USER', deletedAt: null }, _count: { _all: true } });

  // ── Ingresos (libro contable) y planes vendidos con Binance
  const ledger = await prisma.$queryRaw<Array<{ m: string; type: string; kind: string | null; total: unknown }>>`
    SELECT ${monthSql(Prisma.sql`le.occurredAt`)} AS m, le.type, b.kind, SUM(le.amount) AS total
    FROM ledger_entries le LEFT JOIN boosts b ON b.paymentId = le.paymentId
    WHERE le.occurredAt >= ${from} GROUP BY m, le.type, b.kind`;
  const memberships = await prisma.$queryRaw<Array<{ m: string; planCode: string; n: bigint }>>`
    SELECT ${monthSql(Prisma.sql`createdAt`)} AS m, planCode, COUNT(*) AS n FROM membership_periods
    WHERE source = 'BINANCE' AND createdAt >= ${from} GROUP BY m, planCode`;
  const plans = blank(() => ({ premium: 0, basic: 0, pro: 0, plans: 0, commissions: 0, boosts: 0, login: 0, total: 0 }));
  for (const row of ledger) {
    const i = index.get(row.m);
    if (i === undefined) continue;
    const amount = Math.round(num(row.total) * 100) / 100;
    if (row.type === 'MEMBERSHIP_REVENUE') plans[i]!.plans += amount;
    else if (row.type === 'SALE_COMMISSION') plans[i]!.commissions += amount;
    else if (row.type === 'BOOST_REVENUE') {
      if (row.kind === 'LOGIN') plans[i]!.login += amount;
      else plans[i]!.boosts += amount;
    }
    plans[i]!.total += amount;
  }
  for (const row of memberships) {
    const i = index.get(row.m);
    if (i === undefined) continue;
    if (row.planCode === 'PREMIUM') plans[i]!.premium += num(row.n);
    if (row.planCode === 'DEALER_BASIC') plans[i]!.basic += num(row.n);
    if (row.planCode === 'DEALER_PRO') plans[i]!.pro += num(row.n);
  }

  // ── Concesionarios
  const dealersMonths = blank(() => ({ active: 0, withPlan: 0, pro: 0, sales: 0, countries: 0 }));
  await Promise.all(
    ends.map(async (end, i) => {
      const start = startOf(keys[i]!);
      const active = await prisma.$queryRaw<Array<{ id: string; country: string | null }>>`
        SELECT DISTINCT u.id, u.country FROM users u JOIN vehicles v ON v.sellerId = u.id
        WHERE u.accountType = 'DEALER' AND u.isVerified = TRUE AND u.deletedAt IS NULL
          AND v.publishedAt IS NOT NULL AND v.createdAt < ${end} AND (v.deletedAt IS NULL OR v.deletedAt >= ${start})`;
      const plansAt = await prisma.$queryRaw<Array<{ planCode: string; n: bigint }>>`
        SELECT mp.planCode, COUNT(DISTINCT mp.userId) AS n FROM membership_periods mp
        WHERE mp.planCode IN ('DEALER_BASIC', 'DEALER_PRO') AND mp.startsAt < ${end} AND (mp.endsAt IS NULL OR mp.endsAt > ${end})
        GROUP BY mp.planCode`;
      const pro = num(plansAt.find(row => row.planCode === 'DEALER_PRO')?.n);
      dealersMonths[i] = {
        active: active.length,
        withPlan: pro + num(plansAt.find(row => row.planCode === 'DEALER_BASIC')?.n),
        pro,
        sales: sales.filter(row => row.m === keys[i] && Number(row.dealer) === 1).length,
        countries: new Set(active.map(row => row.country).filter(Boolean)).size,
      };
    }),
  );
  const directory = await dealersService.directory(null);
  const soldLast = new Map<string, number>();
  for (const row of lastSales) if (Number(row.dealer) === 1) soldLast.set(row.sellerId, (soldLast.get(row.sellerId) ?? 0) + 1);

  return {
    months: keys.map((key, i) => ({ key, current: i === MONTHS - 1 })),
    currentDays: Number(localDay(now).slice(8, 10)),
    sales: {
      months: salesMonths.map(month => ({ count: month.count, value: Math.round(month.value), daysToSell: month.daysN ? Math.round(month.daysSum / month.daysN) : null })),
      byBrand: top(lastSales.map(row => row.make)),
      byCity: top(lastSales.map(row => row.city)),
    },
    purchases: { months: purchases, outcome },
    cars: {
      months: carsMonths,
      inventory: { published, reserved: reservedAll - negotiating, negotiating, soldThisMonth: salesMonths[MONTHS - 1]!.count },
      byCategory: activeByCategory
        .map(row => ({ label: CATEGORY_LABEL[row.category] ?? row.category, value: row._count._all }))
        .sort((a, b) => b.value - a.value),
    },
    users: {
      months: usersMonths,
      byCountry: byCountry
        .map(row => ({ label: row.country ?? '—', value: row._count._all }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 6),
    },
    plans: { months: plans.map(month => ({ ...month, total: Math.round(month.total * 100) / 100 })) },
    dealers: {
      months: dealersMonths,
      list: directory
        .map(dealer => ({ name: dealer.name, city: dealer.city, country: dealer.country, planCode: dealer.planCode, listings: dealer.activeListings, soldLastMonth: soldLast.get(dealer.id) ?? 0, sold6m: dealer.soldLast6Months, rating: dealer.ratingAverage === null ? null : Math.round(dealer.ratingAverage * 10) / 10 }))
        .sort((a, b) => b.soldLastMonth - a.soldLastMonth || b.sold6m - a.sold6m),
    },
  };
}

/** Las mismas cifras para todo el equipo durante 30 s (el Resumen y el Copiloto las piden seguido). */
export const cachedAdminStats = cached(30_000, () => adminStats());
