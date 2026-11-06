import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { Role } from '../../generated/prisma/enums.js';

/** Cookie httpOnly donde el frontend recibe el access token (alternativa al header Bearer). */
export const ACCESS_TOKEN_COOKIE = 'am_at';
/** Cookie httpOnly del refresh token: solo viaja a /api/auth (path restringido). */
export const REFRESH_TOKEN_COOKIE = 'am_rt';

/** Identidad autenticada disponible en req.auth (HTTP) y socket.data.user (Socket.io). */
export interface AuthContext {
  id: string;
  role: Role;
  /** Copia del estado KYC al emitir el token. Para acciones críticas se revalida en BD. */
  isVerified: boolean;
  /** Expiración (segundos epoch). */
  exp: number;
}

const ClaimsSchema = z.object({
  sub: z.string().min(1),
  role: z.enum(Role),
  kyc: z.boolean(),
  exp: z.number().int(),
});

export function signAccessToken(user: { id: string; role: Role; isVerified: boolean }): string {
  return jwt.sign({ role: user.role, kyc: user.isVerified }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: user.id,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
  });
}

/**
 * Verifica firma, algoritmo (fijado para evitar ataques "alg: none"/confusión),
 * emisor, audiencia y expiración; después valida la forma de los claims.
 * Lanza jwt.TokenExpiredError o jwt.JsonWebTokenError.
 */
export function verifyAccessToken(token: string): AuthContext {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ['HS256'],
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  });

  const claims = ClaimsSchema.safeParse(payload);
  if (!claims.success) throw new jwt.JsonWebTokenError('Claims del token inválidos');

  return { id: claims.data.sub, role: claims.data.role, isVerified: claims.data.kyc, exp: claims.data.exp };
}

/** SHA-256 en hex: en BD solo se guarda la huella del refresh token, nunca el token. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Refresh token opaco de 384 bits (no es un JWT: no contiene datos y se puede revocar). */
export function generateRefreshToken() {
  const token = randomBytes(48).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}
