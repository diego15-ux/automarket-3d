import { ContactSchema, ReviewSubmitSchema, type ContactInput } from '@automarket/contracts';
import { Router } from 'express';
import type { z } from 'zod';
import { authenticate, currentUser, optionalAuth } from '../../shared/http/middlewares/auth.middleware.js';
import { requireHuman } from '../../shared/http/middlewares/human-check.js';
import { clientIp, rateLimit } from '../../shared/http/middlewares/rate-limit.js';
import { validateBody } from '../../shared/http/middlewares/validate.js';
import { notificationsService } from '../../shared/notifications.js';
import { readPublicStats } from '../../shared/realtime.js';
import { getSettings, listPlans, toPublicSettings, toTerms } from '../memberships/plans.js';
import { catalogService } from '../catalog/catalog.service.js';
import { showcaseService } from './showcase.service.js';
import { boostsService } from '../boosts/boosts.service.js';

const contactLimiter = rateLimit({ name: 'contact', windowMs: 60 * 60_000, max: 5, key: clientIp });
const reviewLimiter = rateLimit({ name: 'review', windowMs: 60 * 60_000, max: 10, key: req => currentUser(req).id });

/** /api/public — datos de la landing (sin sesión). */
export const publicRouter = Router();

/** Contadores iniciales; después se actualizan en vivo por Socket.io (namespace /public). */
publicRouter.get('/stats', async (_req, res) => {
  res.json({ data: await readPublicStats() });
});

publicRouter.get('/plans', async (_req, res) => {
  res.json({ data: await listPlans() });
});

/** Plazos de las reservas (ficha del vehículo) y fondo del login (gestionado desde el panel). */
publicRouter.get('/settings', async (_req, res) => {
  res.json({ data: toPublicSettings(await getSettings()) });
});

/** Términos y Condiciones vigentes (editables desde el panel). */
/** Marcas y modelos activos del catálogo (formulario de publicar y filtros). */
publicRouter.get('/catalog/brands', async (_req, res) => {
  res.json({ data: await catalogService.publicBrands() });
});

publicRouter.get('/terms', async (_req, res) => {
  res.json({ data: toTerms(await getSettings()) });
});

publicRouter.get('/carousel', async (_req, res) => {
  res.json({ data: await showcaseService.carousel() });
});

/** Carrusel de Entrar y Crear cuenta: turnos pagados de hoy primero (rotan cada 4 s). */
publicRouter.get('/login-showcase', async (_req, res) => {
  res.json({ data: await boostsService.loginShowcase(await showcaseService.carousel()) });
});

/** Cifras reales del filtro del chat (últimos 30 días) para la sección de seguridad de la portada. */
publicRouter.get('/chat-filter-stats', async (_req, res) => {
  res.json({ data: await showcaseService.chatFilterStats() });
});

publicRouter.get('/reviews', async (_req, res) => {
  res.json({ data: await showcaseService.reviews() });
});

publicRouter.post('/contact', contactLimiter, optionalAuth, validateBody(ContactSchema), requireHuman('contact'), async (req, res) => {
  await showcaseService.contact(req.body as ContactInput, { userId: req.auth?.id ?? null, ip: req.ip ?? null });
  res.status(201).json({ data: { message: 'Gracias por escribirnos: te responderemos en menos de 24 horas hábiles.' } });
});

/** /api/reviews — la reseña del usuario sobre la plataforma (pasa por moderación). */
export const reviewsRouter = Router();
reviewsRouter.use(authenticate);

reviewsRouter.get('/mine', async (req, res) => {
  res.json({ data: await showcaseService.myReview(currentUser(req).id) });
});

reviewsRouter.put('/mine', reviewLimiter, validateBody(ReviewSubmitSchema), async (req, res) => {
  res.json({ data: await showcaseService.submitReview(currentUser(req).id, req.body as z.infer<typeof ReviewSubmitSchema>) });
});

/** /api/notifications — campana de avisos (reservas, membresía, anuncios). */
export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

notificationsRouter.get('/', async (req, res) => {
  res.json({ data: await notificationsService.list(currentUser(req).id) });
});

notificationsRouter.post('/read-all', async (req, res) => {
  await notificationsService.markAllRead(currentUser(req).id);
  res.status(204).end();
});
