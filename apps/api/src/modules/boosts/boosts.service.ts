import { usdText } from '@automarket/contracts';
import {
  BOOST_DAYS,
  BOOST_LABELS,
  LOGIN_MAX_DAYS,
  LOGIN_REST_DAYS,
  MAX_BOOSTED_LISTINGS,
  type BoostCheckoutDTO,
  type BoostCheckoutInput,
  type BoostDTO,
  type BoostKind,
  type BoostOptionsDTO,
  type BoostPreviewDTO,
  type BoostSettingsDTO,
  type BoostSettingsInput,
  type BoostWaitlistDTO,
  type LoginSpotDTO,
  type LoginSpotsDTO,
  type VehicleCardDTO,
} from '@automarket/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../shared/errors/app-error.js';
import { recordAudit } from '../../shared/infra/audit.js';
import { prisma, runInTransaction, type Db } from '../../shared/infra/prisma.js';
import { deliver, notify, type PendingNotice } from '../../shared/notifications.js';
import { getSettings } from '../memberships/plans.js';
import { closePendingPayment, paymentInclude, paymentMethods, prepareCheckout, toPaymentDTO } from '../payments/payment-gateway.js';
import { cardSelect, toCardDTO } from '../vehicles/vehicles.mapper.js';
import { HOME_LABEL, HOME_ZONE, addDays, fromDbDate, localDay, maxDay, placeTurn, toDbDate, zoneKeyOf, zoneLabelOf } from './boost-calendar.js';

const DAY_MS = 86_400_000;
const VISIBLE: Prisma.VehicleWhereInput = { deletedAt: null, status: { in: ['PUBLISHED', 'RESERVED'] } };
/** Pago al Pay ID: 24 h para pagar (si no se confirma, se devuelve según los términos). */
const PAY_WINDOW_MINUTES = 24 * 60;

type Settings = Awaited<ReturnType<typeof getSettings>>;

const boostInclude = {
  vehicle: { select: { id: true, slug: true, make: true, model: true, version: true, year: true, city: true, category: true, country: true } },
} satisfies Prisma.BoostInclude;
type BoostRow = Prisma.BoostGetPayload<{ include: typeof boostInclude }>;

const titleOf = (v: { make: string; model: string; version?: string | null; year: number }) => [v.make, v.model, v.version, v.year].filter(Boolean).join(' ');

const zoneLabel = (row: BoostRow) => (row.kind === 'HOME' ? HOME_LABEL : row.kind === 'LOGIN' ? null : zoneLabelOf(row.vehicle));

export const toBoostDTO = (row: BoostRow): BoostDTO => ({
  id: row.id,
  kind: row.kind,
  days: row.days,
  status: row.status,
  amount: row.amount.toFixed(2),
  zoneLabel: zoneLabel(row),
  vehicle: { id: row.vehicle.id, slug: row.vehicle.slug, title: titleOf(row.vehicle) },
  startsAt: row.startsAt?.toISOString() ?? null,
  endsAt: row.endsAt?.toISOString() ?? null,
  wantDate: fromDbDate(row.wantDate),
  startDate: fromDbDate(row.startDate),
  endDate: fromDbDate(row.endDate),
  turn: row.turn,
  moved: row.moved,
  paidAt: row.paidAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  paymentId: row.paymentId,
});

export const toBoostSettings = (s: Settings): BoostSettingsDTO => ({
  prices: {
    city3: s.boostPriceCity3.toFixed(2),
    city7: s.boostPriceCity7.toFixed(2),
    home: s.boostPriceHome.toFixed(2),
    login: [s.loginPrice1.toFixed(2), s.loginPrice2.toFixed(2), s.loginPrice3.toFixed(2)],
  },
  slots: { city: s.cityBoostSlots, home: s.homeBoostSlots, login: s.loginSlots },
  loginOnSale: s.loginOnSale,
});

function priceOf(s: Settings, kind: BoostKind, days: number): Prisma.Decimal {
  if (kind === 'CITY_3D') return s.boostPriceCity3;
  if (kind === 'CITY_7D') return s.boostPriceCity7;
  if (kind === 'HOME') return s.boostPriceHome;
  return [s.loginPrice1, s.loginPrice2, s.loginPrice3][Math.min(LOGIN_MAX_DAYS, Math.max(1, days)) - 1]!;
}

/** «el jueves 5 de noviembre» */
export function longDay(day: string): string {
  return `el ${new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(toDbDate(day)).replace(',', '')}`;
}
const rangeText = (start: string, end: string) => (start === end ? longDay(start) : `desde ${longDay(start)} hasta ${longDay(end)}`);

/** Cupos usados por zona: impulsos activos (sin vencer) y pagados en cola. */
async function zoneUsage(db: Db, keys: string[], now: Date) {
  const rows = keys.length
    ? await db.boost.findMany({
        where: { zoneKey: { in: keys }, kind: { not: 'LOGIN' }, OR: [{ status: 'ACTIVE', endsAt: { gt: now } }, { status: 'SCHEDULED' }] },
        select: { zoneKey: true, status: true, endsAt: true },
      })
    : [];
  const usage = new Map<string, { active: number; queued: number; ends: Date[] }>();
  for (const key of keys) usage.set(key, { active: 0, queued: 0, ends: [] });
  for (const row of rows) {
    const entry = usage.get(row.zoneKey!)!;
    if (row.status === 'ACTIVE') {
      entry.active++;
      if (row.endsAt) entry.ends.push(row.endsAt);
    } else entry.queued++;
  }
  for (const entry of usage.values()) entry.ends.sort((a, b) => a.getTime() - b.getTime());
  return usage;
}

const zoneState = (entry: { active: number; queued: number; ends: Date[] }, total: number) => {
  const used = entry.active + entry.queued;
  const nextOpenAt = used < total ? null : (entry.ends[Math.min(entry.queued, entry.ends.length - 1)] ?? null);
  return { used, nextOpenAt: nextOpenAt?.toISOString() ?? null };
};

/** Cupos ocupados por día de la pantalla de entrada (turnos programados o en pantalla). */
async function loginOccupancy(db: Db, from: string, to: string) {
  const rows = await db.boost.findMany({
    where: { kind: 'LOGIN', status: { in: ['SCHEDULED', 'ACTIVE'] }, endDate: { gte: toDbDate(from) }, startDate: { lte: toDbDate(to) } },
    select: { startDate: true, endDate: true },
  });
  const occupancy = new Map<string, number>();
  for (const row of rows) {
    let day = maxDay(fromDbDate(row.startDate), from);
    const end = fromDbDate(row.endDate)!;
    for (let guard = 0; day <= end && day <= to && guard < 400; guard++, day = addDays(day, 1)) occupancy.set(day, (occupancy.get(day) ?? 0) + 1);
  }
  return occupancy;
}

/** Descanso entre turnos: si el anuncio tiene un turno sin vencer, vuelve desde su fin + 2 días. */
async function loginRestFrom(db: Db, vehicleId: string, today: string, excludeId?: string) {
  const last = await db.boost.findFirst({
    where: { vehicleId, kind: 'LOGIN', status: { in: ['SCHEDULED', 'ACTIVE'] }, endDate: { gte: toDbDate(today) }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    orderBy: { endDate: 'desc' },
    select: { endDate: true },
  });
  const end = fromDbDate(last?.endDate ?? null);
  return { currentEnd: end, restFrom: end ? addDays(end, LOGIN_REST_DAYS) : null };
}

/** Autos de la persona con algún impulso activo, programado o con el pago en revisión. */
async function boostedListings(userId: string) {
  const rows = await prisma.boost.findMany({
    where: { userId, OR: [{ status: { in: ['ACTIVE', 'SCHEDULED'] } }, { status: 'PENDING_PAYMENT', payment: { status: 'SUBMITTED' } }] },
    select: { vehicleId: true },
  });
  return new Set(rows.map(row => row.vehicleId));
}

/** Avisos de «Mis alertas» para un auto que se destaca (una vez por alerta y auto). */
async function notifyAlertsFor(vehicleId: string) {
  const v = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true, slug: true, sellerId: true, make: true, model: true, version: true, year: true, price: true, city: true, country: true, mileageKm: true, status: true } });
  if (!v || v.status !== 'PUBLISHED') return;
  const alerts = await prisma.searchAlert.findMany({ where: { active: true, frequency: 'INSTANT', userId: { not: v.sellerId }, OR: [{ make: null }, { make: v.make }] }, take: 1000 });
  const notices: Array<PendingNotice | null> = [];
  for (const alert of alerts) {
    if (alert.model && !v.model.toLowerCase().includes(alert.model.toLowerCase())) continue;
    if (alert.maxPrice && v.price.gt(alert.maxPrice)) continue;
    if (alert.country && alert.country !== v.country) continue;
    if (alert.city && alert.city !== v.city) continue;
    if (alert.yearFrom && v.year < alert.yearFrom) continue;
    if (!alert.make && !alert.model && !alert.maxPrice) continue;
    notices.push(
      await notify(prisma, {
        userId: alert.userId,
        type: 'SEARCH_ALERT',
        title: `Destacado: ${titleOf(v)}`,
        body: `${usdText(Number(v.price))} en ${v.city}, ${v.mileageKm.toLocaleString('de-DE')} km`,
        link: `/vehiculos/${v.slug}`,
        dedupeKey: `alert:${alert.id}:${v.id}`,
      }),
    );
  }
  deliver(notices);
}

/** Activa un impulso de zona o portada (dentro de la transacción con el candado de ajustes). */
async function startZoneBoost(tx: Db, boostId: string, days: number, vehicleId: string, now: Date) {
  const endsAt = new Date(now.getTime() + days * DAY_MS);
  const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: vehicleId }, select: { featuredUntil: true, status: true } });
  await tx.boost.update({ where: { id: boostId }, data: { status: 'ACTIVE', startsAt: now, endsAt } });
  if (vehicle.status === 'PUBLISHED') {
    await tx.vehicle.update({
      where: { id: vehicleId },
      data: { featuredAt: now, featuredUntil: vehicle.featuredUntil && vehicle.featuredUntil > endsAt ? vehicle.featuredUntil : endsAt },
    });
  }
  return endsAt;
}

const lockSettings = async (tx: Db) => {
  await getSettings(tx);
  await tx.$queryRaw`SELECT id FROM platform_settings WHERE id = 1 FOR UPDATE`;
};

async function noticeFor(row: BoostRow): Promise<PendingNotice | null> {
  const title = titleOf(row.vehicle);
  if (row.kind === 'LOGIN' && row.startDate && row.endDate) {
    const start = fromDbDate(row.startDate)!;
    const end = fromDbDate(row.endDate)!;
    return notify(prisma, {
      userId: row.userId,
      type: 'BOOST_CONFIRMED',
      title: `Turno #${row.turn} en la pantalla de entrada`,
      body: `${title} sale en la pantalla de entrada ${rangeText(start, end)}, hasta las 11:59 p. m.${row.moved ? ' El día que pediste se llenó antes de confirmar tu pago y pasó al siguiente libre.' : ''}`,
      link: `/vehiculos/${row.vehicle.slug}`,
      dedupeKey: `boost:${row.id}:confirmed`,
    });
  }
  if (row.status === 'ACTIVE' && row.endsAt) {
    return notify(prisma, {
      userId: row.userId,
      type: 'BOOST_CONFIRMED',
      title: 'Tu anuncio ya está destacado',
      body: `${title} sale destacado hasta ${longDay(localDay(row.endsAt))}. Te avisamos cuando alguien te escriba.`,
      link: `/vehiculos/${row.vehicle.slug}`,
      dedupeKey: `boost:${row.id}:active`,
    });
  }
  return notify(prisma, {
    userId: row.userId,
    type: 'BOOST_CONFIRMED',
    title: 'Pago confirmado: estás en la cola',
    body: `El impulso de ${title} empieza apenas se libere un cupo en «${zoneLabel(row)}». Te avisamos.`,
    link: '/cuenta/anuncios',
    dedupeKey: `boost:${row.id}:queued`,
  });
}

export const boostsService = {
  /** Paso 1 y 2 de «Destacar»: tus anuncios, cupos reales, precios y reglas. */
  async options(userId: string): Promise<BoostOptionsDTO> {
    const now = new Date();
    const today = localDay(now);
    const settings = await getSettings();
    const vehicles = await prisma.vehicle.findMany({
      where: { sellerId: userId, deletedAt: null, status: 'PUBLISHED' },
      orderBy: { publishedAt: 'desc' },
      take: 50,
      select: { id: true, slug: true, make: true, model: true, version: true, year: true, price: true, currency: true, city: true, country: true, category: true, publishedAt: true, media: { where: { kind: 'IMAGE' }, orderBy: { position: 'asc' }, take: 1, select: { url: true } } },
    });
    const keys = [...new Set(vehicles.map(zoneKeyOf))];
    const ninety = new Date(now.getTime() - 90 * DAY_MS);
    const [usage, vehicleBoosts, boosted, occupancy, popular] = await Promise.all([
      zoneUsage(prisma, [...keys, HOME_ZONE], now),
      prisma.boost.findMany({
        where: { vehicleId: { in: vehicles.map(v => v.id) }, status: { in: ['ACTIVE', 'SCHEDULED', 'PENDING_PAYMENT'] } },
        select: { vehicleId: true, kind: true, status: true, endsAt: true, endDate: true, payment: { select: { status: true } } },
      }),
      boostedListings(userId),
      loginOccupancy(prisma, today, addDays(today, 59)),
      prisma.boost.groupBy({ by: ['kind'], where: { kind: { not: 'LOGIN' }, paidAt: { gte: ninety } }, _count: { _all: true } }),
    ]);
    const top = popular.sort((a, b) => b._count._all - a._count._all)[0];
    const homeEntry = usage.get(HOME_ZONE)!;

    return {
      today,
      settings: toBoostSettings(settings),
      limit: { max: MAX_BOOSTED_LISTINGS, active: boosted.size },
      listings: vehicles.map(v => {
        const key = zoneKeyOf(v);
        const state = zoneState(usage.get(key)!, settings.cityBoostSlots);
        const own = vehicleBoosts.filter(b => b.vehicleId === v.id);
        const zoneBoost = own.find(b => b.kind !== 'LOGIN' && (b.status === 'ACTIVE' || b.status === 'SCHEDULED'));
        const loginEnd = own
          .filter(b => b.kind === 'LOGIN' && (b.status === 'ACTIVE' || b.status === 'SCHEDULED') && b.endDate && fromDbDate(b.endDate)! >= today)
          .map(b => fromDbDate(b.endDate)!)
          .sort()
          .at(-1) ?? null;
        return {
          id: v.id,
          slug: v.slug,
          title: titleOf(v),
          price: v.price.toFixed(2),
          currency: v.currency,
          city: v.city,
          country: v.country,
          category: v.category,
          coverUrl: v.media[0]?.url ?? null,
          daysPublished: v.publishedAt ? Math.max(0, Math.floor((now.getTime() - v.publishedAt.getTime()) / DAY_MS)) : 0,
          zone: { key, label: zoneLabelOf(v), total: settings.cityBoostSlots, ...state },
          activeBoost: zoneBoost ? { kind: zoneBoost.kind, until: zoneBoost.endsAt?.toISOString() ?? null } : null,
          login: { currentEnd: loginEnd, restFrom: loginEnd ? addDays(loginEnd, LOGIN_REST_DAYS) : null },
          pendingReview: own.some(b => b.status === 'PENDING_PAYMENT' && b.payment?.status === 'SUBMITTED'),
        };
      }),
      home: { total: settings.homeBoostSlots, ...zoneState(homeEntry, settings.homeBoostSlots) },
      loginOccupancy: Array.from({ length: 60 }, (_, index) => {
        const date = addDays(today, index);
        return { date, used: occupancy.get(date) ?? 0 };
      }),
      popularKind: top && top._count._all >= 3 ? top.kind : null,
      payment: paymentMethods(),
    };
  },

  /** Vista previa: el puesto real del anuncio en el catálogo de su ciudad, hoy y con impulso. */
  async preview(userId: string, vehicleId: string): Promise<BoostPreviewDTO> {
    const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, sellerId: userId, deletedAt: null }, select: { id: true, city: true, country: true } });
    if (!vehicle) throw AppError.notFound('VEHICLE_NOT_FOUND', 'Anuncio no encontrado.');
    const now = new Date();
    const rows = await prisma.vehicle.findMany({
      where: { deletedAt: null, status: 'PUBLISHED', country: vehicle.country, city: vehicle.city },
      take: 500,
      select: { id: true, make: true, model: true, version: true, year: true, price: true, category: true, featuredUntil: true, searchBoost: true, publishedAt: true, media: { where: { kind: 'IMAGE' }, orderBy: { position: 'asc' }, take: 1, select: { url: true } } },
    });
    const featured = (row: (typeof rows)[number]) => row.featuredUntil !== null && row.featuredUntil > now;
    // Mismo orden que el catálogo: destacados primero, prioridad del plan y lo más nuevo.
    const rank = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
      Number(featured(b)) - Number(featured(a)) || b.searchBoost - a.searchBoost || (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0) || a.id.localeCompare(b.id);
    rows.sort(rank);
    const index = rows.findIndex(row => row.id === vehicle.id);
    const mine = rows[index];
    const position = index + 1;
    const boostedPosition = !mine || featured(mine) ? Math.max(1, position) : rows.filter(row => row.id !== mine.id && featured(row) && rank(row, { ...mine, featuredUntil: new Date(now.getTime() + DAY_MS) }) < 0).length + 1;
    const others = rows.filter(row => row.id !== vehicle.id).slice(0, 3);
    const toRow = (row: (typeof rows)[number], isMine: boolean) => ({ id: row.id, title: titleOf(row), price: row.price.toFixed(2), coverUrl: row.media[0]?.url ?? null, category: row.category, mine: isMine });
    return {
      city: vehicle.city,
      position: Math.max(1, position),
      boostedPosition,
      total: rows.length,
      rows: [...others.map(row => toRow(row, false)), ...(mine ? [toRow(mine, true)] : [])],
    };
  },

  /** Paso 3: crea la orden y el cobro con Binance (Pay ID con referencia o Binance Pay). */
  async checkout(userId: string, input: BoostCheckoutInput): Promise<BoostCheckoutDTO> {
    const now = new Date();
    const today = localDay(now);
    const settings = await getSettings();
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: input.vehicleId, sellerId: userId, deletedAt: null },
      select: { id: true, status: true, make: true, model: true, version: true, year: true, city: true, country: true, category: true },
    });
    if (!vehicle) throw AppError.notFound('VEHICLE_NOT_FOUND', 'Anuncio no encontrado.');
    if (vehicle.status !== 'PUBLISHED') throw AppError.conflict('INVALID_STATUS', 'Solo se destacan anuncios publicados.');
    const kind = input.kind;
    if (kind === 'LOGIN' && !settings.loginOnSale) throw AppError.conflict('NOT_ON_SALE', 'La «Pantalla de entrada» no está a la venta.');
    const days = kind === 'LOGIN' ? (input.days ?? LOGIN_MAX_DAYS) : BOOST_DAYS[kind];

    const open = await prisma.boost.findMany({ where: { vehicleId: vehicle.id, status: 'PENDING_PAYMENT' }, include: { payment: true } });
    if (open.some(boost => boost.payment?.status === 'SUBMITTED')) {
      throw AppError.conflict('PAYMENT_IN_REVIEW', 'Ya enviaste un pago para este anuncio: el equipo lo está revisando.');
    }
    const boosted = await boostedListings(userId);
    if (!boosted.has(vehicle.id) && boosted.size >= MAX_BOOSTED_LISTINGS) {
      throw AppError.conflict('BOOST_LIMIT', `Puedes tener hasta ${MAX_BOOSTED_LISTINGS} autos destacados a la vez. Espera a que termine uno.`);
    }

    let zoneKey: string | null = null;
    let wantDate: string | null = null;
    if (kind === 'LOGIN') {
      const { restFrom } = await loginRestFrom(prisma, vehicle.id, today);
      const occupancy = await loginOccupancy(prisma, today, addDays(today, 90));
      wantDate = placeTurn(occupancy, maxDay(today, restFrom), days, settings.loginSlots);
    } else {
      const current = await prisma.boost.findFirst({ where: { vehicleId: vehicle.id, kind: { not: 'LOGIN' }, status: { in: ['ACTIVE', 'SCHEDULED'] } }, select: { endsAt: true } });
      if (current) throw AppError.conflict('ALREADY_BOOSTED', current.endsAt ? `Este anuncio ya está destacado hasta ${longDay(localDay(current.endsAt))}.` : 'Este anuncio ya tiene un impulso en cola.');
      zoneKey = kind === 'HOME' ? HOME_ZONE : zoneKeyOf(vehicle);
      const total = kind === 'HOME' ? settings.homeBoostSlots : settings.cityBoostSlots;
      const state = zoneState((await zoneUsage(prisma, [zoneKey], now)).get(zoneKey)!, total);
      if (state.used >= total) {
        throw AppError.conflict('ZONE_FULL', `No hay cupo en «${kind === 'HOME' ? HOME_LABEL : zoneLabelOf(vehicle)}». Puedes anotarte en la lista y te avisamos.`, { nextOpenAt: state.nextOpenAt });
      }
    }

    // Un intento nuevo reemplaza al pago anterior que nunca se hizo.
    for (const stale of open) {
      if (stale.payment?.status === 'PENDING') await closePendingPayment(stale.payment, 'CANCELLED', 'Reemplazado por un nuevo intento de pago.');
      await prisma.boost.update({ where: { id: stale.id }, data: { status: 'CANCELLED' } });
    }

    const methods = paymentMethods();
    const method = input.method ?? (methods.manual ? 'MANUAL' : 'MERCHANT');
    const amount = priceOf(settings, kind, days);
    const data = await prepareCheckout({ userId, purpose: 'BOOST', method, amount, description: `AutoMarket · ${BOOST_LABELS[kind]}`, windowMinutes: PAY_WINDOW_MINUTES });
    const boost = await runInTransaction(async tx => {
      await tx.payment.create({ data });
      return tx.boost.create({
        data: { userId, vehicleId: vehicle.id, kind, days, zoneKey, amount, paymentId: data.id, wantDate: wantDate ? toDbDate(wantDate) : null },
        include: boostInclude,
      });
    });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: data.id }, include: paymentInclude });
    return { boost: toBoostDTO(boost), payment: toPaymentDTO(payment) };
  },

  /** Zona o portada llena: lista de espera sin pago; avisamos cuando se libere un cupo. */
  async waitlist(userId: string, input: { vehicleId: string; kind: 'CITY_3D' | 'CITY_7D' | 'HOME' }): Promise<BoostWaitlistDTO> {
    const now = new Date();
    const settings = await getSettings();
    const vehicle = await prisma.vehicle.findFirst({ where: { id: input.vehicleId, sellerId: userId, deletedAt: null, status: 'PUBLISHED' }, select: { id: true, city: true, country: true, category: true } });
    if (!vehicle) throw AppError.notFound('VEHICLE_NOT_FOUND', 'Anuncio no encontrado.');
    const zoneKey = input.kind === 'HOME' ? HOME_ZONE : zoneKeyOf(vehicle);
    const total = input.kind === 'HOME' ? settings.homeBoostSlots : settings.cityBoostSlots;
    const state = zoneState((await zoneUsage(prisma, [zoneKey], now)).get(zoneKey)!, total);
    if (state.used < total) throw AppError.conflict('ZONE_OPEN', 'Hay cupo: puedes destacarlo ahora.');
    const existing = await prisma.boost.findFirst({ where: { vehicleId: vehicle.id, zoneKey, status: 'WAITLISTED', notifiedAt: null }, include: boostInclude });
    const boost =
      existing ??
      (await prisma.boost.create({
        data: { userId, vehicleId: vehicle.id, kind: input.kind, days: BOOST_DAYS[input.kind], zoneKey, status: 'WAITLISTED', amount: priceOf(settings, input.kind, BOOST_DAYS[input.kind]) },
        include: boostInclude,
      }));
    return { boost: toBoostDTO(boost), nextOpenAt: state.nextOpenAt };
  },

  async get(userId: string, boostId: string): Promise<BoostDTO> {
    const boost = await prisma.boost.findFirst({ where: { id: boostId, userId }, include: boostInclude });
    if (!boost) throw AppError.notFound('BOOST_NOT_FOUND', 'Impulso no encontrado.');
    return toBoostDTO(boost);
  },

  /**
   * Pago confirmado (webhook de Binance Pay o aprobación del equipo). Idempotente.
   *   · Pantalla de entrada: turno por la hora del pago; desde el día pedido (o el siguiente
   *     con cupo en todos sus días seguidos). Inicio y fin quedan fijos.
   *   · Zona y portada: empieza ya si hay cupo; si otro pagó antes el último, queda en cola.
   */
  async activateFromPayment(paymentId: string) {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.status !== 'PAID') return;
    const paidAt = payment.paidAt ?? new Date();
    const updated = await runInTransaction(async tx => {
      await lockSettings(tx);
      const settings = await getSettings(tx);
      const boost = await tx.boost.findUnique({ where: { paymentId } });
      if (!boost || boost.status !== 'PENDING_PAYMENT') return null;
      const now = new Date();
      if (boost.kind === 'LOGIN') {
        const today = localDay(now);
        const want = fromDbDate(boost.wantDate) ?? today;
        const { restFrom } = await loginRestFrom(tx, boost.vehicleId, today, boost.id);
        const from = maxDay(want, localDay(paidAt), today, restFrom);
        const occupancy = await loginOccupancy(tx, today, addDays(from, 90));
        const start = placeTurn(occupancy, from, boost.days, settings.loginSlots);
        const last = await tx.boost.aggregate({ where: { kind: 'LOGIN', turn: { not: null } }, _max: { turn: true } });
        await tx.boost.update({
          where: { id: boost.id },
          data: { status: start <= today ? 'ACTIVE' : 'SCHEDULED', paidAt, startDate: toDbDate(start), endDate: toDbDate(addDays(start, boost.days - 1)), turn: (last._max.turn ?? 0) + 1, moved: start > want },
        });
      } else {
        const total = boost.kind === 'HOME' ? settings.homeBoostSlots : settings.cityBoostSlots;
        const entry = (await zoneUsage(tx, [boost.zoneKey!], now)).get(boost.zoneKey!)!;
        await tx.boost.update({ where: { id: boost.id }, data: { paidAt, status: 'SCHEDULED' } });
        if (entry.active < total && entry.queued === 0) await startZoneBoost(tx, boost.id, boost.days, boost.vehicleId, now);
      }
      await tx.ledgerEntry.create({
        data: { type: 'BOOST_REVENUE', amount: payment.amount, currency: 'USD', userId: payment.userId, paymentId: payment.id, description: `${BOOST_LABELS[boost.kind]} · ${payment.reference}` },
      });
      return tx.boost.findUniqueOrThrow({ where: { id: boost.id }, include: boostInclude });
    });
    if (!updated) return;
    await recordAudit({ action: 'BOOST_ACTIVATED', entityType: 'Boost', entityId: updated.id, metadata: { kind: updated.kind, status: updated.status, turn: updated.turn, startDate: fromDbDate(updated.startDate), endDate: fromDbDate(updated.endDate) } });
    deliver([await noticeFor(updated)]);
    if (updated.status === 'ACTIVE' && (updated.kind === 'CITY_7D' || updated.kind === 'HOME')) {
      await notifyAlertsFor(updated.vehicleId).catch(err => console.warn('[destacar] avisos de alertas', updated.id, err instanceof Error ? err.message : err));
    }
  },

  /** El cobro caducó, se canceló o se rechazó: el impulso no se compra. */
  async onPaymentClosed(paymentId: string) {
    await prisma.boost.updateMany({ where: { paymentId, status: 'PENDING_PAYMENT' }, data: { status: 'CANCELLED' } });
  },

  /** Carrusel de Entrar y Crear cuenta: los turnos pagados de hoy (por orden de llegada) y luego el resto. */
  async loginShowcase(fallback: Array<VehicleCardDTO & { source: string }>) {
    const today = toDbDate(localDay());
    const settings = await getSettings();
    const live = await prisma.boost.findMany({
      where: { kind: 'LOGIN', status: { in: ['ACTIVE', 'SCHEDULED'] }, startDate: { lte: today }, endDate: { gte: today }, vehicle: VISIBLE },
      orderBy: { turn: 'asc' },
      take: settings.loginSlots,
      select: { vehicle: { select: cardSelect } },
    });
    if (live.length === 0) return fallback;
    const seen = new Set(live.map(row => row.vehicle.id));
    const items = [...live.map(row => ({ ...toCardDTO(row.vehicle), source: 'LOGIN' })), ...fallback.filter(item => !seen.has(item.id))];
    return items.slice(0, Math.max(settings.loginSlots, live.length));
  },

  // ───────────────────────────────────────────────────────────── Panel ──

  async settings(): Promise<BoostSettingsDTO> {
    return toBoostSettings(await getSettings());
  },

  async updateSettings(adminId: string, input: BoostSettingsInput, ip: string | null): Promise<BoostSettingsDTO> {
    const data = {
      boostPriceCity3: input.city3,
      boostPriceCity7: input.city7,
      boostPriceHome: input.home,
      loginPrice1: input.login1,
      loginPrice2: input.login2,
      loginPrice3: input.login3,
      cityBoostSlots: input.citySlots,
      homeBoostSlots: input.homeSlots,
      loginSlots: input.loginSlots,
      ...(input.loginOnSale !== undefined && { loginOnSale: input.loginOnSale }),
    };
    const row = await runInTransaction(async tx => {
      const saved = await tx.platformSettings.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
      await recordAudit({ action: 'BOOST_SETTINGS_UPDATED', entityType: 'PlatformSettings', entityId: '1', actorId: adminId, ip, metadata: { ...input } }, tx);
      return saved;
    });
    return toBoostSettings(row);
  },

  /** Panel «Pantalla de entrada»: turnos por orden de llegada, ocupación y cobros. */
  async loginSpots(): Promise<LoginSpotsDTO> {
    const today = localDay();
    const settings = await getSettings();
    const rows = await prisma.boost.findMany({
      where: {
        kind: 'LOGIN',
        OR: [{ status: { in: ['SCHEDULED', 'ACTIVE', 'EXPIRED'] } }, { status: 'PENDING_PAYMENT', payment: { status: { in: ['PENDING', 'SUBMITTED'] } } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 400,
      include: {
        vehicle: { select: { id: true, slug: true, make: true, model: true, version: true, year: true, price: true, city: true, category: true, media: { where: { kind: 'IMAGE' }, orderBy: { position: 'asc' }, take: 1, select: { url: true } } } },
        user: { select: { name: true, businessName: true, accountType: true } },
        payment: { select: { id: true, reference: true, status: true, txId: true } },
      },
    });
    const occupancy = await loginOccupancy(prisma, today, addDays(today, 6));
    const items: LoginSpotDTO[] = rows.map(row => {
      const start = fromDbDate(row.startDate);
      const end = fromDbDate(row.endDate);
      const state =
        row.status === 'PENDING_PAYMENT' ? 'PENDING' : row.status === 'EXPIRED' || (end && end < today) ? 'EXPIRED' : start && start <= today ? 'LIVE' : 'SCHEDULED';
      return {
        boostId: row.id,
        paymentId: row.payment?.id ?? null,
        reference: row.payment?.reference ?? null,
        paymentStatus: row.payment?.status ?? null,
        txId: row.payment?.txId ?? null,
        turn: row.turn,
        state,
        vehicle: {
          id: row.vehicle.id,
          slug: row.vehicle.slug,
          title: [row.vehicle.make, row.vehicle.model, row.vehicle.version].filter(Boolean).join(' '),
          year: row.vehicle.year,
          price: row.vehicle.price.toFixed(2),
          city: row.vehicle.city,
          coverUrl: row.vehicle.media[0]?.url ?? null,
          category: row.vehicle.category,
        },
        seller: { name: row.user.accountType === 'DEALER' && row.user.businessName ? row.user.businessName : row.user.name, dealer: row.user.accountType === 'DEALER' },
        amount: row.amount.toFixed(2),
        days: row.days,
        wantDate: fromDbDate(row.wantDate),
        startDate: start,
        endDate: end,
        moved: row.moved,
        paidAt: row.paidAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      };
    });
    items.sort((a, b) => (a.turn ?? Number.MAX_SAFE_INTEGER) - (b.turn ?? Number.MAX_SAFE_INTEGER) || a.createdAt.localeCompare(b.createdAt));
    const sum = (list: LoginSpotDTO[]) => list.reduce((total, item) => total.plus(item.amount), new Prisma.Decimal(0)).toFixed(2);
    return {
      today,
      slots: settings.loginSlots,
      prices: [settings.loginPrice1.toFixed(2), settings.loginPrice2.toFixed(2), settings.loginPrice3.toFixed(2)],
      items,
      days: Array.from({ length: 7 }, (_, index) => {
        const date = addDays(today, index);
        return { date, used: occupancy.get(date) ?? 0 };
      }),
      collected: sum(items.filter(item => item.paidAt)),
      pending: sum(items.filter(item => item.state === 'PENDING')),
    };
  },
};

export const boostCalendar = { startZoneBoost, zoneUsage, lockSettings, noticeFor, notifyAlertsFor, boostInclude };
