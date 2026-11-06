import {
  BinancePayeeUpdateSchema,
  BinanceQrUploadSchema,
  BlockedTermSchema,
  BrandCreateSchema,
  BrandModelsAddSchema,
  BrandModelUpdateSchema,
  BrandUpdateSchema,
  SocialLinksUpdateSchema,
  CarouselUpdateSchema,
  EXPORT_DATASETS,
  EXPORT_FORMATS,
  ManualMembershipSchema,
  PLAN_CODES,
  PlanUpdateSchema,
  PaymentReviewSchema,
  LoginBackgroundRegisterSchema,
  LoginBackgroundUploadSchema,
  PlatformSettingsSchema,
  TermsUpdateSchema,
  RefundCompleteSchema,
  REPORT_STATUSES,
  REVIEW_STATUSES,
  ReportDecisionSchema,
  ReportResolutionSchema,
  type ReportDecisionInput,
  ReviewModerationSchema,
  UserStatusUpdateSchema,
  UserRoleUpdateSchema,
  VEHICLE_STATUSES,
  type BinancePayeeUpdateInput,
  type BrandCreateInput,
  type BrandUpdateInput,
  type CarouselUpdateInput,
  type ManualMembershipInput,
  type PlanUpdateInput,
} from '@automarket/contracts';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize, currentUser, requireAdmin, requireAdminOne, requireCompliance } from '../../shared/http/middlewares/auth.middleware.js';
import { validateBody } from '../../shared/http/middlewares/validate.js';
import { catalogService } from '../catalog/catalog.service.js';
import { membershipsService } from '../memberships/memberships.service.js';
import { paymentsService } from '../payments/payments.service.js';
import { showcaseService } from '../showcase/showcase.service.js';
import { adminService } from './admin.service.js';
import { exportPdf, exportXlsx } from './exports.js';
import { adminReports } from './admin.reports.js';
import { cachedAdminStats } from './admin.stats.js';
import { adminCopilot } from './admin.copilot.js';
import { adminOverview } from './admin.overview.js';

const IdParams = z.object({ id: z.uuid() });
const PageQuery = z.object({ page: z.coerce.number().int().min(1).max(10_000).optional(), q: z.string().trim().max(80).optional() });
const SettingsSchema = PlatformSettingsSchema;
/** Respuesta de los ajustes con los permisos de quien pregunta (p. ej. si puede cambiar el cobro). */
const settingsFor = (req: Parameters<typeof currentUser>[0]) => adminService.settings(currentUser(req).role);

/** /api/admin — panel de administración (solo rol ADMIN). La revisión KYC vive en /api/admin/kyc. */
export const adminRouter = Router();
adminRouter.use(authenticate, requireAdmin);

adminRouter.get('/metrics', async (req, res) => {
  const { months } = z.object({ months: z.coerce.number().int().min(1).max(36).default(12) }).parse(req.query);
  res.json({ data: await adminService.metrics(months) });
});

/** Estadísticas del panel: series mensuales reales (6 meses, el último en curso). */
adminRouter.get('/stats', async (_req, res) => {
  res.json({ data: await cachedAdminStats() });
});

// Resumen: calendario de vencimientos, actividad reciente y buscador
adminRouter.get('/overview/calendar', async (req, res) => {
  const { month } = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() }).parse(req.query);
  res.json({ data: await adminOverview.calendar(month ?? new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 7)) });
});

adminRouter.get('/overview/activity', async (_req, res) => {
  res.json({ data: await adminOverview.activity(6) });
});

adminRouter.get('/search', async (req, res) => {
  const { q } = z.object({ q: z.string().trim().max(80).default('') }).parse(req.query);
  res.json({ data: await adminOverview.search(q) });
});

// Copiloto del admin: series de Estadísticas + desgloses y alertas calculadas (solo lectura)
adminRouter.get('/copilot', async (req, res) => {
  res.json({ data: await adminCopilot(currentUser(req).id) });
});

// Usuarios y membresías
adminRouter.get('/users', async (req, res) => {
  const query = PageQuery.extend({ plan: z.enum(PLAN_CODES).optional(), status: z.enum(['ACTIVE', 'SUSPENDED']).optional() }).parse(req.query);
  res.json({ data: await adminService.users(query) });
});

adminRouter.patch('/users/:id/status', validateBody(UserStatusUpdateSchema), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  const actor = currentUser(req);
  await adminService.setUserStatus(actor.id, id, (req.body as z.infer<typeof UserStatusUpdateSchema>).status, req.ip ?? null, actor.role);
  res.status(204).end();
});

adminRouter.patch('/users/:id/role', requireAdminOne, validateBody(UserRoleUpdateSchema), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  await adminService.setUserRole(currentUser(req).id, id, (req.body as z.infer<typeof UserRoleUpdateSchema>).role, req.ip ?? null);
  res.status(204).end();
});

/** Activación / renovación / baja manual de la membresía de un usuario. */
adminRouter.post('/users/:id/membership', validateBody(ManualMembershipSchema), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  await membershipsService.grantManually(currentUser(req).id, id, req.body as ManualMembershipInput, req.ip ?? null);
  res.status(204).end();
});

// Pagos con Binance: verificación de pagos manuales y reembolsos por enviar
adminRouter.get('/payments', async (req, res) => {
  const { view } = z.object({ view: z.enum(['review', 'refunds', 'all']).default('review') }).parse(req.query);
  res.json({ data: await paymentsService.listForAdmin(view) });
});

adminRouter.get('/payments/counts', async (_req, res) => {
  res.json({ data: await paymentsService.adminCounts() });
});

adminRouter.post('/payments/:id/review', validateBody(PaymentReviewSchema), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  const { decision, note } = req.body as z.infer<typeof PaymentReviewSchema>;
  await paymentsService.review(currentUser(req).id, id, decision, note);
  res.status(204).end();
});

adminRouter.post('/payments/:id/refund-sent', validateBody(RefundCompleteSchema), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  await paymentsService.completeManualRefund(currentUser(req).id, id, (req.body as z.infer<typeof RefundCompleteSchema>).refundTxId);
  res.status(204).end();
});

// Planes (precios mensual/anual y comisión) y ajustes globales
adminRouter.get('/plans', async (_req, res) => {
  res.json({ data: await adminService.plans() });
});

adminRouter.patch('/plans/:code', validateBody(PlanUpdateSchema), async (req, res) => {
  const { code } = z.object({ code: z.enum(PLAN_CODES) }).parse(req.params);
  res.json({ data: await adminService.updatePlan(currentUser(req).id, code, req.body as PlanUpdateInput, req.ip ?? null) });
});

adminRouter.get('/settings', async (req, res) => {
  res.json({ data: await settingsFor(req) });
});

adminRouter.put('/settings', validateBody(SettingsSchema), async (req, res) => {
  await adminService.updateSettings(currentUser(req).id, req.body as z.infer<typeof SettingsSchema>, req.ip ?? null);
  res.json({ data: await settingsFor(req) });
});

/** Editor de Términos y Condiciones (se guardan en MySQL; los publica /terminos). */
adminRouter.put('/settings/terms', validateBody(TermsUpdateSchema), async (req, res) => {
  const { content } = req.body as z.infer<typeof TermsUpdateSchema>;
  await adminService.updateTerms(currentUser(req).id, content, req.ip ?? null);
  res.json({ data: await settingsFor(req) });
});

/**
 * Cuenta de cobro de Binance: solo el administrador principal (ADMIN_ONE) la cambia.
 * Usuarios y concesionarios solo la ven en la pantalla de pago; no hay forma de indicar otra.
 */
adminRouter.put('/settings/binance', requireAdminOne, validateBody(BinancePayeeUpdateSchema), async (req, res) => {
  await adminService.updateBinancePayee(currentUser(req).id, req.body as BinancePayeeUpdateInput, req.ip ?? null);
  res.json({ data: await settingsFor(req) });
});

adminRouter.post('/settings/binance/qr/upload', requireAdminOne, validateBody(BinanceQrUploadSchema), async (req, res) => {
  res.json({ data: await adminService.presignBinanceQr(req.body as z.infer<typeof BinanceQrUploadSchema>) });
});

adminRouter.put('/settings/binance/qr', requireAdminOne, validateBody(LoginBackgroundRegisterSchema), async (req, res) => {
  await adminService.setBinanceQr(currentUser(req).id, (req.body as z.infer<typeof LoginBackgroundRegisterSchema>).key, req.ip ?? null);
  res.json({ data: await settingsFor(req) });
});

adminRouter.delete('/settings/binance/qr', requireAdminOne, async (req, res) => {
  await adminService.removeBinanceQr(currentUser(req).id, req.ip ?? null);
  res.json({ data: await settingsFor(req) });
});

/** Redes sociales que se muestran en el login, la landing y el pie de página. */
adminRouter.put('/settings/social', validateBody(SocialLinksUpdateSchema), async (req, res) => {
  await adminService.updateSocialLinks(currentUser(req).id, (req.body as z.infer<typeof SocialLinksUpdateSchema>).links, req.ip ?? null);
  res.json({ data: await settingsFor(req) });
});

/** Historial de cambios de planes, plazos, cobro, redes y catálogo. */
adminRouter.get('/settings/history', async (req, res) => {
  const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
  res.json({ data: await adminService.settingsHistory(limit) });
});

// Catálogo de marcas y modelos
adminRouter.get('/catalog/brands', async (_req, res) => {
  res.json({ data: await catalogService.adminBrands() });
});

/** Marcas que usan los anuncios y aún no están en el catálogo. */
adminRouter.get('/catalog/missing', async (_req, res) => {
  res.json({ data: await catalogService.missingFromListings() });
});

adminRouter.post('/catalog/import-from-listings', async (req, res) => {
  res.status(201).json({ data: await catalogService.importFromListings(currentUser(req).id, req.ip ?? null) });
});

adminRouter.post('/catalog/brands', validateBody(BrandCreateSchema), async (req, res) => {
  res.status(201).json({ data: await catalogService.createBrand(currentUser(req).id, req.body as BrandCreateInput, req.ip ?? null) });
});

adminRouter.patch('/catalog/brands/:id', validateBody(BrandUpdateSchema), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  res.json({ data: await catalogService.updateBrand(currentUser(req).id, id, req.body as BrandUpdateInput, req.ip ?? null) });
});

adminRouter.post('/catalog/brands/:id/models', validateBody(BrandModelsAddSchema), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  res.status(201).json({ data: await catalogService.addModels(currentUser(req).id, id, (req.body as z.infer<typeof BrandModelsAddSchema>).names, req.ip ?? null) });
});

adminRouter.patch('/catalog/models/:id', validateBody(BrandModelUpdateSchema), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  res.json({ data: await catalogService.setModelActive(currentUser(req).id, id, (req.body as z.infer<typeof BrandModelUpdateSchema>).isActive, req.ip ?? null) });
});

/** Fondo del login: URL prefirmada para subir la imagen y, después, registro de su ruta en MySQL. */
adminRouter.post('/settings/login-background/upload', validateBody(LoginBackgroundUploadSchema), async (req, res) => {
  res.json({ data: await adminService.presignLoginBackground(req.body as z.infer<typeof LoginBackgroundUploadSchema>) });
});

adminRouter.put('/settings/login-background', validateBody(LoginBackgroundRegisterSchema), async (req, res) => {
  const { key } = req.body as z.infer<typeof LoginBackgroundRegisterSchema>;
  await adminService.setLoginBackground(currentUser(req).id, key, req.ip ?? null);
  res.json({ data: await settingsFor(req) });
});

adminRouter.delete('/settings/login-background', async (req, res) => {
  await adminService.removeLoginBackground(currentUser(req).id, req.ip ?? null);
  res.json({ data: await settingsFor(req) });
});

/** Foto de la portada: mismo flujo que el fondo del login (JPG, PNG o WebP de hasta 8 MB). */
adminRouter.post('/settings/home-hero/upload', validateBody(LoginBackgroundUploadSchema), async (req, res) => {
  res.json({ data: await adminService.presignHomeHero(req.body as z.infer<typeof LoginBackgroundUploadSchema>) });
});

adminRouter.put('/settings/home-hero', validateBody(LoginBackgroundRegisterSchema), async (req, res) => {
  const { key } = req.body as z.infer<typeof LoginBackgroundRegisterSchema>;
  await adminService.setHomeHero(currentUser(req).id, key, req.ip ?? null);
  res.json({ data: await settingsFor(req) });
});

adminRouter.delete('/settings/home-hero', async (req, res) => {
  await adminService.removeHomeHero(currentUser(req).id, req.ip ?? null);
  res.json({ data: await settingsFor(req) });
});

/** Comisiones post-venta pendientes de pago (las vencidas primero). */
adminRouter.get('/commissions', async (_req, res) => {
  res.json({ data: await adminService.commissions() });
});

// Lista negra global
adminRouter.get('/blocked-terms', async (_req, res) => {
  res.json({ data: await adminService.blockedTerms() });
});

adminRouter.post('/blocked-terms', validateBody(BlockedTermSchema), async (req, res) => {
  res.status(201).json({ data: await adminService.addBlockedTerm(currentUser(req).id, (req.body as z.infer<typeof BlockedTermSchema>).term) });
});

adminRouter.delete('/blocked-terms/:id', async (req, res) => {
  const { id } = IdParams.parse(req.params);
  await adminService.removeBlockedTerm(currentUser(req).id, id);
  res.status(204).end();
});

// Carrusel de la landing
adminRouter.get('/carousel/recommendations', async (_req, res) => {
  res.json({ data: await showcaseService.marketRecommendations() });
});

adminRouter.get('/carousel', async (_req, res) => {
  res.json({ data: await showcaseService.carouselAdmin() });
});

adminRouter.put('/carousel', validateBody(CarouselUpdateSchema), async (req, res) => {
  res.json({ data: await showcaseService.updateCarousel(currentUser(req).id, req.body as CarouselUpdateInput) });
});

// Inventario
adminRouter.get('/vehicles', async (req, res) => {
  const query = PageQuery.extend({ status: z.enum(VEHICLE_STATUSES).optional() }).parse(req.query);
  res.json({ data: await adminService.inventory(query) });
});

adminRouter.post('/vehicles/:id/archive', validateBody(z.object({ reason: z.string().trim().max(500).optional() })), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  await adminService.archiveVehicle(currentUser(req).id, id, (req.body as { reason?: string }).reason, req.ip ?? null);
  res.status(204).end();
});

// Mensajes de contacto (no disponible para supervisores)
adminRouter.get('/contact', async (req, res) => {
  const { status } = z.object({ status: z.enum(['NEW', 'HANDLED']).optional() }).parse(req.query);
  res.json({ data: await adminService.contactMessages(status) });
});

adminRouter.patch('/contact/:id', validateBody(z.object({ status: z.enum(['NEW', 'HANDLED']) })), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  await adminService.setContactStatus(id, (req.body as { status: 'NEW' | 'HANDLED' }).status);
  res.status(204).end();
});

/** Exportaciones: GET /api/admin/exports/users?format=xlsx|pdf */
adminRouter.get('/exports/:dataset', async (req, res) => {
  const { dataset } = z.object({ dataset: z.enum(EXPORT_DATASETS) }).parse(req.params);
  const { format } = z.object({ format: z.enum(EXPORT_FORMATS).default('xlsx') }).parse(req.query);
  await (format === 'xlsx' ? exportXlsx(dataset, res) : exportPdf(dataset, res));
});

/** Rutas limitadas para supervisores: solo denuncias y reseñas. */
export const adminModerationRouter = Router();
adminModerationRouter.use(authenticate, requireCompliance);
adminModerationRouter.get('/reports', async (req, res) => {
  const query = PageQuery.extend({ status: z.enum(REPORT_STATUSES).optional() }).parse(req.query);
  res.json({ data: await adminService.reports(query.status, query.page) });
});
/** Bandeja «Reportes»: casos agrupados por anuncio, chat o perfil, con KPIs. */
adminModerationRouter.get('/reports/board', async (req, res) => {
  const { status, light } = z.object({ status: z.enum(REPORT_STATUSES).default('OPEN'), light: z.enum(['1']).optional() }).parse(req.query);
  res.json({ data: await adminReports.board(status, light === '1') });
});
adminModerationRouter.get('/reports/:id/chat', async (req, res) => {
  const { id } = IdParams.parse(req.params);
  res.json({ data: await adminReports.chat(currentUser(req).id, id, req.ip ?? null) });
});
adminModerationRouter.post('/reports/:id/decision', validateBody(ReportDecisionSchema), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  const actor = currentUser(req);
  res.json({ data: await adminReports.decide({ id: actor.id, role: actor.role }, id, req.body as ReportDecisionInput, req.ip ?? null) });
});
adminModerationRouter.patch('/reports/:id', validateBody(ReportResolutionSchema), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  await adminService.resolveReport(currentUser(req).id, id, req.body as z.infer<typeof ReportResolutionSchema>, req.ip ?? null);
  res.status(204).end();
});
adminModerationRouter.get('/reviews', async (req, res) => {
  const { status } = z.object({ status: z.enum(REVIEW_STATUSES).optional() }).parse(req.query);
  res.json({ data: await adminService.reviews(status) });
});
adminModerationRouter.patch('/reviews/:id', validateBody(ReviewModerationSchema), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  await adminService.moderateReview(currentUser(req).id, id, (req.body as z.infer<typeof ReviewModerationSchema>).status);
  res.status(204).end();
});
