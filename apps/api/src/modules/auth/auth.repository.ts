import type { AuthProvider, Prisma, User } from '../../generated/prisma/client.js';
import { prisma } from '../../shared/infra/prisma.js';

/** Acceso a datos de identidad y sesiones. Sin reglas de negocio. */
export const authRepository = {
  findUserByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
  },

  findUserById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  },

  createUser(data: Prisma.UserUncheckedCreateInput): Promise<User> {
    return prisma.user.create({ data });
  },

  updateUser(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return prisma.user.update({ where: { id }, data });
  },

  async touchLogin(userId: string): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  },

  // ── OAuth ──────────────────────────────────────────────────────────────

  findOAuthAccount(provider: AuthProvider, providerAccountId: string) {
    return prisma.oAuthAccount.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId } },
      include: { user: true },
    });
  },

  async linkOAuthAccount(userId: string, provider: AuthProvider, providerAccountId: string): Promise<void> {
    await prisma.oAuthAccount.create({ data: { userId, provider, providerAccountId } });
  },

  createUserWithOAuth(data: Prisma.UserUncheckedCreateInput, provider: AuthProvider, providerAccountId: string): Promise<User> {
    return prisma.user.create({ data: { ...data, accounts: { create: { provider, providerAccountId } } } });
  },

  // ── Refresh tokens ─────────────────────────────────────────────────────

  async createRefreshToken(data: Prisma.RefreshTokenUncheckedCreateInput): Promise<void> {
    await prisma.refreshToken.create({ data });
  },

  findRefreshToken(tokenHash: string) {
    return prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
  },

  /** Revoca solo si seguía activo. `false` = otro proceso lo usó antes (posible robo). */
  async revokeIfActive(id: string): Promise<boolean> {
    const { count } = await prisma.refreshToken.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
    return count === 1;
  },

  async revokeFamily(familyId: string): Promise<void> {
    await prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  },

  /** "Cerrar sesión en todos los dispositivos". */
  async revokeAllForUser(userId: string): Promise<void> {
    await prisma.$transaction([
      prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }),
    ]);
  },

  // ── Recuperación de contraseña ─────────────────────────────────────────

  findPasswordReset(tokenHash: string) {
    return prisma.passwordResetToken.findUnique({ where: { tokenHash }, include: { user: true } });
  },
};
