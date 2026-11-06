import { BOOST_LABELS, PLAN_LABELS, type AdminActivityDTO, type AdminCalendarDTO, type AdminSearchDTO } from '@automarket/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../shared/infra/prisma.js';
import { localDay } from '../boosts/boost-calendar.js';

/**
 * Resumen del panel: calendario de vencimientos, actividad reciente y buscador. Todo sale de la
 * base; los días van en hora de Venezuela (UTC-4), igual que Estadísticas.
 */
const TZ = '-04:00';
const DOCUMENT_LABEL: Record<string, string> = {
  NATIONAL_ID: 'su cédula',
  PASSPORT: 'su pasaporte',
  DRIVER_LICENSE: 'su licencia de conducir',
  SELFIE: 'su selfie con el documento',
  PROOF_OF_ADDRESS: 'un comprobante de domicilio',
  BUSINESS_REGISTRATION: 'el documento del RIF',
};
const REASON_LABEL: Record<string, string> = { FRAUD: 'posible fraude', WRONG_INFO: 'datos incorrectos', OFFENSIVE: 'lenguaje ofensivo', SPAM: 'spam o duplicado', OTHER: 'otro motivo' };
const displayName = (u: { name: string; businessName: string | null; accountType: string }) => (u.accountType === 'DEALER' && u.businessName ? u.businessName : u.name);
const vehicleTitle = (v: { make: string; model: string; version?: string | null; year: number }) => [v.make, v.model, v.version, v.year].filter(Boolean).join(' ');

type PaymentConcept = { purpose: string; planCode: string | null; cycle: string | null; boost: { kind: string; days: number } | null; vehicleSale: { vehicle: { make: string; model: string } } | null; reservation: { vehicle: { make: string; model: string } } | null };
export function paymentConcept(p: PaymentConcept): string {
  if (p.purpose === 'MEMBERSHIP') return `Plan ${PLAN_LABELS[p.planCode as keyof typeof PLAN_LABELS] ?? ''} · ${p.cycle === 'YEARLY' ? 'anual' : 'mensual'}`;
  if (p.purpose === 'BOOST' && p.boost) return p.boost.kind === 'LOGIN' ? `Pantalla de entrada (${p.boost.days === 1 ? '1 día' : `${p.boost.days} días`})` : BOOST_LABELS[p.boost.kind as keyof typeof BOOST_LABELS];
  const car = p.vehicleSale?.vehicle ?? p.reservation?.vehicle;
  if (p.purpose === 'COMMISSION') return car ? `Comisión · ${car.make} ${car.model}` : 'Comisión por venta';
  return 'Abono de reserva';
}
export const paymentConceptSelect = {
  purpose: true,
  planCode: true,
  cycle: true,
  boost: { select: { kind: true, days: true } },
  vehicleSale: { select: { vehicle: { select: { make: true, model: true } } } },
  reservation: { select: { vehicle: { select: { make: true, model: true } } } },
} as const;

export const adminOverview = {
  /** Días del mes con una reserva confirmada que vence o una comisión sin pagar que vence. */
  async calendar(month: string): Promise<AdminCalendarDTO> {
    const start = new Date(`${month}-01T00:00:00${TZ}`);
    const [y, m] = month.split('-').map(Number) as [number, number];
    const end = new Date(`${new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7)}-01T00:00:00${TZ}`);
    const day = (column: Prisma.Sql) => Prisma.sql`DAY(CONVERT_TZ(${column}, '+00:00', ${TZ}))`;
    const [reservations, commissions] = await Promise.all([
      prisma.$queryRaw<Array<{ d: number }>>`
        SELECT DISTINCT ${day(Prisma.sql`expiresAt`)} AS d FROM cart_reserves
        WHERE type = 'RESERVATION' AND status = 'ACCEPTED' AND expiresAt >= ${start} AND expiresAt < ${end}`,
      prisma.$queryRaw<Array<{ d: number }>>`
        SELECT DISTINCT ${day(Prisma.sql`commissionDueAt`)} AS d FROM cart_reserves
        WHERE status IN ('ACCEPTED', 'COMPLETED') AND commissionAmount > 0 AND commissionPaidAt IS NULL AND commissionDueAt >= ${start} AND commissionDueAt < ${end}`,
    ]);
    const days = (rows: Array<{ d: number }>) => rows.map(row => Number(row.d)).sort((a, b) => a - b);
    return { month, today: localDay(), reservations: days(reservations), commissions: days(commissions) };
  },

  /** Lo último que pasó en la plataforma: documentos, denuncias, pagos, publicaciones y opiniones. */
  async activity(limit = 6): Promise<AdminActivityDTO[]> {
    const take = limit;
    const [kyc, reports, payments, listings, reviews, sellerReviews] = await Promise.all([
      prisma.kycDocument.findMany({ orderBy: { createdAt: 'desc' }, take, select: { type: true, status: true, createdAt: true, user: { select: { name: true, businessName: true, accountType: true } } } }),
      prisma.report.findMany({
        orderBy: { createdAt: 'desc' },
        take,
        select: { kind: true, reason: true, status: true, createdAt: true, vehicle: { select: { make: true, model: true, version: true, year: true } }, reportedUser: { select: { name: true, businessName: true, accountType: true } } },
      }),
      prisma.payment.findMany({
        where: { OR: [{ status: 'SUBMITTED' }, { paidAt: { not: null } }] },
        orderBy: { updatedAt: 'desc' },
        take,
        select: { mode: true, status: true, submittedAt: true, paidAt: true, updatedAt: true, user: { select: { name: true, businessName: true, accountType: true } }, ...paymentConceptSelect },
      }),
      prisma.vehicle.findMany({
        where: { publishedAt: { not: null }, deletedAt: null },
        orderBy: { publishedAt: 'desc' },
        take,
        select: { slug: true, make: true, model: true, version: true, year: true, publishedAt: true, seller: { select: { name: true, businessName: true, accountType: true } } },
      }),
      prisma.review.findMany({ orderBy: { createdAt: 'desc' }, take, select: { rating: true, status: true, createdAt: true, user: { select: { name: true, businessName: true, accountType: true } } } }),
      prisma.sellerReview.findMany({
        orderBy: { createdAt: 'desc' },
        take,
        select: { rating: true, createdAt: true, sellerId: true, buyer: { select: { name: true, businessName: true, accountType: true } }, seller: { select: { name: true, businessName: true, accountType: true } } },
      }),
    ]);
    const stars = (n: number) => (n === 1 ? '1 estrella' : `${n} estrellas`);
    const items: AdminActivityDTO[] = [
      ...kyc.map(d => ({
        kind: 'KYC' as const,
        who: displayName(d.user),
        what: `envió ${DOCUMENT_LABEL[d.type] ?? 'un documento'}.`,
        at: d.createdAt.toISOString(),
        action: d.status === 'PENDING' ? { label: 'Revisar', href: '/admin/kyc' } : null,
      })),
      ...reports.map(r => ({
        kind: 'REPORT' as const,
        who: r.vehicle ? vehicleTitle(r.vehicle) : r.reportedUser ? displayName(r.reportedUser) : 'Un chat',
        what: `recibió una denuncia por ${REASON_LABEL[r.reason] ?? 'otro motivo'}.`,
        at: r.createdAt.toISOString(),
        action: r.status === 'OPEN' ? { label: 'Moderar', href: '/admin/reportes' } : null,
      })),
      ...payments.map(p => {
        const paid = p.paidAt !== null;
        return {
          kind: 'PAYMENT' as const,
          who: displayName(p.user),
          what: paid ? `pagó ${paymentConcept(p).replace(/^Plan /, 'el plan ')} por ${p.mode === 'MERCHANT' ? 'Binance Pay' : 'Binance'}.` : `envió un pago por ${paymentConcept(p).replace(/^Plan /, 'el plan ')}.`,
          at: (paid ? p.paidAt! : (p.submittedAt ?? p.updatedAt)).toISOString(),
          action: p.status === 'SUBMITTED' ? { label: 'Verificar', href: '/admin/pagos' } : { label: 'Ver', href: '/admin/pagos?tab=todos' },
        };
      }),
      ...listings.map(v => ({
        kind: 'LISTING' as const,
        who: displayName(v.seller),
        what: `publicó un ${vehicleTitle(v)}.`,
        at: v.publishedAt!.toISOString(),
        action: { label: 'Ver', href: `/vehiculos/${v.slug}` },
      })),
      ...reviews.map(r => ({
        kind: 'REVIEW' as const,
        who: displayName(r.user),
        what: `dejó una opinión de ${stars(r.rating)}.`,
        at: r.createdAt.toISOString(),
        action: r.status === 'PENDING' ? { label: 'Moderar', href: '/admin/moderacion' } : null,
      })),
      ...sellerReviews.map(r => ({
        kind: 'REVIEW' as const,
        who: displayName(r.buyer),
        what: `calificó a ${displayName(r.seller)} con ${stars(r.rating)}.`,
        at: r.createdAt.toISOString(),
        action: { label: 'Ver', href: `/vendedores/${r.sellerId}` },
      })),
    ];
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  },

  /** Buscador del Resumen: personas, anuncios y pagos que coinciden. */
  async search(q: string): Promise<AdminSearchDTO> {
    const term = q.trim();
    if (term.length < 2) return { users: [], vehicles: [], payments: [] };
    const [users, vehicles, payments] = await Promise.all([
      prisma.user.findMany({
        where: { deletedAt: null, OR: [{ name: { contains: term } }, { email: { contains: term } }, { businessName: { contains: term } }, { taxId: { contains: term } }, { phone: { contains: term } }] },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, name: true, email: true, businessName: true, accountType: true },
      }),
      prisma.vehicle.findMany({
        where: { deletedAt: null, OR: [{ make: { contains: term } }, { model: { contains: term } }, { vin: { contains: term } }, { slug: { contains: term } }] },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, slug: true, make: true, model: true, version: true, year: true, status: true, seller: { select: { name: true, businessName: true, accountType: true } } },
      }),
      prisma.payment.findMany({
        where: { OR: [{ reference: { contains: term } }, { txId: { contains: term } }, { user: { OR: [{ name: { contains: term } }, { email: { contains: term } }] } }] },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, reference: true, amount: true, status: true, user: { select: { name: true, businessName: true, accountType: true } } },
      }),
    ]);
    return {
      users: users.map(u => ({ id: u.id, name: displayName(u), email: u.email, accountType: u.accountType })),
      vehicles: vehicles.map(v => ({ id: v.id, slug: v.slug, title: vehicleTitle(v), seller: displayName(v.seller), status: v.status })),
      payments: payments.map(p => ({ id: p.id, reference: p.reference, user: displayName(p.user), amount: p.amount.toFixed(2), status: p.status })),
    };
  },
};
