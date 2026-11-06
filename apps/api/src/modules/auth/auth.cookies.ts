import type { CookieOptions, Response } from 'express';
import { env } from '../../config/env.js';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '../../shared/auth/token.service.js';
import type { Session } from './auth.service.js';

/**
 * Cookies de sesión:
 * - am_at (access): httpOnly + SameSite=Lax → no legible por JS y no viaja en POST cross-site (CSRF).
 * - am_rt (refresh): además SameSite=Strict y Path=/api/auth → solo llega a los endpoints de sesión.
 */
const base: CookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  domain: env.COOKIE_DOMAIN,
};
const accessCookie: CookieOptions = { ...base, sameSite: 'lax', path: '/' };
const refreshCookie: CookieOptions = { ...base, sameSite: 'strict', path: '/api/auth' };

export function setSessionCookies(res: Response, session: Session): void {
  res.cookie(ACCESS_TOKEN_COOKIE, session.accessToken, { ...accessCookie, maxAge: session.accessExpiresIn * 1000 });
  res.cookie(REFRESH_TOKEN_COOKIE, session.refreshToken, { ...refreshCookie, expires: session.refreshExpiresAt });
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(ACCESS_TOKEN_COOKIE, accessCookie);
  res.clearCookie(REFRESH_TOKEN_COOKIE, refreshCookie);
}
