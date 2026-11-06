import type { KycDocumentType, KycStatus, Prisma } from '../../generated/prisma/client.js';
import { prisma, type Db } from '../../shared/infra/prisma.js';
import type { KycQueueQuery } from './kyc.schemas.js';

/** Lo que el propio usuario ve de sus documentos (sin claves S3 ni huellas). */
const ownerView = { id: true, type: true, status: true, rejectionReason: true, expiresAt: true, createdAt: true, reviewedAt: true } as const;

export const kycRepository = {
  findUserVerification(userId: string) {
    return prisma.user.findUnique({ where: { id: userId }, select: { isVerified: true, verifiedAt: true, phone: true, accountType: true } });
  },

  listForUser(userId: string) {
    return prisma.kycDocument.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, select: ownerView });
  },

  countPending(userId: string): Promise<number> {
    return prisma.kycDocument.count({ where: { userId, status: 'PENDING' } });
  },

  /** ¿Otra cuenta ya presentó exactamente el mismo archivo? (señal de fraude) */
  findOtherOwnerOfHash(sha256: string, userId: string) {
    return prisma.kycDocument.findFirst({ where: { sha256, userId: { not: userId } }, select: { id: true, userId: true } });
  },

  create(data: Prisma.KycDocumentUncheckedCreateInput) {
    return prisma.kycDocument.create({ data, select: ownerView });
  },

  /** Cola FIFO con paginación por cursor; pide uno de más para saber si hay página siguiente. */
  listQueue({ status, cursor, limit }: KycQueueQuery) {
    return prisma.kycDocument.findMany({
      where: { status },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        ...ownerView,
        s3Bucket: true,
        s3Key: true,
        mimeType: true,
        sizeBytes: true,
        sha256: true,
        userId: true,
        reviewedBy: { select: { name: true } },
        user: { select: { id: true, name: true, email: true, createdAt: true, accountType: true, businessName: true, taxId: true, phone: true, isVerified: true } },
      },
    });
  },

  /** Conteos de la cola por estado (pestañas del panel). */
  async countByStatus() {
    const rows = await prisma.kycDocument.groupBy({ by: ['status'], _count: { _all: true } });
    const count = (status: KycStatus) => rows.find(row => row.status === status)?._count._all ?? 0;
    return { PENDING: count('PENDING'), APPROVED: count('APPROVED'), REJECTED: count('REJECTED') };
  },

  /** Documento que acompaña al revisado: la selfie si se revisa un documento, o el documento si se revisa la selfie. */
  findCompanion(userId: string, type: KycDocumentType, excludeId: string) {
    const wanted: KycDocumentType[] = type === 'SELFIE' ? ['NATIONAL_ID', 'PASSPORT', 'DRIVER_LICENSE'] : ['SELFIE'];
    return prisma.kycDocument.findFirst({
      where: { userId, type: { in: wanted }, id: { not: excludeId } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, type: true, status: true, mimeType: true, s3Bucket: true, s3Key: true },
    });
  },

  /** ¿El mismo archivo (huella) lo envió otra cuenta? */
  countOtherOwners(sha256: string, userId: string) {
    return prisma.kycDocument.count({ where: { sha256, userId: { not: userId } } });
  },

  // ── Revisión (siempre dentro de una transacción) ────────────────────────
  findForReview(id: string, db: Db) {
    return db.kycDocument.findUnique({ where: { id }, select: { id: true, userId: true, type: true, status: true } });
  },

  /** Solo cambia documentos PENDING: si dos administradores revisan a la vez, gana uno. */
  async markReviewed(
    params: { id: string; status: Exclude<KycStatus, 'PENDING'>; reviewerId: string; reason: string | null; at: Date },
    db: Db,
  ): Promise<boolean> {
    const { count } = await db.kycDocument.updateMany({
      where: { id: params.id, status: 'PENDING' },
      data: { status: params.status, reviewedById: params.reviewerId, reviewedAt: params.at, rejectionReason: params.reason },
    });
    return count === 1;
  },

  async approvedTypes(userId: string, db: Db, now = new Date()): Promise<Set<KycDocumentType>> {
    const rows = await db.kycDocument.findMany({
      where: { userId, status: 'APPROVED', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      select: { type: true },
    });
    return new Set(rows.map(row => row.type));
  },

  async invalidateExpiredIdentity(userId: string, now = new Date()): Promise<boolean> {
    const expired = await prisma.kycDocument.findFirst({
      where: {
        userId,
        status: 'APPROVED',
        type: { in: ['NATIONAL_ID', 'PASSPORT', 'DRIVER_LICENSE'] },
        expiresAt: { lte: now },
        user: { isVerified: true },
      },
      select: { id: true },
    });
    if (!expired) return false;
    const validAlternative = await prisma.kycDocument.count({
      where: {
        userId,
        status: 'APPROVED',
        type: { in: ['NATIONAL_ID', 'PASSPORT', 'DRIVER_LICENSE'] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });
    if (validAlternative > 0) return false;
    const { count } = await prisma.user.updateMany({
      where: { id: userId, isVerified: true },
      data: { isVerified: false, verifiedAt: null },
    });
    return count > 0;
  },

  latestValidIdentity(userId: string, now = new Date()) {
    return prisma.kycDocument.findFirst({
      where: {
        userId,
        status: 'APPROVED',
        type: { in: ['NATIONAL_ID', 'PASSPORT', 'DRIVER_LICENSE'] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { expiresAt: 'desc' },
      select: { expiresAt: true },
    });
  },

  findOwner(userId: string, db: Db) {
    return db.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true, isVerified: true, phone: true, accountType: true } });
  },

  async verifyUser(userId: string, at: Date, db: Db): Promise<void> {
    await db.user.update({ where: { id: userId }, data: { isVerified: true, verifiedAt: at } });
  },
};
