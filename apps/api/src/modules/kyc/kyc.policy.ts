import type { AccountType, KycDocumentType } from '../../generated/prisma/enums.js';
import { AppError } from '../../shared/errors/app-error.js';

const MB = 1024 * 1024;

export const KYC_FILE_POLICY = {
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  maxBytes: 10 * MB,
} as const;

export const IDENTITY_DOCUMENTS: readonly KycDocumentType[] = ['NATIONAL_ID', 'PASSPORT', 'DRIVER_LICENSE'];

/** Evita que un usuario sature la cola de revisión. */
export const MAX_PENDING_DOCUMENTS = 5;

export type KycRequirement = 'IDENTITY_DOCUMENT' | 'SELFIE' | 'PHONE' | 'BUSINESS_DOCUMENT';

/** Todo documento de un usuario vive bajo su prefijo en el bucket privado de KYC (cédulas, selfies, RIF). */
export const kycPrefix = (userId: string) => `cedulas/${userId}/`;

export function assertKycFileAllowed(type: KycDocumentType, mimeType: string, sizeBytes: number): void {
  if (!(KYC_FILE_POLICY.mimeTypes as readonly string[]).includes(mimeType)) {
    throw AppError.badRequest('KYC_FILE_TYPE_NOT_ALLOWED', 'Sube una foto (JPG, PNG, WEBP) o un PDF.', { allowed: KYC_FILE_POLICY.mimeTypes });
  }
  if (type === 'SELFIE' && !mimeType.startsWith('image/')) {
    throw AppError.badRequest('KYC_SELFIE_MUST_BE_IMAGE', 'La selfie debe ser una imagen.');
  }
  if (sizeBytes > KYC_FILE_POLICY.maxBytes) {
    throw AppError.badRequest('KYC_FILE_TOO_LARGE', 'El archivo supera el máximo de 10 MB.');
  }
}

/**
 * Verificación estricta (requisito para publicar y reservar): cédula u otro documento de identidad
 * + selfie (prueba de vida) aprobados y un teléfono de contacto. Los concesionarios añaden el
 * documento del RIF (BUSINESS_REGISTRATION) aprobado.
 */
export function missingRequirements(
  approved: ReadonlySet<KycDocumentType>,
  owner: { phone: string | null; accountType: AccountType },
): KycRequirement[] {
  const missing: KycRequirement[] = [];
  if (!IDENTITY_DOCUMENTS.some(type => approved.has(type))) missing.push('IDENTITY_DOCUMENT');
  if (!approved.has('SELFIE')) missing.push('SELFIE');
  if (!owner.phone) missing.push('PHONE');
  if (owner.accountType === 'DEALER' && !approved.has('BUSINESS_REGISTRATION')) missing.push('BUSINESS_DOCUMENT');
  return missing;
}
