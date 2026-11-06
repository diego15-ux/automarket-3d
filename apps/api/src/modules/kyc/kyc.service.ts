import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError } from '../../shared/errors/app-error.js';
import type { Role } from '../../generated/prisma/enums.js';
import { recordAudit } from '../../shared/infra/audit.js';
import { isUniqueViolation, runInTransaction } from '../../shared/infra/prisma.js';
import { presignDownload, presignUpload, statObject } from '../../shared/infra/storage.js';
import { baseMime, extensionFor } from '../../shared/utils/mime.js';
import { assertKycFileAllowed, kycPrefix, MAX_PENDING_DOCUMENTS, missingRequirements } from './kyc.policy.js';
import { kycRepository } from './kyc.repository.js';
import type { KycQueueQuery, KycReviewInput, KycSubmitInput, KycUploadInput } from './kyc.schemas.js';

export interface ActorContext {
  actorId: string;
  role: Role;
  ip: string | null;
}

/** Las URLs de lectura de documentos de identidad caducan rápido. */
const REVIEW_URL_TTL_SECONDS = 300;

const IDENTITY_RENEWAL_WINDOW_DAYS = 30;

async function assertNotVerified(userId: string, allowIdentityRenewal = false): Promise<void> {
  await kycRepository.invalidateExpiredIdentity(userId);
  const user = await kycRepository.findUserVerification(userId);
  if (!user) throw AppError.notFound('USER_NOT_FOUND', 'Usuario no encontrado.');
  if (user.isVerified) {
    const identity = allowIdentityRenewal ? await kycRepository.latestValidIdentity(userId) : null;
    const renewalAllowed = identity?.expiresAt !== null && identity?.expiresAt !== undefined &&
      identity.expiresAt.getTime() <= Date.now() + IDENTITY_RENEWAL_WINDOW_DAYS * 86_400_000;
    if (!renewalAllowed) throw AppError.conflict('ALREADY_VERIFIED', 'Tu identidad ya está verificada.');
  }
}

export const kycService = {
  /** Estado agregado para la UI: qué falta, qué está en revisión y por qué se rechazó. */
  async getStatus(userId: string) {
    await kycRepository.invalidateExpiredIdentity(userId);
    const [user, documents] = await Promise.all([kycRepository.findUserVerification(userId), kycRepository.listForUser(userId)]);
    if (!user) throw AppError.notFound('USER_NOT_FOUND', 'Usuario no encontrado.');

    const now = new Date();
    const approved = new Set(documents.filter(doc => doc.status === 'APPROVED' && (!doc.expiresAt || doc.expiresAt > now)).map(doc => doc.type));
    const latestIdentity = documents
      .filter(doc => ['NATIONAL_ID', 'PASSPORT', 'DRIVER_LICENSE'].includes(doc.type) && doc.status === 'APPROVED' && doc.expiresAt && doc.expiresAt > now)
      .sort((a, b) => b.expiresAt!.getTime() - a.expiresAt!.getTime())[0];
    const identityExpiresAt = latestIdentity?.expiresAt?.toISOString() ?? null;
    const status = user.isVerified
      ? 'APPROVED'
      : documents.length === 0
        ? 'NOT_STARTED'
        : documents.some(doc => doc.status === 'PENDING')
          ? 'PENDING'
          : documents[0]?.status === 'REJECTED'
            ? 'REJECTED'
            : 'INCOMPLETE';

    return {
      status,
      isVerified: user.isVerified,
      verifiedAt: user.verifiedAt,
      identityExpiresAt,
      canRenewIdentity: user.isVerified && Boolean(latestIdentity?.expiresAt && latestIdentity.expiresAt.getTime() <= now.getTime() + IDENTITY_RENEWAL_WINDOW_DAYS * 86_400_000),
      missing: user.isVerified ? [] : missingRequirements(approved, user),
      documents,
    };
  },

  /** Paso 1: URL prefirmada PUT (5 min) al bucket privado de KYC, bajo el prefijo del usuario. */
  async requestUpload(userId: string, input: KycUploadInput) {
    await assertNotVerified(userId, ['NATIONAL_ID', 'PASSPORT', 'DRIVER_LICENSE'].includes(input.type));
    if ((await kycRepository.countPending(userId)) >= MAX_PENDING_DOCUMENTS) {
      throw AppError.conflict('TOO_MANY_PENDING', 'Tienes documentos pendientes de revisión. Espera a que los revisemos.');
    }

    const mimeType = baseMime(input.mimeType);
    assertKycFileAllowed(input.type, mimeType, input.sizeBytes);

    const key = `${kycPrefix(userId)}${randomUUID()}.${extensionFor(mimeType)}`;
    const expiresIn = 300;
    const uploadUrl = await presignUpload({ bucket: env.S3_BUCKET_KYC, key, contentType: mimeType, contentLength: input.sizeBytes, expiresIn });

    return { key, uploadUrl, method: 'PUT' as const, headers: { 'Content-Type': mimeType }, expiresIn };
  },

  /** Paso 2: registra el documento subido y lo pone en la cola de revisión. */
  async submitDocument(userId: string, input: KycSubmitInput, ip: string | null) {
    if (!input.key.startsWith(kycPrefix(userId))) {
      throw AppError.forbidden('KYC_KEY_FORBIDDEN', 'El archivo no pertenece a tu cuenta.');
    }
    await assertNotVerified(userId, ['NATIONAL_ID', 'PASSPORT', 'DRIVER_LICENSE'].includes(input.type));

    // No confiamos en lo declarado: leemos tamaño y tipo reales del objeto en S3.
    const stored = await statObject(env.S3_BUCKET_KYC, input.key);
    if (!stored) throw AppError.badRequest('KYC_FILE_NOT_UPLOADED', 'El archivo aún no termina de subirse.');
    const mimeType = baseMime(stored.contentType);
    assertKycFileAllowed(input.type, mimeType, stored.sizeBytes);

    const duplicate = await kycRepository.findOtherOwnerOfHash(input.sha256, userId);
    if (duplicate) {
      await recordAudit({
        action: 'KYC_DUPLICATE_DETECTED',
        entityType: 'User',
        entityId: userId,
        actorId: userId,
        metadata: { sha256: input.sha256, otherUserId: duplicate.userId, otherDocumentId: duplicate.id },
        ip,
      });
      throw AppError.conflict('DOCUMENT_ALREADY_USED', 'Este documento ya fue presentado por otra cuenta. Contacta con soporte.');
    }

    try {
      const document = await kycRepository.create({
        userId,
        type: input.type,
        s3Bucket: env.S3_BUCKET_KYC,
        s3Key: input.key,
        mimeType,
        sizeBytes: stored.sizeBytes,
        sha256: input.sha256,
        ...(input.expiresAt ? { expiresAt: new Date(`${input.expiresAt}T23:59:59.999Z`) } : {}),
      });
      await recordAudit({ action: 'KYC_DOCUMENT_SUBMITTED', entityType: 'KycDocument', entityId: document.id, actorId: userId, ip });
      return document;
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict('DOCUMENT_ALREADY_SUBMITTED', 'Ese archivo ya fue enviado.');
      throw err;
    }
  },

  /** Panel de administración: cola FIFO con enlaces de lectura de 5 min. Cada consulta queda auditada. */
  async listQueue(query: KycQueueQuery, actor: ActorContext) {
    const rows = await kycRepository.listQueue(query);
    const page = rows.slice(0, query.limit);

    const viewed = new Set<string>();
    const data = await Promise.all(
      page.map(async ({ s3Bucket, s3Key, userId, reviewedBy, ...document }) => {
        viewed.add(document.id);
        const [companion, otherOwners] = await Promise.all([kycRepository.findCompanion(userId, document.type, document.id), kycRepository.countOtherOwners(document.sha256, userId)]);
        if (companion) viewed.add(companion.id);
        return {
          ...document,
          reviewer: reviewedBy?.name ?? null,
          /** El mismo archivo lo envió otra cuenta (señal de fraude). */
          duplicateElsewhere: otherOwners > 0,
          fileUrl: await presignDownload(s3Bucket, s3Key, REVIEW_URL_TTL_SECONDS),
          companion: companion
            ? { id: companion.id, type: companion.type, status: companion.status, mimeType: companion.mimeType, fileUrl: await presignDownload(companion.s3Bucket, companion.s3Key, REVIEW_URL_TTL_SECONDS) }
            : null,
        };
      }),
    );

    await recordAudit(
      [...viewed].map(id => ({
        action: 'KYC_DOCUMENTS_VIEWED' as const,
        entityType: 'KycDocument' as const,
        entityId: id,
        actorId: actor.actorId,
        ip: actor.ip,
      })),
    );

    return { data, nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null };
  },

  /** Conteos por estado para las pestañas de la cola. */
  counts() {
    return kycRepository.countByStatus();
  },

  /**
   * Aprobar / rechazar. En una sola transacción:
   * documento revisado → ¿cumple requisitos? → usuario verificado (insignia y permiso para recibir depósitos) → auditoría.
   */
  async review(documentId: string, input: KycReviewInput, actor: ActorContext) {
    return runInTransaction(async tx => {
      const document = await kycRepository.findForReview(documentId, tx);
      if (!document) throw AppError.notFound('KYC_DOCUMENT_NOT_FOUND', 'Documento no encontrado.');
      const selfReview = document.userId === actor.actorId;
      if (selfReview && (actor.role !== 'ADMIN_ONE' || input.decision !== 'APPROVE')) {
        throw AppError.forbidden('SELF_REVIEW_FORBIDDEN', 'No puedes revisar tus propios documentos.');
      }

      const now = new Date();
      const status = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const reviewed = await kycRepository.markReviewed(
        { id: document.id, status, reviewerId: actor.actorId, reason: input.decision === 'REJECT' ? input.reason : null, at: now },
        tx,
      );
      if (!reviewed) throw AppError.conflict('ALREADY_REVIEWED', 'Este documento ya fue revisado.');

      let userVerified = false;
      if (status === 'APPROVED') {
        // Secuencial a propósito: una transacción interactiva usa una única conexión.
        const approved = await kycRepository.approvedTypes(document.userId, tx);
        const owner = await kycRepository.findOwner(document.userId, tx);
        if (!owner.isVerified && missingRequirements(approved, owner).length === 0) {
          await kycRepository.verifyUser(document.userId, now, tx);
          userVerified = true;
        }
      }

      await recordAudit(
        [
          {
            action: status === 'APPROVED' ? 'KYC_APPROVED' : 'KYC_REJECTED',
            entityType: 'KycDocument',
            entityId: document.id,
            actorId: actor.actorId,
            ip: actor.ip,
            metadata: {
              ...(input.decision === 'REJECT' ? { reason: input.reason } : {}),
              ...(selfReview ? { selfReview: true } : {}),
            },
          },
          ...(userVerified ? [{ action: 'USER_VERIFIED' as const, entityType: 'User' as const, entityId: document.userId, actorId: actor.actorId, ip: actor.ip }] : []),
        ],
        tx,
      );

      return { documentId: document.id, status, userVerified };
    });
  },

  /**
   * Vuelve a evaluar los requisitos cuando cambian datos del perfil (p. ej. el usuario añade el
   * teléfono después de que le aprobaran los documentos). Devuelve true si quedó verificado.
   */
  async refreshVerification(userId: string): Promise<boolean> {
    return runInTransaction(async tx => {
      const owner = await kycRepository.findOwner(userId, tx);
      if (owner.isVerified) return false;
      const approved = await kycRepository.approvedTypes(userId, tx);
      if (missingRequirements(approved, owner).length > 0) return false;
      await kycRepository.verifyUser(userId, new Date(), tx);
      await recordAudit({ action: 'USER_VERIFIED', entityType: 'User', entityId: userId, actorId: null }, tx);
      return true;
    });
  },
};
