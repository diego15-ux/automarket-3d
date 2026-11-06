import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Request } from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { adminModerationRouter, adminRouter } from './modules/admin/admin.routes.js';
import { alertsRouter } from './modules/alerts/alerts.routes.js';
import { dealersRouter } from './modules/dealers/dealers.routes.js';
import { adminBoostsRouter, boostsRouter } from './modules/boosts/boosts.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { conversationsRouter } from './modules/chat/chat.routes.js';
import { adminKycRouter, kycRouter } from './modules/kyc/kyc.routes.js';
import { mediaRouter } from './modules/media/media.routes.js';
import { membershipsRouter, paymentsRouter } from './modules/payments/payments.routes.js';
import { reservationsRouter } from './modules/reservations/reservations.routes.js';
import { notificationsRouter, publicRouter, reviewsRouter } from './modules/showcase/showcase.routes.js';
import { vehiclesRouter } from './modules/vehicles/vehicles.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { errorHandler, notFoundHandler } from './shared/http/middlewares/error-handler.js';

/** Rutas cuyo cuerpo original se conserva para verificar la firma de las notificaciones de Binance Pay. */
const RAW_BODY_PATHS = new Set(['/api/payments/binance/webhook']);

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Saltos de proxy de confianza (ALB / Nginx / Cloudflare): req.ip = IP real del cliente.
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        if (RAW_BODY_PATHS.has((req.url ?? '').split('?')[0] ?? '')) (req as Request).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/public', publicRouter);
  app.use('/api/vehicles', vehiclesRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/conversations', conversationsRouter);
  app.use('/api/media', mediaRouter);
  app.use('/api/kyc', kycRouter);
  app.use('/api/reservations', reservationsRouter);
  app.use('/api/memberships', membershipsRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/reviews', reviewsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/alerts', alertsRouter);
  app.use('/api/dealers', dealersRouter);
  app.use('/api/boosts', boostsRouter);
  app.use('/api/admin/kyc', adminKycRouter);
  app.use('/api/admin', adminBoostsRouter);
  app.use('/api/admin', adminModerationRouter);
  app.use('/api/admin', adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
