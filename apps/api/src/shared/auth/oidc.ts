import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError } from '../errors/app-error.js';

/**
 * Verificación de ID tokens OpenID Connect (Google / Apple).
 * El frontend obtiene el ID token con Google Identity Services o Sign in with Apple JS
 * y lo envía a la API; aquí comprobamos firma (JWKS del proveedor, cacheado), emisor,
 * audiencia (nuestros client ids), expiración y, si se envió, el nonce anti-replay.
 */
const PROVIDERS = {
  google: {
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    audiences: env.GOOGLE_CLIENT_IDS,
    jwks: createRemoteJWKSet(new URL(env.GOOGLE_JWKS_URL)),
  },
  apple: {
    issuers: ['https://appleid.apple.com'],
    audiences: env.APPLE_CLIENT_IDS,
    jwks: createRemoteJWKSet(new URL(env.APPLE_JWKS_URL)),
  },
} as const;

export type OAuthProvider = keyof typeof PROVIDERS;

export interface VerifiedIdentity {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

const IdTokenClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.email().optional(),
  // Apple envía "true"/"false" como texto; Google, como booleano.
  email_verified: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
  name: z.string().optional(),
  picture: z.url().optional(),
  nonce: z.string().optional(),
});

export async function verifyIdToken(provider: OAuthProvider, idToken: string, expectedNonce?: string): Promise<VerifiedIdentity> {
  const config = PROVIDERS[provider];
  if (config.audiences.length === 0) {
    throw new AppError(503, 'OAUTH_NOT_CONFIGURED', `El acceso con ${provider === 'google' ? 'Google' : 'Apple'} no está disponible.`);
  }

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(idToken, config.jwks, {
      issuer: [...config.issuers],
      audience: config.audiences,
      algorithms: ['RS256', 'ES256'],
      clockTolerance: 30,
    }));
  } catch {
    throw AppError.unauthorized('INVALID_ID_TOKEN', 'No pudimos verificar tu identidad con el proveedor.');
  }

  const claims = IdTokenClaimsSchema.safeParse(payload);
  if (!claims.success || (expectedNonce !== undefined && claims.data.nonce !== expectedNonce)) {
    throw AppError.unauthorized('INVALID_ID_TOKEN', 'No pudimos verificar tu identidad con el proveedor.');
  }

  const { sub, email, email_verified, name, picture } = claims.data;
  return {
    subject: sub,
    email: email?.toLowerCase() ?? null,
    emailVerified: email_verified === true || email_verified === 'true',
    name: name ?? null,
    picture: picture ?? null,
  };
}
