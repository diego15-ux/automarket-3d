import { env } from '../../config/env.js';
import type { EmailMessage } from './mailer.js';

/** Los datos de usuario (nombres, títulos) SIEMPRE se escapan antes de ir al HTML. */
const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);

export const formatMoney = (amount: string | number, currency = 'USD') =>
  new Intl.NumberFormat('es', { style: 'currency', currency, minimumFractionDigits: 2 }).format(Number(amount));

const formatDate = (date: Date) => new Intl.DateTimeFormat('es', { dateStyle: 'long', timeZone: 'UTC' }).format(date);

export const webLink = (path: string) => `${env.WEB_URL}${path.startsWith('/') ? path : `/${path}`}`;

interface LayoutInput {
  to: string;
  subject: string;
  /** Texto de vista previa en la bandeja de entrada. */
  preheader: string;
  greeting: string;
  /** Párrafos en texto plano (se escapan). */
  paragraphs: string[];
  cta?: { label: string; url: string };
  footnote?: string;
}

/** Plantilla común: HTML compatible con clientes de correo (tablas + estilos en línea) y versión texto. */
function render({ to, subject, preheader, greeting, paragraphs, cta, footnote }: LayoutInput): EmailMessage {
  const body = paragraphs.map(p => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#cbd5e1">${escapeHtml(p)}</p>`).join('');
  const button = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="border-radius:999px;background:#f97316">
         <a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#0b1120;text-decoration:none">${escapeHtml(cta.label)}</a>
       </td></tr></table>
       <p style="margin:0 0 16px;font-size:12px;color:#64748b;word-break:break-all">Si el botón no funciona, copia este enlace: ${escapeHtml(cta.url)}</p>`
    : '';
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;background:#0b1120;font-family:Inter,Segoe UI,Arial,sans-serif">
<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1120;padding:32px 16px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111827;border:1px solid #1f2937;border-radius:16px">
    <tr><td style="padding:28px 32px 0;font-size:20px;font-weight:700;color:#f8fafc">Auto<span style="color:#f97316">Market</span></td></tr>
    <tr><td style="padding:24px 32px 8px">
      <h1 style="margin:0 0 16px;font-size:20px;color:#f8fafc">${escapeHtml(greeting)}</h1>
      ${body}${button}
      ${footnote ? `<p style="margin:0;font-size:12px;line-height:1.5;color:#64748b">${escapeHtml(footnote)}</p>` : ''}
    </td></tr>
    <tr><td style="padding:16px 32px 28px;font-size:12px;color:#475569">Recibes este correo por tu cuenta en AutoMarket. © ${new Date().getUTCFullYear()} AutoMarket</td></tr>
  </table>
</td></tr></table></body></html>`;

  const text = [greeting, '', ...paragraphs, ...(cta ? ['', `${cta.label}: ${cta.url}`] : []), ...(footnote ? ['', footnote] : []), '', '— AutoMarket'].join('\n');
  return { to, subject, html, text };
}

export const emails = {
  passwordReset: (p: { to: string; name: string; link: string; minutes: number }) =>
    render({
      to: p.to,
      subject: 'Restablece tu contraseña de AutoMarket',
      preheader: `El enlace caduca en ${p.minutes} minutos.`,
      greeting: `Hola, ${p.name}`,
      paragraphs: ['Recibimos una solicitud para restablecer la contraseña de tu cuenta.', `El enlace es de un solo uso y caduca en ${p.minutes} minutos.`],
      cta: { label: 'Elegir nueva contraseña', url: p.link },
      footnote: 'Si no lo solicitaste, ignora este correo: tu contraseña actual sigue siendo válida.',
    }),

  membershipActivated: (p: { to: string; name: string; planName: string; expiresAt: Date }) =>
    render({
      to: p.to,
      subject: `Tu plan ${p.planName} está activo`,
      preheader: `Vigente hasta el ${formatDate(p.expiresAt)}.`,
      greeting: `¡Gracias, ${p.name}!`,
      paragraphs: [`Tu membresía ${p.planName} quedó activada y es válida hasta el ${formatDate(p.expiresAt)}.`, 'Ya puedes aprovechar todos sus beneficios en tus anuncios.'],
      cta: { label: 'Ver mi plan', url: webLink('/cuenta/plan') },
    }),

  membershipExpiring: (p: { to: string; name: string; planName: string; daysLeft: number; expiresAt: Date }) =>
    render({
      to: p.to,
      subject: `Tu plan ${p.planName} vence en ${p.daysLeft} ${p.daysLeft === 1 ? 'día' : 'días'}`,
      preheader: `Renueva antes del ${formatDate(p.expiresAt)} para no perder beneficios.`,
      greeting: `Hola, ${p.name}`,
      paragraphs: [
        `Tu membresía ${p.planName} vence el ${formatDate(p.expiresAt)}.`,
        'Al vencer pasarás al plan Gratis: solo una publicación activa y el resto de tus anuncios quedarán en pausa.',
      ],
      cta: { label: 'Renovar ahora', url: webLink('/cuenta/plan') },
    }),

  membershipExpired: (p: { to: string; name: string; planName: string }) =>
    render({
      to: p.to,
      subject: `Tu plan ${p.planName} ha vencido`,
      preheader: 'Renueva para reactivar tus anuncios en pausa.',
      greeting: `Hola, ${p.name}`,
      paragraphs: [`Tu membresía ${p.planName} venció y tu cuenta pasó al plan Gratis.`, 'Tus anuncios adicionales quedaron en pausa: al renovar puedes reactivarlos desde Mis anuncios.'],
      cta: { label: 'Renovar membresía', url: webLink('/cuenta/plan') },
    }),

  listingExpiring: (p: { to: string; name: string; vehicle: string; daysLeft: number; expiresAt: Date }) =>
    render({
      to: p.to,
      subject: `Tu anuncio ${p.vehicle} vence en ${p.daysLeft} ${p.daysLeft === 1 ? 'día' : 'días'}`,
      preheader: `Renuévalo antes del ${formatDate(p.expiresAt)} para que siga visible.`,
      greeting: `Hola, ${p.name}`,
      paragraphs: [
        `Tu anuncio ${p.vehicle} vence el ${formatDate(p.expiresAt)} y dejará de mostrarse en el catálogo.`,
        'Renuévalo desde Mis anuncios para mantenerlo publicado.',
      ],
      cta: { label: 'Revisar mis anuncios', url: webLink('/cuenta/anuncios') },
    }),

  reservationRequested: (p: { to: string; name: string; vehicle: string; deposit: string; currency: string; deadline: Date }) =>
    render({
      to: p.to,
      subject: `Nueva solicitud de reserva: ${p.vehicle}`,
      preheader: `Abono de ${formatMoney(p.deposit, p.currency)} pendiente de tu confirmación.`,
      greeting: `Hola, ${p.name}`,
      paragraphs: [
        `Un comprador verificado quiere reservar tu ${p.vehicle} con el abono de ${formatMoney(p.deposit, p.currency)} que fijaste. El abono te lo paga directamente a ti (AutoMarket no lo cobra).`,
        `Tienes hasta el ${formatDate(p.deadline)} para responder. Al confirmar, el vehículo queda reservado para ese comprador y se abre el chat directo con sus datos verificados.`,
      ],
      cta: { label: 'Revisar solicitud', url: webLink('/cuenta/reservas?tab=ventas') },
    }),

  reservationDecision: (p: { to: string; name: string; vehicle: string; accepted: boolean; deposit?: string | null; currency?: string; note?: string | null }) =>
    render({
      to: p.to,
      subject: p.accepted ? `¡Reserva confirmada! ${p.vehicle}` : `Reserva no aceptada: ${p.vehicle}`,
      preheader: p.accepted ? 'El vehículo queda reservado para ti.' : 'El vehículo sigue disponible para otros compradores.',
      greeting: `Hola, ${p.name}`,
      paragraphs: [
        p.accepted
          ? `El vendedor confirmó tu reserva del ${p.vehicle}. Ya tienes su contacto verificado en el chat para coordinar el pago del abono${p.deposit && p.currency ? ` (${formatMoney(p.deposit, p.currency)})` : ''} y la visita.`
          : `El vendedor no aceptó tu solicitud de reserva del ${p.vehicle}. No se realizó ningún cargo.`,
        ...(p.accepted ? ['Recuerda: el abono se paga directamente al vendedor y se descuenta del precio; si la venta no se concreta, el vendedor debe devolvértelo íntegro.'] : []),
        ...(p.note ? [`Mensaje del vendedor: «${p.note}»`] : []),
      ],
      cta: { label: 'Ver mis reservas', url: webLink('/cuenta/reservas') },
    }),

  reservationReleased: (p: { to: string; name: string; vehicle: string; deposit: string; currency: string; reason: string; isSeller: boolean }) =>
    render({
      to: p.to,
      subject: `Reserva finalizada sin venta: ${p.vehicle}`,
      preheader: 'El vehículo vuelve a estar disponible para reserva.',
      greeting: `Hola, ${p.name}`,
      paragraphs: [
        `${p.reason} El ${p.vehicle} vuelve a estar disponible para reserva.`,
        p.isSeller
          ? `Si recibiste el abono de ${formatMoney(p.deposit, p.currency)}, estás obligado a devolverlo íntegro (100 %) al comprador.`
          : `Si pagaste el abono de ${formatMoney(p.deposit, p.currency)}, el vendedor está obligado a devolvértelo íntegro (100 %). Si no lo hace, escríbenos.`,
      ],
      cta: { label: 'Ver mis reservas', url: webLink('/cuenta/reservas') },
    }),

  commissionDue: (p: { to: string; name: string; vehicle: string; amount: string; currency: string; dueAt: Date; overdue: boolean; legalWarning: string }) =>
    render({
      to: p.to,
      subject: p.overdue ? `Comisión vencida: ${p.vehicle}` : `Comisión post-venta: ${p.vehicle}`,
      preheader: `${formatMoney(p.amount, p.currency)} a pagar con Binance${p.overdue ? ' (vencida)' : ` antes del ${formatDate(p.dueAt)}`}.`,
      greeting: `Hola, ${p.name}`,
      paragraphs: [
        p.overdue
          ? `La comisión de ${formatMoney(p.amount, p.currency)} por la venta de tu ${p.vehicle} venció el ${formatDate(p.dueAt)}. Tu cuenta no puede publicar ni reservar hasta que la pagues.`
          : `¡Felicidades por la venta de tu ${p.vehicle}! La comisión post-venta es de ${formatMoney(p.amount, p.currency)} y se paga con Binance antes del ${formatDate(p.dueAt)}.`,
        p.legalWarning,
      ],
      cta: { label: 'Pagar comisión con Binance', url: webLink('/cuenta/reservas?tab=ventas') },
    }),
};
