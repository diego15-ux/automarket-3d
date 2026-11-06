import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env.js';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma, type Db } from '../infra/prisma.js';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const MAX_ATTEMPTS = 8;
const BATCH_SIZE = 20;

let transporter: Transporter | null = null;
let flushing: Promise<number> | null = null;

/** SMTP real con SMTP_URL; sin él (solo desarrollo) el correo se imprime en la consola. */
function transport(): Transporter {
  transporter ??= env.SMTP_URL ? nodemailer.createTransport(env.SMTP_URL) : nodemailer.createTransport({ jsonTransport: true });
  return transporter;
}

/**
 * Encola un correo en la bandeja de salida (tabla email_outbox). Se llama dentro de la
 * transacción del cambio de negocio: si la transacción falla, el correo no existe.
 */
export async function enqueueEmail(message: EmailMessage, db: Db = prisma): Promise<void> {
  await db.emailOutbox.create({
    data: { toEmail: message.to, subject: message.subject.slice(0, 200), html: message.html, text: message.text },
  });
}

/** Tras confirmar la transacción: intenta enviar ya, sin retrasar la respuesta HTTP. */
export function kickOutbox(): void {
  setImmediate(() => {
    flushOutbox().catch(err => console.error('[mail] error vaciando la bandeja de salida', err));
  });
}

/**
 * Envía los pendientes. Seguro con varias instancias: los reclama con FOR UPDATE y los
 * «alquila» 5 min (sin SKIP LOCKED, que la MariaDB 10.4 de XAMPP no soporta).
 */
export function flushOutbox(): Promise<number> {
  flushing ??= sendPending().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function sendPending(): Promise<number> {
  const now = new Date();
  // Mientras se envía, la fila queda «alquilada» 5 min: si el proceso muere, otro la reintenta.
  const lease = new Date(now.getTime() + 5 * 60_000);

  const claimed = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM email_outbox
      WHERE status = 'PENDING' AND sendAfter <= ${now}
      ORDER BY createdAt
      LIMIT ${Prisma.raw(String(BATCH_SIZE))}
      FOR UPDATE`;
    if (rows.length === 0) return [];
    const ids = rows.map(row => row.id);
    await tx.emailOutbox.updateMany({ where: { id: { in: ids } }, data: { sendAfter: lease, attempts: { increment: 1 } } });
    return tx.emailOutbox.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: 'asc' } });
  });

  let sent = 0;
  for (const email of claimed) {
    try {
      await transport().sendMail({ from: env.MAIL_FROM, to: email.toEmail, subject: email.subject, html: email.html, text: email.text });
      if (!env.SMTP_URL) {
        // En producción no se imprime el cuerpo: lleva enlaces de un solo uso (restablecer contraseña).
        if (env.NODE_ENV === 'production') console.warn(`[mail] sin SMTP_URL, no se envió: ${email.subject}`);
        else console.info(`[mail] (sin SMTP_URL) Para: ${email.toEmail} · ${email.subject}\n${email.text}\n`);
      }
      await prisma.emailOutbox.update({ where: { id: email.id }, data: { status: 'SENT', sentAt: new Date(), lastError: null } });
      sent += 1;
    } catch (err) {
      const reason = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      const gaveUp = email.attempts >= MAX_ATTEMPTS;
      await prisma.emailOutbox.update({
        where: { id: email.id },
        // Reintento con espera exponencial: 1, 2, 4, 8… minutos.
        data: { status: gaveUp ? 'FAILED' : 'PENDING', lastError: reason, sendAfter: new Date(Date.now() + 2 ** email.attempts * 30_000) },
      });
      console.error(`[mail] fallo enviando ${email.id} (intento ${email.attempts}/${MAX_ATTEMPTS}): ${reason}`);
    }
  }
  return sent;
}
