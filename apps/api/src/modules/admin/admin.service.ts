import { randomUUID } from 'node:crypto';
import {
  MAX_BINANCE_QR_BYTES,
  MAX_LOGIN_BACKGROUND_BYTES,
  SOCIAL_NETWORK_LABELS,
  type AdminCommissionDTO,
  type AdminMetricsDTO,
  type AdminSettingsDTO,
  type BinancePayeeDTO,
  type BinancePayeeUpdateInput,
  type PlanUpdateInput,
  type PlatformSettingsInput,
  type SettingsHistoryEntryDTO,
  type SocialLinkDTO,
} from '@automarket/contracts';
import { env } from '../../config/env.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { ContactStatus, LedgerType, PlanCode, ReportStatus, ReviewStatus, Role, UserStatus, VehicleStatus } from '../../generated/prisma/enums.js';
import { AppError } from '../../shared/errors/app-error.js';
import { recordAudit } from '../../shared/infra/audit.js';
import { isUniqueViolation, prisma, runInTransaction } from '../../shared/infra/prisma.js';
import { effectivePlan } from '../../shared/membership.js';
import { invalidateBlocklist } from '../../shared/moderation/blocklist.js';
import { deliver } from '../../shared/notifications.js';
import { currentPayee, currentPayeeSource, refreshPlatformConfig } from '../../shared/platform-config.js';
import { realtime } from '../../shared/realtime.js';
import { deleteObject, presignUpload, publicMediaUrl, readObjectStart, statObject } from '../../shared/infra/storage.js';
import { baseMime, extensionFor, sniffImageType } from '../../shared/utils/mime.js';
import { getSettings, toPlanDTO, toPublicSettings, toTerms } from '../memberships/plans.js';
import { notifyAdmins } from '../payments/payment-gateway.js';
import { cardSelect, toCardDTO } from '../vehicles/vehicles.mapper.js';

const PAGE_SIZE = 25;
/** Carpeta del bucket público con los fondos del login. */
const LOGIN_BG_PREFIX = 'login-bg/';
/** Carpeta del bucket público con el QR del Pay ID de Binance. */
const BINANCE_QR_PREFIX = 'binance-qr/';

/** Fotos del sitio que cambia el panel: carpeta del bucket, columnas en MySQL y acción de auditoría. */
const SITE_IMAGES = {
  login: { prefix: LOGIN_BG_PREFIX, url: 'loginBackgroundUrl', key: 'loginBackgroundKey', action: 'LOGIN_BACKGROUND_UPDATED' },
  home: { prefix: 'home-hero/', url: 'homeHeroUrl', key: 'homeHeroKey', action: 'HOME_HERO_UPDATED' },
} as const;
type SiteImage = (typeof SITE_IMAGES)[keyof typeof SITE_IMAGES];

/** Paso 1: URL prefirmada (PUT, 5 min) al bucket público, en la carpeta de esa foto. */
async function presignSiteImage(image: SiteImage, input: { mimeType: string; sizeBytes: number }) {
  const key = `${image.prefix}${randomUUID()}.${extensionFor(input.mimeType)}`;
  const expiresIn = 300;
  const uploadUrl = await presignUpload({ bucket: env.S3_BUCKET_MEDIA, key, contentType: input.mimeType, contentLength: input.sizeBytes, expiresIn });
  return { key, uploadUrl, method: 'PUT' as const, headers: { 'Content-Type': input.mimeType }, expiresIn };
}

/** Paso 2: se verifica la imagen (tipo real, tamaño), su ruta queda en MySQL y se borra la anterior. */
async function setSiteImage(image: SiteImage, adminId: string, key: string, ip: string | null) {
  if (!key.startsWith(image.prefix) || key.includes('..')) throw AppError.forbidden('MEDIA_KEY_FORBIDDEN', 'Archivo no válido.');
  const stored = await statObject(env.S3_BUCKET_MEDIA, key);
  if (!stored) throw AppError.badRequest('MEDIA_NOT_UPLOADED', 'La imagen aún no termina de subirse.');
  const mimeType = baseMime(stored.contentType);
  if (stored.sizeBytes > MAX_LOGIN_BACKGROUND_BYTES || sniffImageType(await readObjectStart(env.S3_BUCKET_MEDIA, key)) !== mimeType) {
    await deleteObject(env.S3_BUCKET_MEDIA, key).catch(() => undefined);
    throw AppError.badRequest('INVALID_IMAGE', 'Sube una imagen JPG, PNG o WebP de hasta 8 MB.');
  }
  const previous = await runInTransaction(async tx => {
    const before = await getSettings(tx);
    await tx.platformSettings.update({ where: { id: 1 }, data: { [image.url]: publicMediaUrl(key), [image.key]: key } });
    await recordAudit({ action: image.action, entityType: 'PlatformSettings', entityId: '1', actorId: adminId, ip, metadata: { key } }, tx);
    return before[image.key];
  });
  if (previous) await deleteObject(env.S3_BUCKET_MEDIA, previous).catch(() => undefined);
}

/** Quita la foto subida: la web vuelve a la predeterminada. */
async function removeSiteImage(image: SiteImage, adminId: string, ip: string | null) {
  const previous = await runInTransaction(async tx => {
    const before = await getSettings(tx);
    await tx.platformSettings.update({ where: { id: 1 }, data: { [image.url]: null, [image.key]: null } });
    await recordAudit({ action: image.action, entityType: 'PlatformSettings', entityId: '1', actorId: adminId, ip, metadata: { key: null } }, tx);
    return before[image.key];
  });
  if (previous) await deleteObject(env.S3_BUCKET_MEDIA, previous).catch(() => undefined);
}

/** Acciones que forman el historial de «Planes y ajustes». */
const SETTINGS_ACTIONS = [
  'PLAN_UPDATED',
  'BOOST_SETTINGS_UPDATED',
  'SETTINGS_UPDATED',
  'TERMS_UPDATED',
  'LOGIN_BACKGROUND_UPDATED',
  'HOME_HERO_UPDATED',
  'BINANCE_PAYEE_UPDATED',
  'BINANCE_QR_UPDATED',
  'SOCIAL_LINKS_UPDATED',
  'BRAND_CREATED',
  'BRAND_UPDATED',
  'BRAND_MODELS_ADDED',
  'BRAND_MODEL_UPDATED',
  'BRANDS_IMPORTED',
] as const;

const PLAN_FIELD_LABELS: Record<string, string> = {
  priceMonthly: 'precio mensual',
  priceYearly: 'precio anual',
  commissionRate: 'comisión',
  maxActiveListings: 'anuncios en cupo',
  listingDurationDays: 'días por anuncio',
  featuredSlots: 'destacados a la vez',
  monthlyFeaturedCredits: 'destacados por mes',
  searchBoost: 'prioridad en búsquedas',
};

const showValue = (key: string, value: unknown) => {
  if (value === null || value === undefined) return key === 'listingDurationDays' ? 'no vence' : key === 'maxActiveListings' ? 'ilimitados' : '—';
  if (key === 'commissionRate') return `${Math.round(Number(value) * 10_000) / 100} %`;
  if (key === 'priceMonthly' || key === 'priceYearly') return `${Number(value).toFixed(2)} USD`;
  return String(value);
};

/** Resumen legible de una entrada del registro de auditoría. */
function summarize(action: string, entityId: string, metadata: Prisma.JsonValue | null): string {
  const meta = (metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}) as Record<string, unknown>;
  switch (action) {
    case 'PLAN_UPDATED': {
      const before = (meta.before ?? {}) as Record<string, unknown>;
      const after = (meta.after ?? {}) as Record<string, unknown>;
      const changes = Object.keys(after)
        .filter(key => key in PLAN_FIELD_LABELS && String(before[key] ?? null) !== String(after[key] ?? null))
        .map(key => `${PLAN_FIELD_LABELS[key]}: ${showValue(key, before[key])} → ${showValue(key, after[key])}`);
      return `Plan ${String(before.name ?? entityId)}${changes.length ? ` · ${changes.join(' · ')}` : ' · sin cambios'}`;
    }
    case 'SETTINGS_UPDATED':
      return `Plazos: vendedor ${String(meta.sellerResponseHours)} h · reserva ${String(meta.reservationHoldDays)} días · comisión ${String(meta.commissionDueDays)} días`;
    case 'TERMS_UPDATED':
      return 'Términos y Condiciones actualizados';
    case 'BOOST_SETTINGS_UPDATED':
      return `Destacar: impulso $${String(meta.city3)} · semana $${String(meta.city7)} · portada $${String(meta.home)} · entrada $${String(meta.login1)}/$${String(meta.login2)}/$${String(meta.login3)} · cupos ${String(meta.citySlots)} por zona, ${String(meta.homeSlots)} en portada, ${String(meta.loginSlots)} por día${meta.loginOnSale === undefined ? '' : meta.loginOnSale ? ' · entrada a la venta' : ' · entrada sin vender'}`;
    case 'LOGIN_BACKGROUND_UPDATED':
      return meta.key ? 'Nueva foto de fondo del login' : 'Fondo del login quitado';
    case 'HOME_HERO_UPDATED':
      return meta.key ? 'Nueva foto de la portada' : 'Portada con la foto predeterminada';
    case 'BINANCE_PAYEE_UPDATED': {
      const before = (meta.before ?? {}) as Record<string, unknown>;
      const after = (meta.after ?? {}) as Record<string, unknown>;
      return `Cuenta de cobro Binance: ${String(before.payId ?? 'sin Pay ID')} → ${String(after.payId)} (${String(after.payName ?? '')})`;
    }
    case 'BINANCE_QR_UPDATED':
      return meta.key ? 'Nuevo QR del Pay ID' : 'QR del Pay ID quitado';
    case 'SOCIAL_LINKS_UPDATED': {
      const links = Array.isArray(meta.links) ? (meta.links as Array<{ network: keyof typeof SOCIAL_NETWORK_LABELS }>) : [];
      return links.length ? `Redes sociales: ${links.map(link => SOCIAL_NETWORK_LABELS[link.network] ?? link.network).join(', ')}` : 'Redes sociales: ninguna';
    }
    case 'BRAND_CREATED':
      return `Marca nueva: ${String(meta.name)}${Array.isArray(meta.models) && meta.models.length ? ` (${meta.models.length} modelos)` : ''}`;
    case 'BRAND_UPDATED':
      return `Marca ${String(meta.before ?? '')}${meta.name && meta.name !== meta.before ? ` → ${String(meta.name)}` : ''}${meta.isActive === false ? ' · desactivada' : meta.isActive === true ? ' · activada' : ''}`;
    case 'BRAND_MODELS_ADDED':
      return `Modelos agregados a ${String(meta.brand)}: ${Array.isArray(meta.names) ? meta.names.join(', ') : ''}`;
    case 'BRANDS_IMPORTED':
      return `Marcas importadas de los anuncios: ${Array.isArray(meta.names) ? meta.names.join(', ') : ''}`;
    case 'BRAND_MODEL_UPDATED':
      return `Modelo ${String(meta.name)} de ${String(meta.brand)} ${meta.isActive ? 'activado' : 'desactivado'}`;
    default:
      return action;
  }
}
const page = (n: number | undefined) => ({ skip: (Math.max(1, n ?? 1) - 1) * PAGE_SIZE, take: PAGE_SIZE });

const sum = (rows: Array<{ type: LedgerType; _sum: { amount: Prisma.Decimal | null } }>, type: LedgerType) =>
  rows.find(row => row.type === type)?._sum.amount?.toNumber() ?? 0;

export const adminService = {
  /**
   * Métricas financieras a partir del libro contable (ledger_entries): ingresos = membresías +
   * comisiones post-venta cobradas. Las reservas son P2P: su abono no pasa por la plataforma.
   */
  async metrics(months: number): Promise<AdminMetricsDTO> {
    const now = new Date();
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
    const previousSince = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() - months, 1));
    const unpaid = { status: { in: ['ACCEPTED', 'COMPLETED'] }, commissionAmount: { gt: 0 }, commissionPaidAt: null } satisfies Prisma.CartReserveWhereInput;
    const previous = await prisma.ledgerEntry.aggregate({
      where: { occurredAt: { gte: previousSince, lt: since }, type: { in: ['MEMBERSHIP_REVENUE', 'SALE_COMMISSION', 'BOOST_REVENUE'] } },
      _sum: { amount: true },
    });
    const [totals, monthlyRows, users, dealers, activeListings, acceptedReservations, completedSales, completedVehicleSales, pending, pendingVehicleSales, overdue, plans] = await Promise.all([
      prisma.ledgerEntry.groupBy({ by: ['type'], _sum: { amount: true } }),
      prisma.$queryRaw<Array<{ month: string; type: LedgerType; total: Prisma.Decimal }>>`
        SELECT DATE_FORMAT(occurredAt, '%Y-%m') AS month, type, SUM(amount) AS total
        FROM ledger_entries WHERE occurredAt >= ${since}
        GROUP BY month, type ORDER BY month`,
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { deletedAt: null, accountType: 'DEALER' } }),
      prisma.vehicle.count({ where: { deletedAt: null, status: { in: ['PUBLISHED', 'RESERVED'] } } }),
      prisma.cartReserve.count({ where: { type: 'RESERVATION', status: 'ACCEPTED' } }),
      prisma.cartReserve.count({ where: { type: 'RESERVATION', status: 'COMPLETED' } }),
      prisma.vehicleSale.count({ where: { status: 'COMPLETED' } }),
      prisma.cartReserve.aggregate({
        where: {
          ...unpaid,
          OR: [{ status: 'ACCEPTED' }, { status: 'COMPLETED', commissionDueAt: { gte: now } }],
        },
        _sum: { commissionAmount: true },
      }),
      prisma.vehicleSale.aggregate({ where: { status: 'PENDING_PAYMENT', commissionAmount: { gt: 0 } }, _sum: { commissionAmount: true } }),
      prisma.cartReserve.aggregate({ where: { ...unpaid, commissionDueAt: { lt: now } }, _sum: { commissionAmount: true } }),
      prisma.$queryRaw<Array<{ code: PlanCode; users: bigint }>>`
        SELECT (CASE WHEN planCode <> 'FREE' AND planExpiresAt > ${now} THEN planCode ELSE 'FREE' END) AS code, COUNT(*) AS users
        FROM users WHERE deletedAt IS NULL GROUP BY code`,
    ]);

    const monthly = Array.from({ length: months }, (_, i) => {
      const date = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + i, 1));
      const month = date.toISOString().slice(0, 7);
      const value = (type: LedgerType) => Number(monthlyRows.find(row => row.month === month && row.type === type)?.total ?? 0);
      return { month, membership: value('MEMBERSHIP_REVENUE'), commission: value('SALE_COMMISSION'), boosts: value('BOOST_REVENUE') };
    });
    const cents = (value: number) => Math.round(value * 100) / 100;
    const periodSum = (key: 'membership' | 'commission' | 'boosts') => cents(monthly.reduce((total, month) => total + month[key], 0));

    const membershipRevenue = sum(totals, 'MEMBERSHIP_REVENUE');
    const commissions = sum(totals, 'SALE_COMMISSION');
    const plansCount = plans.map(row => ({ code: row.code, users: Number(row.users) }));
    return {
      currency: 'USD',
      totals: {
        revenue: Math.round((membershipRevenue + commissions) * 100) / 100,
        membershipRevenue,
        commissions,
        commissionsPending: (pending._sum.commissionAmount?.toNumber() ?? 0) + (pendingVehicleSales._sum.commissionAmount?.toNumber() ?? 0),
        commissionsOverdue: overdue._sum.commissionAmount?.toNumber() ?? 0,
        boosts: sum(totals, 'BOOST_REVENUE'),
      },
      period: {
        months,
        membership: periodSum('membership'),
        commissions: periodSum('commission'),
        boosts: periodSum('boosts'),
        revenue: cents(periodSum('membership') + periodSum('commission') + periodSum('boosts')),
        previousRevenue: cents(previous._sum.amount?.toNumber() ?? 0),
      },
      monthly,
      counts: {
        users,
        dealers,
        activeListings,
        acceptedReservations,
        completedSales: completedSales + completedVehicleSales,
        paidMemberships: plansCount.filter(p => p.code !== 'FREE').reduce((acc, p) => acc + p.users, 0),
      },
      plans: plansCount,
    };
  },

  /** Comisiones post-venta sin pagar (las vencidas primero). */
  async commissions(): Promise<AdminCommissionDTO[]> {
    const now = new Date();
    const [rows, sales] = await Promise.all([
      prisma.cartReserve.findMany({
        where: { status: { in: ['ACCEPTED', 'COMPLETED'] }, commissionAmount: { gt: 0 }, commissionPaidAt: null },
        orderBy: { commissionDueAt: 'asc' },
        take: 200,
        include: {
          seller: { select: { id: true, name: true, email: true, phone: true, businessName: true } },
          vehicle: { select: { make: true, model: true, year: true } },
          payment: { select: { id: true, status: true, reference: true } },
        },
      }),
      prisma.vehicleSale.findMany({
        where: { status: 'PENDING_PAYMENT', commissionAmount: { gt: 0 } },
        orderBy: { createdAt: 'asc' },
        take: 200,
        include: {
          seller: { select: { id: true, name: true, email: true, phone: true, businessName: true } },
          vehicle: { select: { make: true, model: true, year: true } },
          payment: { select: { id: true, status: true, reference: true, expiresAt: true } },
        },
      }),
    ]);
    return [
      ...rows.map(r => ({
        recordId: r.id,
        recordType: 'RESERVATION' as const,
        seller: r.seller,
        vehicleTitle: `${r.vehicle.make} ${r.vehicle.model} ${r.vehicle.year}`,
        salePrice: r.salePrice?.toFixed(2) ?? '0.00',
        commissionAmount: r.commissionAmount?.toFixed(2) ?? '0.00',
        currency: r.currency,
        completedAt: (r.completedAt ?? r.updatedAt).toISOString(),
        commissionDueAt: (r.commissionDueAt ?? now).toISOString(),
        overdue: r.commissionDueAt !== null && r.commissionDueAt < now,
        payment: r.payment,
      })),
      ...sales.map(s => ({
        recordId: s.id,
        recordType: 'VEHICLE_SALE' as const,
        seller: s.seller,
        vehicleTitle: `${s.vehicle.make} ${s.vehicle.model} ${s.vehicle.year}`,
        salePrice: s.salePrice.toFixed(2),
        commissionAmount: s.commissionAmount.toFixed(2),
        currency: s.currency,
        completedAt: s.createdAt.toISOString(),
        commissionDueAt: (s.payment?.expiresAt ?? s.createdAt).toISOString(),
        overdue: false,
        payment: s.payment,
      })),
    ];
  },

  // ──────────────────────────────────────────────── Usuarios y membresías ──

  async users(filters: { q?: string; plan?: PlanCode; status?: UserStatus; page?: number }) {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(filters.q && { OR: [{ email: { contains: filters.q } }, { name: { contains: filters.q } }] }),
      ...(filters.plan && { planCode: filters.plan }),
      ...(filters.status && { status: filters.status }),
    };
    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...page(filters.page),
        select: { id: true, email: true, name: true, role: true, status: true, accountType: true, businessName: true, taxId: true, phone: true, country: true, city: true, isVerified: true, planCode: true, planCycle: true, planExpiresAt: true, createdAt: true, _count: { select: { vehicles: true } } },
      }),
      prisma.user.count({ where }),
    ]);
    return {
      items: rows.map(({ _count, planExpiresAt, createdAt, ...user }) => ({
        ...user,
        plan: effectivePlan({ planCode: user.planCode, planCycle: user.planCycle, planExpiresAt }),
        createdAt: createdAt.toISOString(),
        vehicles: _count.vehicles,
      })),
      total,
      pageSize: PAGE_SIZE,
    };
  },

  async setUserStatus(adminId: string, userId: string, status: UserStatus, ip: string | null, actorRole: Role) {
    if (adminId === userId) throw AppError.badRequest('SELF_SUSPEND', 'No puedes suspender tu propia cuenta.');
    await runInTransaction(async tx => {
      const target = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
      if (!target) throw AppError.notFound('USER_NOT_FOUND', 'Usuario no encontrado.');
      if (target.role !== 'USER' && actorRole !== 'ADMIN_ONE') {
        throw AppError.forbidden('ROLE_MANAGEMENT_FORBIDDEN', 'Solo ADMIN_ONE puede modificar el estado de administradores y supervisores.');
      }
      await tx.user.update({ where: { id: userId }, data: { status, ...(status === 'SUSPENDED' && { tokenVersion: { increment: 1 } }) } });
      // Suspender cierra todas sus sesiones al instante.
      if (status === 'SUSPENDED') await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await recordAudit({ action: 'USER_STATUS_CHANGED', entityType: 'User', entityId: userId, actorId: adminId, ip, metadata: { status } }, tx);
    });
    realtime.statsChanged();
  },

  async setUserRole(adminId: string, userId: string, role: Exclude<Role, 'ADMIN_ONE'>, ip: string | null) {
    if (adminId === userId) throw AppError.forbidden('OWNER_ROLE_PROTECTED', 'ADMIN_ONE no puede cambiar su propio rol.');
    await runInTransaction(async tx => {
      const target = await tx.user.findUnique({ where: { id: userId }, select: { role: true, email: true, status: true, deletedAt: true } });
      if (!target || target.deletedAt) throw AppError.notFound('USER_NOT_FOUND', 'Usuario no encontrado.');
      if (target.role === 'ADMIN_ONE') throw AppError.forbidden('OWNER_ROLE_PROTECTED', 'No se puede cambiar el rol de ADMIN_ONE.');
      if (target.role === role) return;
      await tx.user.update({
        where: { id: userId },
        data: { role, tokenVersion: { increment: 1 } },
      });
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await recordAudit({
        action: 'USER_ROLE_CHANGED',
        entityType: 'User',
        entityId: userId,
        actorId: adminId,
        ip,
        metadata: { email: target.email, from: target.role, to: role },
      }, tx);
    });
  },

  // ─────────────────────────────────────────────────────── Planes y ajustes ──

  async plans() {
    return (await prisma.plan.findMany({ orderBy: { priceMonthly: 'asc' } })).map(toPlanDTO);
  },

  async updatePlan(adminId: string, code: PlanCode, input: PlanUpdateInput, ip: string | null) {
    if (code === 'FREE' && (input.priceMonthly > 0 || input.priceYearly > 0)) throw AppError.badRequest('FREE_PLAN_PRICE', 'El plan Gratis no tiene precio.');
    if (code !== 'FREE' && (input.priceMonthly <= 0 || input.priceYearly <= 0)) throw AppError.badRequest('PRICE_REQUIRED', 'Los planes de pago necesitan precio mensual y anual.');
    const plan = await runInTransaction(async tx => {
      const before = await tx.plan.findUniqueOrThrow({ where: { code } });
      const updated = await tx.plan.update({ where: { code }, data: input });
      // Los anuncios guardan una copia de la prioridad del plan de su vendedor: se recalcula al momento.
      if (input.searchBoost !== undefined && input.searchBoost !== before.searchBoost) {
        const now = new Date();
        await tx.$executeRaw`
          UPDATE vehicles AS v INNER JOIN users AS u ON u.id = v.sellerId
          SET v.searchBoost = ${input.searchBoost}
          WHERE v.deletedAt IS NULL AND ${
            code === 'FREE'
              ? Prisma.sql`(u.planCode = 'FREE' OR (u.planExpiresAt IS NOT NULL AND u.planExpiresAt <= ${now}))`
              : Prisma.sql`u.planCode = ${code} AND (u.planExpiresAt IS NULL OR u.planExpiresAt > ${now})`
          }`;
      }
      await recordAudit(
        { action: 'PLAN_UPDATED', entityType: 'Plan', entityId: code, actorId: adminId, ip, metadata: { before: toPlanDTO(before) as unknown as Prisma.InputJsonValue, after: { ...input } } },
        tx,
      );
      return updated;
    });
    return toPlanDTO(plan);
  },

  async settings(actorRole: Role = 'ADMIN'): Promise<AdminSettingsDTO> {
    const settings = await getSettings();
    return { ...toPublicSettings(settings), terms: toTerms(settings), binance: await adminService.binancePayee(actorRole, settings) };
  },

  // ─────────────────────────────────── Cuenta de cobro de Binance (ADMIN_ONE) ──

  async binancePayee(actorRole: Role, loaded?: Awaited<ReturnType<typeof getSettings>>): Promise<BinancePayeeDTO> {
    const settings = loaded ?? (await getSettings());
    await refreshPlatformConfig();
    const payee = currentPayee();
    const [updatedBy, openManualPayments] = await Promise.all([
      settings.binanceUpdatedById ? prisma.user.findUnique({ where: { id: settings.binanceUpdatedById }, select: { name: true } }) : null,
      prisma.payment.count({ where: { mode: 'MANUAL', status: { in: ['PENDING', 'SUBMITTED'] } } }),
    ]);
    return {
      payId: payee?.payId ?? null,
      payName: payee?.payName ?? null,
      qrImageUrl: payee?.qrImageUrl ?? null,
      source: currentPayeeSource(),
      updatedAt: settings.binanceUpdatedAt?.toISOString() ?? null,
      updatedBy: updatedBy?.name ?? null,
      canEdit: actorRole === 'ADMIN_ONE',
      openManualPayments,
    };
  },

  /**
   * Cambia la cuenta de cobro de la empresa. La ruta exige ADMIN_ONE; aquí se vuelve a
   * comprobar en la base (el rol del JWT podría ser antiguo). Queda en la auditoría y todos
   * los administradores reciben un aviso: un cambio no autorizado se ve al instante.
   */
  async updateBinancePayee(adminId: string, input: BinancePayeeUpdateInput, ip: string | null) {
    const notices = await runInTransaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: adminId }, select: { role: true, name: true, status: true, deletedAt: true } });
      if (!actor || actor.role !== 'ADMIN_ONE' || actor.status !== 'ACTIVE' || actor.deletedAt) {
        throw AppError.forbidden('ADMIN_ONE_REQUIRED', 'Solo el administrador principal puede cambiar la cuenta de cobro.');
      }
      const before = await getSettings(tx);
      const now = new Date();
      await tx.platformSettings.update({
        where: { id: 1 },
        data: { binancePayId: input.payId, binancePayName: input.payName, binanceUpdatedAt: now, binanceUpdatedById: adminId },
      });
      await recordAudit(
        {
          action: 'BINANCE_PAYEE_UPDATED',
          entityType: 'PlatformSettings',
          entityId: '1',
          actorId: adminId,
          ip,
          metadata: { before: { payId: before.binancePayId ?? currentPayee()?.payId ?? null, payName: before.binancePayName }, after: { payId: input.payId, payName: input.payName } },
        },
        tx,
      );
      const changed = before.binancePayId !== input.payId;
      return changed
        ? notifyAdmins(tx, {
            type: 'BINANCE_PAYEE_UPDATED',
            title: 'Cambió la cuenta de cobro de Binance',
            body: `${actor.name} puso el Pay ID ${input.payId} (${input.payName}). Los pagos nuevos irán a esa cuenta.`,
            link: '/admin/planes#cobro',
          })
        : [];
    });
    deliver(notices);
    await refreshPlatformConfig();
  },

  /** QR del Pay ID, paso 1: URL prefirmada al bucket público (carpeta binance-qr/). */
  async presignBinanceQr(input: { mimeType: string; sizeBytes: number }) {
    const key = `${BINANCE_QR_PREFIX}${randomUUID()}.${extensionFor(input.mimeType)}`;
    const expiresIn = 300;
    const uploadUrl = await presignUpload({ bucket: env.S3_BUCKET_MEDIA, key, contentType: input.mimeType, contentLength: input.sizeBytes, expiresIn });
    return { key, uploadUrl, method: 'PUT' as const, headers: { 'Content-Type': input.mimeType }, expiresIn };
  },

  /** Paso 2: se valida la imagen y queda como QR de la cuenta de cobro. */
  async setBinanceQr(adminId: string, key: string, ip: string | null) {
    if (!key.startsWith(BINANCE_QR_PREFIX) || key.includes('..')) throw AppError.forbidden('MEDIA_KEY_FORBIDDEN', 'Archivo no válido.');
    const stored = await statObject(env.S3_BUCKET_MEDIA, key);
    if (!stored) throw AppError.badRequest('MEDIA_NOT_UPLOADED', 'La imagen aún no termina de subirse.');
    const mimeType = baseMime(stored.contentType);
    if (stored.sizeBytes > MAX_BINANCE_QR_BYTES || sniffImageType(await readObjectStart(env.S3_BUCKET_MEDIA, key)) !== mimeType) {
      await deleteObject(env.S3_BUCKET_MEDIA, key).catch(() => undefined);
      throw AppError.badRequest('INVALID_IMAGE', 'Sube el QR como imagen JPG, PNG o WebP de hasta 2 MB.');
    }
    const previous = await runInTransaction(async tx => {
      const before = await getSettings(tx);
      if (!before.binancePayId) throw AppError.conflict('PAY_ID_REQUIRED', 'Guarda primero el Pay ID de la cuenta de cobro.');
      await tx.platformSettings.update({ where: { id: 1 }, data: { binanceQrUrl: publicMediaUrl(key), binanceQrKey: key, binanceUpdatedAt: new Date(), binanceUpdatedById: adminId } });
      await recordAudit({ action: 'BINANCE_QR_UPDATED', entityType: 'PlatformSettings', entityId: '1', actorId: adminId, ip, metadata: { key } }, tx);
      return before.binanceQrKey;
    });
    if (previous) await deleteObject(env.S3_BUCKET_MEDIA, previous).catch(() => undefined);
    await refreshPlatformConfig();
  },

  async removeBinanceQr(adminId: string, ip: string | null) {
    const previous = await runInTransaction(async tx => {
      const before = await getSettings(tx);
      await tx.platformSettings.update({ where: { id: 1 }, data: { binanceQrUrl: null, binanceQrKey: null, binanceUpdatedAt: new Date(), binanceUpdatedById: adminId } });
      await recordAudit({ action: 'BINANCE_QR_UPDATED', entityType: 'PlatformSettings', entityId: '1', actorId: adminId, ip, metadata: { key: null } }, tx);
      return before.binanceQrKey;
    });
    if (previous) await deleteObject(env.S3_BUCKET_MEDIA, previous).catch(() => undefined);
    await refreshPlatformConfig();
  },

  // ───────────────────────────────────────────────────────── Redes sociales ──

  async updateSocialLinks(adminId: string, links: SocialLinkDTO[], ip: string | null) {
    await runInTransaction(async tx => {
      await getSettings(tx);
      await tx.platformSettings.update({ where: { id: 1 }, data: { socialLinks: links as unknown as Prisma.InputJsonValue } });
      await recordAudit({ action: 'SOCIAL_LINKS_UPDATED', entityType: 'PlatformSettings', entityId: '1', actorId: adminId, ip, metadata: { links: links as unknown as Prisma.InputJsonValue } }, tx);
    });
    await refreshPlatformConfig();
  },

  /** Historial de cambios de planes, ajustes, cobro, redes y catálogo (lo más reciente primero). */
  async settingsHistory(limit: number): Promise<SettingsHistoryEntryDTO[]> {
    const rows = await prisma.auditLog.findMany({
      where: { action: { in: [...SETTINGS_ACTIONS] } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { actor: { select: { name: true, email: true } } },
    });
    return rows.map(row => ({
      id: row.id,
      action: row.action,
      summary: summarize(row.action, row.entityId, row.metadata),
      actor: row.actor ? { name: row.actor.name, email: row.actor.email } : null,
      createdAt: row.createdAt.toISOString(),
    }));
  },

  async updateSettings(adminId: string, input: PlatformSettingsInput, ip: string | null) {
    await runInTransaction(async tx => {
      await tx.platformSettings.upsert({ where: { id: 1 }, update: input, create: { id: 1, ...input } });
      await recordAudit({ action: 'SETTINGS_UPDATED', entityType: 'PlatformSettings', entityId: '1', actorId: adminId, ip, metadata: { ...input } }, tx);
    });
  },

  /** Términos y Condiciones editados desde el panel (los ve /terminos y el registro). */
  async updateTerms(adminId: string, content: string, ip: string | null) {
    await runInTransaction(async tx => {
      await tx.platformSettings.upsert({ where: { id: 1 }, update: { termsContent: content, termsUpdatedAt: new Date() }, create: { id: 1, termsContent: content, termsUpdatedAt: new Date() } });
      await recordAudit({ action: 'TERMS_UPDATED', entityType: 'PlatformSettings', entityId: '1', actorId: adminId, ip, metadata: { length: content.length } }, tx);
    });
  },

  /** Fondo del login, paso 1: URL prefirmada (PUT, 5 min) al bucket público, carpeta login-bg/. */
  presignLoginBackground: (input: { mimeType: string; sizeBytes: number }) => presignSiteImage(SITE_IMAGES.login, input),
  /** Paso 2: se verifica la imagen (tipo real, tamaño) y su ruta queda guardada en MySQL. */
  setLoginBackground: (adminId: string, key: string, ip: string | null) => setSiteImage(SITE_IMAGES.login, adminId, key, ip),
  /** Vuelve al fondo por defecto del login. */
  removeLoginBackground: (adminId: string, ip: string | null) => removeSiteImage(SITE_IMAGES.login, adminId, ip),

  /** Foto de la portada, igual que el fondo del login pero en la carpeta home-hero/. */
  presignHomeHero: (input: { mimeType: string; sizeBytes: number }) => presignSiteImage(SITE_IMAGES.home, input),
  setHomeHero: (adminId: string, key: string, ip: string | null) => setSiteImage(SITE_IMAGES.home, adminId, key, ip),
  /** Vuelve a la foto predeterminada de la portada. */
  removeHomeHero: (adminId: string, ip: string | null) => removeSiteImage(SITE_IMAGES.home, adminId, ip),

  // ─────────────────────────────────────────────────── Lista negra global ──

  blockedTerms: () => prisma.blockedTerm.findMany({ orderBy: { term: 'asc' } }),

  async addBlockedTerm(adminId: string, term: string) {
    try {
      const created = await prisma.blockedTerm.create({ data: { term } });
      await recordAudit({ action: 'BLOCKED_TERM_ADDED', entityType: 'BlockedTerm', entityId: created.id, actorId: adminId, metadata: { term } });
      invalidateBlocklist();
      return created;
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict('TERM_EXISTS', 'Ese término ya está en la lista.');
      throw err;
    }
  },

  async removeBlockedTerm(adminId: string, id: string) {
    const removed = await prisma.blockedTerm.delete({ where: { id } }).catch(() => null);
    if (!removed) throw AppError.notFound('TERM_NOT_FOUND', 'Término no encontrado.');
    await recordAudit({ action: 'BLOCKED_TERM_REMOVED', entityType: 'BlockedTerm', entityId: id, actorId: adminId, metadata: { term: removed.term } });
    invalidateBlocklist();
  },

  // ──────────────────────────────────────────────────────────── Inventario ──

  async inventory(filters: { q?: string; status?: VehicleStatus; page?: number }) {
    const where: Prisma.VehicleWhereInput = {
      ...(filters.status ? { status: filters.status } : { deletedAt: null }),
      ...(filters.q && { OR: [{ make: { contains: filters.q } }, { model: { contains: filters.q } }, { slug: { contains: filters.q } }] }),
    };
    const [rows, total, byStatus] = await Promise.all([
      prisma.vehicle.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        ...page(filters.page),
        select: { ...cardSelect, createdAt: true, expiresAt: true, seller: { select: { isVerified: true, accountType: true, businessName: true, name: true, email: true, planCode: true } }, _count: { select: { reports: { where: { status: 'OPEN' } } } } },
      }),
      prisma.vehicle.count({ where }),
      prisma.vehicle.groupBy({ by: ['status'], _count: true }),
    ]);
    return {
      items: rows.map(row => ({ ...toCardDTO(row), sellerName: row.seller.name, sellerEmail: row.seller.email, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt?.toISOString() ?? null, openReports: row._count.reports })),
      total,
      pageSize: PAGE_SIZE,
      byStatus: Object.fromEntries(byStatus.map(row => [row.status, row._count])),
    };
  },

  async archiveVehicle(adminId: string, vehicleId: string, reason: string | undefined, ip: string | null) {
    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { status: true } });
    if (!vehicle) throw AppError.notFound('VEHICLE_NOT_FOUND', 'Vehículo no encontrado.');
    if (vehicle.status === 'RESERVED' || vehicle.status === 'PENDING_SALE') throw AppError.conflict('VEHICLE_LOCKED', 'Resuelve la reserva o revisión del pago antes de retirar el anuncio.');
    await runInTransaction(async tx => {
      await tx.vehicle.update({ where: { id: vehicleId }, data: { status: 'ARCHIVED', deletedAt: new Date(), featuredUntil: null } });
      await tx.carouselItem.deleteMany({ where: { vehicleId } });
      await recordAudit({ action: 'VEHICLE_ARCHIVED_BY_ADMIN', entityType: 'Vehicle', entityId: vehicleId, actorId: adminId, ip, metadata: { reason: reason ?? null } }, tx);
    });
    realtime.statsChanged();
  },

  // ─────────────────────────────────────────── Denuncias, reseñas, contacto ──

  async reports(status: ReportStatus | undefined, pageNumber?: number) {
    const where = status ? { status } : {};
    const [rows, total] = await Promise.all([
      prisma.report.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...page(pageNumber),
        include: {
          vehicle: { select: { id: true, slug: true, make: true, model: true, year: true, status: true } },
          reporter: { select: { name: true, email: true } },
          reportedUser: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.report.count({ where }),
    ]);
    return { items: rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString(), resolvedAt: row.resolvedAt?.toISOString() ?? null })), total, pageSize: PAGE_SIZE };
  },

  async resolveReport(adminId: string, reportId: string, input: { status: Exclude<ReportStatus, 'OPEN'>; note?: string; archiveVehicle: boolean }, ip: string | null) {
    const report = await prisma.report.findUnique({ where: { id: reportId } });
    if (!report) throw AppError.notFound('REPORT_NOT_FOUND', 'Denuncia no encontrada.');
    // Retirar el anuncio solo aplica a denuncias de anuncios (las del chat son sobre una persona).
    if (input.archiveVehicle && report.kind === 'VEHICLE' && report.vehicleId) await adminService.archiveVehicle(adminId, report.vehicleId, input.note ?? `Denuncia ${report.reason}`, ip);
    await runInTransaction(async tx => {
      await tx.report.update({ where: { id: reportId }, data: { status: input.status, resolutionNote: input.note ?? null, resolvedById: adminId, resolvedAt: new Date() } });
      await recordAudit({ action: 'REPORT_RESOLVED', entityType: 'Report', entityId: reportId, actorId: adminId, ip, metadata: { status: input.status, archived: input.archiveVehicle } }, tx);
    });
  },

  async reviews(status: ReviewStatus | undefined) {
    const rows = await prisma.review.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { name: true, email: true, city: true } } },
    });
    return rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), moderatedAt: row.moderatedAt?.toISOString() ?? null }));
  },

  async moderateReview(adminId: string, reviewId: string, status: Exclude<ReviewStatus, 'PENDING'>) {
    await runInTransaction(async tx => {
      await tx.review.update({ where: { id: reviewId }, data: { status, moderatedById: adminId, moderatedAt: new Date() } });
      await recordAudit({ action: 'REVIEW_MODERATED', entityType: 'Review', entityId: reviewId, actorId: adminId, metadata: { status } }, tx);
    });
  },

  async contactMessages(status: ContactStatus | undefined) {
    const rows = await prisma.contactMessage.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString() }));
  },

  async setContactStatus(id: string, status: ContactStatus) {
    await prisma.contactMessage.update({ where: { id }, data: { status } });
  },
};
