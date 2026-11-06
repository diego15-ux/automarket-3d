import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role } from '../../../generated/prisma/enums.js';
import { ACCESS_TOKEN_COOKIE, verifyAccessToken, type AuthContext } from '../../auth/token.service.js';
import { AppError } from '../../errors/app-error.js';
import { prisma } from '../../infra/prisma.js';

/**
 * Cadena de seguridad para rutas protegidas:
 *
 *   authenticate            → identidad y rol vigentes   (JWT + BD)              401/403
 *   authorize(...)          → ¿tienes el permiso?        (rol actual)            403
 *   requireCompleteProfile  → ¿cuenta activa con país   (consulta en BD)        403
 *                             y ciudad?
 *
 * Roles unificados: todo USER compra, reserva y publica. Express 5 propaga los
 * errores lanzados (síncronos o async) al error handler: aquí basta con `throw`.
 */

function extractToken(req: Request): string | null {
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7).trim() || null;

  const cookie: unknown = req.cookies?.[ACCESS_TOKEN_COOKIE];
  return typeof cookie === 'string' && cookie.length > 0 ? cookie : null;
}

/** 1) Autenticación: verifica el JWT y adjunta la identidad en `req.auth`. */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = extractToken(req);
  if (!token) throw AppError.unauthorized('AUTH_REQUIRED', 'Inicia sesión para continuar.');

  let auth: AuthContext;
  try {
    auth = verifyAccessToken(token);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw AppError.unauthorized('TOKEN_EXPIRED', 'Tu sesión expiró. Vuelve a iniciar sesión.');
    }
    throw AppError.unauthorized('INVALID_TOKEN', 'Token de acceso inválido.');
  }

  const account = await prisma.user.findUnique({ where: { id: auth.id }, select: { role: true, status: true, deletedAt: true } });
  if (!account || account.deletedAt) throw AppError.unauthorized('ACCOUNT_NOT_FOUND', 'La cuenta ya no existe.');
  if (account.status !== 'ACTIVE') throw AppError.forbidden('ACCOUNT_SUSPENDED', 'Tu cuenta está suspendida.');
  req.auth = { ...auth, role: account.role };
  next();
}

/** Identidad opcional: rutas públicas que personalizan si hay sesión (búsqueda por cercanía). */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = extractToken(req);
  if (!token) return next();

  let auth: AuthContext;
  try {
    auth = verifyAccessToken(token);
  } catch {
    // token caducado o inválido: se trata como visitante anónimo
    return next();
  }
  const account = await prisma.user.findUnique({ where: { id: auth.id }, select: { role: true, status: true, deletedAt: true } });
  if (account && !account.deletedAt && account.status === 'ACTIVE') req.auth = { ...auth, role: account.role };
  next();
}

/** Devuelve la identidad autenticada o lanza 401 (útil dentro de los controladores). */
export function currentUser(req: Request): AuthContext {
  if (!req.auth) throw AppError.unauthorized('AUTH_REQUIRED', 'Inicia sesión para continuar.');
  return req.auth;
}

/** 2) Autorización por rol. */
export function authorize(...allowed: [Role, ...Role[]]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!allowed.includes(currentUser(req).role)) {
      throw AppError.forbidden('FORBIDDEN_ROLE', 'No tienes permisos para realizar esta acción.');
    }
    next();
  };
}

/** Permisos del panel completo, controles de propietario y equipo de cumplimiento. */
export const requireAdmin = authorize('ADMIN', 'ADMIN_ONE');
export const requireAdminOne = authorize('ADMIN_ONE');
export const requireCompliance = authorize('ADMIN', 'ADMIN_ONE', 'SUPERVISOR');

/**
 * 3) Publicar, reservar o pagar exige cuenta activa con país y ciudad (las cuentas
 * creadas con Google/Apple los completan en /cuenta/perfil). Se consulta la BD y no
 * el JWT: una suspensión surte efecto al instante.
 */
export async function requireCompleteProfile(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const auth = currentUser(req);
  const user = await prisma.user.findUnique({ where: { id: auth.id }, select: { status: true, deletedAt: true, country: true, city: true } });

  if (!user || user.deletedAt) throw AppError.unauthorized('ACCOUNT_NOT_FOUND', 'La cuenta ya no existe.');
  if (user.status !== 'ACTIVE') throw AppError.forbidden('ACCOUNT_SUSPENDED', 'Tu cuenta está suspendida.');
  if (!user.country || !user.city) {
    throw AppError.forbidden('PROFILE_INCOMPLETE', 'Completa tu país y ciudad en tu perfil para continuar.');
  }
  next();
}

/** Composición para publicar, reservar y comprar membresías. */
export const requireActiveMember = [authenticate, requireCompleteProfile] as const;
