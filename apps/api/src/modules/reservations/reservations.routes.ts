import { ReservationCreateSchema, ReservationDecisionSchema, SaleCommissionCheckoutSchema, SaleCompletionSchema, SellerRatingSchema } from '@automarket/contracts';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, requireActiveMember } from '../../shared/http/middlewares/auth.middleware.js';
import { rateLimit } from '../../shared/http/middlewares/rate-limit.js';
import { validateBody } from '../../shared/http/middlewares/validate.js';
import { reservationsService } from './reservations.service.js';

const IdParams = z.object({ id: z.uuid() });
const VehicleParams = z.object({ vehicleId: z.uuid() });
const ListQuery = z.object({ as: z.enum(['buyer', 'seller']).default('buyer') });

// Solicitudes de reserva: máximo 10 por usuario y hora.
const createLimiter = rateLimit({ name: 'reservation-create', windowMs: 60 * 60_000, max: 10, key: req => currentUser(req).id });
// Cada intento de pago de comisión crea un cobro en Binance.
const commissionLimiter = rateLimit({ name: 'commission-checkout', windowMs: 60 * 60_000, max: 20, key: req => currentUser(req).id });

/** /api/reservations — reservas P2P (el abono va al vendedor) y comisión post-venta con Binance. */
export const reservationsRouter = Router();

reservationsRouter.get('/', authenticate, async (req, res) => {
  const { as } = ListQuery.parse(req.query);
  res.json({ data: await reservationsService.list(currentUser(req).id, as) });
});

reservationsRouter.get('/vehicle/:vehicleId', authenticate, async (req, res) => {
  const { vehicleId } = VehicleParams.parse(req.params);
  res.json({ data: await reservationsService.mineForVehicle(currentUser(req).id, vehicleId) });
});

/** Solicita la reserva (identidad verificada + aviso legal aceptado). No hay cobro: el abono va al vendedor. */
reservationsRouter.post('/', ...requireActiveMember, createLimiter, validateBody(ReservationCreateSchema), async (req, res) => {
  const { vehicleId } = req.body as z.infer<typeof ReservationCreateSchema>;
  res.status(201).json({ data: await reservationsService.create(currentUser(req).id, vehicleId) });
});

/** El vendedor paga la comisión post-venta: devuelve el cobro (QR de Binance Pay o instrucciones del Pay ID). */
reservationsRouter.post('/:id/commission/checkout', ...requireActiveMember, commissionLimiter, validateBody(SaleCommissionCheckoutSchema), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  res.status(201).json({ data: await reservationsService.payCommission(currentUser(req).id, id, req.body as z.infer<typeof SaleCommissionCheckoutSchema>) });
});

/** El vendedor confirma: el vehículo queda reservado para el comprador y se abre el chat directo. */
reservationsRouter.post('/:id/accept', ...requireActiveMember, validateBody(ReservationDecisionSchema), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  const { note } = req.body as z.infer<typeof ReservationDecisionSchema>;
  res.json({ data: await reservationsService.accept(currentUser(req).id, id, note) });
});

reservationsRouter.post('/:id/reject', authenticate, validateBody(ReservationDecisionSchema), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  const { note } = req.body as z.infer<typeof ReservationDecisionSchema>;
  res.json({ data: await reservationsService.reject(currentUser(req).id, id, note) });
});

reservationsRouter.post('/:id/cancel', authenticate, validateBody(ReservationDecisionSchema), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  const { note } = req.body as z.infer<typeof ReservationDecisionSchema>;
  res.json({ data: await reservationsService.cancel(currentUser(req), id, note) });
});

/** El vendedor avisa que está cerrando la venta: el público ve «En negociación». */
reservationsRouter.post('/:id/negotiate', authenticate, async (req, res) => {
  const { id } = IdParams.parse(req.params);
  res.json({ data: await reservationsService.negotiate(currentUser(req).id, id) });
});

reservationsRouter.post('/:id/complete', authenticate, validateBody(SaleCompletionSchema), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  const { salePrice } = req.body as z.infer<typeof SaleCompletionSchema>;
  res.json({ data: await reservationsService.complete(currentUser(req), id, salePrice) });
});

reservationsRouter.post('/:id/rating', authenticate, validateBody(SellerRatingSchema), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  const { rating, comment } = req.body as z.infer<typeof SellerRatingSchema>;
  res.json({ data: await reservationsService.rateSeller(currentUser(req).id, id, rating, comment) });
});
