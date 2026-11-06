import { apiFetch } from '@/shared/lib/http';
import type { PresignedUpload } from '@/shared/lib/upload';
import { sha256HexOf } from '@/shared/lib/browser';

export type KycDocumentType = 'NATIONAL_ID' | 'PASSPORT' | 'DRIVER_LICENSE' | 'SELFIE' | 'PROOF_OF_ADDRESS' | 'BUSINESS_REGISTRATION';
export type KycDocumentStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface KycDocument {
  id: string;
  type: KycDocumentType;
  status: KycDocumentStatus;
  rejectionReason: string | null;
  expiresAt: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface KycStatus {
  status: 'NOT_STARTED' | 'PENDING' | 'REJECTED' | 'INCOMPLETE' | 'APPROVED';
  isVerified: boolean;
  verifiedAt: string | null;
  identityExpiresAt: string | null;
  canRenewIdentity: boolean;
  missing: Array<'IDENTITY_DOCUMENT' | 'SELFIE' | 'PHONE' | 'BUSINESS_DOCUMENT'>;
  documents: KycDocument[];
}

export interface KycQueueItem extends KycDocument {
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  /** Enlace de lectura temporal (5 min). */
  fileUrl: string;
  /** Quién lo revisó (aprobados y rechazados). */
  reviewer: string | null;
  /** El mismo archivo lo envió otra cuenta. */
  duplicateElsewhere: boolean;
  /** La selfie de la misma persona (si se revisa un documento) o su documento (si se revisa la selfie). */
  companion: { id: string; type: KycDocumentType; status: KycDocumentStatus; mimeType: string; fileUrl: string } | null;
  user: { id: string; name: string; email: string; createdAt: string; accountType: 'INDIVIDUAL' | 'DEALER'; businessName: string | null; taxId: string | null; phone: string | null; isVerified: boolean };
}
export type KycCounts = Record<KycDocumentStatus, number>;

export type KycDecision = { decision: 'APPROVE' } | { decision: 'REJECT'; reason: string };

export const kycKeys = {
  status: ['kyc', 'status'] as const,
  queue: (status: KycDocumentStatus) => ['kyc', 'queue', status] as const,
  counts: ['kyc', 'counts'] as const,
};

export const kycApi = {
  status: () => apiFetch<{ data: KycStatus }>('/api/kyc/status').then(response => response.data),
  requestUpload: (input: { type: KycDocumentType; mimeType: string; sizeBytes: number }) =>
    apiFetch<{ data: PresignedUpload }>('/api/kyc/uploads', { method: 'POST', body: input }).then(response => response.data),
  submit: (input: { type: KycDocumentType; key: string; sha256: string; expiresAt?: string }) =>
    apiFetch<{ data: KycDocument }>('/api/kyc/documents', { method: 'POST', body: input }).then(response => response.data),

  // Administración
  queue: (status: KycDocumentStatus, cursor?: string) => {
    const query = new URLSearchParams({ status, limit: '10', ...(cursor ? { cursor } : {}) });
    return apiFetch<{ data: KycQueueItem[]; nextCursor: string | null }>(`/api/admin/kyc?${query}`);
  },
  counts: () => apiFetch<{ data: KycCounts }>('/api/admin/kyc/counts').then(response => response.data),
  review: (id: string, decision: KycDecision) =>
    apiFetch<{ data: { documentId: string; status: KycDocumentStatus; userVerified: boolean } }>(`/api/admin/kyc/${id}`, { method: 'PATCH', body: decision }).then(
      response => response.data,
    ),
};

/** Huella SHA-256 calculada en el navegador: detecta documentos reutilizados. */
export async function sha256Hex(file: Blob): Promise<string> {
  return sha256HexOf(await file.arrayBuffer());
}

export const DOCUMENT_LABELS: Record<KycDocumentType, string> = {
  NATIONAL_ID: 'Cédula de identidad',
  PASSPORT: 'Pasaporte',
  DRIVER_LICENSE: 'Licencia de conducir',
  SELFIE: 'Selfie',
  PROOF_OF_ADDRESS: 'Comprobante de domicilio',
  BUSINESS_REGISTRATION: 'Documento del RIF',
};

export const KYC_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const KYC_MAX_BYTES = 10 * 1024 * 1024;
