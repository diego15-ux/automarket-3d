import { PriceDropAlertsSchema, SearchAlertCreateSchema, SearchAlertUpdateSchema } from '@automarket/contracts';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser } from '../../shared/http/middlewares/auth.middleware.js';
import { rateLimit } from '../../shared/http/middlewares/rate-limit.js';
import { validateBody } from '../../shared/http/middlewares/validate.js';
import { alertsService } from './alerts.service.js';

const IdParams = z.object({ id: z.uuid() });
const createLimiter = rateLimit({ name: 'alert-create', windowMs: 60 * 60_000, max: 30, key: req => currentUser(req).id });

/** /api/alerts — «Mis alertas»: búsquedas guardadas, autos esperados y avisos recientes. */
export const alertsRouter = Router();
alertsRouter.use(authenticate);

alertsRouter.get('/', async (req, res) => {
  res.json({ data: await alertsService.overview(currentUser(req).id) });
});

alertsRouter.post('/', createLimiter, validateBody(SearchAlertCreateSchema), async (req, res) => {
  res.status(201).json({ data: await alertsService.create(currentUser(req).id, req.body as z.infer<typeof SearchAlertCreateSchema>) });
});

// «Bajadas de precio en tus guardados»: encender o apagar (va antes de /:id).
alertsRouter.put('/price-drops', validateBody(PriceDropAlertsSchema), async (req, res) => {
  const { active } = req.body as z.infer<typeof PriceDropAlertsSchema>;
  res.json({ data: await alertsService.setPriceDrops(currentUser(req).id, active) });
});

alertsRouter.patch('/:id', validateBody(SearchAlertUpdateSchema), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  const { active } = req.body as z.infer<typeof SearchAlertUpdateSchema>;
  res.json({ data: await alertsService.setActive(currentUser(req).id, id, active) });
});

alertsRouter.post('/:id/seen', async (req, res) => {
  const { id } = IdParams.parse(req.params);
  await alertsService.markSeen(currentUser(req).id, id);
  res.status(204).end();
});

alertsRouter.delete('/:id', async (req, res) => {
  const { id } = IdParams.parse(req.params);
  await alertsService.remove(currentUser(req).id, id);
  res.status(204).end();
});
