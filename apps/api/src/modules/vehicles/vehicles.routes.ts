import {
  CopilotAskSchema,
  MediaOrderSchema,
  MediaRegisterSchema,
  MediaUploadRequestSchema,
  ReportSchema,
  SaleCommissionCheckoutSchema,
  VehicleDraftSchema,
  VehicleInsightsQuerySchema,
  VehicleSearchSchema,
  VehicleUpdateSchema,
  type CopilotAskInput,
  type VehicleDraftInput,
  type VehicleUpdateInput,
} from '@automarket/contracts';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, optionalAuth, requireActiveMember } from '../../shared/http/middlewares/auth.middleware.js';
import { AppError } from '../../shared/errors/app-error.js';
import { clientIp, rateLimit } from '../../shared/http/middlewares/rate-limit.js';
import { validateBody } from '../../shared/http/middlewares/validate.js';
import { prisma } from '../../shared/infra/prisma.js';
import { assertNoBlockedTerms } from '../../shared/moderation/blocklist.js';
import { vehicleSearch, type Coordinates, type Locality } from './vehicles.search.js';
import { vehicleInsights } from './vehicles.insights.js';
import { smartSearch } from './vehicles.smart.js';
import { copilot } from './vehicles.copilot.js';
import { vehicleSalesService } from './vehicle-sales.service.js';
import { vehiclesService } from './vehicles.service.js';
import { savedService } from './vehicles.saved.js';

const IdParams = z.object({ id: z.uuid() });
const MediaParams = z.object({ id: z.uuid(), mediaId: z.uuid() });
const SlugParams = z.object({ slug: z.string().min(1).max(160) });
const FacetsQuery = z.object({ make: z.string().trim().max(60).optional(), country: z.string().length(2).toUpperCase().optional() });
const LocationHeaders = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});

const reportLimiter = rateLimit({ name: 'report', windowMs: 60 * 60_000, max: 20, key: clientIp });
const saleCheckoutLimiter = rateLimit({ name: 'vehicle-sale-checkout', windowMs: 60 * 60_000, max: 10, key: req => currentUser(req).id });
const insightsLimiter = rateLimit({ name: 'vehicle-insights', windowMs: 60_000, max: 60, key: req => currentUser(req).id });
/** El buscador inteligente responde a cada tecla (con pausa de ~200 ms en el navegador). */
const smartLimiter = rateLimit({ name: 'smart-search', windowMs: 60_000, max: 240, key: req => clientIp(req) });
/** Copiloto del comprador: un mensaje por envío (las respuestas salen de la base). */
const copilotLimiter = rateLimit({ name: 'copilot', windowMs: 60_000, max: 60, key: req => clientIp(req) });
const saveLimiter = rateLimit({ name: 'vehicle-save', windowMs: 60_000, max: 60, key: req => currentUser(req).id });

/**
 * Ubicación para priorizar resultados: la del perfil si hay sesión; si no, el país
 * que añade Cloudflare (CF-IPCountry) cuando la API está detrás de su proxy.
 */
async function localityOf(req: Request): Promise<Locality> {
  if (req.auth) {
    const user = await prisma.user.findUnique({ where: { id: req.auth.id }, select: { country: true, city: true } });
    if (user?.country) return { country: user.country, city: user.city };
  }
  const header = req.get('cf-ipcountry');
  return { country: header && /^[A-Z]{2}$/.test(header) && header !== 'XX' ? header : null, city: null };
}

export const vehiclesRouter = Router();

// ── Catálogo público ────────────────────────────────────────────────────────

vehiclesRouter.get('/', optionalAuth, async (req, res) => {
  const query = VehicleSearchSchema.parse(req.query);
  await assertNoBlockedTerms({ q: query.q, make: query.make, model: query.model, city: query.city });
  const rawLatitude = req.get('x-location-latitude');
  const rawLongitude = req.get('x-location-longitude');
  let coordinates: Coordinates | null = null;
  if (rawLatitude !== undefined || rawLongitude !== undefined) {
    const parsed = LocationHeaders.safeParse({ latitude: rawLatitude, longitude: rawLongitude });
    if (!parsed.success) throw AppError.badRequest('INVALID_LOCATION', 'La ubicación enviada no es válida.');
    coordinates = parsed.data;
  }
  res.json({ data: await vehicleSearch.search(query, await localityOf(req), coordinates) });
});

// Buscador inteligente: frase libre → filtros, sugerencias y los mejores autos (reglas, sin IA)
vehiclesRouter.get('/smart', smartLimiter, async (req, res) => {
  const { q, limit } = z.object({ q: z.string().max(120).default(''), limit: z.coerce.number().int().min(1).max(8).default(4) }).parse(req.query);
  await assertNoBlockedTerms({ q });
  res.json({ data: await smartSearch.search(q, limit) });
});

vehiclesRouter.get('/smart/start', smartLimiter, async (_req, res) => {
  res.json({ data: await smartSearch.start() });
});

// Copiloto del comprador: chat con reglas sobre los anuncios reales (sin IA).
vehiclesRouter.post('/copilot', optionalAuth, copilotLimiter, validateBody(CopilotAskSchema), async (req, res) => {
  const input = req.body as CopilotAskInput;
  await assertNoBlockedTerms({ q: input.text });
  // Solo importa si puede reservar (identidad verificada): cambia el siguiente paso que se le propone.
  const viewer = req.auth ? await prisma.user.findUnique({ where: { id: req.auth.id }, select: { isVerified: true } }) : null;
  res.json({ data: await copilot.ask(input, viewer ? viewer.isVerified : null) });
});

vehiclesRouter.get('/facets', async (req, res) => {
  const query = FacetsQuery.parse(req.query);
  await assertNoBlockedTerms({ make: query.make });
  res.json({ data: await vehicleSearch.facets(query) });
});

vehiclesRouter.get('/recommended', optionalAuth, async (req, res) => {
  res.json({ data: await vehicleSearch.recommended(req.auth?.id ?? null, await localityOf(req)) });
});

// ── Mis anuncios (cualquier usuario registrado puede publicar) ──────────────

vehiclesRouter.get('/mine', authenticate, async (req, res) => {
  res.json({ data: await vehiclesService.mine(currentUser(req).id) });
});

// «Avísame si vuelve» (autos en negociación).
vehiclesRouter.get('/watching', authenticate, async (req, res) => {
  res.json({ data: await vehiclesService.watching(currentUser(req).id) });
});

// «Guardar» en la ficha: mis autos guardados.
vehiclesRouter.get('/saved', authenticate, async (req, res) => {
  res.json({ data: await savedService.list(currentUser(req).id) });
});

vehiclesRouter.get('/saved/ids', authenticate, async (req, res) => {
  res.json({ data: await savedService.ids(currentUser(req).id) });
});

// Copiloto al publicar: ficha típica y valor de mercado con anuncios reales (solo con sesión).
vehiclesRouter.get('/insights', authenticate, insightsLimiter, async (req, res) => {
  const query = VehicleInsightsQuerySchema.parse(req.query);
  res.json({ data: await vehicleInsights(query) });
});

vehiclesRouter.post('/', ...requireActiveMember, validateBody(VehicleDraftSchema), async (req, res) => {
  res.status(201).json({ data: await vehiclesService.createDraft(currentUser(req).id, req.body as VehicleDraftInput) });
});

vehiclesRouter.get('/:id/edit', authenticate, async (req, res) => {
  const { id } = IdParams.parse(req.params);
  res.json({ data: await vehiclesService.getForEdit(id, currentUser(req).id) });
});

vehiclesRouter.patch('/:id', ...requireActiveMember, validateBody(VehicleUpdateSchema), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  res.json({ data: await vehiclesService.update(id, currentUser(req).id, req.body as VehicleUpdateInput) });
});

/** Galería: 1) URL prefirmada → 2) PUT directo a S3 → 3) registro verificado. */
vehiclesRouter.post('/:id/media/uploads', ...requireActiveMember, validateBody(MediaUploadRequestSchema), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  res.status(201).json({ data: await vehiclesService.presignMedia(id, currentUser(req).id, req.body as z.infer<typeof MediaUploadRequestSchema>) });
});

vehiclesRouter.post('/:id/media', ...requireActiveMember, validateBody(MediaRegisterSchema), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  res.status(201).json({ data: await vehiclesService.registerMedia(id, currentUser(req).id, req.body as z.infer<typeof MediaRegisterSchema>) });
});

vehiclesRouter.put('/:id/media/order', ...requireActiveMember, validateBody(MediaOrderSchema), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  await vehiclesService.reorderMedia(id, currentUser(req).id, (req.body as z.infer<typeof MediaOrderSchema>).mediaIds);
  res.status(204).end();
});

vehiclesRouter.delete('/:id/media/:mediaId', authenticate, async (req, res) => {
  const { id, mediaId } = MediaParams.parse(req.params);
  await vehiclesService.removeMedia(id, currentUser(req).id, mediaId);
  res.status(204).end();
});

vehiclesRouter.put('/:id/save', authenticate, saveLimiter, async (req, res) => {
  const { id } = IdParams.parse(req.params);
  await savedService.save(id, currentUser(req).id);
  res.status(204).end();
});

vehiclesRouter.delete('/:id/save', authenticate, async (req, res) => {
  const { id } = IdParams.parse(req.params);
  await savedService.unsave(id, currentUser(req).id);
  res.status(204).end();
});

vehiclesRouter.put('/:id/watch', authenticate, async (req, res) => {
  const { id } = IdParams.parse(req.params);
  await vehiclesService.watch(id, currentUser(req).id);
  res.status(204).end();
});

vehiclesRouter.delete('/:id/watch', authenticate, async (req, res) => {
  const { id } = IdParams.parse(req.params);
  await vehiclesService.unwatch(id, currentUser(req).id);
  res.status(204).end();
});

vehiclesRouter.post('/:id/publish', ...requireActiveMember, async (req, res) => {
  const { id } = IdParams.parse(req.params);
  res.json({ data: await vehiclesService.publish(id, currentUser(req).id) });
});

vehiclesRouter.post('/:id/pause', authenticate, async (req, res) => {
  const { id } = IdParams.parse(req.params);
  await vehiclesService.pause(id, currentUser(req).id);
  res.status(204).end();
});

vehiclesRouter.post('/:id/sale/checkout', ...requireActiveMember, saleCheckoutLimiter, validateBody(SaleCommissionCheckoutSchema), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  res.status(201).json({ data: await vehicleSalesService.checkout(id, currentUser(req).id, req.body as z.infer<typeof SaleCommissionCheckoutSchema>) });
});

vehiclesRouter.post('/:id/feature', ...requireActiveMember, async (req, res) => {
  const { id } = IdParams.parse(req.params);
  await vehiclesService.feature(id, currentUser(req).id);
  res.status(204).end();
});

vehiclesRouter.delete('/:id/feature', authenticate, async (req, res) => {
  const { id } = IdParams.parse(req.params);
  await vehiclesService.unfeature(id, currentUser(req).id);
  res.status(204).end();
});

vehiclesRouter.delete('/:id', authenticate, async (req, res) => {
  const { id } = IdParams.parse(req.params);
  await vehiclesService.archive(id, currentUser(req).id);
  res.status(204).end();
});

vehiclesRouter.post('/:id/report', authenticate, reportLimiter, validateBody(ReportSchema), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  await vehiclesService.report(id, currentUser(req).id, req.body as z.infer<typeof ReportSchema>);
  res.status(201).json({ data: { message: 'Gracias: el equipo de moderación revisará el anuncio.' } });
});

// ── Ficha pública (al final: /:slug captura cualquier segmento) ─────────────

vehiclesRouter.get('/:slug/similar', async (req, res) => {
  const { slug } = SlugParams.parse(req.params);
  res.json({ data: await vehicleSearch.similar(await vehiclesService.findForSimilar(slug)) });
});

vehiclesRouter.get('/:slug', optionalAuth, async (req, res) => {
  const { slug } = SlugParams.parse(req.params);
  res.json({ data: await vehiclesService.getBySlug(slug, req.auth ?? null, clientIp(req)) });
});
