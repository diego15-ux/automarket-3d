import { createClient } from 'redis';
import { env } from '../../config/env.js';

async function connect(url: string) {
  const client = createClient({ url });
  client.on('error', (err: Error) => console.error('[redis]', err.message));
  await client.connect();
  return client;
}

export type RedisClient = Awaited<ReturnType<typeof connect>>;

let connecting: Promise<RedisClient> | null = null;

/**
 * Cliente Redis compartido (rate limiting distribuido). `null` sin REDIS_URL, lo que
 * solo ocurre fuera de producción: env.ts exige REDIS_URL cuando NODE_ENV=production.
 */
export function getRedis(): Promise<RedisClient> | null {
  if (!env.REDIS_URL) return null;
  connecting ??= connect(env.REDIS_URL).catch(err => {
    connecting = null; // reintenta en la próxima petición
    throw err;
  });
  return connecting;
}

export async function closeRedis() {
  if (!connecting) return;
  const client = await connecting.catch(() => null);
  connecting = null;
  await client?.quit();
}
