import type { ReportCaseDTO, ReportCaseReason, ReportCaseStatus, ReportChatDTO, ReportDecisionInput, ReportsBoardDTO } from '@automarket/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Role } from '../../generated/prisma/enums.js';
import { AppError } from '../../shared/errors/app-error.js';
import { recordAudit } from '../../shared/infra/audit.js';
import { prisma } from '../../shared/infra/prisma.js';
import { effectivePlan } from '../../shared/membership.js';
import { deliver, notify } from '../../shared/notifications.js';
import { localDay } from '../boosts/boost-calendar.js';
import { vehicleInsights } from '../vehicles/vehicles.insights.js';
import { adminService } from './admin.service.js';

const SEVERITY: Record<ReportCaseReason, number> = { FRAUD: 0, OFFENSIVE: 1, WRONG_INFO: 2, SPAM: 3, OTHER: 4 };
const REASON_LABEL: Record<ReportCaseReason, string> = { FRAUD: 'Posible fraude', OFFENSIVE: 'Ofensivo', WRONG_INFO: 'Datos incorrectos', SPAM: 'Spam o duplicado', OTHER: 'Otro' };
const MAX_CASES = 120;
const MAX_MARKET_LOOKUPS = 40;
const DAY_MS = 86_400_000;

type Light = { id: string; kind: 'VEHICLE' | 'CHAT' | 'USER'; status: ReportCaseStatus; reason: ReportCaseReason; vehicleId: string | null; conversationId: string | null; reportedUserId: string | null; createdAt: Date; resolvedAt: Date | null };

const target = (r: Pick<Light, 'kind' | 'vehicleId' | 'conversationId' | 'reportedUserId'>) => (r.kind === 'VEHICLE' ? r.vehicleId : r.kind === 'CHAT' ? r.conversationId : r.reportedUserId);
/** Un caso = las denuncias del mismo objeto; los cerrados, además, por la misma decisión. */
const caseKey = (r: Light) => `${r.status}:${r.kind}:${target(r)}:${r.status === 'OPEN' ? '' : (r.resolvedAt?.toISOString().slice(0, 16) ?? '')}`;
const codeOf = (id: string) => `RP-${id.replace(/-/g, '').slice(-5).toUpperCase()}`;
const titleOf = (v: { make: string; model: string; version?: string | null; year: number }) => [v.make, v.model, v.version, v.year].filter(Boolean).join(' ');
const displayName = (u: { name: string; businessName: string | null; accountType: string }) => (u.accountType === 'DEALER' && u.businessName ? u.businessName : u.name);

/** Lunes de esta semana a las 00:00 de Venezuela. */
function weekStart(now = new Date()): Date {
  const today = localDay(now);
  const day = new Date(`${today}T00:00:00Z`);
  const offset = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - offset);
  return new Date(`${day.toISOString().slice(0, 10)}T00:00:00-04:00`);
}

function groupCases(rows: Light[]) {
  const groups = new Map<string, Light[]>();
  for (const row of rows) {
    const key = caseKey(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return [...groups.values()].map(list => {
    const sorted = [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    // La denuncia principal: la del motivo más grave (y, entre esas, la más reciente).
    const top = [...sorted].sort((a, b) => SEVERITY[a.reason] - SEVERITY[b.reason])[0]!;
    return { latest: sorted[0]!, top, reports: sorted, reason: top.reason };
  });
}

/** Sugerencia del Copiloto con reglas sobre los datos reales del caso (no inventa hechos). */
function suggest(c: Omit<ReportCaseDTO, 'suggestion'>, extra: { duplicates: number; previousOffensive: number }): string {
  if (c.status !== 'OPEN') return c.resolution?.note ? `Caso cerrado: ${c.resolution.note}` : 'Caso cerrado.';
  const age = c.reported ? Math.floor((Date.now() - new Date(c.reported.since).getTime()) / DAY_MS) : null;
  const ageText = age === 0 ? 'cuenta creada hoy' : age === 1 ? 'cuenta de hace 1 día' : `cuenta de hace ${age} días`;
  const market = c.vehicle?.market;
  if (c.kind === 'VEHICLE' && c.reason === 'FRAUD') {
    const signs = [
      market && market.diffPct <= -25 ? `precio ${Math.abs(market.diffPct)} % por debajo del mercado` : null,
      age !== null && age < 7 ? ageText : null,
      c.count > 1 ? `${c.count} personas lo reportaron` : null,
    ].filter(Boolean);
    return signs.length >= 2
      ? `${signs.join(', ').replace(/^./, s => s.toUpperCase())}: es el patrón típico de estafa. Sugiero retirar el anuncio y suspender la cuenta mientras se revisa.`
      : 'Revisa si pide pagar fuera de AutoMarket o a otra cuenta. Si se confirma, retira el anuncio y suspende la cuenta.';
  }
  if (c.kind === 'CHAT' && c.reason === 'FRAUD') return 'Pedir datos de tarjeta o pagos fuera de lo acordado está prohibido en los términos. Revisa los mensajes: si se confirma, suspende la cuenta.';
  if (c.reason === 'OFFENSIVE') {
    return extra.previousOffensive >= 2
      ? `Es su reporte número ${extra.previousOffensive + 1} por lenguaje ofensivo. Sugiero suspender la cuenta.`
      : extra.previousOffensive === 1
        ? 'Ya tuvo otro reporte por lenguaje ofensivo. Sugiero una advertencia final.'
        : 'Revisa los mensajes. Si es la primera vez, basta con una advertencia.';
  }
  if (c.reason === 'WRONG_INFO') return 'Pide al vendedor que corrija el dato. Si no lo corrige, retira el anuncio.';
  if (c.reason === 'SPAM') {
    return extra.duplicates > 1
      ? `El vendedor tiene ${extra.duplicates} anuncios iguales (misma marca, modelo y año). Deja uno y retira los demás.`
      : 'Revisa si el anuncio está repetido o no es de un auto real.';
  }
  if (c.kind === 'USER' && c.reason === 'FRAUD') return 'Revisa sus anuncios y chats. Si se confirma, suspende la cuenta.';
  return 'Lee el mensaje de quien reportó y pregúntale al vendedor antes de decidir.';
}

export const adminReports = {
  /** Bandeja «Reportes»: casos agrupados, KPIs reales y conteos por estado. */
  async board(status: ReportCaseStatus, summaryOnly = false): Promise<ReportsBoardDTO> {
    const now = new Date();
    const light = (await prisma.report.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5000,
      select: { id: true, kind: true, status: true, reason: true, vehicleId: true, conversationId: true, reportedUserId: true, createdAt: true, resolvedAt: true },
    })) as Light[];
    const cases = groupCases(light);
    const counts: Record<ReportCaseStatus, number> = { OPEN: 0, RESOLVED: 0, DISMISSED: 0 };
    for (const c of cases) counts[c.latest.status]++;
    const since = weekStart(now);
    const closed30 = light.filter(r => r.resolvedAt && r.status !== 'OPEN' && r.resolvedAt.getTime() > now.getTime() - 30 * DAY_MS);
    const kpis = {
      open: counts.OPEN,
      fraud: cases.filter(c => c.latest.status === 'OPEN' && c.reason === 'FRAUD').length,
      resolvedThisWeek: cases.filter(c => c.latest.status === 'RESOLVED' && c.latest.resolvedAt && c.latest.resolvedAt >= since).length,
      avgResponseHours: closed30.length ? Math.round((closed30.reduce((sum, r) => sum + (r.resolvedAt!.getTime() - r.createdAt.getTime()), 0) / closed30.length / 3_600_000) * 10) / 10 : null,
    };

    if (summaryOnly) return { kpis, counts, items: [] };
    const selected = cases
      .filter(c => c.latest.status === status)
      .sort((a, b) => SEVERITY[a.reason] - SEVERITY[b.reason] || b.latest.createdAt.getTime() - a.latest.createdAt.getTime())
      .slice(0, MAX_CASES);
    const full = await prisma.report.findMany({
      where: { id: { in: selected.map(c => c.top.id) } },
      include: {
        reporter: { select: { name: true } },
        resolvedBy: { select: { name: true } },
        reportedUser: { select: { id: true, name: true, businessName: true, accountType: true, isVerified: true, status: true, createdAt: true, planCode: true, planCycle: true, planExpiresAt: true } },
        vehicle: {
          select: {
            id: true, slug: true, make: true, model: true, version: true, year: true, city: true, mileageKm: true, price: true, category: true, status: true, publishedAt: true, transmission: true, sellerId: true,
            seller: { select: { id: true, name: true, businessName: true, accountType: true, isVerified: true, status: true, createdAt: true, planCode: true, planCycle: true, planExpiresAt: true } },
          },
        },
      },
    });
    const byId = new Map(full.map(row => [row.id, row]));
    const reportedIds = [...new Set(full.map(row => (row.kind === 'VEHICLE' ? row.vehicle?.sellerId : row.reportedUserId)).filter((id): id is string => Boolean(id)))];
    const [listings, againstUser] = await Promise.all([
      prisma.vehicle.groupBy({ by: ['sellerId'], where: { sellerId: { in: reportedIds }, deletedAt: null, status: { in: ['PUBLISHED', 'RESERVED'] } }, _count: { _all: true } }),
      prisma.report.findMany({ where: { OR: [{ reportedUserId: { in: reportedIds } }, { kind: 'VEHICLE', vehicle: { sellerId: { in: reportedIds } } }] }, select: { id: true, reason: true, reportedUserId: true, kind: true, vehicle: { select: { sellerId: true } } } }),
    ]);
    const listingCount = new Map(listings.map(row => [row.sellerId, row._count._all]));

    let marketLookups = 0;
    const items: ReportCaseDTO[] = [];
    for (const c of selected) {
      const row = byId.get(c.top.id);
      if (!row) continue;
      const caseIds = new Set(c.reports.map(r => r.id));
      const person = row.kind === 'VEHICLE' ? row.vehicle?.seller : row.reportedUser;
      const v = row.vehicle;
      let market: { value: number; diffPct: number } | null = null;
      if (v && row.kind === 'VEHICLE' && marketLookups < MAX_MARKET_LOOKUPS) {
        marketLookups++;
        const insight = await vehicleInsights({ make: v.make, model: v.model, year: v.year, mileageKm: v.mileageKm, transmission: v.transmission, excludeId: v.id });
        if (insight.market) market = { value: insight.market.value, diffPct: Math.round(((Number(v.price) - insight.market.value) / insight.market.value) * 100) };
      }
      const previous = person ? againstUser.filter(r => !caseIds.has(r.id) && (r.reportedUserId === person.id || r.vehicle?.sellerId === person.id)) : [];
      const previousReports = previous.length;
      const vehicleTitle = v ? titleOf(v) : '';
      const base: Omit<ReportCaseDTO, 'suggestion'> = {
        id: row.id,
        code: codeOf(row.id),
        kind: row.kind,
        reason: c.reason,
        status: row.status,
        createdAt: c.latest.createdAt.toISOString(),
        count: c.reports.length,
        title: row.kind === 'VEHICLE' ? vehicleTitle : row.kind === 'CHAT' ? `Chat con ${person ? displayName(person) : 'un usuario'}${vehicleTitle ? ` · ${vehicleTitle}` : ''}` : `Perfil de ${person ? displayName(person) : 'un usuario'}`,
        details: row.details,
        reporter: { name: c.reports.length > 1 ? 'Varias personas' : row.reporter.name, many: c.reports.length > 1 },
        reported: person
          ? {
              id: person.id,
              name: displayName(person),
              dealer: person.accountType === 'DEALER',
              planCode: effectivePlan(person).code,
              verified: person.isVerified,
              status: person.status,
              since: person.createdAt.toISOString(),
              listings: listingCount.get(person.id) ?? 0,
              previousReports,
            }
          : null,
        vehicle: v
          ? { id: v.id, slug: v.slug, title: vehicleTitle, city: v.city, mileageKm: v.mileageKm, price: v.price.toFixed(2), category: v.category, status: v.status, publishedAt: v.publishedAt?.toISOString() ?? null, market }
          : null,
        conversationId: row.conversationId,
        resolution: row.status === 'OPEN' ? null : { note: row.resolutionNote, at: row.resolvedAt?.toISOString() ?? null, by: row.resolvedBy?.name ?? null },
      };
      let duplicates = 0;
      if (row.reason === 'SPAM' && v) duplicates = await prisma.vehicle.count({ where: { sellerId: v.sellerId, make: v.make, model: v.model, year: v.year, deletedAt: null, status: { in: ['PUBLISHED', 'RESERVED', 'PAUSED'] } } });
      items.push({ ...base, suggestion: suggest(base, { duplicates, previousOffensive: previous.filter(r => r.reason === 'OFFENSIVE').length }) });
    }
    return { kpis, counts, items };
  },

  /** Mensajes del chat denunciado (solo ese hilo; el acceso queda en la auditoría). */
  async chat(adminId: string, reportId: string, ip: string | null): Promise<ReportChatDTO> {
    const report = await prisma.report.findUnique({
      where: { id: reportId },
      include: { conversation: { select: { id: true, buyerId: true, sellerId: true, vehicle: { select: { make: true, model: true, version: true, year: true } } } } },
    });
    if (!report || report.kind !== 'CHAT' || !report.conversation) throw AppError.notFound('REPORT_NOT_FOUND', 'Reporte de chat no encontrado.');
    const rows = await prisma.chatMessage.findMany({
      where: { conversationId: report.conversation.id, deletedAt: null, createdAt: { lte: new Date(report.createdAt.getTime() + 60_000) } },
      orderBy: { createdAt: 'desc' },
      take: 12,
      include: { sender: { select: { name: true, businessName: true, accountType: true } } },
    });
    await recordAudit({ action: 'REPORT_CHAT_VIEWED', entityType: 'Report', entityId: reportId, actorId: adminId, ip, metadata: { conversationId: report.conversation.id } });
    return {
      vehicleTitle: titleOf(report.conversation.vehicle),
      messages: rows.reverse().map(m => ({
        id: m.id,
        author: displayName(m.sender),
        role: m.senderId === report.conversation!.sellerId ? 'SELLER' : 'BUYER',
        body: m.body,
        type: m.type,
        hidden: Array.isArray(m.moderationFlags) && m.moderationFlags.length > 0,
        flagged: m.senderId === report.reportedUserId,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  },

  /**
   * Decide un caso (todas sus denuncias abiertas): retirar el anuncio, suspender la cuenta,
   * advertir a la persona o descartar. Guarda el resultado y la nota interna.
   */
  async decide(actor: { id: string; role: Role }, reportId: string, input: ReportDecisionInput, ip: string | null) {
    const report = await prisma.report.findUnique({
      where: { id: reportId },
      include: {
        vehicle: { select: { id: true, slug: true, make: true, model: true, version: true, year: true, sellerId: true, seller: { select: { id: true, name: true, businessName: true, accountType: true } } } },
        reportedUser: { select: { id: true, name: true, businessName: true, accountType: true } },
      },
    });
    if (!report) throw AppError.notFound('REPORT_NOT_FOUND', 'Reporte no encontrado.');
    if (report.status !== 'OPEN') throw AppError.conflict('ALREADY_DECIDED', 'Este reporte ya se resolvió.');
    const person = report.kind === 'VEHICLE' ? report.vehicle?.seller : report.reportedUser;
    const name = person ? displayName(person) : 'la persona';
    const vehicleTitle = report.vehicle ? titleOf(report.vehicle) : null;
    const group: Prisma.ReportWhereInput = {
      status: 'OPEN',
      kind: report.kind,
      ...(report.kind === 'VEHICLE' ? { vehicleId: report.vehicleId } : report.kind === 'CHAT' ? { conversationId: report.conversationId } : { reportedUserId: report.reportedUserId }),
    };
    // El motivo del caso es el más grave de sus denuncias abiertas (el que se ve en la bandeja).
    const reasons = (await prisma.report.findMany({ where: group, select: { reason: true } })).map(row => row.reason as ReportCaseReason);
    const reason = reasons.sort((a, b) => SEVERITY[a] - SEVERITY[b])[0] ?? (report.reason as ReportCaseReason);
    const reasonLabel = REASON_LABEL[reason];

    let result: string;
    switch (input.action) {
      case 'ARCHIVE': {
        if (report.kind !== 'VEHICLE' || !report.vehicle) throw AppError.badRequest('NOT_A_LISTING', 'Retirar solo aplica a reportes de anuncios.');
        await adminService.archiveVehicle(actor.id, report.vehicle.id, input.note || `Reporte: ${reasonLabel}`, ip);
        deliver([
          await notify(prisma, {
            userId: report.vehicle.sellerId,
            type: 'LISTING_REMOVED',
            title: 'Retiramos tu anuncio',
            body: `Retiramos ${vehicleTitle} por un reporte de «${reasonLabel.toLowerCase()}». Si crees que es un error, escríbenos.`,
            link: '/cuenta/anuncios',
          }),
        ]);
        result = 'Se retiró el anuncio.';
        break;
      }
      case 'SUSPEND': {
        if (!person) throw AppError.badRequest('NO_TARGET', 'Este reporte no tiene una persona a quien suspender.');
        if (report.kind === 'VEHICLE' && reason !== 'FRAUD') throw AppError.badRequest('SUSPEND_NOT_ALLOWED', 'En reportes de anuncios, suspender solo aplica a posible fraude.');
        if (!['ADMIN', 'ADMIN_ONE'].includes(actor.role)) throw AppError.forbidden('FORBIDDEN_ROLE', 'Solo un administrador puede suspender cuentas.');
        await adminService.setUserStatus(actor.id, person.id, 'SUSPENDED', ip, actor.role);
        result = `Se suspendió la cuenta de ${name}.`;
        break;
      }
      case 'WARN': {
        if (!person) throw AppError.badRequest('NO_TARGET', 'Este reporte no tiene una persona a quien avisar.');
        const where = report.kind === 'VEHICLE' ? `sobre tu anuncio ${vehicleTitle}` : report.kind === 'CHAT' ? 'por un mensaje del chat' : 'sobre tu perfil';
        deliver([
          await notify(prisma, {
            userId: person.id,
            type: 'ACCOUNT_WARNING',
            title: 'Aviso del equipo de AutoMarket',
            body: `Recibimos un reporte por «${reasonLabel.toLowerCase()}» ${where}. Revisa los Términos y políticas: si se repite, podemos suspender tu cuenta.`,
            link: '/terminos',
          }),
        ]);
        await recordAudit({ action: 'USER_WARNED', entityType: 'User', entityId: person.id, actorId: actor.id, ip, metadata: { reportId, reason } });
        result = `Se envió una advertencia a ${name}.`;
        break;
      }
      default:
        result = 'Se revisó y no se encontró problema.';
    }
    const note = input.note?.trim();
    const resolution = `${result}${note ? ` Nota: ${note}` : ''}`.slice(0, 500);
    const status = input.action === 'DISMISS' ? 'DISMISSED' : 'RESOLVED';
    const { count } = await prisma.report.updateMany({ where: group, data: { status, resolutionNote: resolution, resolvedById: actor.id, resolvedAt: new Date() } });
    await recordAudit({ action: 'REPORT_RESOLVED', entityType: 'Report', entityId: reportId, actorId: actor.id, ip, metadata: { action: input.action, status, reports: count } });
    return { status, result, name, reports: count };
  },
};
