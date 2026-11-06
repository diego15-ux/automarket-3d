import type { RequestHandler } from 'express';
import { z } from 'zod';
import { env } from '../../../config/env.js';
import { AppError } from '../../errors/app-error.js';
import { clientIp } from './rate-limit.js';

/** Acciones protegidas: Turnstile firma la acción en el token y aquí se comprueba. */
export type HumanAction = 'register' | 'login' | 'forgot_password' | 'reset_password' | 'contact';

const SiteverifyResponse = z.object({
  success: z.boolean(),
  'error-codes': z.array(z.string()).default([]),
  action: z.string().optional(),
  hostname: z.string().optional(),
});

const notHuman = () => AppError.badRequest('HUMAN_CHECK_FAILED', 'No pudimos verificar que eres una persona. Recarga la página e inténtalo de nuevo.');

let warnedMissingSecret = false;

/** Verificación servidor-servidor del token de Cloudflare Turnstile (siteverify). */
export async function verifyTurnstile(token: string, action: HumanAction, ip: string): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;

  const body = new URLSearchParams({ secret, response: token, remoteip: ip });
  const response = await fetch(env.TURNSTILE_VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new AppError(503, 'HUMAN_CHECK_UNAVAILABLE', 'La verificación anti-bot no está disponible. Inténtalo en unos segundos.');

  const result = SiteverifyResponse.parse(await response.json());
  if (!result.success) return false;
  // Un token emitido para otra acción (p. ej. el del login reutilizado en el registro) no vale.
  return result.action === undefined || result.action === '' || result.action === action;
}

/**
 * Detección de bots en formularios públicos:
 *   1. Honeypot `website`: campo invisible para personas; los bots lo rellenan.
 *   2. Cloudflare Turnstile (`captchaToken`), obligatorio en producción.
 * Se combina con `rateLimit` (Redis) en cada ruta.
 */
export function requireHuman(action: HumanAction): RequestHandler {
  return async (req, _res, next) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    if (typeof body['website'] === 'string' && body['website'].trim() !== '') {
      console.warn(`[anti-bot] honeypot activado en ${action} desde ${clientIp(req)}`);
      throw notHuman();
    }

    if (!env.TURNSTILE_SECRET_KEY) {
      if (!warnedMissingSecret) {
        console.warn('[anti-bot] TURNSTILE_SECRET_KEY no configurada: solo honeypot + rate limit.');
        warnedMissingSecret = true;
      }
      return next();
    }

    const token = body['captchaToken'];
    if (typeof token !== 'string' || token.length === 0) {
      throw AppError.badRequest('HUMAN_CHECK_REQUIRED', 'Completa la verificación anti-bot.');
    }
    if (!(await verifyTurnstile(token, action, clientIp(req)))) throw notHuman();
    next();
  };
}
