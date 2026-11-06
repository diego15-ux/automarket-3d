import { prisma, runInTransaction } from '../../shared/infra/prisma.js';
import { deliver, notify } from '../../shared/notifications.js';
import { IDENTITY_DOCUMENTS } from './kyc.policy.js';
import { kycRepository } from './kyc.repository.js';

const DAY_MS = 86_400_000;
let monthlyReviewReminderMonth: string | null = null;

async function sendMonthlyReviewReminders(now: Date): Promise<void> {
  const month = now.toISOString().slice(0, 7);
  if (monthlyReviewReminderMonth === month) return;

  let cursor: string | undefined;
  while (true) {
    const users = await prisma.user.findMany({
      where: {
        isVerified: true,
        deletedAt: null,
        kycDocuments: {
          some: {
            type: { in: [...IDENTITY_DOCUMENTS] },
            status: 'APPROVED',
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        },
      },
      select: { id: true, avatarUrl: true },
      orderBy: { id: 'asc' },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (users.length === 0) break;

    for (const user of users) {
      const reminders = [
        {
          type: 'PROFILE_PHOTO_RENEWAL_REMINDER',
          title: user.avatarUrl ? 'Renueva tu foto de perfil' : 'Añade una foto de perfil',
          body: user.avatarUrl
            ? 'Actualiza tu foto de perfil este mes para mantener tu perfil vigente.'
            : 'Añade una foto de perfil para que los clientes puedan reconocerte.',
          link: '/cuenta/perfil',
          dedupeKey: `monthly-profile-photo:${user.id}:${month}`,
        },
        {
          type: 'IDENTITY_REVIEW_REMINDER',
          title: 'Revisa tus documentos de identidad',
          body: 'Si necesitas renovarlos, envía documentos nuevos para revisión. La verificación no se renueva automáticamente.',
          link: '/cuenta/verificacion',
          dedupeKey: `monthly-identity-review:${user.id}:${month}`,
        },
      ];

      for (const reminder of reminders) {
        const notice = await runInTransaction(tx =>
          notify(tx, { userId: user.id, ...reminder }),
        );
        deliver([notice]);
      }
    }

    if (users.length < 500) break;
    cursor = users.at(-1)!.id;
  }

  monthlyReviewReminderMonth = month;
}

export async function runKycJobs(now = new Date()): Promise<void> {
  await sendMonthlyReviewReminders(now);

  const expiring = await prisma.kycDocument.findMany({
    where: {
      type: { in: [...IDENTITY_DOCUMENTS] },
      status: 'APPROVED',
      expiresAt: { gt: now, lte: new Date(now.getTime() + 30 * DAY_MS) },
      user: { isVerified: true, deletedAt: null },
    },
    select: { id: true, userId: true, expiresAt: true },
    take: 500,
  });

  for (const document of expiring) {
    if (!document.expiresAt) continue;
    const latestIdentity = await kycRepository.latestValidIdentity(document.userId, now);
    if (latestIdentity?.expiresAt?.getTime() !== document.expiresAt.getTime()) continue;
    const daysLeft = Math.max(1, Math.ceil((document.expiresAt.getTime() - now.getTime()) / DAY_MS));
    for (const threshold of [30, 7, 1]) {
      if (daysLeft > threshold) continue;
      const notice = await runInTransaction(tx =>
        notify(tx, {
          userId: document.userId,
          type: 'IDENTITY_DOCUMENT_EXPIRING',
          title: `Tu documento de identidad vence en ${daysLeft} ${daysLeft === 1 ? 'día' : 'días'}`,
          body: 'Sube un documento vigente para mantener habilitadas las publicaciones y reservas.',
          link: '/cuenta/verificacion',
          dedupeKey: `kyc-expiring:${document.id}:${threshold}`,
        }),
      );
      deliver([notice]);
    }
  }

  const expired = await prisma.kycDocument.findMany({
    where: {
      type: { in: [...IDENTITY_DOCUMENTS] },
      status: 'APPROVED',
      expiresAt: { lte: now },
      user: { isVerified: true, deletedAt: null },
    },
    select: { id: true, userId: true },
    take: 500,
  });

  for (const document of expired) {
    const notice = await runInTransaction(async tx => {
      const validAlternative = await tx.kycDocument.count({
        where: {
          userId: document.userId,
          type: { in: [...IDENTITY_DOCUMENTS] },
          status: 'APPROVED',
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      });
      if (validAlternative > 0) return null;
      const { count } = await tx.user.updateMany({
        where: { id: document.userId, isVerified: true },
        data: { isVerified: false, verifiedAt: null },
      });
      if (count === 0) return null;
      return notify(tx, {
        userId: document.userId,
        type: 'IDENTITY_DOCUMENT_EXPIRED',
        title: 'Tu documento de identidad venció',
        body: 'Tu cuenta ya no puede publicar ni reservar. Sube un documento vigente para recuperar el acceso.',
        link: '/cuenta/verificacion',
        dedupeKey: `kyc-expired:${document.id}`,
      });
    });
    deliver([notice]);
  }
}
