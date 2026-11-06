import { BoostCheckoutSchema, BoostSettingsSchema, BoostWaitlistSchema, type BoostCheckoutInput, type BoostSettingsInput } from '@automarket/contracts';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, requireAdmin } from '../../shared/http/middlewares/auth.middleware.js';
import { rateLimit } from '../../shared/http/middlewares/rate-limit.js';
import { validateBody } from '../../shared/http/middlewares/validate.js';
import { boostsService } from './boosts.service.js';

export const boostsRouter = Router();
boostsRouter.use(authenticate);

const checkoutLimiter = rateLimit({ name: 'boost-checkout', windowMs: 60 * 60_000, max: 30, key: req => currentUser(req).id });

boostsRouter.get('/options', async (req, res) => {
  res.json({ data: await boostsService.options(currentUser(req).id) });
});

boostsRouter.get('/preview', async (req, res) => {
  const { vehicleId } = z.object({ vehicleId: z.uuid() }).parse(req.query);
  res.json({ data: await boostsService.preview(currentUser(req).id, vehicleId) });
});

boostsRouter.post('/', checkoutLimiter, validateBody(BoostCheckoutSchema), async (req, res) => {
  res.status(201).json({ data: await boostsService.checkout(currentUser(req).id, req.body as BoostCheckoutInput) });
});

boostsRouter.post('/waitlist', checkoutLimiter, validateBody(BoostWaitlistSchema), async (req, res) => {
  res.status(201).json({ data: await boostsService.waitlist(currentUser(req).id, req.body as z.infer<typeof BoostWaitlistSchema>) });
});

boostsRouter.get('/:id', async (req, res) => {
  const { id } = z.object({ id: z.uuid() }).parse(req.params);
  res.json({ data: await boostsService.get(currentUser(req).id, id) });
});

/** Panel: precios y cupos de «Destacar» y la cola de la pantalla de entrada. */
// Middleware por ruta: este router se monta en /api/admin junto a otros (supervisores incluidos).
export const adminBoostsRouter = Router();

adminBoostsRouter.get('/settings/boosts', authenticate, requireAdmin, async (_req, res) => {
  res.json({ data: await boostsService.settings() });
});

adminBoostsRouter.put('/settings/boosts', authenticate, requireAdmin, validateBody(BoostSettingsSchema), async (req, res) => {
  res.json({ data: await boostsService.updateSettings(currentUser(req).id, req.body as BoostSettingsInput, req.ip ?? null) });
});

adminBoostsRouter.get('/login-spots', authenticate, requireAdmin, async (_req, res) => {
  res.json({ data: await boostsService.loginSpots() });
});
