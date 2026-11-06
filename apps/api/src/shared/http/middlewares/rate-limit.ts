import type { Request, RequestHandler, Response } from 'express';
import { env } from '../../../config/env.js';
import { AppError } from '../../errors/app-error.js';
import { getRedis } from '../../infra/redis.js';

interface Hit {
  count: number;
  /** Milisegundos hasta que se reinicia la ventana. */
  resetMs: number;
}

/**
 * INCR + PEXPIRE atómicos en Redis (ventana fija compartida por todas las instancias).
 * Devuelve [contador, ms restantes].
 */
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return { count, ttl }
`;

/** Respaldo en memoria SOLO para desarrollo/test sin Redis (producción exige REDIS_URL). */
const memory = new Map<string, { count: number; resetAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memory) if (entry.resetAt <= now) memory.delete(key);
}, 60_000).unref();

async function hit(key: string, windowMs: number): Promise<Hit> {
  const redis = getRedis();
  if (redis) {
    const client = await redis;
    const [count, ttl] = (await client.eval(HIT_SCRIPT, { keys: [key], arguments: [String(windowMs)] })) as [number, number];
    return { count, resetMs: ttl };
  }
  if (env.NODE_ENV === 'production') throw new Error('REDIS_URL es obligatoria en producción');

  const now = Date.now();
  let entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    memory.set(key, entry);
  }
  entry.count += 1;
  return { count: entry.count, resetMs: entry.resetAt - now };
}

export interface RateLimitRule {
  /** Espacio de nombres de la clave en Redis (p. ej. 'login-ip'). */
  name: string;
  /** Ventana fija en milisegundos. */
  windowMs: number;
  /** Peticiones permitidas por clave y ventana. */
  max: number;
}

const tooMany = (res: Response | null, resetMs: number) => {
  res?.setHeader('Retry-After', String(Math.max(1, Math.ceil(resetMs / 1000))));
  return AppError.tooManyRequests('TOO_MANY_ATTEMPTS', 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.');
};

/** Consume una unidad del límite desde un servicio (p. ej. por email además de por IP). */
export async function consumeRateLimit(rule: RateLimitRule, key: string, res: Response | null = null): Promise<void> {
  const { count, resetMs } = await hit(`rl:${rule.name}:${key}`, rule.windowMs);
  if (count > rule.max) throw tooMany(res, resetMs);
}

/** Middleware de límite de peticiones con cabeceras estándar RateLimit-*. */
export function rateLimit(rule: RateLimitRule & { key: (req: Request) => string }): RequestHandler {
  return async (req, res, next) => {
    const { count, resetMs } = await hit(`rl:${rule.name}:${rule.key(req)}`, rule.windowMs);
    res.setHeader('RateLimit-Limit', String(rule.max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, rule.max - count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(resetMs / 1000)));
    if (count > rule.max) throw tooMany(res, resetMs);
    next();
  };
}

/** IP del cliente (con `trust proxy` configurado, la real detrás del balanceador). */
export const clientIp = (req: Request) => req.ip ?? 'unknown';

/** Email del cuerpo normalizado (para limitar por cuenta además de por IP). */
export const bodyEmail = (req: Request) => {
  const email: unknown = (req.body as Record<string, unknown> | undefined)?.['email'];
  return typeof email === 'string' ? email.trim().toLowerCase().slice(0, 254) : 'none';
};
