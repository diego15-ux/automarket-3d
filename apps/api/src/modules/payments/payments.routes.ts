import { MembershipCheckoutSchema, PaymentSubmitSchema, type MembershipCheckoutInput, type PaymentSubmitInput } from '@automarket/contracts';
import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error.js';
import { authenticate, currentUser, requireActiveMember } from '../../shared/http/middlewares/auth.middleware.js';
import { rateLimit } from '../../shared/http/middlewares/rate-limit.js';
import { validateBody } from '../../shared/http/middlewares/validate.js';
import { membershipsService } from '../memberships/memberships.service.js';
import { paymentsService } from './payments.service.js';

const IdParams = z.object({ id: z.uuid() });
const checkoutLimiter = rateLimit({ name: 'membership-checkout', windowMs: 60 * 60_000, max: 10, key: req => currentUser(req).id });
const submitLimiter = rateLimit({ name: 'payment-submit', windowMs: 60 * 60_000, max: 20, key: req => currentUser(req).id });

/** /api/payments — pagos con Binance: métodos, estado, comprobante manual y notificaciones de Binance Pay. */
export const paymentsRouter = Router();

paymentsRouter.get('/methods', (_req, res) => {
  res.json({ data: paymentsService.methods() });
});

/**
 * Notificaciones de Binance Pay (configura esta URL en el panel de comercio o con API_PUBLIC_URL).
 * El cuerpo original se conserva en app.ts para verificar la firma. Binance espera returnCode SUCCESS.
 */
paymentsRouter.post('/binance/webhook', async (req, res) => {
  const raw = req.rawBody?.toString('utf8');
  if (!raw) throw AppError.badRequest('EMPTY_BODY', 'Cuerpo vacío.');
  await paymentsService.handleWebhook(req.headers as Record<string, string | undefined>, raw);
  res.json({ returnCode: 'SUCCESS', returnMessage: null });
});

paymentsRouter.get('/:id', authenticate, async (req, res) => {
  const { id } = IdParams.parse(req.params);
  res.json({ data: await paymentsService.get(currentUser(req), id) });
});

/** Modo manual: id de la transacción de Binance (y Pay ID del pagador para posibles reembolsos). */
paymentsRouter.post('/:id/submit', authenticate, submitLimiter, validateBody(PaymentSubmitSchema), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  res.json({ data: await paymentsService.submitManual(currentUser(req).id, id, req.body as PaymentSubmitInput) });
});

paymentsRouter.post('/:id/cancel', authenticate, async (req, res) => {
  const { id } = IdParams.parse(req.params);
  res.json({ data: await paymentsService.cancel(currentUser(req).id, id) });
});

/** /api/memberships — plan actual y compra por periodo (mensual / anual) con Binance. */
export const membershipsRouter = Router();

membershipsRouter.get('/me', authenticate, async (req, res) => {
  res.json({ data: await membershipsService.status(currentUser(req).id) });
});

membershipsRouter.post('/checkout', ...requireActiveMember, checkoutLimiter, validateBody(MembershipCheckoutSchema), async (req, res) => {
  res.status(201).json({ data: await membershipsService.checkout(currentUser(req).id, req.body as MembershipCheckoutInput) });
});
