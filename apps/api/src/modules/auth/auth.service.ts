import { randomBytes, randomUUID } from 'node:crypto';
import { AvatarRegisterSchema, AvatarUploadSchema, isRif, type PublicUser } from '@automarket/contracts';
import { hash, verify } from '@node-rs/argon2';
import { env } from '../../config/env.js';
import type { AuthProvider, User } from '../../generated/prisma/client.js';
import { verifyIdToken, type OAuthProvider } from '../../shared/auth/oidc.js';
import { generateRefreshToken, hashToken, signAccessToken } from '../../shared/auth/token.service.js';
import { AppError } from '../../shared/errors/app-error.js';
import { recordAudit } from '../../shared/infra/audit.js';
import { deleteObject, presignUpload, publicMediaUrl, readObjectStart, statObject } from '../../shared/infra/storage.js';
import { isUniqueViolation, prisma, runInTransaction } from '../../shared/infra/prisma.js';
import { enqueueEmail, kickOutbox } from '../../shared/mail/mailer.js';
import { emails, webLink } from '../../shared/mail/templates.js';
import { effectivePlan } from '../../shared/membership.js';
import { assertNoBlockedTerms } from '../../shared/moderation/blocklist.js';
import { countOverdueCommissions } from '../../shared/trust.js';
import { baseMime, extensionFor, sniffImageType } from '../../shared/utils/mime.js';
import { kycService } from '../kyc/kyc.service.js';
import { realtime } from '../../shared/realtime.js';
import { authRepository } from './auth.repository.js';
import type { ForgotPasswordInput, LoginInput, OAuthLoginInput, ProfileUpdateInput, RegisterInput, ResetPasswordInput } from './auth.schemas.js';

/** Parámetros recomendados por OWASP para argon2id: 19 MiB, 2 iteraciones, 1 hilo. */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ClientContext {
  ip: string | null;
  userAgent: string | null;
}

export interface Session {
  accessToken: string;
  accessExpiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export type { PublicUser };

/** Lo único que el frontend ve del usuario (con el plan efectivo y si le falta el perfil). */
export const toPublicUser = (user: User, overdueCommissions = 0): PublicUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  avatarUrl: user.avatarUrl,
  bio: user.bio,
  role: user.role,
  accountType: user.accountType,
  isVerified: user.isVerified,
  phone: user.phone,
  country: user.country,
  city: user.city,
  dealer:
    user.accountType === 'DEALER' && user.businessName && user.taxId && user.fiscalAddress && user.businessPhone
      ? { businessName: user.businessName, taxId: user.taxId, fiscalAddress: user.fiscalAddress, businessPhone: user.businessPhone }
      : null,
  businessHours: user.accountType === 'DEALER' ? user.businessHours : null,
  plan: effectivePlan(user),
  needsProfile: !user.country || !user.city,
  overdueCommissions,
  termsAcceptedAt: user.termsAcceptedAt?.toISOString() ?? null,
});

/** Igual que toPublicUser, con las comisiones vencidas (bloquean publicar y reservar). */
export const loadPublicUser = async (user: User): Promise<PublicUser> => toPublicUser(user, await countOverdueCommissions(user.id));

const taxIdTaken = () => AppError.conflict('TAX_ID_TAKEN', 'Ya hay una cuenta de concesionario con ese RIF.');

const invalidCredentials = () => AppError.unauthorized('INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.');

// Hash de relleno: si el email no existe verificamos igualmente contra él para que
// el tiempo de respuesta no revele qué correos están registrados.
let timingEqualizer: Promise<string> | undefined;
const dummyHash = () => (timingEqualizer ??= hash('automarket-timing-equalizer', ARGON2_OPTIONS));

function assertCanSignIn(user: User): void {
  if (user.deletedAt) throw invalidCredentials();
  if (user.status !== 'ACTIVE') throw AppError.forbidden('ACCOUNT_SUSPENDED', 'Tu cuenta está suspendida. Contacta con soporte.');
}

/** Emite access token (con rol y estado KYC actuales) + refresh token de la familia indicada. */
async function startSession(user: User, ctx: ClientContext, familyId: string = randomUUID()): Promise<Session> {
  const { token, tokenHash } = generateRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * DAY_MS);

  await authRepository.createRefreshToken({
    userId: user.id,
    tokenHash,
    familyId,
    expiresAt: refreshExpiresAt,
    userAgent: ctx.userAgent?.slice(0, 512) ?? null,
    ip: ctx.ip?.slice(0, 45) ?? null,
  });

  return { accessToken: signAccessToken(user), accessExpiresIn: env.JWT_ACCESS_TTL_SECONDS, refreshToken: token, refreshExpiresAt };
}

const PROVIDER_ENUM: Record<OAuthProvider, AuthProvider> = { google: 'GOOGLE', apple: 'APPLE' };

export const authService = {
  async register(input: RegisterInput, ctx: ClientContext) {
    await assertNoBlockedTerms({ name: input.name, city: input.city, businessName: input.businessName });
    if (await authRepository.findUserByEmail(input.email)) {
      throw AppError.conflict('EMAIL_TAKEN', 'Ya existe una cuenta con ese correo.');
    }

    const now = new Date();
    const dealer = input.accountType === 'DEALER';
    let user: User;
    try {
      user = await authRepository.createUser({
        email: input.email,
        name: input.name,
        country: input.country,
        city: input.city,
        accountType: input.accountType,
        ...(dealer && { businessName: input.businessName, taxId: input.taxId, fiscalAddress: input.fiscalAddress, businessPhone: input.businessPhone }),
        passwordHash: await hash(input.password, ARGON2_OPTIONS),
        termsAcceptedAt: now,
        lastLoginAt: now,
      });
    } catch (err) {
      if (isUniqueViolation(err, 'taxId')) throw taxIdTaken();
      // Dos registros simultáneos con el mismo correo: gana el primero.
      if (isUniqueViolation(err)) throw AppError.conflict('EMAIL_TAKEN', 'Ya existe una cuenta con ese correo.');
      throw err;
    }

    realtime.statsChanged();
    return { user: await loadPublicUser(user), session: await startSession(user, ctx) };
  },

  async login({ email, password }: LoginInput, ctx: ClientContext) {
    const user = await authRepository.findUserByEmail(email);

    // Cuenta inexistente o solo-OAuth: mismo coste y mismo mensaje que una contraseña errónea.
    if (!user?.passwordHash) {
      await verify(await dummyHash(), password);
      throw invalidCredentials();
    }
    if (!(await verify(user.passwordHash, password))) throw invalidCredentials();

    assertCanSignIn(user);
    await authRepository.touchLogin(user.id);
    return { user: await loadPublicUser(user), session: await startSession(user, ctx) };
  },

  /**
   * Inicio de sesión con Google / Apple a partir de un ID token verificado.
   * 1) Cuenta OAuth ya vinculada → ese usuario.
   * 2) Email verificado por el proveedor que coincide con un usuario → se vincula.
   * 3) Si no existe → alta automática; país y ciudad se completan después (needsProfile).
   */
  async loginWithOAuth(provider: OAuthProvider, input: OAuthLoginInput, ctx: ClientContext) {
    const identity = await verifyIdToken(provider, input.idToken, input.nonce);
    const providerEnum = PROVIDER_ENUM[provider];

    const resolveUser = async (): Promise<{ user: User; isNewUser: boolean }> => {
      const linked = await authRepository.findOAuthAccount(providerEnum, identity.subject);
      if (linked) return { user: linked.user, isNewUser: false };

      if (!identity.email) throw AppError.badRequest('EMAIL_REQUIRED', 'El proveedor no compartió tu correo. Revisa los permisos e inténtalo de nuevo.');
      if (!identity.emailVerified) throw AppError.forbidden('EMAIL_NOT_VERIFIED', 'Verifica tu correo con el proveedor antes de continuar.');

      const existing = await authRepository.findUserByEmail(identity.email);
      if (existing) {
        await authRepository.linkOAuthAccount(existing.id, providerEnum, identity.subject);
        return { user: existing, isNewUser: false };
      }

      const now = new Date();
      const name = identity.name ?? input.name ?? identity.email.split('@')[0] ?? 'Usuario';
      await assertNoBlockedTerms({ name });
      const user = await authRepository.createUserWithOAuth(
        {
          email: identity.email,
          name,
          avatarUrl: identity.picture,
          emailVerifiedAt: now,
          termsAcceptedAt: now, // la UI muestra "Al continuar aceptas los Términos…"
        },
        providerEnum,
        identity.subject,
      );
      return { user, isNewUser: true };
    };

    let result: { user: User; isNewUser: boolean };
    try {
      result = await resolveUser();
    } catch (err) {
      // Primer login simultáneo desde dos pestañas: el segundo encuentra la cuenta ya creada.
      if (!isUniqueViolation(err)) throw err;
      result = await resolveUser();
    }

    assertCanSignIn(result.user);
    await authRepository.touchLogin(result.user.id);
    if (result.isNewUser) realtime.statsChanged();
    return { user: await loadPublicUser(result.user), isNewUser: result.isNewUser, session: await startSession(result.user, ctx) };
  },

  /**
   * Rotación de refresh token. Cada uso invalida el token y emite uno nuevo de la
   * misma familia. Si llega un token ya rotado, alguien lo copió: se revoca la familia.
   */
  async refresh(rawToken: string | undefined, ctx: ClientContext) {
    if (!rawToken) throw AppError.unauthorized('REFRESH_TOKEN_MISSING', 'Tu sesión terminó. Inicia sesión de nuevo.');

    const stored = await authRepository.findRefreshToken(hashToken(rawToken));
    if (!stored) throw AppError.unauthorized('INVALID_REFRESH_TOKEN', 'Tu sesión terminó. Inicia sesión de nuevo.');

    const reuseDetected = async () => {
      await authRepository.revokeFamily(stored.familyId);
      return AppError.unauthorized('REFRESH_TOKEN_REUSED', 'Detectamos un uso inusual de tu sesión. Inicia sesión de nuevo.');
    };

    if (stored.revokedAt) throw await reuseDetected();
    if (stored.expiresAt <= new Date()) throw AppError.unauthorized('REFRESH_TOKEN_EXPIRED', 'Tu sesión expiró. Inicia sesión de nuevo.');
    assertCanSignIn(stored.user);

    if (!(await authRepository.revokeIfActive(stored.id))) throw await reuseDetected();

    // El nuevo access token refleja el rol y el KYC actuales (p. ej. recién aprobado).
    return { user: await loadPublicUser(stored.user), session: await startSession(stored.user, ctx, stored.familyId) };
  },

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const stored = await authRepository.findRefreshToken(hashToken(rawToken));
    if (stored) await authRepository.revokeIfActive(stored.id);
  },

  logoutEverywhere(userId: string): Promise<void> {
    return authRepository.revokeAllForUser(userId);
  },

  /** Acepta la versión vigente de los Términos (página /terminos tras una actualización). */
  async acceptTerms(userId: string): Promise<PublicUser> {
    const user = await prisma.user.update({ where: { id: userId }, data: { termsAcceptedAt: new Date() } });
    await recordAudit({ action: 'TERMS_ACCEPTED', entityType: 'User', entityId: userId, actorId: userId });
    return loadPublicUser(user);
  },

  async me(userId: string): Promise<PublicUser> {
    const user = await authRepository.findUserById(userId);
    if (!user || user.deletedAt) throw AppError.notFound('USER_NOT_FOUND', 'Usuario no encontrado.');
    return loadPublicUser(user);
  },

  /**
   * Perfil. Tras verificar la identidad quedan fijos el teléfono, el tipo de cuenta y el RIF (son
   * los «datos verificados» que ve la otra parte de una reserva); cambiarlos requiere soporte.
   */
  async updateProfile(userId: string, input: ProfileUpdateInput): Promise<PublicUser> {
    await assertNoBlockedTerms({ name: input.name, bio: input.bio, city: input.city, businessName: input.businessName, businessHours: input.businessHours });
    const current = await authRepository.findUserById(userId);
    if (!current || current.deletedAt) throw AppError.notFound('USER_NOT_FOUND', 'Usuario no encontrado.');

    const accountType = input.accountType ?? current.accountType;
    const locked = (changed: boolean, what: string) => {
      if (changed && current.isVerified) throw AppError.conflict('VERIFIED_FIELD_LOCKED', `Tu ${what} ya está verificado. Para cambiarlo escribe a soporte.`);
    };
    locked(input.phone !== undefined && input.phone !== current.phone, 'teléfono');
    locked(accountType !== current.accountType, 'tipo de cuenta');
    locked(input.taxId !== undefined && input.taxId !== current.taxId, 'RIF');
    if (accountType !== current.accountType && effectivePlan(current).code !== 'FREE') {
      throw AppError.conflict('PLAN_ACTIVE', 'Para cambiar el tipo de cuenta espera a que venza tu plan de pago.');
    }

    const dealer = {
      businessName: input.businessName ?? current.businessName,
      taxId: input.taxId ?? current.taxId,
      fiscalAddress: input.fiscalAddress ?? current.fiscalAddress,
      businessPhone: input.businessPhone ?? current.businessPhone,
    };
    if (accountType === 'DEALER') {
      if (!dealer.businessName || !dealer.taxId || !dealer.fiscalAddress || !dealer.businessPhone) {
        throw AppError.badRequest('DEALER_DATA_REQUIRED', 'Completa razón social, RIF, dirección fiscal y teléfono corporativo.');
      }
      if ((input.country ?? current.country) === 'VE' && !isRif(dealer.taxId)) {
        throw AppError.badRequest('INVALID_RIF', 'RIF inválido. Formato: J-12345678-9.');
      }
    }

    let user: User;
    try {
      user = await authRepository.updateUser(userId, {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.bio !== undefined && { bio: input.bio || null }),
        ...(input.phone !== undefined && { phone: input.phone }),
        ...(input.country !== undefined && { country: input.country }),
        ...(input.city !== undefined && { city: input.city }),
        accountType,
        // Una persona natural no conserva datos fiscales ni horario de agencia.
        ...(accountType === 'DEALER' ? dealer : { businessName: null, taxId: null, fiscalAddress: null, businessPhone: null, businessHours: null }),
        ...(accountType === 'DEALER' && input.businessHours !== undefined && { businessHours: input.businessHours || null }),
      });
    } catch (err) {
      if (isUniqueViolation(err, 'taxId')) throw taxIdTaken();
      throw err;
    }
    // Completar el teléfono (o pasar a persona natural) puede terminar la verificación.
    if (!user.isVerified && (await kycService.refreshVerification(userId))) {
      user = (await authRepository.findUserById(userId)) ?? user;
    }
    return loadPublicUser(user);
  },

  async requestAvatarUpload(userId: string, rawInput: unknown) {
    const input = AvatarUploadSchema.parse(rawInput);
    const key = `avatars/${userId}/${randomUUID()}.${extensionFor(input.mimeType)}`;
    const expiresIn = 300;
    const uploadUrl = await presignUpload({ bucket: env.S3_BUCKET_MEDIA, key, contentType: input.mimeType, contentLength: input.sizeBytes, expiresIn });
    return { key, uploadUrl, method: 'PUT' as const, headers: { 'Content-Type': input.mimeType }, expiresIn };
  },

  async registerAvatar(userId: string, rawInput: unknown): Promise<PublicUser> {
    const { key } = AvatarRegisterSchema.parse(rawInput);
    const prefix = `avatars/${userId}/`;
    if (!key.startsWith(prefix)) throw AppError.forbidden('AVATAR_KEY_FORBIDDEN', 'El archivo no pertenece a tu cuenta.');
    const stored = await statObject(env.S3_BUCKET_MEDIA, key);
    if (!stored) throw AppError.badRequest('AVATAR_FILE_NOT_UPLOADED', 'La foto aún no termina de subirse.');
    const mimeType = baseMime(stored.contentType);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType) || stored.sizeBytes > 5 * 1024 * 1024) {
      throw AppError.badRequest('AVATAR_FILE_INVALID', 'Sube una imagen JPG, PNG o WEBP de máximo 5 MB.');
    }
    if (sniffImageType(await readObjectStart(env.S3_BUCKET_MEDIA, key)) !== mimeType) {
      throw AppError.badRequest('AVATAR_CONTENT_INVALID', 'El contenido del archivo no coincide con el tipo de imagen.');
    }

    const current = await authRepository.findUserById(userId);
    if (!current || current.deletedAt) throw AppError.notFound('USER_NOT_FOUND', 'Usuario no encontrado.');
    const user = await authRepository.updateUser(userId, { avatarUrl: publicMediaUrl(key), avatarKey: key });
    if (current.avatarKey && current.avatarKey.startsWith(prefix)) {
      try {
        await deleteObject(env.S3_BUCKET_MEDIA, current.avatarKey);
      } catch (err) {
        console.error('[auth] no se pudo eliminar la foto de perfil anterior:', err);
      }
    }
    return loadPublicUser(user);
  },

  /**
   * Recuperación de contraseña. La respuesta es SIEMPRE la misma (no revela si el correo
   * existe). El token (256 bits) viaja solo en el enlace; en BD se guarda su SHA-256.
   * También sirve a cuentas Google/Apple que quieran añadir una contraseña.
   */
  async forgotPassword({ email }: ForgotPasswordInput, ctx: ClientContext): Promise<void> {
    const user = await authRepository.findUserByEmail(email);
    if (!user || user.deletedAt || user.status !== 'ACTIVE') return;

    const token = randomBytes(32).toString('base64url');
    const minutes = env.PASSWORD_RESET_TTL_MINUTES;

    await runInTransaction(async tx => {
      // Un enlace nuevo invalida los anteriores.
      await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
      await tx.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + minutes * 60_000), ip: ctx.ip?.slice(0, 45) ?? null },
      });
      await enqueueEmail(emails.passwordReset({ to: user.email, name: user.name, link: webLink(`/restablecer?token=${token}`), minutes }), tx);
    });
    kickOutbox();
  },

  /** Cambia la contraseña con un token válido y cierra todas las sesiones abiertas. */
  async resetPassword({ token, password }: ResetPasswordInput, ctx: ClientContext): Promise<void> {
    const invalid = () => AppError.badRequest('RESET_TOKEN_INVALID', 'El enlace no es válido o ya caducó. Solicita uno nuevo.');
    const stored = await authRepository.findPasswordReset(hashToken(token));
    if (!stored || stored.usedAt || stored.expiresAt <= new Date()) throw invalid();
    if (stored.user.deletedAt || stored.user.status !== 'ACTIVE') throw invalid();

    const passwordHash = await hash(password, ARGON2_OPTIONS);
    await runInTransaction(async tx => {
      // Consumo atómico: dos envíos simultáneos del mismo enlace → solo uno gana.
      const { count } = await tx.passwordResetToken.updateMany({ where: { id: stored.id, usedAt: null }, data: { usedAt: new Date() } });
      if (count !== 1) throw invalid();
      await tx.user.update({ where: { id: stored.userId }, data: { passwordHash, tokenVersion: { increment: 1 } } });
      await tx.refreshToken.updateMany({ where: { userId: stored.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await recordAudit({ action: 'PASSWORD_RESET', entityType: 'User', entityId: stored.userId, actorId: stored.userId, ip: ctx.ip }, tx);
    });
  },
};
