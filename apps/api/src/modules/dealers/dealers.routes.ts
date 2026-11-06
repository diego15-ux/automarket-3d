import { DealerCopilotAskSchema, DealerCopilotOverviewQuerySchema, type DealerCopilotAskInput } from '@automarket/contracts';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, optionalAuth } from '../../shared/http/middlewares/auth.middleware.js';
import { rateLimit } from '../../shared/http/middlewares/rate-limit.js';
import { validateBody } from '../../shared/http/middlewares/validate.js';
import { dealerCopilot } from './dealer-copilot.js';
import { dealerPage } from './dealer-page.js';
import { dealerPanel } from './dealer-panel.js';
import { dealersService } from './dealers.service.js';

const DealerParams = z.object({ id: z.uuid() });

export const dealersRouter = Router();

/** Directorio público de concesionarios aliados (con «Siguiendo» si hay sesión). */
dealersRouter.get('/', optionalAuth, async (req, res) => {
  res.json({ data: await dealersService.directory(req.auth?.id ?? null) });
});

/** Panel del concesionario (su propia cuenta). */
dealersRouter.get('/me/dashboard', authenticate, async (req, res) => {
  res.json({ data: await dealerPanel.dashboard(currentUser(req).id) });
});

// Copiloto para agencias: resumen del costado (se refresca solo) y preguntas con reglas sobre datos reales.
const copilotLimiter = rateLimit({ name: 'dealer-copilot', windowMs: 60_000, max: 60, key: req => currentUser(req).id });

dealersRouter.get('/me/copilot', authenticate, copilotLimiter, async (req, res) => {
  const { vehicleId } = DealerCopilotOverviewQuerySchema.parse(req.query);
  res.json({ data: await dealerCopilot.overview(currentUser(req).id, vehicleId) });
});

dealersRouter.post('/me/copilot', authenticate, copilotLimiter, validateBody(DealerCopilotAskSchema), async (req, res) => {
  res.json({ data: await dealerCopilot.ask(currentUser(req).id, req.body as DealerCopilotAskInput) });
});

/** Página pública de una agencia (con «Siguiendo» y «es tuya» si hay sesión). */
dealersRouter.get('/:id/page', optionalAuth, async (req, res) => {
  const { id } = DealerParams.parse(req.params);
  res.json({ data: await dealerPage.page(id, req.auth?.id ?? null) });
});

// Seguir y dejar de seguir: 60 cambios por hora y persona.
const followLimiter = rateLimit({ name: 'dealer-follow', windowMs: 60 * 60_000, max: 60, key: req => currentUser(req).id });

dealersRouter.put('/:id/follow', authenticate, followLimiter, async (req, res) => {
  const { id } = DealerParams.parse(req.params);
  res.json({ data: await dealersService.follow(currentUser(req).id, id) });
});

dealersRouter.delete('/:id/follow', authenticate, followLimiter, async (req, res) => {
  const { id } = DealerParams.parse(req.params);
  res.json({ data: await dealersService.unfollow(currentUser(req).id, id) });
});
