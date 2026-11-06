import { z } from 'zod';
import { KycDocumentType, KycStatus } from '../../generated/prisma/enums.js';

const Sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/i, 'Huella SHA-256 inválida.')
  .transform(value => value.toLowerCase());

/** Paso 1: pedir URL prefirmada para subir el archivo directo al bucket privado. */
export const KycUploadSchema = z.object({
  type: z.enum(KycDocumentType),
  mimeType: z.string().min(3).max(100),
  sizeBytes: z.number().int().positive(),
});
export type KycUploadInput = z.infer<typeof KycUploadSchema>;

/** Paso 2: registrar el documento ya subido (la huella la calcula el cliente con Web Crypto). */
export const KycSubmitSchema = z.object({
  type: z.enum(KycDocumentType),
  key: z.string().min(10).max(512),
  sha256: Sha256Schema,
  expiresAt: z.iso.date().optional(),
}).superRefine((input, ctx) => {
  const identity = ['NATIONAL_ID', 'PASSPORT', 'DRIVER_LICENSE'].includes(input.type);
  if (identity && !input.expiresAt) {
    ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Indica la fecha de vencimiento del documento.' });
  }
  if (input.expiresAt && input.expiresAt < new Date().toISOString().slice(0, 10)) {
    ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'El documento ya está vencido.' });
  }
});
export type KycSubmitInput = z.infer<typeof KycSubmitSchema>;

export const KycQueueQuerySchema = z.object({
  status: z.enum(KycStatus).default('PENDING'),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type KycQueueQuery = z.infer<typeof KycQueueQuerySchema>;

export const KycReviewSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('APPROVE') }),
  z.object({ decision: z.literal('REJECT'), reason: z.string().trim().min(10, 'Explica el motivo (mínimo 10 caracteres).').max(500) }),
]);
export type KycReviewInput = z.infer<typeof KycReviewSchema>;

export const DocumentIdParamsSchema = z.object({ id: z.uuid() });
