/*!
 * AutoMarket 3D
 * © Todos los derechos reservados. Sistema desarrollado bajo licencia exclusiva del propietario de la plataforma.
 * Prohibida su copia, modificación o distribución sin autorización expresa y por escrito (ver LICENSE).
 */
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { startScheduler } from './jobs/scheduler.js';
import { binanceMerchantConfigured } from './shared/infra/binance-pay.js';
import { prisma } from './shared/infra/prisma.js';
import { refreshPlatformConfig } from './shared/platform-config.js';
import { closeRedis } from './shared/infra/redis.js';
import { createSocketServer } from './sockets/index.js';

// Cuenta de cobro y redes del panel (se renuevan solas; ver shared/platform-config.ts).
const config = await refreshPlatformConfig().catch(err => {
  console.error('[ajustes] no se pudieron leer al arrancar:', err);
  return null;
});
if (config && !config.payee && !binanceMerchantConfigured()) {
  console.warn('⚠️  Sin método de cobro con Binance: el administrador principal debe poner el Pay ID en Panel → Planes y ajustes.');
}

// Express y Socket.io comparten el mismo servidor HTTP (y el mismo puerto).
const httpServer = createServer(createApp());
const io = await createSocketServer(httpServer);

httpServer.listen(env.PORT, '0.0.0.0', () => {
  console.log(`🚗 AutoMarket API + Socket.io en http://localhost:${env.PORT}`);
  if (env.NODE_ENV === 'production' && env.MAIL_DISABLED && !env.SMTP_URL) {
    console.warn('⚠️  Sin correo (MAIL_DISABLED): «Olvidé mi contraseña» y los avisos por correo no llegan. Pon SMTP_URL.');
  }
  if (env.NODE_ENV === 'production' && env.TURNSTILE_DISABLED && !env.TURNSTILE_SECRET_KEY) {
    console.warn('⚠️  Sin Turnstile (TURNSTILE_DISABLED): el registro y el login solo tienen trampa anti-bot y límites. Pon las llaves.');
  }
});

// Caducidades de reservas y anuncios, recordatorios de membresía, destacados y correo.
const stopScheduler = startScheduler();

// Apagado ordenado: ECS / Kubernetes envían SIGTERM antes de matar el contenedor.
async function shutdown(signal: string) {
  console.log(`${signal} recibido: cerrando conexiones…`);
  stopScheduler();
  await io.close(); // cierra sockets y el servidor HTTP
  await Promise.allSettled([prisma.$disconnect(), closeRedis()]);
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
