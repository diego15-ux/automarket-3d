import { AppError } from './errors/app-error.js';
import { prisma, type Db } from './infra/prisma.js';

/** Comisiones post-venta generadas, sin pagar y con el plazo vencido. */
export function countOverdueCommissions(userId: string, db: Db = prisma, now = new Date()): Promise<number> {
  return db.cartReserve.count({
    where: { sellerId: userId, status: 'COMPLETED', commissionAmount: { gt: 0 }, commissionPaidAt: null, commissionDueAt: { lt: now } },
  });
}

const ACTIONS = { publish: 'publicar', reserve: 'reservar', accept: 'confirmar reservas' } as const;

/**
 * Verificación estricta: nadie publica ni reserva sin identidad verificada (cédula, selfie y
 * teléfono; RIF en concesionarios), ni con comisiones post-venta vencidas.
 */
export async function assertCanTransact(
  user: { id: string; isVerified: boolean },
  action: keyof typeof ACTIONS,
  db: Db = prisma,
): Promise<void> {
  if (!user.isVerified) {
    throw AppError.forbidden('IDENTITY_NOT_VERIFIED', `Verifica tu identidad (cédula, selfie y teléfono) para ${ACTIONS[action]}.`);
  }
  const expiredIdentity = await db.kycDocument.findFirst({
    where: {
      userId: user.id,
      status: 'APPROVED',
      type: { in: ['NATIONAL_ID', 'PASSPORT', 'DRIVER_LICENSE'] },
      expiresAt: { lte: new Date() },
    },
    select: { id: true },
  });
  if (expiredIdentity) {
    const validAlternative = await db.kycDocument.count({
      where: {
        userId: user.id,
        status: 'APPROVED',
        type: { in: ['NATIONAL_ID', 'PASSPORT', 'DRIVER_LICENSE'] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (validAlternative === 0) {
      await db.user.updateMany({ where: { id: user.id, isVerified: true }, data: { isVerified: false, verifiedAt: null } });
      throw AppError.forbidden('IDENTITY_DOCUMENT_EXPIRED', `Tu documento de identidad venció. Actualízalo para ${ACTIONS[action]}.`);
    }
  }
  if ((await countOverdueCommissions(user.id, db)) > 0) {
    throw AppError.forbidden('COMMISSION_OVERDUE', `Tienes comisiones post-venta vencidas. Págalas con Binance para volver a ${ACTIONS[action]}.`);
  }
}
