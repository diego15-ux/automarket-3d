// AutoMarket 3D · manda un correo de prueba con el SMTP_URL de apps/api/.env.
//   npm run mail:probar -w @automarket/api -- tu@correo.com   (o doble clic en probar-correo.cmd)
// No muestra SMTP_URL ni la clave: solo dice si el servidor aceptó el correo.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';

const API = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Lee solo las variables pedidas de apps/api/.env (las del sistema tienen prioridad). */
function readEnv(...keys) {
  const values = {};
  const file = process.env.AM_ENV_FILE ?? path.join(API, '.env');
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : [];
  for (const key of keys) {
    if (process.env[key]) {
      values[key] = process.env[key];
      continue;
    }
    const line = lines.find((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
    if (line) values[key] = line.replace(new RegExp(`^\\s*${key}\\s*=\\s*`), '').trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

const to = (process.argv[2] ?? '').trim();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
  console.log('Escribe un correo válido para recibir la prueba (por ejemplo tu@gmail.com).');
  process.exit(1);
}

const { SMTP_URL, MAIL_FROM } = readEnv('SMTP_URL', 'MAIL_FROM');
if (!SMTP_URL) {
  console.log(`Falta SMTP_URL en apps/api/.env, así que AutoMarket todavía no envía correos.

Agrega una línea así (con los datos de tu servicio de correo):
  SMTP_URL=smtp://USUARIO:CLAVE@smtp-relay.brevo.com:587          (Brevo)
  SMTP_URL=smtps://tucorreo%40gmail.com:CLAVE_DE_APLICACION@smtp.gmail.com:465   (Gmail)
  MAIL_FROM=AutoMarket <no-reply@tudominio.com>

Si la clave o el usuario tienen @, : o /, cámbialos por %40, %3A y %2F.
Luego cierra y abre AutoMarket, y vuelve a probar.`);
  process.exit(1);
}

const from = MAIL_FROM || 'AutoMarket <no-reply@automarket.dev>';
const transport = nodemailer.createTransport(SMTP_URL);
try {
  console.log('Conectando con el servidor de correo…');
  await transport.verify();
  const sentAt = new Date().toLocaleString('es-VE');
  const info = await transport.sendMail({
    from,
    to,
    subject: 'Prueba de correo de AutoMarket',
    text: `Si lees esto, AutoMarket ya puede enviar correos (recuperar contraseña, avisos y pagos).\n\nEnviado el ${sentAt}.`,
    html: `<p>Si lees esto, AutoMarket ya puede enviar correos (recuperar contraseña, avisos y pagos).</p><p style="color:#666">Enviado el ${sentAt}.</p>`,
  });
  console.log(`Listo: el servidor aceptó el correo para ${to}. Revisa la bandeja de entrada y la de spam.`);
  if (info.rejected?.length) console.log(`Ojo: rechazó a ${info.rejected.join(', ')}.`);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.log(`No se pudo enviar: ${reason.replace(SMTP_URL, '[SMTP_URL]')}`);
  console.log('Revisa el usuario, la clave y el puerto de SMTP_URL. Con Gmail hace falta una «contraseña de aplicación», no tu clave normal.');
  process.exit(1);
} finally {
  transport.close();
}
