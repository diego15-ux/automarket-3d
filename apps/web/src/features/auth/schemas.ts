import { z } from 'zod';

// Las reglas de validación (registro, login, recuperación) son las MISMAS que aplica la API:
// vienen de @automarket/contracts. Aquí solo quedan utilidades de formulario.
export { ForgotPasswordSchema, LoginSchema, ProfileUpdateSchema, RegisterSchema, ResetPasswordSchema } from '@automarket/contracts';

export type FieldErrors = Partial<Record<string, string>>;

/** Primer mensaje de error por campo. */
export const fieldErrors = (error: z.ZodError): FieldErrors =>
  Object.fromEntries(Object.entries(z.flattenError(error).fieldErrors).map(([field, messages]) => [field, (messages as string[] | undefined)?.[0]]));

/** Fortaleza 0–4 para el medidor del registro. */
export function passwordStrength(password: string): number {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
  return password && !score ? 1 : score;
}

/**
 * Evita redirecciones abiertas: solo rutas de este sitio. El navegador lee `/\otro.com`
 * o `/<tab>/otro.com` como `//otro.com`, así que se resuelve la URL y se compara el origen.
 */
const SAME_SITE = 'http://automarket.invalid';
export function safeNext(next: string | null, fallback = '/vehiculos') {
  if (!next || !next.startsWith('/')) return fallback;
  try {
    const url = new URL(next, SAME_SITE);
    return url.origin === SAME_SITE ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}

/** Campos anti-bot del formulario (token de Turnstile + honeypot). */
export const humanFields = (formData: FormData, captchaToken: string | null) => ({
  captchaToken: captchaToken ?? undefined,
  website: String(formData.get('website') ?? ''),
});
