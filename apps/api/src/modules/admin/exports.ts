import { ACCOUNT_TYPE_LABELS, COPYRIGHT_NOTICE, PLAN_LABELS, type ExportDataset } from '@automarket/contracts';
import { effectivePlan } from '../../shared/membership.js';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import PDFDocument from 'pdfkit';
import { prisma } from '../../shared/infra/prisma.js';

/**
 * Exportaciones reales del panel (.xlsx con exceljs y PDF con pdfkit), generadas en
 * streaming directamente sobre la respuesta HTTP.
 */

type Cell = string | number | null;
interface Column {
  header: string;
  key: string;
  width: number;
  /** Formato numérico de Excel (p. ej. moneda). */
  numFmt?: string;
}
interface Dataset {
  title: string;
  columns: Column[];
  rows: () => Promise<Array<Record<string, Cell>>>;
  /** Columnas numéricas que llevan una fila de totales al final. */
  totals?: string[];
}

const MAX_ROWS = 10_000;
const MONEY = '#,##0.00';
const date = (value: Date | null | undefined) => (value ? value.toISOString().slice(0, 16).replace('T', ' ') : null);
const amount = (value: { toNumber(): number } | null | undefined) => (value ? value.toNumber() : null);
const PURPOSE_LABELS = { MEMBERSHIP: 'Membresía', COMMISSION: 'Comisión', BOOST: 'Destacado', RESERVATION: 'Depósito (histórico)' } as const;
const CYCLE_LABELS = { MONTHLY: 'Mensual', YEARLY: 'Anual' } as const;
const SOURCE_LABELS = { BINANCE: 'Pago con Binance', ADMIN: 'Alta manual', SYSTEM: 'Sistema' } as const;
const vehicleTitle = (v: { make: string; model: string; year: number }) => `${v.make} ${v.model} ${v.year}`;

/**
 * Ventas concretadas: las cerradas con una reserva en AutoMarket y las ventas directas
 * que el vendedor reportó (y cuya comisión ya se confirmó).
 */
async function salesRows() {
  const [reserved, direct] = await Promise.all([
    prisma.cartReserve.findMany({
      where: { type: 'RESERVATION', status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      take: MAX_ROWS,
      include: { vehicle: { select: { make: true, model: true, year: true, city: true, country: true } }, buyer: { select: { name: true } }, seller: { select: { name: true, businessName: true, accountType: true } } },
    }),
    prisma.vehicleSale.findMany({
      where: { status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      take: MAX_ROWS,
      include: { vehicle: { select: { make: true, model: true, year: true, city: true, country: true } }, seller: { select: { name: true, businessName: true, accountType: true } } },
    }),
  ]);
  const seller = (s: { name: string; businessName: string | null; accountType: 'INDIVIDUAL' | 'DEALER' }) => (s.accountType === 'DEALER' && s.businessName ? s.businessName : s.name);
  return [
    ...reserved.map(r => ({
      at: r.completedAt ?? r.updatedAt,
      row: {
        completedAt: date(r.completedAt ?? r.updatedAt), vehicle: vehicleTitle(r.vehicle), location: `${r.vehicle.city}, ${r.vehicle.country}`, channel: 'Reserva en AutoMarket',
        seller: seller(r.seller), sellerType: ACCOUNT_TYPE_LABELS[r.seller.accountType], buyer: r.buyer.name,
        salePrice: amount(r.salePrice), commission: amount(r.commissionAmount), commissionPaidAt: date(r.commissionPaidAt),
      },
    })),
    ...direct.map(v => ({
      at: v.completedAt ?? v.updatedAt,
      row: {
        completedAt: date(v.completedAt ?? v.updatedAt), vehicle: vehicleTitle(v.vehicle), location: `${v.vehicle.city}, ${v.vehicle.country}`, channel: 'Venta directa reportada',
        seller: seller(v.seller), sellerType: ACCOUNT_TYPE_LABELS[v.seller.accountType], buyer: null,
        salePrice: amount(v.salePrice), commission: amount(v.commissionAmount), commissionPaidAt: date(v.completedAt),
      },
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, MAX_ROWS)
    .map(item => item.row);
}

/** Concesionarios con su actividad: anuncios activos, ventas concretadas y valoración. */
async function dealerRows() {
  const dealers = await prisma.user.findMany({ where: { deletedAt: null, accountType: 'DEALER' }, orderBy: { createdAt: 'desc' }, take: MAX_ROWS });
  const ids = dealers.map(d => d.id);
  if (ids.length === 0) return [];
  const [active, reservedSales, directSales, ratings] = await Promise.all([
    prisma.vehicle.groupBy({ by: ['sellerId'], where: { sellerId: { in: ids }, deletedAt: null, status: { in: ['PUBLISHED', 'RESERVED'] } }, _count: { _all: true } }),
    prisma.cartReserve.groupBy({ by: ['sellerId'], where: { sellerId: { in: ids }, type: 'RESERVATION', status: 'COMPLETED' }, _count: { _all: true }, _sum: { salePrice: true } }),
    prisma.vehicleSale.groupBy({ by: ['sellerId'], where: { sellerId: { in: ids }, status: 'COMPLETED' }, _count: { _all: true }, _sum: { salePrice: true } }),
    prisma.sellerReview.groupBy({ by: ['sellerId'], where: { sellerId: { in: ids } }, _count: { _all: true }, _avg: { rating: true } }),
  ]);
  const find = <T extends { sellerId: string }>(rows: T[], id: string) => rows.find(row => row.sellerId === id);
  return dealers.map(d => {
    const sales = (find(reservedSales, d.id)?._count._all ?? 0) + (find(directSales, d.id)?._count._all ?? 0);
    const volume = (find(reservedSales, d.id)?._sum.salePrice?.toNumber() ?? 0) + (find(directSales, d.id)?._sum.salePrice?.toNumber() ?? 0);
    const rating = find(ratings, d.id);
    return {
      businessName: d.businessName, taxId: d.taxId, contact: d.name, email: d.email, phone: d.businessPhone ?? d.phone,
      location: [d.city, d.country].filter(Boolean).join(', ') || null, plan: PLAN_LABELS[effectivePlan(d).code], verified: d.isVerified ? 'Sí' : 'No',
      activeListings: find(active, d.id)?._count._all ?? 0, sales, volume: Math.round(volume * 100) / 100,
      rating: rating?._avg.rating ? Math.round(rating._avg.rating * 10) / 10 : null, ratings: rating?._count._all ?? 0, createdAt: date(d.createdAt),
    };
  });
}

const DATASETS: Record<ExportDataset, Dataset> = {
  sales: {
    title: 'Ventas concretadas',
    columns: [
      { header: 'Fecha', key: 'completedAt', width: 17 },
      { header: 'Vehículo', key: 'vehicle', width: 30 },
      { header: 'Ubicación', key: 'location', width: 20 },
      { header: 'Canal', key: 'channel', width: 22 },
      { header: 'Vendedor', key: 'seller', width: 24 },
      { header: 'Tipo', key: 'sellerType', width: 14 },
      { header: 'Comprador', key: 'buyer', width: 22 },
      { header: 'Precio de venta', key: 'salePrice', width: 15, numFmt: MONEY },
      { header: 'Comisión', key: 'commission', width: 12, numFmt: MONEY },
      { header: 'Comisión pagada', key: 'commissionPaidAt', width: 17 },
    ],
    rows: salesRows,
    totals: ['salePrice', 'commission'],
  },
  dealers: {
    title: 'Concesionarios',
    columns: [
      { header: 'Razón social', key: 'businessName', width: 26 },
      { header: 'RIF', key: 'taxId', width: 14 },
      { header: 'Contacto', key: 'contact', width: 20 },
      { header: 'Email', key: 'email', width: 28 },
      { header: 'Teléfono', key: 'phone', width: 16 },
      { header: 'Ubicación', key: 'location', width: 18 },
      { header: 'Plan', key: 'plan', width: 18 },
      { header: 'KYC', key: 'verified', width: 6 },
      { header: 'Anuncios activos', key: 'activeListings', width: 10 },
      { header: 'Ventas', key: 'sales', width: 8 },
      { header: 'Volumen vendido', key: 'volume', width: 15, numFmt: MONEY },
      { header: 'Valoración', key: 'rating', width: 10 },
      { header: 'Opiniones', key: 'ratings', width: 9 },
      { header: 'Alta', key: 'createdAt', width: 17 },
    ],
    rows: dealerRows,
    totals: ['activeListings', 'sales', 'volume'],
  },
  memberships: {
    title: 'Compras de planes',
    columns: [
      { header: 'Fecha', key: 'createdAt', width: 17 },
      { header: 'Usuario', key: 'user', width: 24 },
      { header: 'Email', key: 'email', width: 28 },
      { header: 'Tipo de cuenta', key: 'accountType', width: 14 },
      { header: 'Plan', key: 'plan', width: 18 },
      { header: 'Ciclo', key: 'cycle', width: 9 },
      { header: 'Origen', key: 'source', width: 16 },
      { header: 'Importe', key: 'amount', width: 12, numFmt: MONEY },
      { header: 'Desde', key: 'startsAt', width: 17 },
      { header: 'Hasta', key: 'endsAt', width: 17 },
      { header: 'Referencia', key: 'reference', width: 14 },
      { header: 'Otorgado por', key: 'grantedBy', width: 20 },
    ],
    rows: async () =>
      (
        await prisma.membershipPeriod.findMany({
          where: { planCode: { not: 'FREE' } },
          orderBy: { createdAt: 'desc' },
          take: MAX_ROWS,
          include: { user: { select: { name: true, email: true, accountType: true } }, grantedBy: { select: { name: true } }, payment: { select: { reference: true } } },
        })
      ).map(m => ({
        createdAt: date(m.createdAt), user: m.user.name, email: m.user.email, accountType: ACCOUNT_TYPE_LABELS[m.user.accountType], plan: PLAN_LABELS[m.planCode],
        cycle: m.cycle ? CYCLE_LABELS[m.cycle] : null, source: SOURCE_LABELS[m.source], amount: amount(m.amount), startsAt: date(m.startsAt), endsAt: date(m.endsAt),
        reference: m.payment?.reference ?? null, grantedBy: m.grantedBy?.name ?? null,
      })),
    totals: ['amount'],
  },
  users: {
    title: 'Usuarios',
    columns: [
      { header: 'Nombre', key: 'name', width: 26 },
      { header: 'Email', key: 'email', width: 32 },
      { header: 'Rol', key: 'role', width: 9 },
      { header: 'Estado', key: 'status', width: 11 },
      { header: 'País', key: 'country', width: 6 },
      { header: 'Ciudad', key: 'city', width: 18 },
      { header: 'Tipo', key: 'accountType', width: 14 },
      { header: 'Razón social', key: 'businessName', width: 26 },
      { header: 'RIF', key: 'taxId', width: 14 },
      { header: 'Plan', key: 'plan', width: 14 },
      { header: 'Vence', key: 'planExpiresAt', width: 17 },
      { header: 'KYC', key: 'verified', width: 6 },
      { header: 'Alta', key: 'createdAt', width: 17 },
    ],
    rows: async () =>
      (await prisma.user.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: MAX_ROWS })).map(u => ({
        name: u.name, email: u.email, role: u.role, status: u.status, country: u.country, city: u.city,
        accountType: ACCOUNT_TYPE_LABELS[u.accountType], businessName: u.businessName, taxId: u.taxId, plan: PLAN_LABELS[u.planCode],
        planExpiresAt: date(u.planExpiresAt), verified: u.isVerified ? 'Sí' : 'No', createdAt: date(u.createdAt),
      })),
  },
  vehicles: {
    title: 'Inventario de vehículos',
    columns: [
      { header: 'Vehículo', key: 'title', width: 34 },
      { header: 'Año', key: 'year', width: 7 },
      { header: 'Condición', key: 'condition', width: 10 },
      { header: 'Dueños', key: 'owners', width: 8 },
      { header: 'Precio', key: 'price', width: 13, numFmt: MONEY },
      { header: 'Estado', key: 'status', width: 11 },
      { header: 'Ubicación', key: 'location', width: 22 },
      { header: 'Vendedor', key: 'seller', width: 24 },
      { header: 'Publicado', key: 'publishedAt', width: 17 },
      { header: 'Vence', key: 'expiresAt', width: 17 },
    ],
    rows: async () =>
      (await prisma.vehicle.findMany({ orderBy: { createdAt: 'desc' }, take: MAX_ROWS, include: { seller: { select: { name: true } } } })).map(v => ({
        title: `${v.make} ${v.model}${v.version ? ` ${v.version}` : ''}`, year: v.year, condition: v.condition === 'NEW' ? 'Nuevo' : 'Usado',
        owners: v.ownersCount, price: amount(v.price), status: v.status, location: `${v.city}, ${v.country}`, seller: v.seller.name,
        publishedAt: date(v.publishedAt), expiresAt: date(v.expiresAt),
      })),
  },
  reservations: {
    title: 'Reservas',
    columns: [
      { header: 'Vehículo', key: 'vehicle', width: 30 },
      { header: 'Comprador', key: 'buyer', width: 22 },
      { header: 'Vendedor', key: 'seller', width: 22 },
      { header: 'Estado', key: 'status', width: 16 },
      { header: 'Abono (P2P)', key: 'deposit', width: 12, numFmt: MONEY },
      { header: 'Precio venta', key: 'salePrice', width: 13, numFmt: MONEY },
      { header: 'Comisión', key: 'commission', width: 12, numFmt: MONEY },
      { header: 'Comisión pagada', key: 'commissionPaidAt', width: 17 },
      { header: 'Creada', key: 'createdAt', width: 17 },
    ],
    rows: async () =>
      (
        await prisma.cartReserve.findMany({
          where: { type: 'RESERVATION' },
          orderBy: { createdAt: 'desc' },
          take: MAX_ROWS,
          include: { vehicle: { select: { make: true, model: true, year: true } }, buyer: { select: { name: true } }, seller: { select: { name: true } } },
        })
      ).map(r => ({
        vehicle: `${r.vehicle.make} ${r.vehicle.model} ${r.vehicle.year}`, buyer: r.buyer.name, seller: r.seller.name, status: r.status,
        deposit: amount(r.depositAmount), salePrice: amount(r.salePrice), commission: amount(r.commissionAmount), commissionPaidAt: date(r.commissionPaidAt), createdAt: date(r.createdAt),
      })),
  },
  payments: {
    title: 'Pagos con Binance',
    columns: [
      { header: 'Fecha', key: 'createdAt', width: 17 },
      { header: 'Usuario', key: 'user', width: 28 },
      { header: 'Concepto', key: 'purpose', width: 13 },
      { header: 'Plan', key: 'plan', width: 14 },
      { header: 'Estado', key: 'status', width: 18 },
      { header: 'Importe', key: 'amount', width: 12, numFmt: MONEY },
      { header: 'Reembolsado', key: 'refunded', width: 12, numFmt: MONEY },
      { header: 'Modo', key: 'mode', width: 10 },
      { header: 'Referencia', key: 'reference', width: 14 },
      { header: 'Transacción Binance', key: 'txId', width: 24 },
    ],
    rows: async () =>
      (await prisma.payment.findMany({ orderBy: { createdAt: 'desc' }, take: MAX_ROWS, include: { user: { select: { email: true } } } })).map(p => ({
        createdAt: date(p.createdAt), user: p.user.email, purpose: PURPOSE_LABELS[p.purpose],
        plan: p.planCode ? `${p.planCode} ${p.cycle ?? ''}`.trim() : null, status: p.status, amount: amount(p.amount), refunded: amount(p.refundedAmount),
        mode: p.mode === 'MERCHANT' ? 'Binance Pay' : 'Pay ID', reference: p.reference, txId: p.txId,
      })),
  },
  reports: {
    title: 'Denuncias',
    columns: [
      { header: 'Fecha', key: 'createdAt', width: 17 },
      { header: 'Denunciado', key: 'vehicle', width: 36 },
      { header: 'Motivo', key: 'reason', width: 12 },
      { header: 'Detalle', key: 'details', width: 40 },
      { header: 'Denunciante', key: 'reporter', width: 26 },
      { header: 'Estado', key: 'status', width: 11 },
    ],
    rows: async () =>
      (
        await prisma.report.findMany({
          orderBy: { createdAt: 'desc' },
          take: MAX_ROWS,
          include: { vehicle: { select: { make: true, model: true, year: true } }, reporter: { select: { email: true } }, reportedUser: { select: { name: true } } },
        })
      ).map(r => ({
        createdAt: date(r.createdAt),
        // Anuncio denunciado; en el chat o en un perfil, la persona denunciada.
        vehicle: [r.kind === 'VEHICLE' ? null : `${r.kind === 'CHAT' ? 'Chat' : 'Perfil'}: ${r.reportedUser?.name ?? '—'}`, r.vehicle ? `${r.vehicle.make} ${r.vehicle.model} ${r.vehicle.year}` : null].filter(Boolean).join(' · '),
        reason: r.reason,
        details: r.details,
        reporter: r.reporter.email,
        status: r.status,
      })),
  },
  reviews: {
    title: 'Opiniones de usuarios',
    columns: [
      { header: 'Fecha', key: 'createdAt', width: 17 },
      { header: 'Autor', key: 'author', width: 22 },
      { header: 'Email', key: 'email', width: 28 },
      { header: 'Ciudad', key: 'city', width: 16 },
      { header: 'Valoración', key: 'rating', width: 10 },
      { header: 'Estado', key: 'status', width: 11 },
      { header: 'Comentario', key: 'comment', width: 60 },
    ],
    rows: async () =>
      (await loadReviews()).map(r => ({
        createdAt: date(r.createdAt), author: r.user.name, email: r.user.email, city: r.user.city, rating: r.rating, status: REVIEW_STATUS_LABELS[r.status], comment: r.comment,
      })),
  },
};

const REVIEW_STATUS_LABELS = { PENDING: 'Pendiente', APPROVED: 'Aprobada', REJECTED: 'Rechazada' } as const;

function loadReviews() {
  return prisma.review.findMany({ orderBy: { createdAt: 'desc' }, take: MAX_ROWS, include: { user: { select: { name: true, email: true, city: true } } } });
}

/** Pie de página de todas las hojas: derechos de autor y numeración. */
function stampFooter(doc: PDFKit.PDFDocument) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.height - doc.page.margins.bottom;
    // Escribir dentro del margen inferior no debe crear páginas nuevas.
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7).fillColor('#94a3b8');
    doc.text(`${COPYRIGHT_NOTICE} · Página ${i - range.start + 1} de ${range.count}`, doc.page.margins.left, bottom + 12, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      align: 'center',
      lineBreak: false,
    });
  }
}

/**
 * Informe PDF de opiniones: resumen (media y distribución por estrellas) y cada opinión completa
 * (la tabla genérica recortaría los comentarios).
 */
async function exportReviewsPdf(res: Response) {
  const reviews = await loadReviews();
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: 'AutoMarket · Opiniones de usuarios', Author: 'AutoMarket' } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName('reviews', 'pdf')}"`);
  doc.pipe(res);

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const dots = (rating: number, x: number, y: number) => {
    for (let i = 0; i < 5; i++) doc.circle(x + i * 10, y, 3.2).fill(i < rating ? '#f59e0b' : '#e2e8f0');
  };

  const average = reviews.length ? reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length : 0;
  const approved = reviews.filter(r => r.status === 'APPROVED');
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#0f172a').text('AutoMarket · Opiniones de usuarios');
  doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(`Generado el ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  doc.moveDown(1);

  // Resumen
  doc.font('Helvetica-Bold').fontSize(30).fillColor('#0f172a').text(reviews.length ? average.toFixed(1).replace('.', ',') : '—', left, doc.y, { continued: true });
  doc.font('Helvetica').fontSize(11).fillColor('#64748b').text(`  / 5 · ${reviews.length} opiniones · ${approved.length} publicadas en la web`);
  doc.moveDown(0.6);
  for (let stars = 5; stars >= 1; stars--) {
    const count = reviews.filter(r => r.rating === stars).length;
    const y = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor('#334155').text(`${stars} estrellas`, left, y, { width: 60 });
    doc.rect(left + 64, y + 1, 200, 8).fill('#e2e8f0');
    if (count > 0) doc.rect(left + 64, y + 1, (200 * count) / reviews.length, 8).fill('#f59e0b');
    doc.fillColor('#334155').text(String(count), left + 272, y, { width: 40 });
    doc.y = y + 14;
  }
  doc.moveDown(1);

  for (const review of reviews) {
    const meta = `${review.user.name}${review.user.city ? ` · ${review.user.city}` : ''} · ${date(review.createdAt)} UTC · ${REVIEW_STATUS_LABELS[review.status]}`;
    doc.font('Helvetica').fontSize(10);
    const height = doc.heightOfString(review.comment, { width }) + 38;
    if (doc.y + height > bottom()) doc.addPage();
    const y = doc.y;
    doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.5).stroke('#e2e8f0');
    dots(review.rating, left + 4, y + 12);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text(meta, left + 60, y + 7, { width: width - 60, lineBreak: false, ellipsis: true });
    doc.font('Helvetica').fontSize(10).fillColor('#334155').text(review.comment, left, y + 22, { width });
    doc.y += 10;
  }
  if (reviews.length === 0) doc.font('Helvetica').fontSize(10).fillColor('#64748b').text('Aún no hay opiniones.');

  stampFooter(doc);
  doc.end();
}

const fileName = (dataset: ExportDataset, ext: string) => `automarket-${dataset}-${new Date().toISOString().slice(0, 10)}.${ext}`;

export async function exportXlsx(dataset: ExportDataset, res: Response) {
  const spec = DATASETS[dataset];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AutoMarket';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(spec.title, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = spec.columns.map(col => ({ header: col.header, key: col.key, width: col.width, style: col.numFmt ? { numFmt: col.numFmt } : {} }));
  const rows = await spec.rows();
  sheet.addRows(rows);
  if (spec.totals?.length && rows.length) {
    // Fila de totales con fórmulas: se recalcula si alguien filtra o corrige celdas en Excel.
    const last = rows.length + 1;
    sheet.addRow({}); // fila en blanco: el autofiltro de Excel no incluye los totales
    const total = sheet.addRow({});
    spec.columns.forEach((col, i) => {
      const cell = total.getCell(i + 1);
      if (i === 0) cell.value = 'Total';
      if (spec.totals!.includes(col.key)) {
        const letter = sheet.getColumn(i + 1).letter;
        cell.value = { formula: `SUBTOTAL(9,${letter}2:${letter}${last})` };
      }
    });
    total.font = { bold: true };
    total.border = { top: { style: 'thin', color: { argb: 'FF0F172A' } } };
  }
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: spec.columns.length } };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName(dataset, 'xlsx')}"`);
  await workbook.xlsx.write(res);
  res.end();
}

export async function exportPdf(dataset: ExportDataset, res: Response) {
  if (dataset === 'reviews') return exportReviewsPdf(res);
  const spec = DATASETS[dataset];
  const rows = await spec.rows();
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true, info: { Title: `AutoMarket · ${spec.title}`, Author: 'AutoMarket' } });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName(dataset, 'pdf')}"`);
  doc.pipe(res);

  const left = doc.page.margins.left;
  const usable = doc.page.width - left - doc.page.margins.right;
  const totalWidth = spec.columns.reduce((acc, col) => acc + col.width, 0);
  const widths = spec.columns.map(col => (col.width / totalWidth) * usable);
  const bottom = doc.page.height - doc.page.margins.bottom;

  const format = (value: Cell, col: Column) =>
    value === null ? '—' : typeof value === 'number' && col.numFmt ? value.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(value);

  const drawHeader = () => {
    let x = left;
    const y = doc.y;
    doc.rect(left, y - 3, usable, 18).fill('#0f172a');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
    spec.columns.forEach((col, i) => {
      doc.text(col.header, x + 3, y + 1, { width: widths[i]! - 6, lineBreak: false, ellipsis: true });
      x += widths[i]!;
    });
    doc.fillColor('#0f172a').font('Helvetica').fontSize(8);
    doc.y = y + 20;
  };

  doc.font('Helvetica-Bold').fontSize(16).fillColor('#0f172a').text(`AutoMarket · ${spec.title}`);
  doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(`Generado el ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${rows.length} registros`);
  doc.moveDown(0.8);
  drawHeader();

  rows.forEach((row, index) => {
    if (doc.y + 16 > bottom) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    if (index % 2 === 1) doc.rect(left, y - 3, usable, 16).fill('#f1f5f9').fillColor('#0f172a');
    let x = left;
    spec.columns.forEach((col, i) => {
      doc.text(format(row[col.key] ?? null, col), x + 3, y, { width: widths[i]! - 6, lineBreak: false, ellipsis: true, align: col.numFmt ? 'right' : 'left' });
      x += widths[i]!;
    });
    doc.y = y + 16;
  });
  if (rows.length === 0) doc.text('Sin registros.', left, doc.y + 6);
  if (spec.totals?.length && rows.length) {
    if (doc.y + 20 > bottom) doc.addPage();
    const y = doc.y + 2;
    doc.moveTo(left, y - 3).lineTo(left + usable, y - 3).lineWidth(0.8).stroke('#0f172a');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a');
    let x = left;
    spec.columns.forEach((col, i) => {
      const value = spec.totals!.includes(col.key) ? rows.reduce((acc, row) => acc + (typeof row[col.key] === 'number' ? (row[col.key] as number) : 0), 0) : null;
      const text = i === 0 ? 'Total' : value === null ? '' : format(Math.round(value * 100) / 100, col);
      doc.text(text, x + 3, y, { width: widths[i]! - 6, lineBreak: false, ellipsis: true, align: col.numFmt || value !== null ? 'right' : 'left' });
      x += widths[i]!;
    });
    doc.font('Helvetica');
    doc.y = y + 16;
  }
  stampFooter(doc);
  doc.end();
}
