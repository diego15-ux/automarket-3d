import type { Prisma } from '../../generated/prisma/client.js';
import { prisma, type Db } from './prisma.js';

export type AuditAction =
  | 'KYC_DOCUMENT_SUBMITTED'
  | 'KYC_DOCUMENTS_VIEWED'
  | 'KYC_APPROVED'
  | 'KYC_REJECTED'
  | 'KYC_DUPLICATE_DETECTED'
  | 'USER_VERIFIED'
  | 'USER_STATUS_CHANGED'
  | 'USER_ROLE_CHANGED'
  | 'PASSWORD_RESET'
  | 'MEMBERSHIP_ACTIVATED'
  | 'MEMBERSHIP_GRANTED_MANUALLY'
  | 'MEMBERSHIP_EXPIRED'
  | 'PLAN_UPDATED'
  | 'SETTINGS_UPDATED'
  | 'TERMS_UPDATED'
  | 'TERMS_ACCEPTED'
  | 'BOOST_SETTINGS_UPDATED'
  | 'BOOST_ACTIVATED'
  | 'LOGIN_BACKGROUND_UPDATED'
  | 'HOME_HERO_UPDATED'
  | 'BINANCE_PAYEE_UPDATED'
  | 'BINANCE_QR_UPDATED'
  | 'SOCIAL_LINKS_UPDATED'
  | 'BRAND_CREATED'
  | 'BRAND_UPDATED'
  | 'BRAND_MODELS_ADDED'
  | 'BRAND_MODEL_UPDATED'
  | 'BRANDS_IMPORTED'
  | 'RESERVATION_ACCEPTED'
  | 'RESERVATION_REJECTED'
  | 'RESERVATION_CANCELLED'
  | 'RESERVATION_NEGOTIATING'
  | 'RESERVATION_COMPLETED'
  | 'RESERVATION_EXPIRED'
  | 'COMMISSION_PAID'
  | 'VEHICLE_SALE_CHECKOUT'
  | 'VEHICLE_SALE_COMPLETED'
  | 'PAYMENT_REQUIRES_ATTENTION'
  | 'PAYMENT_REVIEWED'
  | 'REFUND_SENT'
  | 'VEHICLE_ARCHIVED_BY_ADMIN'
  | 'REPORT_RESOLVED'
  | 'REPORT_CHAT_VIEWED'
  | 'USER_WARNED'
  | 'BLOCKED_TERM_ADDED'
  | 'BLOCKED_TERM_REMOVED'
  | 'CAROUSEL_UPDATED'
  | 'REVIEW_MODERATED';

export interface AuditEntry {
  action: AuditAction;
  entityType: 'User' | 'KycDocument' | 'CartReserve' | 'Payment' | 'Plan' | 'PlatformSettings' | 'Vehicle' | 'Report' | 'BlockedTerm' | 'CarouselItem' | 'Review' | 'VehicleBrand' | 'Boost';
  entityId: string;
  /** null = acción del sistema (webhook, job). */
  actorId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
}

/** Registro de solo inserción (nunca se actualiza ni se borra desde la aplicación). */
export async function recordAudit(entries: AuditEntry | AuditEntry[], db: Db = prisma): Promise<void> {
  const list = Array.isArray(entries) ? entries : [entries];
  if (list.length === 0) return;

  await db.auditLog.createMany({
    data: list.map(entry => ({
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      actorId: entry.actorId ?? null,
      metadata: entry.metadata,
      ip: entry.ip ?? null,
    })),
  });
}
