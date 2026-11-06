import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser } from '../../shared/http/middlewares/auth.middleware.js';
import { ConversationReportSchema } from '@automarket/contracts';
import { rateLimit } from '../../shared/http/middlewares/rate-limit.js';
import { validateBody } from '../../shared/http/middlewares/validate.js';
import { chatDeal } from './chat.deal.js';
import { chatService } from './chat.service.js';

const OpenConversationSchema = z.object({ vehicleId: z.uuid() });
const ConversationParamsSchema = z.object({ id: z.uuid() });
const HistoryQuerySchema = z.object({
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/**
 * /api/conversations — la parte REST del chat: abrir hilo, bandeja e historial
 * (el cliente lo usa al abrir un hilo y para resincronizar tras una reconexión).
 */
export const conversationsRouter = Router();
conversationsRouter.use(authenticate);

conversationsRouter.post('/', validateBody(OpenConversationSchema), async (req, res) => {
  const { vehicleId } = req.body as z.infer<typeof OpenConversationSchema>;
  res.json({ data: await chatService.openConversation(vehicleId, currentUser(req).id) });
});

conversationsRouter.get('/', async (req, res) => {
  res.json({ data: await chatService.inbox(currentUser(req).id) });
});

conversationsRouter.get('/:id/messages', async (req, res) => {
  const { id } = ConversationParamsSchema.parse(req.params);
  const page = HistoryQuerySchema.parse(req.query);
  res.json({ data: await chatService.history(id, currentUser(req).id, page) });
});

/** «El trato»: estado de la reserva y la venta, eventos del hilo y plazos (solo las dos partes). */
conversationsRouter.get('/:id/deal', async (req, res) => {
  const { id } = ConversationParamsSchema.parse(req.params);
  res.json({ data: await chatDeal.deal(id, currentUser(req).id) });
});

// Reportes del chat: máximo 10 por usuario y hora.
const reportLimiter = rateLimit({ name: 'chat-report', windowMs: 60 * 60_000, max: 10, key: req => currentUser(req).id });

/** Reporte anónimo de la otra persona (el equipo lo revisa en Moderación). */
conversationsRouter.post('/:id/report', reportLimiter, validateBody(ConversationReportSchema), async (req, res) => {
  const { id } = ConversationParamsSchema.parse(req.params);
  await chatDeal.report(id, currentUser(req).id, req.body as z.infer<typeof ConversationReportSchema>);
  res.status(201).json({ data: { message: 'Reporte enviado. El equipo de AutoMarket lo revisa.' } });
});
