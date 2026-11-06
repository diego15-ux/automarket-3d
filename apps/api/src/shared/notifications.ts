import type { NotificationDTO } from '@automarket/contracts';
import type { Notification } from '../generated/prisma/client.js';
import { prisma, isUniqueViolation, type Db } from './infra/prisma.js';
import { enqueueEmail, kickOutbox, type EmailMessage } from './mail/mailer.js';
import { realtime } from './realtime.js';

export interface NotifyInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  link?: string;
  /** Avisos programados: impide duplicados entre ejecuciones e instancias. */
  dedupeKey?: string;
  email?: EmailMessage;
}

export interface PendingNotice {
  userId: string;
  dto: NotificationDTO;
  hasEmail: boolean;
}

export const toNotificationDTO = (n: Notification): NotificationDTO => ({
  id: n.id,
  type: n.type,
  title: n.title,
  body: n.body,
  link: n.link,
  readAt: n.readAt?.toISOString() ?? null,
  createdAt: n.createdAt.toISOString(),
});

/**
 * Crea la notificación (y encola su correo) DENTRO de la transacción del cambio de negocio.
 * Devuelve null si `dedupeKey` ya existía. Tras el commit llama a `deliver()`.
 */
export async function notify(db: Db, input: NotifyInput): Promise<PendingNotice | null> {
  // Aviso programado que ya se mandó: no se intenta otra vez (así Prisma no imprime el choque de la clave).
  if (input.dedupeKey && (await db.notification.findUnique({ where: { dedupeKey: input.dedupeKey }, select: { id: true } }))) return null;
  let created: Notification;
  try {
    created = await db.notification.create({
      data: { userId: input.userId, type: input.type, title: input.title.slice(0, 160), body: input.body.slice(0, 500), link: input.link ?? null, dedupeKey: input.dedupeKey ?? null },
    });
  } catch (err) {
    if (input.dedupeKey && isUniqueViolation(err, 'dedupeKey')) return null;
    throw err;
  }
  if (input.email) await enqueueEmail(input.email, db);
  return { userId: input.userId, dto: toNotificationDTO(created), hasEmail: Boolean(input.email) };
}

/** Entrega en tiempo real (campana) y dispara el envío de correos encolados. */
export function deliver(notices: Array<PendingNotice | null>): void {
  let hasEmail = false;
  for (const notice of notices) {
    if (!notice) continue;
    realtime.toUser(notice.userId, 'notification:new', notice.dto);
    hasEmail ||= notice.hasEmail;
  }
  if (hasEmail) kickOutbox();
}

export const notificationsService = {
  async list(userId: string) {
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30 }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items: items.map(toNotificationDTO), unread };
  },

  async markAllRead(userId: string) {
    await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  },
};
