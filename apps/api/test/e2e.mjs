// Prueba end-to-end: base de datos REAL + migraciones Prisma + API real + Socket.io real.
//   · Por defecto arranca MySQL 8.4 oficial (mysql-memory-server).
//   · Con E2E_DATABASE_URL usa un servidor existente, p. ej. la MariaDB de XAMPP:
//       E2E_DATABASE_URL=mysql://root@127.0.0.1:3306 npm run test:e2e
//     (crea la base temporal automarket_e2e y la borra al terminar).
// Binance Pay, Turnstile, S3, SMTP y los JWKS de Google se sustituyen por dobles locales que
// respetan su contrato HTTP (test/fakes.mjs).
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { hash as argon2hash } from '@node-rs/argon2';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import mariadb from 'mariadb';
import { createDB } from 'mysql-memory-server';
import { io as ioClient } from 'socket.io-client';
import { createFakeBinancePay, createFakeS3, createFakeTurnstile, createSmtpSink } from './fakes.mjs';

const API_DIR = fileURLToPath(new URL('..', import.meta.url));
const TSX_CLI = createRequire(import.meta.url).resolve('tsx/cli');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const PORTS = { api: 4545, s3: 4546, jwks: 4547, binance: 4548, turnstile: 4549, smtp: 4550 };
const BASE = `http://127.0.0.1:${PORTS.api}`;
const BINANCE = { apiKey: 'test-binance-api-key', secretKey: 'test-binance-secret-key', payId: '123456789' };
const TURNSTILE_SECRET = 'test-turnstile-secret';
const GOOGLE_CLIENT = 'test-google-client.apps.googleusercontent.com';
const E2E_DB = 'automarket_e2e';

const results = [];
const check = (name, cond, extra = '') => results.push([cond ? 'PASS' : 'FAIL', name, cond ? '' : typeof extra === 'string' ? extra : JSON.stringify(extra)?.slice(0, 300)]);
const section = title => results.push(['', title, '']);

async function waitFor(fn, timeoutMs = 8_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await sleep(150);
  }
  return null;
}

// ───────────────────────────────────────────────────────── Servicios simulados ──
const binance = createFakeBinancePay(BINANCE);
const turnstile = createFakeTurnstile({ secret: TURNSTILE_SECRET });
const s3 = createFakeS3();
const smtp = createSmtpSink();
const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
const jwks = http.createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ keys: [jwk] })));
const googleToken = (sub, claims) =>
  new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer('https://accounts.google.com').setAudience(GOOGLE_CLIENT).setSubject(sub).setIssuedAt().setExpirationTime('5m').sign(privateKey);

await Promise.all([
  new Promise(r => binance.server.listen(PORTS.binance, '127.0.0.1', r)),
  new Promise(r => turnstile.server.listen(PORTS.turnstile, '127.0.0.1', r)),
  new Promise(r => s3.server.listen(PORTS.s3, '127.0.0.1', r)),
  new Promise(r => jwks.listen(PORTS.jwks, '127.0.0.1', r)),
  new Promise(r => smtp.server.listen(PORTS.smtp, '127.0.0.1', r)),
]);

// ─────────────────────────────────────────────────────── Base de datos + migraciones ──
const connectionOf = url => {
  const parsed = new URL(url);
  return { host: parsed.hostname, port: Number(parsed.port || 3306), user: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password), allowPublicKeyRetrieval: true };
};
let DATABASE_URL;
let stopDatabase;
if (process.env.E2E_DATABASE_URL) {
  const server = connectionOf(process.env.E2E_DATABASE_URL);
  const admin = await mariadb.createConnection(server);
  await admin.query(`DROP DATABASE IF EXISTS ${E2E_DB}`);
  await admin.query(`CREATE DATABASE ${E2E_DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.end();
  const url = new URL(process.env.E2E_DATABASE_URL);
  url.pathname = `/${E2E_DB}`;
  DATABASE_URL = url.toString();
  stopDatabase = async () => {
    const conn = await mariadb.createConnection(server);
    await conn.query(`DROP DATABASE IF EXISTS ${E2E_DB}`);
    await conn.end();
  };
} else {
  const mysql = await createDB({ version: '8.4.x', dbName: E2E_DB, username: 'root', logLevel: 'ERROR', downloadBinaryOnce: true });
  DATABASE_URL = `mysql://root@127.0.0.1:${mysql.port}/${E2E_DB}`;
  stopDatabase = () => mysql.stop();
}

const pool = mariadb.createPool({ ...connectionOf(DATABASE_URL), database: E2E_DB, connectionLimit: 3, initSql: "SET time_zone = '+00:00'" });
const q = async (sql, params = []) => pool.query(sql, params);
const one = async (sql, params = []) => (await q(sql, params))[0];
const version = (await one('SELECT VERSION() AS v')).v;

section(`Base de datos ${version} · migraciones Prisma · seed`);

const prismaCli = command => spawnSync(command, { cwd: API_DIR, shell: true, encoding: 'utf8', env: { ...process.env, DATABASE_URL } });
const migrate = prismaCli('npx prisma migrate deploy');
check('prisma migrate deploy aplica todas las migraciones', migrate.status === 0, migrate.stderr || migrate.stdout);
const seed = prismaCli('npx prisma db seed');
check('seed de catálogo (planes, ajustes, lista negra)', seed.status === 0, seed.stderr || seed.stdout);
const seededDemoCounts = await one('SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM vehicles) AS vehicles, (SELECT COUNT(*) FROM reviews) AS reviews');
check(
  'seed no crea cuentas, anuncios ni reseñas ficticios',
  Number(seededDemoCounts.users) === 0 && Number(seededDemoCounts.vehicles) === 0 && Number(seededDemoCounts.reviews) === 0,
  seededDemoCounts,
);

check('Motor compatible (MySQL ≥ 8.0.16 o MariaDB ≥ 10.2)', /MariaDB/i.test(version) ? Number(version.split('.')[0]) >= 10 : /^8\./.test(version), version);
check('Restricciones CHECK creadas (≥ 18)', Number((await one('SELECT COUNT(*) AS n FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()')).n) >= 18);
const planRows = await q('SELECT code, accountType, maxActiveListings, listingDurationDays, commissionRate, featuredSlots, monthlyFeaturedCredits, searchBoost FROM plans ORDER BY priceMonthly');
check(
  'Planes por tipo de cuenta: Gratis (todas, 1) · Premium personal (5 + destacado mensual) · Concesionario Básico (20) y Pro (ilimitado)',
  planRows.map(p => `${p.code}:${p.accountType ?? '*'}:${p.maxActiveListings ?? '∞'}`).join(' ') === 'FREE:*:1 PREMIUM:INDIVIDUAL:5 DEALER_BASIC:DEALER:20 DEALER_PRO:DEALER:∞'
    && Number(planRows.find(p => p.code === 'PREMIUM')?.listingDurationDays) === 90
    && Number(planRows.find(p => p.code === 'PREMIUM')?.commissionRate) === 0.025
    && Number(planRows.find(p => p.code === 'PREMIUM')?.featuredSlots) === 1
    && Number(planRows.find(p => p.code === 'PREMIUM')?.monthlyFeaturedCredits) === 1
    && Number(planRows.find(p => p.code === 'PREMIUM')?.searchBoost) === 2,
  planRows,
);

const ADMIN_PASSWORD = 'AdminSegura2026';
const ADMIN_ID = randomUUID();
await q('INSERT INTO users (id,email,name,role,status,country,city,isVerified,verifiedAt,avatarUrl,passwordHash,planCode,tokenVersion,updatedAt) VALUES (?,?,?,?,?,?,?, ?,UTC_TIMESTAMP(3) - INTERVAL 31 DAY,?,?,?,0,UTC_TIMESTAMP(3))', [
  ADMIN_ID, 'admin@automarket.test', 'Admin', 'ADMIN', 'ACTIVE', 'ES', 'Madrid', 1, 'https://cdn.test/avatars/admin.jpg', await argon2hash(ADMIN_PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 }), 'FREE',
]);
await q("INSERT INTO kyc_documents (id,userId,type,status,s3Bucket,s3Key,mimeType,sizeBytes,sha256,reviewedAt,updatedAt) VALUES (?,?,?,'APPROVED',?,?,?,?,?,UTC_TIMESTAMP(3) - INTERVAL 31 DAY,UTC_TIMESTAMP(3))", [
  randomUUID(), ADMIN_ID, 'NATIONAL_ID', 'kyc-test', `kyc/${ADMIN_ID}/monthly-reminder.jpg`, 'image/jpeg', 64, createHash('sha256').update('monthly-reminder').digest('hex'),
]);
const adminVerifiedAt = (await one('SELECT verifiedAt FROM users WHERE id = ?', [ADMIN_ID])).verifiedAt;
check('CHECK: vehículo NUEVO con dueños anteriores es rechazado por la base de datos', await q("INSERT INTO vehicles (id,sellerId,slug,make,model,year,`condition`,ownersCount,mileageKm,price,category,fuelType,transmission,city,country,updatedAt) VALUES (UUID(),?,'x','X','Y',2024,'NEW',2,0,1,'SEDAN','GASOLINE','MANUAL','A','MX',UTC_TIMESTAMP(3))", [ADMIN_ID]).then(() => false, err => /vehicles_condition_owners/.test(err.message)));
check('CHECK: abono de reserva mayor que el precio es rechazado', await q("INSERT INTO vehicles (id,sellerId,slug,make,model,year,`condition`,ownersCount,mileageKm,price,reservationAmount,category,fuelType,transmission,city,country,updatedAt) VALUES (UUID(),?,'y','X','Y',2020,'USED',1,10,100,500,'SEDAN','GASOLINE','MANUAL','A','MX',UTC_TIMESTAMP(3))", [ADMIN_ID]).then(() => false, err => /vehicles_reservation_amount_bounded/.test(err.message)));
check('CHECK: concesionario sin datos fiscales es rechazado', await q("INSERT INTO users (id,email,name,accountType,updatedAt) VALUES (UUID(),'sin-rif@test.com','Sin RIF','DEALER',UTC_TIMESTAMP(3))").then(() => false, err => /users_dealer_fiscal_data/.test(err.message)));

// ───────────────────────────────────────────────────────────────── API real ──
const api = spawn(process.execPath, [TSX_CLI, 'src/main.ts'], {
  cwd: API_DIR,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(PORTS.api),
    TRUST_PROXY: '1',
    WEB_URL: 'http://localhost:3000',
    DATABASE_URL,
    DATABASE_POOL_SIZE: '5',
    JWT_ACCESS_SECRET: 'x'.repeat(48),
    CORS_ORIGINS: 'http://localhost:3000',
    S3_BUCKET_MEDIA: 'media-test',
    S3_BUCKET_KYC: 'kyc-test',
    S3_ENDPOINT: `http://127.0.0.1:${PORTS.s3}`,
    MEDIA_PUBLIC_BASE_URL: 'http://cdn.test/media',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    GOOGLE_CLIENT_IDS: GOOGLE_CLIENT,
    GOOGLE_JWKS_URL: `http://127.0.0.1:${PORTS.jwks}/google`,
    APPLE_JWKS_URL: `http://127.0.0.1:${PORTS.jwks}/apple`,
    TURNSTILE_SECRET_KEY: TURNSTILE_SECRET,
    TURNSTILE_VERIFY_URL: `http://127.0.0.1:${PORTS.turnstile}/siteverify`,
    SMTP_URL: `smtp://127.0.0.1:${PORTS.smtp}`,
    MAIL_FROM: 'AutoMarket <no-reply@automarket.test>',
    PAYMENT_CURRENCY: 'USDT',
    BINANCE_PAY_ID: BINANCE.payId,
    BINANCE_PAY_NAME: 'AutoMarket Pagos',
    BINANCE_PAY_API_KEY: BINANCE.apiKey,
    BINANCE_PAY_SECRET_KEY: BINANCE.secretKey,
    BINANCE_PAY_API_BASE: `http://127.0.0.1:${PORTS.binance}`,
    MANUAL_PAYMENT_WINDOW_HOURS: '24',
    JOBS_INTERVAL_MS: '1000',
  },
});
let apiLog = '';
api.stdout.on('data', d => (apiLog += d));
api.stderr.on('data', d => (apiLog += d));
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('La API no arrancó:\n' + apiLog)), 40_000);
  const poll = setInterval(() => {
    if (apiLog.includes('Socket.io en')) {
      clearTimeout(timeout);
      clearInterval(poll);
      resolve();
    }
  }, 100);
});

section('Recordatorios mensuales de foto e identidad');
const reminderMonth = new Date().toISOString().slice(0, 7);
const photoReminderKey = `monthly-profile-photo:${ADMIN_ID}:${reminderMonth}`;
const identityReminderKey = `monthly-identity-review:${ADMIN_ID}:${reminderMonth}`;
check('Envía recordatorio mensual para renovar la foto de perfil', Boolean(await waitFor(async () =>
  Number((await one('SELECT COUNT(*) AS n FROM notifications WHERE userId = ? AND dedupeKey = ?', [ADMIN_ID, photoReminderKey])).n) === 1,
)));
check('Envía recordatorio mensual de revisión de identidad', Boolean(await waitFor(async () =>
  Number((await one('SELECT COUNT(*) AS n FROM notifications WHERE userId = ? AND dedupeKey = ?', [ADMIN_ID, identityReminderKey])).n) === 1,
)));
await sleep(1_500);
const monthlyReminderCounts = await one(
  "SELECT COUNT(CASE WHEN dedupeKey = ? THEN 1 END) AS photo, COUNT(CASE WHEN dedupeKey = ? THEN 1 END) AS identity FROM notifications WHERE userId = ?",
  [photoReminderKey, identityReminderKey, ADMIN_ID],
);
const adminVerificationAfterReminders = await one('SELECT isVerified,verifiedAt FROM users WHERE id = ?', [ADMIN_ID]);
check('No duplica recordatorios ni extiende la verificación automáticamente',
  Number(monthlyReminderCounts.photo) === 1
    && Number(monthlyReminderCounts.identity) === 1
    && adminVerificationAfterReminders.isVerified === 1
    && new Date(adminVerificationAfterReminders.verifiedAt).getTime() === new Date(adminVerifiedAt).getTime(),
  { monthlyReminderCounts, adminVerificationAfterReminders },
);

/** Cliente HTTP con cookies propias y una IP simulada (X-Forwarded-For) por "dispositivo". */
function client(ip) {
  const jar = new Map();
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const [name, ...rest] = pair.split('=');
      const value = rest.join('=');
      if (!value || /Expires=Thu, 01 Jan 1970/i.test(cookie)) jar.delete(name);
      else jar.set(name, value);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    let json = null;
    try {
      json = JSON.parse(buffer.toString('utf8'));
    } catch {}
    return { status: res.status, body: json, buffer, headers: res.headers };
  };
  return {
    jar,
    get: (path, headers) => call('GET', path, undefined, headers),
    post: (path, body, headers) => call('POST', path, body ?? {}, headers),
    patch: (path, body) => call('PATCH', path, body),
    put: (path, body) => call('PUT', path, body),
    del: path => call('DELETE', path),
  };
}

const human = action => ({ captchaToken: `ok:${action}` });
const mailTo = (email, pattern) => waitFor(() => smtp.mails.find(m => m.to.includes(email) && pattern.test(m.text)));
const sendWebhook = ({ body, headers }) => fetch(`${BASE}/api/payments/binance/webhook`, { method: 'POST', headers, body });
const orderOf = reference => [...binance.state.orders.values()].find(order => order.merchantTradeNo === reference);
/** El usuario paga la orden en Binance y Binance Pay notifica a la API (PAY_SUCCESS firmado). */
const payMerchant = async reference => sendWebhook(binance.signedWebhook('PAY', 'PAY_SUCCESS', binance.pay(reference)));
const paymentRow = id => one('SELECT status, refundDue, refundedAmount, txId, payerBinanceId FROM payments WHERE id = ?', [id]);
const reservationRow = id => one('SELECT status, commissionAmount, commissionPaidAt, salePrice, legalAcceptedAt, expiresAt FROM cart_reserves WHERE id = ?', [id]);
const vehicleRow = id => one('SELECT status, lockedReservationId FROM vehicles WHERE id = ?', [id]);
/** Verificación por atajo de BD para usuarios secundarios (el flujo KYC completo se prueba con Ana). */
const verifyUser = (email, phone) => q('UPDATE users SET isVerified = 1, verifiedAt = UTC_TIMESTAMP(3), phone = ? WHERE email = ?', [phone, email]);

/** Bytes con la firma real del formato (las fotos falsas se rechazan). */
const SIGNATURES = {
  'image/jpeg': [0xff, 0xd8, 0xff, 0xe0],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/webp': [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')],
};
const fileBytes = (mimeType, bytes, fill = 7) => {
  const buffer = Buffer.alloc(bytes, fill);
  if (SIGNATURES[mimeType]) Buffer.from(SIGNATURES[mimeType]).copy(buffer);
  return buffer;
};

try {
  // ─────────────────────────────────────────────── Registro, anti-bot, login ──
  section('Registro (persona natural o concesionario con RIF) · anti-bot (Turnstile + honeypot) · login');
  const ana = client('10.0.0.11');
  const beto = client('10.0.0.12');
  const carla = client('10.0.0.13');
  const dario = client('10.0.0.15');
  const admin = client('10.0.0.99');
  const register = (c, data) => c.post('/api/auth/register', { password: 'Segura2026', acceptTerms: true, ...data });

  let res = await register(ana, { name: 'Ana Ruiz', email: 'ana@test.com', country: 'MX', ...human('register') });
  check('Registro sin ciudad → 422', res.status === 422, res.body);
  res = await register(ana, { name: 'Ana Ruiz', email: 'ana@test.com', country: 'MX', city: 'Guadalajara', website: 'http://spam.example', ...human('register') });
  check('Honeypot relleno → 400 HUMAN_CHECK_FAILED', res.status === 400 && res.body?.error?.code === 'HUMAN_CHECK_FAILED', res.body);
  res = await register(ana, { name: 'Ana Ruiz', email: 'ana@test.com', country: 'MX', city: 'Guadalajara' });
  check('Sin token Turnstile → 400 HUMAN_CHECK_REQUIRED', res.status === 400 && res.body?.error?.code === 'HUMAN_CHECK_REQUIRED', res.body);
  res = await register(ana, { name: 'Ana Ruiz', email: 'ana@test.com', country: 'MX', city: 'Guadalajara', captchaToken: 'ok:login' });
  check('Token Turnstile de otra acción → 400', res.status === 400, res.body);
  res = await register(client('10.0.0.88'), { name: '1d10t4', email: 'ana@test.com', country: 'MX', city: 'Guadalajara', ...human('register') });
  check('Registro: grosería leetspeak rechazada → 400 BLOCKED_TERMS', res.status === 400 && res.body?.error?.code === 'BLOCKED_TERMS', res.body);
  res = await register(ana, { name: 'Ana Ruiz', email: 'ana@test.com', country: 'MX', city: '  guadalajara ', ...human('register') });
  check('Registro OK → 201 persona natural con plan FREE', res.status === 201 && res.body?.data?.user?.plan?.code === 'FREE' && res.body?.data?.user?.accountType === 'INDIVIDUAL', res.body);
  const anaId = res.body.data.user.id;
  check('Ciudad normalizada y país guardado', res.body?.data?.user?.city === 'Guadalajara' && res.body?.data?.user?.country === 'MX', res.body?.data?.user);
  check('Turnstile verificado servidor-servidor con la IP real (X-Forwarded-For)', turnstile.calls.some(c => c.ip === '10.0.0.11'), turnstile.calls);
  res = await register(beto, { name: 'Beto Gómez', email: 'beto@test.com', country: 'MX', city: 'Guadalajara', ...human('register') });
  check('Segundo usuario registrado', res.status === 201, res.body);
  res = await register(carla, { name: 'Carla Díaz', email: 'carla@test.com', country: 'CO', city: 'Bogotá', ...human('register') });
  check('Tercer usuario (Colombia) registrado', res.status === 201, res.body);
  res = await register(client('10.0.0.14'), { name: 'Otra', email: 'ana@test.com', country: 'MX', city: 'Puebla', ...human('register') });
  check('Email duplicado → 409 EMAIL_TAKEN', res.status === 409, res.body);

  const dealerData = { name: 'Darío Pérez', email: 'dario@test.com', country: 'VE', city: 'Caracas', accountType: 'DEALER' };
  res = await register(dario, { ...dealerData, ...human('register') });
  check('Concesionario sin datos fiscales → 422', res.status === 422, res.body);
  const fiscal = { businessName: 'Autos Darío C.A.', fiscalAddress: 'Av. Principal de Las Mercedes, Caracas', businessPhone: '+58 212 555 0001' };
  res = await register(dario, { ...dealerData, ...fiscal, taxId: 'X-123', ...human('register') });
  check('RIF con formato inválido en Venezuela → 422', res.status === 422, res.body);
  res = await register(dario, { ...dealerData, ...fiscal, taxId: 'j 40123456 7', ...human('register') });
  check('Concesionario registrado con su RIF normalizado (J-40123456-7)', res.status === 201 && res.body?.data?.user?.accountType === 'DEALER' && res.body?.data?.user?.dealer?.taxId === 'J-40123456-7', res.body);
  res = await register(client('10.0.0.16'), { ...dealerData, email: 'otro@test.com', ...fiscal, taxId: 'J-40123456-7', ...human('register') });
  check('RIF ya registrado por otra cuenta → 409 TAX_ID_TAKEN', res.status === 409 && res.body?.error?.code === 'TAX_ID_TAKEN', res.body);

  res = await admin.post('/api/auth/login', { email: 'admin@automarket.test', password: ADMIN_PASSWORD, ...human('login') });
  check('Login de administrador', res.status === 200 && res.body?.data?.user?.role === 'ADMIN', res.body);
  res = await admin.post('/api/auth/login', { email: 'admin@automarket.test', password: ADMIN_PASSWORD });
  check('Login sin Turnstile → 400', res.status === 400, res.body);

  const brute = client('10.0.0.50');
  let last;
  for (let i = 0; i < 11; i++) last = await brute.post('/api/auth/login', { email: 'beto@test.com', password: `mala${i}xx1`, ...human('login') });
  check('Fuerza bruta: el intento 11 → 429 con Retry-After', last.status === 429 && Number(last.headers.get('retry-after')) > 0, last.status);

  // ────────────────────────────────────────────────── Recuperación por correo ──
  section('Recuperación de contraseña por correo transaccional');
  const visitor = client('10.0.0.60');
  res = await visitor.post('/api/auth/password/forgot', { email: 'nadie@test.com', ...human('forgot_password') });
  check('Correo inexistente → 202 (no revela si existe)', res.status === 202, res.body);
  res = await visitor.post('/api/auth/password/forgot', { email: 'beto@test.com', ...human('forgot_password') });
  check('Solicitud de recuperación → 202', res.status === 202, res.body);
  const resetMail = await mailTo('beto@test.com', /restablecer\?token=/);
  check('Correo de recuperación entregado por SMTP', Boolean(resetMail));
  const token = resetMail?.text.match(/restablecer\?token=([A-Za-z0-9_-]{20,})/)?.[1];
  check('El correo incluye el enlace con token', Boolean(token));
  check('Ningún correo para el email inexistente', !smtp.mails.some(m => m.to.includes('nadie@test.com')));
  res = await visitor.post('/api/auth/password/reset', { token, password: 'NuevaClave2026' });
  check('Restablecer con token válido → 204', res.status === 204, res.body);
  res = await visitor.post('/api/auth/password/reset', { token, password: 'OtraClave2026' });
  check('Reutilizar el token → 400 RESET_TOKEN_INVALID', res.status === 400 && res.body?.error?.code === 'RESET_TOKEN_INVALID', res.body);
  res = await client('10.0.0.61').post('/api/auth/login', { email: 'beto@test.com', password: 'NuevaClave2026', ...human('login') });
  check('Login con la nueva contraseña', res.status === 200, res.body);
  res = await beto.post('/api/auth/refresh');
  check('Las sesiones previas se revocaron al restablecer', res.status === 401, res.status);
  res = await client('10.0.0.62').post('/api/auth/refresh');
  check('Visitante sin sesión: renovar → 204, sin error en la consola', res.status === 204, res.status);
  res = await beto.post('/api/auth/login', { email: 'beto@test.com', password: 'NuevaClave2026', ...human('login') });
  check('Beto vuelve a iniciar sesión', res.status === 200, res.body);

  section('Google sin país/ciudad → completar perfil');
  const oauth = client('10.0.0.70');
  res = await oauth.post('/api/auth/oauth/google', { idToken: await googleToken('g-123', { email: 'diego@gmail.com', email_verified: true, name: 'Diego' }) });
  check('Alta con Google → needsProfile', res.status === 201 && res.body?.data?.user?.needsProfile === true, res.body);
  res = await oauth.post('/api/vehicles', {});
  check('Sin país/ciudad no puede publicar → 403 PROFILE_INCOMPLETE', res.status === 403 && res.body?.error?.code === 'PROFILE_INCOMPLETE', res.body);
  res = await oauth.patch('/api/auth/me', { country: 'AR', city: 'rosario' });
  check('Completar perfil → needsProfile false', res.status === 200 && res.body?.data?.needsProfile === false && res.body?.data?.city === 'Rosario', res.body);

  // ──────────────────────────────────────────── Publicación y verificación ──
  section('Publicación gratuita limitada · verificación estricta (cédula + selfie + teléfono) · foto real');
  const corolla = { make: 'Toyota', model: 'Corolla', version: 'SE', year: 2020, condition: 'USED', ownersCount: 1, mileageKm: 45000, price: 20000, category: 'SEDAN', fuelType: 'GASOLINE', transmission: 'AUTOMATIC', country: 'MX', city: 'Guadalajara', latitude: 20.6597, longitude: -103.3496, description: 'Impecable, único dueño.' };
  const mazda = { ...corolla, make: 'Mazda', model: '3', version: 'Signature', year: 2025, condition: 'NEW', ownersCount: 0, mileageKm: 10, price: 30000, reservationAmount: 1500, city: 'Monterrey' };
  res = await ana.post('/api/vehicles', { ...corolla, condition: 'NEW', ownersCount: 1 });
  check('NUEVO con dueños anteriores → 422', res.status === 422, res.body);
  res = await ana.post('/api/vehicles', { ...corolla, reservationAmount: 25000 });
  check('Abono de reserva mayor que el precio → 422', res.status === 422, res.body);
  res = await ana.post('/api/vehicles', { ...corolla, description: 'Vendo porque el anterior dueño era un idiota' });
  check('Descripción con término bloqueado → 400 BLOCKED_TERMS', res.status === 400 && res.body?.error?.code === 'BLOCKED_TERMS', res.body);
  res = await ana.post('/api/vehicles', corolla);
  check('Borrador creado (plan Free, gratis; aún sin verificar)', res.status === 201 && res.body?.data?.status === 'DRAFT', res.body);
  const v1 = res.body?.data;
  const savedLocation = await one('SELECT latitude, longitude FROM vehicles WHERE id = ?', [v1.id]);
  check('Coordenadas GPS del anuncio guardadas en columnas privadas', Number(savedLocation.latitude) === 20.6597 && Number(savedLocation.longitude) === -103.3496, savedLocation);
  res = await ana.post(`/api/vehicles/${v1.id}/publish`);
  check('Publicar sin identidad verificada → 403 IDENTITY_NOT_VERIFIED', res.status === 403 && res.body?.error?.code === 'IDENTITY_NOT_VERIFIED', res.body);

  res = await ana.get('/api/kyc/status');
  check('KYC: faltan cédula, selfie y teléfono', ['IDENTITY_DOCUMENT', 'SELFIE', 'PHONE'].every(item => res.body?.data?.missing?.includes(item)), res.body);
  res = await dario.get('/api/kyc/status');
  check('KYC de concesionario: además pide el documento del RIF', res.body?.data?.missing?.includes('BUSINESS_DOCUMENT'), res.body);
  const kycUpload = async (c, type, mimeType, fill) => {
    const bytes = fileBytes(mimeType, 4096, fill);
    const presign = await c.post('/api/kyc/uploads', { type, mimeType, sizeBytes: bytes.length });
    await fetch(presign.body.data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: bytes });
    return c.post('/api/kyc/documents', {
      type,
      key: presign.body.data.key,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      ...(type === 'NATIONAL_ID' || type === 'PASSPORT' || type === 'DRIVER_LICENSE' ? { expiresAt: '2035-12-31' } : {}),
    });
  };
  const cedula = await kycUpload(ana, 'NATIONAL_ID', 'image/jpeg', 11);
  check('Cédula subida a la carpeta privada cedulas/', cedula.status === 201 && [...s3.objects.keys()].some(key => key.includes('/cedulas/')), cedula.body);
  const selfie = await kycUpload(ana, 'SELFIE', 'image/jpeg', 12);
  for (const document of [cedula.body?.data, selfie.body?.data]) await admin.patch(`/api/admin/kyc/${document.id}`, { decision: 'APPROVE' });
  res = await ana.get('/api/auth/me');
  check('Documentos aprobados pero sin teléfono → aún sin verificar', res.body?.data?.isVerified === false, res.body?.data);
  res = await ana.patch('/api/auth/me', { name: '1d10t4' });
  check('Perfil: grosería leetspeak rechazada → 400 BLOCKED_TERMS', res.status === 400 && res.body?.error?.code === 'BLOCKED_TERMS', res.body);
  res = await ana.patch('/api/auth/me', { phone: '+52 33 1234 5678' });
  check('Al añadir el teléfono queda verificada', res.status === 200 && res.body?.data?.isVerified === true && res.body?.data?.phone === '+52 33 1234 5678', res.body);
  res = await ana.patch('/api/auth/me', { phone: '+52 33 0000 0000' });
  check('El teléfono verificado ya no se cambia sin soporte → 409 VERIFIED_FIELD_LOCKED', res.status === 409 && res.body?.error?.code === 'VERIFIED_FIELD_LOCKED', res.body);
  res = await ana.patch('/api/auth/me', { bio: 'Vendedor de vehículos con atención personalizada.' });
  check('Biografía pública guardada en el perfil', res.status === 200 && res.body?.data?.bio === 'Vendedor de vehículos con atención personalizada.', res.body);
  const avatarBytes = fileBytes('image/jpeg', 2048, 13);
  res = await ana.post('/api/auth/me/avatar/uploads', { mimeType: 'image/jpeg', sizeBytes: avatarBytes.length });
  await fetch(res.body.data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: avatarBytes });
  res = await ana.put('/api/auth/me/avatar', { key: res.body.data.key });
  check('Foto de perfil verificada por firma de imagen y guardada en S3', res.status === 200 && res.body?.data?.avatarUrl?.includes(`/avatars/${anaId}/`), res.body);

  res = await ana.post(`/api/vehicles/${v1.id}/publish`);
  check('Publicar sin foto → 400 COVER_REQUIRED', res.status === 400 && res.body?.error?.code === 'COVER_REQUIRED', res.body);

  const upload = async (c, vehicleId, mimeType, bytes = 2048) => {
    const presign = await c.post(`/api/vehicles/${vehicleId}/media/uploads`, { mimeType, sizeBytes: bytes });
    if (presign.status !== 201) return presign;
    const put = await fetch(presign.body.data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: fileBytes(mimeType, bytes) });
    if (!put.ok) return { status: put.status };
    return c.post(`/api/vehicles/${vehicleId}/media`, { key: presign.body.data.key, ...(mimeType.startsWith('video') ? { durationMs: 15_000 } : { width: 1600, height: 900 }) });
  };
  res = await upload(ana, v1.id, 'video/mp4');
  check('Vídeo subido directo a S3 y registrado (kind VIDEO)', res.status === 201 && res.body?.data?.kind === 'VIDEO', res.body);
  const videoId = res.body?.data?.id;
  const videoKey = new URL(res.body?.data?.url ?? 'http://x/').pathname.replace('/media/', '');
  const fake = await ana.post(`/api/vehicles/${v1.id}/media/uploads`, { mimeType: 'image/jpeg', sizeBytes: 2048 });
  await fetch(fake.body.data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: Buffer.alloc(2048, 7) });
  res = await ana.post(`/api/vehicles/${v1.id}/media`, { key: fake.body.data.key, width: 10, height: 10 });
  check('Foto falsa (la firma no es JPG) → 400 MEDIA_NOT_A_PHOTO y se borra de S3', res.status === 400 && res.body?.error?.code === 'MEDIA_NOT_A_PHOTO' && ![...s3.objects.keys()].some(key => key.endsWith(fake.body.data.key)), res.body);
  res = await upload(ana, v1.id, 'image/jpeg');
  check('Foto real registrada en la carpeta vehiculos/ del CDN', res.status === 201 && res.body?.data?.url?.startsWith('http://cdn.test/media/vehiculos/'), res.body);
  res = await ana.post(`/api/vehicles/${v1.id}/media/uploads`, { mimeType: 'application/pdf', sizeBytes: 100 });
  check('Tipo no permitido → 400', res.status === 400, res.body);
  res = await ana.post(`/api/vehicles/${v1.id}/media`, { key: `vehiculos/${randomUUID()}/robada.jpg` });
  check('Clave S3 de otro anuncio → 403', res.status === 403, res.body);
  for (let i = 0; i < 8; i++) await upload(ana, v1.id, 'image/webp', 512);
  res = await ana.post(`/api/vehicles/${v1.id}/media/uploads`, { mimeType: 'image/jpeg', sizeBytes: 100 });
  check('Archivo nº 11 → 409 MEDIA_LIMIT', res.status === 409 && res.body?.error?.code === 'MEDIA_LIMIT', res.body);
  res = await ana.del(`/api/vehicles/${v1.id}/media/${videoId}`);
  check('Borrar un archivo de la galería', res.status === 204, res.body);
  check('El objeto se elimina de S3', videoKey.startsWith('vehiculos/') && ![...s3.objects.keys()].some(k => k.endsWith(videoKey)), videoKey);
  await upload(ana, v1.id, 'video/webm');
  res = await ana.post(`/api/vehicles/${v1.id}/publish`);
  check('Publicar sin abono de reserva → 400 RESERVATION_AMOUNT_REQUIRED', res.status === 400 && res.body?.error?.code === 'RESERVATION_AMOUNT_REQUIRED', res.body);
  res = await ana.patch(`/api/vehicles/${v1.id}`, { reservationAmount: 1000 });
  check('El vendedor fija el abono de reserva (1000)', res.status === 200, res.body);
  res = await ana.post(`/api/vehicles/${v1.id}/publish`);
  check('Publicado con plan FREE (vence en 30 días)', res.status === 200 && res.body?.data?.status === 'PUBLISHED' && Math.round((new Date(res.body.data.expiresAt) - Date.now()) / 86_400_000) === 30, res.body);
  res = await ana.post('/api/vehicles', mazda);
  check('Plan FREE lleno: crear otro anuncio → 403 PLAN_LIMIT_REACHED (pide mejorar el plan)', res.status === 403 && res.body?.error?.code === 'PLAN_LIMIT_REACHED' && /Binance/.test(res.body?.error?.message), res.body);
  res = await ana.get('/api/vehicles/mine');
  check('Mis anuncios: cupo usado 1/1', res.body?.data?.usage?.slotsUsed === 1 && res.body?.data?.usage?.max === 1, res.body?.data?.usage);
  res = await ana.post(`/api/vehicles/${v1.id}/feature`);
  check('Destacar con plan FREE → 403 PLAN_REQUIRED', res.status === 403 && res.body?.error?.code === 'PLAN_REQUIRED', res.body);
  res = await ana.patch(`/api/vehicles/${v1.id}`, { price: 19500, description: 'Precio rebajado.' });
  check('Editar el propio anuncio (CRUD)', res.status === 200, res.body);
  res = await ana.patch(`/api/vehicles/${v1.id}`, { price: 800 });
  check('Precio por debajo del abono → 400 RESERVATION_AMOUNT_TOO_HIGH', res.status === 400 && res.body?.error?.code === 'RESERVATION_AMOUNT_TOO_HIGH', res.body);
  res = await beto.patch(`/api/vehicles/${v1.id}`, { price: 1 });
  check('Editar un anuncio ajeno → 403', res.status === 403, res.body);
  await ana.patch(`/api/vehicles/${v1.id}`, { price: 20000 });

  res = await carla.get(`/api/vehicles/${v1.slug}`);
  const detail = res.body?.data;
  check('Ficha: galería completa con vídeo', res.status === 200 && detail.media.length === 10 && detail.media.some(m => m.kind === 'VIDEO'), detail?.media?.length);
  check('Ficha: condición, dueños y abono de reserva', detail?.condition === 'USED' && detail?.ownersCount === 1 && detail?.reservationAmount === '1000.00', detail);
  check('Tarjeta: portada = primera FOTO (nunca un vídeo)', detail?.coverUrl && !detail.coverUrl.endsWith('.mp4') && !detail.coverUrl.endsWith('.webm'), detail?.coverUrl);

  // ──────────────────────────────────────────────── Membresía con Binance ──
  section('Planes por tipo de cuenta con Binance · modo manual (Pay ID + verificación del equipo)');
  res = await ana.get('/api/payments/methods');
  check('Métodos disponibles: Binance Pay (comercio) y Pay ID manual', res.body?.data?.merchant === true && res.body?.data?.manual?.payId === BINANCE.payId && res.body?.data?.currency === 'USDT', res.body);
  res = await ana.post('/api/memberships/checkout', { planCode: 'DEALER_BASIC', cycle: 'MONTHLY', method: 'MANUAL' });
  check('Persona natural no puede contratar un plan de concesionario → 403 PLAN_NOT_FOR_ACCOUNT', res.status === 403 && res.body?.error?.code === 'PLAN_NOT_FOR_ACCOUNT', res.body);
  res = await ana.post('/api/memberships/checkout', { planCode: 'PREMIUM', cycle: 'MONTHLY', method: 'MANUAL' });
  const manualPremium = res.body?.data;
  check('Checkout manual: instrucciones con Pay ID, importe en USDT y referencia', res.status === 201 && manualPremium?.status === 'PENDING' && manualPremium?.manual?.payId === BINANCE.payId && manualPremium?.amount === '9.99' && manualPremium?.currency === 'USDT' && /^AM[A-Z2-9]{8}$/.test(manualPremium?.reference), res.body);
  res = await ana.post(`/api/payments/${manualPremium.id}/submit`, { txId: 'id con espacios!' });
  check('ID de transacción con formato inválido → 422', res.status === 422, res.body);
  res = await ana.post(`/api/payments/${manualPremium.id}/submit`, { txId: '410000000000000001' });
  check('Comprobante enviado → SUBMITTED (en verificación)', res.status === 200 && res.body?.data?.status === 'SUBMITTED', res.body);
  check('El equipo recibe el aviso de pago por verificar', Boolean(await waitFor(async () => Number((await one("SELECT COUNT(*) AS n FROM notifications WHERE userId = ? AND type = 'PAYMENT_SUBMITTED'", [ADMIN_ID])).n) >= 1)));
  res = await ana.get('/api/admin/payments?view=review');
  check('Un usuario no puede revisar pagos → 403', res.status === 403, res.status);
  res = await admin.get('/api/admin/payments?view=review');
  check('Cola de verificación del panel', res.body?.data?.some(p => p.id === manualPremium.id && p.txId === '410000000000000001'), res.body);
  res = await admin.post(`/api/admin/payments/${manualPremium.id}/review`, { decision: 'APPROVE', note: 'Visto en Binance' });
  check('Admin aprueba → plan PREMIUM activo', res.status === 204 && (await one('SELECT planCode FROM users WHERE email = ?', ['ana@test.com'])).planCode === 'PREMIUM', res.body);
  check('Pago marcado PAID e historial con origen BINANCE', (await paymentRow(manualPremium.id)).status === 'PAID' && Number((await one("SELECT COUNT(*) AS n FROM membership_periods WHERE source = 'BINANCE'")).n) === 1);
  check('Libro contable: ingreso de membresía 9.99', Number((await one("SELECT SUM(amount) AS s FROM ledger_entries WHERE type = 'MEMBERSHIP_REVENUE'")).s) === 9.99);
  check('Correo «plan activo» enviado', Boolean(await mailTo('ana@test.com', /Premium est/)));
  const premiumMonth = new Date().toISOString().slice(0, 7);
  check('Premium: destacado mensual automático en carrusel', Boolean(await waitFor(async () => {
    const user = await one('SELECT featureCreditMonth FROM users WHERE email = ?', ['ana@test.com']);
    const featuredCount = Number((await one("SELECT COUNT(*) AS n FROM vehicles WHERE sellerId = (SELECT id FROM users WHERE email = ?) AND featuredUntil > UTC_TIMESTAMP(3)", ['ana@test.com'])).n);
    return user.featureCreditMonth === premiumMonth && featuredCount > 0;
  })));
  res = await admin.post(`/api/admin/payments/${manualPremium.id}/review`, { decision: 'APPROVE' });
  check('Aprobar dos veces → 409 (sin doble activación)', res.status === 409, res.status);

  res = await ana.post('/api/memberships/checkout', { planCode: 'PREMIUM', cycle: 'YEARLY', method: 'MANUAL' });
  const reused = res.body?.data;
  res = await ana.post(`/api/payments/${reused.id}/submit`, { txId: '410000000000000001' });
  check('Reutilizar una transacción ya usada → 409 TX_ALREADY_USED', res.status === 409 && res.body?.error?.code === 'TX_ALREADY_USED', res.body);
  res = await ana.post(`/api/payments/${reused.id}/cancel`);
  check('Cancelar un pago pendiente → CANCELLED', res.body?.data?.status === 'CANCELLED', res.body);

  res = await carla.post('/api/memberships/checkout', { planCode: 'PREMIUM', cycle: 'MONTHLY', method: 'MANUAL' });
  const rejectedPay = res.body?.data;
  await carla.post(`/api/payments/${rejectedPay.id}/submit`, { txId: '410000000000000002' });
  res = await admin.post(`/api/admin/payments/${rejectedPay.id}/review`, { decision: 'REJECT', note: 'El importe recibido no coincide.' });
  check('Admin rechaza un comprobante → REJECTED y el plan no cambia', res.status === 204 && (await paymentRow(rejectedPay.id)).status === 'REJECTED' && (await one('SELECT planCode FROM users WHERE email = ?', ['carla@test.com'])).planCode === 'FREE');
  check('El usuario recibe el motivo del rechazo', Number((await one("SELECT COUNT(*) AS n FROM notifications n JOIN users u ON u.id = n.userId WHERE u.email = 'carla@test.com' AND n.type = 'PAYMENT_REJECTED'")).n) === 1);

  res = await ana.post('/api/vehicles', mazda);
  check('Con PREMIUM ya puede crear su 2º anuncio', res.status === 201, res.body);
  const v2 = res.body?.data;
  res = await carla.get(`/api/vehicles/${v2.slug}`);
  check('Un borrador no es visible para terceros → 404', res.status === 404, res.status);
  await upload(ana, v2.id, 'image/png');
  res = await ana.post(`/api/vehicles/${v2.id}/publish`);
  check('Publicado con PREMIUM (vence en 90 días)', res.status === 200 && Math.round((new Date(res.body.data.expiresAt) - Date.now()) / 86_400_000) === 90, res.body);

  section('Concesionario: insignia con RIF · plan con Binance Pay (API de comercio) · webhooks firmados');
  await verifyUser('dario@test.com', '+58 414 555 0001');
  const kia = { make: 'Kia', model: 'Sportage', version: 'EX', year: 2022, condition: 'USED', ownersCount: 1, mileageKm: 30000, price: 30000, reservationAmount: 1200, category: 'SUV', fuelType: 'GASOLINE', transmission: 'AUTOMATIC', country: 'VE', city: 'Caracas', description: 'Garantía de concesionario.' };
  res = await dario.post('/api/vehicles', kia);
  const kia1 = res.body?.data;
  await upload(dario, kia1.id, 'image/jpeg');
  res = await dario.post(`/api/vehicles/${kia1.id}/publish`);
  check('El concesionario publica gratis su primer anuncio', res.status === 200, res.body);
  res = await carla.get(`/api/vehicles/${kia1.slug}`);
  check('Ficha: insignia de concesionario; el RIF solo es visible con plan de concesionario', res.body?.data?.seller?.accountType === 'DEALER' && res.body?.data?.seller?.dealer?.businessName === 'Autos Darío C.A.' && res.body?.data?.seller?.dealer?.taxId === null, res.body?.data?.seller);
  res = await dario.post('/api/memberships/checkout', { planCode: 'PREMIUM', cycle: 'MONTHLY', method: 'MERCHANT' });
  check('Un concesionario no contrata el plan Premium de personas → 403', res.status === 403 && res.body?.error?.code === 'PLAN_NOT_FOR_ACCOUNT', res.body);
  res = await dario.post('/api/memberships/checkout', { planCode: 'DEALER_BASIC', cycle: 'MONTHLY', method: 'MERCHANT' });
  const merchantDealer = res.body?.data;
  check('Orden de Binance Pay creada: QR y enlace de pago', res.status === 201 && merchantDealer?.merchant?.checkoutUrl?.includes('pay.binance.com') && merchantDealer?.merchant?.qrcodeLink, res.body);
  check('Orden en Binance con importe 24.99 USDT y nuestra referencia', orderOf(merchantDealer.reference)?.amount === 24.99 && orderOf(merchantDealer.reference)?.currency === 'USDT', orderOf(merchantDealer.reference));
  binance.pay(merchantDealer.reference);
  let hook = await sendWebhook(binance.signedWebhook('PAY', 'PAY_SUCCESS', orderOf(merchantDealer.reference), {}, { tamper: true }));
  check('Notificación con firma inválida → 401', hook.status === 401, hook.status);
  hook = await sendWebhook(binance.signedWebhook('PAY', 'PAY_SUCCESS', orderOf(merchantDealer.reference)));
  const hookBody = await hook.json();
  check('Notificación PAY_SUCCESS → plan Concesionario Básico activo y returnCode SUCCESS', hook.status === 200 && hookBody.returnCode === 'SUCCESS' && (await one('SELECT planCode FROM users WHERE email = ?', ['dario@test.com'])).planCode === 'DEALER_BASIC', hookBody);
  hook = await sendWebhook(binance.signedWebhook('PAY', 'PAY_SUCCESS', orderOf(merchantDealer.reference)));
  check('Notificación duplicada → se ignora (exactamente una vez)', hook.status === 200 && Number((await one('SELECT COUNT(*) AS n FROM membership_periods WHERE paymentId = ?', [merchantDealer.id])).n) === 1);
  check('La transacción de Binance queda registrada en el pago', (await paymentRow(merchantDealer.id)).txId === orderOf(merchantDealer.reference).transactionId);
  res = await dario.get(`/api/payments/${merchantDealer.id}`);
  check('Página de pago: estado PAID', res.body?.data?.status === 'PAID', res.body);
  res = await carla.get(`/api/vehicles/${kia1.slug}`);
  check('Con plan de concesionario: RIF, dirección fiscal y teléfono corporativo visibles', res.body?.data?.seller?.dealer?.taxId === 'J-40123456-7' && Boolean(res.body?.data?.seller?.dealer?.businessPhone), res.body?.data?.seller?.dealer);
  res = await dario.post('/api/vehicles', { ...kia, model: 'Sorento', price: 35000 });
  const kia2 = res.body?.data;
  await upload(dario, kia2.id, 'image/jpeg');
  res = await dario.post(`/api/vehicles/${kia2.id}/publish`);
  check('Concesionario Básico: segundo anuncio publicado', res.status === 200, res.body);
  res = await client('10.0.0.80').get('/api/vehicles?country=VE');
  check('Tarjeta del catálogo con la insignia del concesionario', res.body?.data?.items?.length === 2 && res.body.data.items.every(item => item.sellerDealerName === 'Autos Darío C.A.'), res.body?.data?.items);

  res = await carla.post('/api/memberships/checkout', { planCode: 'PREMIUM', cycle: 'MONTHLY', method: 'MERCHANT' });
  const lostHook = res.body?.data;
  binance.pay(lostHook.reference);
  await q('UPDATE payments SET updatedAt = UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE WHERE id = ?', [lostHook.id]);
  res = await carla.get(`/api/payments/${lostHook.id}`);
  check('Webhook perdido: al volver, la API consulta la orden en Binance y activa el plan', res.body?.data?.status === 'PAID' && (await one('SELECT planCode FROM users WHERE email = ?', ['carla@test.com'])).planCode === 'PREMIUM', res.body);

  check('Concesionario Básico: destacado automático del mes asignado por el job', Boolean(await waitFor(async () => Number((await one("SELECT COUNT(*) AS n FROM vehicles WHERE sellerId = (SELECT id FROM users WHERE email='dario@test.com') AND featuredUntil > UTC_TIMESTAMP(3)")).n) === 1)));
  res = await dario.post(`/api/vehicles/${kia1.id}/feature`);
  check('Segundo destacado → 409 (1 a la vez / crédito mensual)', res.status === 409, res.body);
  res = await dario.get('/api/memberships/me');
  check('Estado de membresía con historial', res.status === 200 && res.body?.data?.plan?.code === 'DEALER_BASIC' && res.body?.data?.history?.length >= 1, res.body);

  res = await beto.post('/api/memberships/checkout', { planCode: 'PREMIUM', cycle: 'YEARLY', method: 'MANUAL' });
  const staleCheckout = res.body?.data;
  await q('UPDATE payments SET expiresAt = UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE WHERE id = ?', [staleCheckout.id]);
  check('Job: cobro de membresía no pagado a tiempo → EXPIRED', Boolean(await waitFor(async () => (await paymentRow(staleCheckout.id)).status === 'EXPIRED')));
  res = await beto.post(`/api/payments/${staleCheckout.id}/submit`, { txId: '410000000000000099' });
  check('Enviar comprobante de un pago vencido → 409', res.status === 409, res.body);

  // ───────────────────────────────────────────────── Búsqueda y sugerencias ──
  section('Búsqueda avanzada con prioridad por ubicación · similares · recomendaciones');
  res = await ana.post('/api/vehicles', { ...corolla, make: 'Toyota', model: 'RAV4', year: 2021, category: 'SUV', price: 26000, reservationAmount: 1000, city: 'Bogotá', country: 'CO', ownersCount: 2 });
  const v3 = res.body?.data;
  await upload(ana, v3.id, 'image/jpeg');
  res = await ana.post(`/api/vehicles/${v3.id}/publish`);
  check('Tercer anuncio publicado (Bogotá)', res.status === 200, res.body);
  res = await carla.get('/api/vehicles?sort=relevance');
  check('Usuaria de Bogotá: primero lo de su ciudad', res.body?.data?.items?.[0]?.city === 'Bogotá', res.body?.data?.items?.map(i => i.city));
  res = await beto.get('/api/vehicles?sort=relevance');
  check('Usuario de Guadalajara: primero lo de su ciudad', res.body?.data?.items?.[0]?.city === 'Guadalajara', res.body?.data?.items?.map(i => i.city));
  const madrid = client('10.0.0.18');
  res = await register(madrid, { name: 'Lucía Madrid', email: 'lucia.madrid@test.com', country: 'ES', city: 'Madrid', ...human('register') });
  check('Cuenta de prueba con ubicación Madrid', res.status === 201 && res.body?.data?.user?.city === 'Madrid', res.body);
  await q("UPDATE vehicles SET country = 'ES', city = 'Madrid', latitude = 40.4168, longitude = -3.7038 WHERE id = ?", [v1.id]);
  await q("UPDATE vehicles SET country = 'ES', city = 'Barcelona', latitude = 41.3874, longitude = 2.1686 WHERE id = ?", [v2.id]);
  await q('UPDATE vehicles SET latitude = NULL, longitude = NULL WHERE id = ?', [v3.id]);
  res = await madrid.get('/api/vehicles?nearby=true', { 'X-Location-Latitude': '40.417', 'X-Location-Longitude': '-3.704' });
  check('Cerca de mí limita a 100 km: Madrid excluye Barcelona y anuncios sin GPS', res.status === 200 && res.body?.data?.total === 1 && res.body?.data?.items?.[0]?.id === v1.id && !Object.hasOwn(res.body?.data?.items?.[0] ?? {}, 'latitude'), res.body?.data);
  res = await madrid.get('/api/vehicles?nearby=true', { 'X-Location-Latitude': '41.387', 'X-Location-Longitude': '2.168' });
  check('Al mover ubicación a Barcelona, el resultado cercano cambia a Barcelona', res.status === 200 && res.body?.data?.total === 1 && res.body?.data?.items?.[0]?.id === v2.id, res.body?.data?.items?.map(item => item.city));
  res = await client('10.0.0.80').get('/api/vehicles?nearby=true');
  check('Cerca de mí sin coordenadas devuelve 400 LOCATION_REQUIRED', res.status === 400 && res.body?.error?.code === 'LOCATION_REQUIRED', res.body);
  await q("UPDATE vehicles SET country = 'MX', city = 'Guadalajara' WHERE id IN (?, ?)", [v1.id, v2.id]);
  res = await client('10.0.0.80').get('/api/vehicles?make=Toyota&priceMin=19000&priceMax=21000&condition=USED&owners=1&yearMin=2019&yearMax=2021&country=MX');
  check('Filtros marca + precio + condición + dueños + año + país', res.body?.data?.total === 1 && res.body?.data?.items?.[0]?.model === 'Corolla', res.body?.data);
  res = await client('10.0.0.80').get('/api/vehicles?q=mazda%203&condition=NEW');
  check('Texto libre + condición NUEVO', res.body?.data?.total === 1 && res.body?.data?.items?.[0]?.make === 'Mazda', res.body?.data);
  res = await client('10.0.0.80').get('/api/vehicles?q=1d10t4');
  check('Buscador: variante leetspeak rechazada → 400 BLOCKED_TERMS', res.status === 400 && res.body?.error?.code === 'BLOCKED_TERMS', res.body);
  res = await client('10.0.0.80').get('/api/vehicles/facets?make=1d10t4');
  check('Facetas del buscador: variante leetspeak rechazada → 400 BLOCKED_TERMS', res.status === 400 && res.body?.error?.code === 'BLOCKED_TERMS', res.body);
  res = await client('10.0.0.80').get('/api/vehicles?q=100%25');
  check('Comodines de LIKE escapados', res.status === 200 && res.body?.data?.total === 0, res.body);
  res = await client('10.0.0.80').get('/api/vehicles?q=&owners=&page=');
  check('Parámetros vacíos se ignoran', res.status === 200 && res.body?.data?.total === 5, res.body?.data?.total);
  res = await client('10.0.0.80').get('/api/vehicles/facets?make=Toyota&country=MX');
  check('Facetas reales: marcas, modelos y ciudades', res.body?.data?.makes?.some(m => m.value === 'Toyota' && m.count === 2) && res.body?.data?.models?.length === 2 && res.body?.data?.cities?.length >= 1, res.body?.data);
  res = await client('10.0.0.80').get(`/api/vehicles/${v1.slug}/similar`);
  check('Similares: excluye el propio; misma categoría y país primero', res.status === 200 && !res.body.data.some(i => i.id === v1.id) && res.body.data.length === 2 && res.body.data[0]?.id === v2.id, res.body?.data?.map(i => i.model));
  res = await fetch(`${BASE}/api/vehicles/recommended`, { headers: { 'cf-ipcountry': 'CO', 'X-Forwarded-For': '10.0.0.81' } }).then(r => r.json());
  check('Recomendaciones anónimas por país (CF-IPCountry)', res.data?.[0]?.country === 'CO', res.data?.map(i => i.country));

  section('Guardar autos («Guardar» en la ficha) y bajadas de precio en los guardados');
  const v2Price = Number((await one('SELECT price FROM vehicles WHERE id = ?', [v2.id])).price);
  res = await client('10.0.0.89').put(`/api/vehicles/${v2.id}/save`);
  check('Guardar sin sesión → 401', res.status === 401, res.body);
  res = await ana.put(`/api/vehicles/${v2.id}/save`);
  check('El vendedor no guarda su propio auto → 400 OWN_VEHICLE', res.status === 400 && res.body?.error?.code === 'OWN_VEHICLE', res.body);
  res = await carla.put(`/api/vehicles/${v2.id}/save`);
  check('Guardar un auto publicado → 204', res.status === 204, res.body);
  res = await carla.put(`/api/vehicles/${v2.id}/save`);
  check('Guardarlo otra vez no lo duplica', res.status === 204 && Number((await one('SELECT COUNT(*) AS n FROM vehicle_favorites WHERE vehicleId = ?', [v2.id])).n) === 1, res.body);
  res = await carla.get('/api/vehicles/saved/ids');
  check('Mis guardados (ids) incluye el auto', res.body?.data?.includes(v2.id), res.body);
  res = await carla.get('/api/vehicles/saved');
  let savedItem = res.body?.data?.find(item => item.vehicle.id === v2.id);
  check('Tus guardados: tarjeta del auto con el precio al guardarlo y sin bajada', savedItem?.savedPrice === v2Price && savedItem?.priceDrop === 0 && savedItem?.vehicle?.slug === v2.slug, res.body?.data);
  res = await carla.get('/api/alerts');
  check('Mis alertas: «Bajadas de precio en tus guardados» encendida con 1 guardado y 0 nuevos', res.body?.data?.priceDrops?.saved === 1 && res.body.data.priceDrops.active === true && res.body.data.priceDrops.newCount === 0, res.body?.data?.priceDrops);
  const dropsOf = async () => Number((await one("SELECT COUNT(*) AS n FROM notifications n JOIN users u ON u.id = n.userId WHERE u.email = 'carla@test.com' AND n.type = 'PRICE_DROP'")).n);
  res = await ana.patch(`/api/vehicles/${v2.id}`, { price: v2Price - 500 });
  check('El vendedor baja el precio → 200', res.status === 200, res.body);
  const dropNotice = await waitFor(() => one("SELECT n.title, n.body, n.link FROM notifications n JOIN users u ON u.id = n.userId WHERE u.email = 'carla@test.com' AND n.type = 'PRICE_DROP' LIMIT 1"));
  const usd = value => '$' + Math.round(value).toLocaleString('de-DE');
  check('Aviso «Bajó de precio» a quien lo guardó, con el precio anterior y el nuevo', dropNotice?.link === `/vehiculos/${v2.slug}` && /^Bajó de precio: /.test(dropNotice.title) && dropNotice.body.includes(`de ${usd(v2Price)} a ${usd(v2Price - 500)}`), dropNotice);
  check('El vendedor no recibe el aviso de su propio auto', Number((await one("SELECT COUNT(*) AS n FROM notifications n JOIN users u ON u.id = n.userId WHERE u.email = 'ana@test.com' AND n.type = 'PRICE_DROP'")).n) === 0);
  res = await carla.get('/api/vehicles/saved');
  check('Tus guardados: «Bajó $500 desde que lo guardaste»', res.body?.data?.find(item => item.vehicle.id === v2.id)?.priceDrop === 500, res.body?.data);
  res = await carla.get('/api/alerts');
  check('Mis alertas: 1 bajada nueva y el aviso en «Avisos recientes»', res.body?.data?.priceDrops?.newCount === 1 && res.body.data.recent.some(n => n.type === 'PRICE_DROP' && n.link === `/vehiculos/${v2.slug}`), res.body?.data);
  res = await ana.patch(`/api/vehicles/${v2.id}`, { price: v2Price });
  check('Subir el precio no avisa', res.status === 200 && (await dropsOf()) === 1, res.body);
  res = await ana.patch(`/api/vehicles/${v2.id}`, { price: v2Price - 500 });
  check('Volver a bajar al mismo monto no repite el aviso', res.status === 200 && (await dropsOf()) === 1, res.body);
  res = await carla.put('/api/alerts/price-drops', { active: false });
  check('Apagar «Bajadas de precio en tus guardados»', res.status === 200 && res.body?.data?.active === false && res.body.data.newCount === 0, res.body);
  res = await ana.patch(`/api/vehicles/${v2.id}`, { price: v2Price - 900 });
  check('Con la alerta apagada no llega el aviso', res.status === 200 && (await dropsOf()) === 1, res.body);
  res = await carla.put('/api/alerts/price-drops', { active: true });
  check('Encenderla otra vez', res.status === 200 && res.body?.data?.active === true, res.body);
  res = await ana.patch(`/api/vehicles/${v2.id}`, { price: v2Price });
  check('El anuncio vuelve a su precio', res.status === 200 && Number((await one('SELECT price FROM vehicles WHERE id = ?', [v2.id])).price) === v2Price, res.body);
  res = await carla.del(`/api/vehicles/${v2.id}/save`);
  check('Quitar de guardados → 204', res.status === 204, res.body);
  res = await carla.get('/api/vehicles/saved/ids');
  check('Ya no está en sus guardados', Array.isArray(res.body?.data) && !res.body.data.includes(v2.id), res.body);
  res = await carla.put('/api/vehicles/00000000-0000-7000-8000-000000000000/save');
  check('Guardar un auto que no existe → 404', res.status === 404, res.body);

  // ────────────────────────────────────────── Reserva P2P con aviso legal ──
  section('Reserva P2P: aviso legal → confirmación del vendedor → bloqueo y chat directo');
  res = await beto.post('/api/reservations', { vehicleId: v1.id, acceptLegal: true });
  check('Sin identidad verificada no puede reservar → 403 IDENTITY_NOT_VERIFIED', res.status === 403 && res.body?.error?.code === 'IDENTITY_NOT_VERIFIED', res.body);
  await verifyUser('beto@test.com', '+52 33 5555 1111');
  await verifyUser('carla@test.com', '+57 1 555 2222');
  res = await beto.post('/api/reservations', { vehicleId: v1.id });
  check('Sin aceptar el aviso legal → 422', res.status === 422, res.body);
  res = await ana.post('/api/reservations', { vehicleId: v1.id, acceptLegal: true });
  check('No puede reservar su propio vehículo → 400', res.status === 400, res.body);
  const paymentsBefore = Number((await one('SELECT COUNT(*) AS n FROM payments')).n);
  res = await beto.post('/api/reservations', { vehicleId: v1.id, acceptLegal: true });
  const betoRes = res.body?.data;
  check('Solicitud → AWAITING_SELLER con el abono fijado por el vendedor (1000.00), sin cobro de la plataforma', res.status === 201 && betoRes?.status === 'AWAITING_SELLER' && betoRes?.depositAmount === '1000.00' && Number((await one('SELECT COUNT(*) AS n FROM payments')).n) === paymentsBefore, res.body);
  check('Se registra la aceptación del aviso legal', (await reservationRow(betoRes.id)).legalAcceptedAt !== null);
  res = await beto.post('/api/reservations', { vehicleId: v1.id, acceptLegal: true });
  check('Segunda solicitud del mismo comprador → 409 ALREADY_RESERVED', res.status === 409 && res.body?.error?.code === 'ALREADY_RESERVED', res.body);
  check('El vendedor recibe correo de la solicitud', Boolean(await mailTo('ana@test.com', /Nueva solicitud de reserva/)));
  res = await ana.get('/api/notifications');
  check('Notificación en la campana del vendedor', res.body?.data?.items?.some(n => n.type === 'RESERVATION_REQUESTED'), res.body);
  res = await carla.post('/api/reservations', { vehicleId: v1.id, acceptLegal: true });
  const carlaRes = res.body?.data;
  check('Otra compradora también solicita la reserva', res.status === 201, res.body);
  res = await ana.get('/api/reservations?as=seller');
  check('El vendedor ve 2 solicitudes, aún sin datos de contacto', res.body?.data?.filter(r => r.status === 'AWAITING_SELLER').length === 2 && res.body.data.every(r => r.contact === null), res.body?.data);

  // Chat antes de confirmar: datos de contacto ocultos, lenguaje enmascarado y sin notas de voz.
  res = await beto.get('/api/conversations');
  const conversationId = res.body?.data?.[0]?.id;
  check('La solicitud abrió el hilo de chat comprador ↔ vendedor (aún no directo)', Boolean(conversationId) && res.body?.data?.[0]?.direct === false && res.body?.data?.[0]?.contact === null, res.body);
  const login = await client('10.0.0.12').post('/api/auth/login', { email: 'beto@test.com', password: 'NuevaClave2026', ...human('login') });
  const socket = ioClient(BASE, { transports: ['websocket'], auth: { token: login.body?.data?.accessToken } });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  await socket.emitWithAck('conversation:join', { conversationId });
  let ack = await socket.emitWithAck('message:send', { conversationId, clientId: randomUUID(), type: 'TEXT', text: 'Eres un 1d10t4, escribe a beto@mail.com 😀' });
  check('Chat: término bloqueado enmascarado (lista negra global)', ack.ok && ack.data.body.includes('•••') && ack.data.moderationFlags.includes('PROFANITY'), ack);
  check('Chat: email oculto antes de confirmar la reserva (los emojis se conservan)', ack.ok && ack.data.body.includes('[email oculto]') && ack.data.body.includes('😀'), ack);
  res = await beto.post('/api/media/chat-uploads', { conversationId, type: 'AUDIO', mimeType: 'audio/webm', sizeBytes: 4000 });
  check('Notas de voz bloqueadas hasta confirmar la reserva → 403 VOICE_NOTES_LOCKED', res.status === 403 && res.body?.error?.code === 'VOICE_NOTES_LOCKED', res.body);

  res = await ana.post(`/api/reservations/${betoRes.id}/accept`, { note: 'Te espero el sábado' });
  check('Vendedor confirma → ACCEPTED con 7 días de reserva', res.status === 200 && res.body?.data?.status === 'ACCEPTED' && Math.round((new Date(res.body.data.expiresAt) - Date.now()) / 86_400_000) === 7, res.body);
  const v1Row = await vehicleRow(v1.id);
  check('Vehículo bloqueado (RESERVED + lockedReservationId)', v1Row.status === 'RESERVED' && v1Row.lockedReservationId === betoRes.id, v1Row);
  check('La otra solicitud se rechaza', (await reservationRow(carlaRes.id)).status === 'REJECTED');
  res = await ana.post(`/api/reservations/${carlaRes.id}/accept`);
  check('Confirmar otra solicitud del mismo vehículo → 409', res.status === 409, res.body);
  res = await carla.post('/api/reservations', { vehicleId: v1.id, acceptLegal: true });
  check('Vehículo reservado: no admite nuevas solicitudes → 409', res.status === 409 && res.body?.error?.code === 'VEHICLE_NOT_AVAILABLE', res.body);
  check('Tasa de comisión Premium fijada al confirmar (2,5 %)', Number((await one('SELECT commissionRate AS r FROM cart_reserves WHERE id = ?', [betoRes.id])).r) === 0.025);
  check('Correo de confirmación al comprador', Boolean(await mailTo('beto@test.com', /Reserva confirmada/)));
  res = await beto.get('/api/reservations?as=buyer');
  check('Comprador: datos verificados del vendedor (teléfono incluido)', res.body?.data?.find(r => r.id === betoRes.id)?.contact?.phone === '+52 33 1234 5678', res.body?.data?.[0]?.contact);
  res = await ana.get('/api/reservations?as=seller');
  check('Vendedor: datos verificados del comprador', res.body?.data?.find(r => r.id === betoRes.id)?.contact?.phone === '+52 33 5555 1111', res.body?.data?.[0]?.contact);
  res = await client('10.0.0.88').get(`/api/vehicles/${v1.slug}`);
  check('La ficha muestra el vehículo como reservado', res.body?.data?.status === 'RESERVED', res.body?.data?.status);

  ack = await socket.emitWithAck('message:send', { conversationId, clientId: randomUUID(), type: 'TEXT', text: 'Mi correo: beto@mail.com' });
  check('Chat directo: ya se comparten datos de contacto', ack.ok && ack.data.body.includes('beto@mail.com'), ack);
  res = await beto.get('/api/conversations');
  check('Bandeja: chat directo con la tarjeta de datos verificados', res.body?.data?.[0]?.direct === true && res.body?.data?.[0]?.contact?.phone === '+52 33 1234 5678', res.body?.data?.[0]);
  res = await beto.post('/api/media/chat-uploads', { conversationId, type: 'AUDIO', mimeType: 'audio/webm', sizeBytes: 4000 });
  check('Nota de voz: URL prefirmada en la carpeta audios-chat/', res.status === 201 && res.body?.data?.key?.startsWith(`audios-chat/${conversationId}/`), res.body);
  const voice = res.body?.data;
  await fetch(voice.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'audio/webm' }, body: Buffer.alloc(4000, 3) });
  ack = await socket.emitWithAck('message:send', { conversationId, clientId: randomUUID(), type: 'AUDIO', media: { key: voice.key, mimeType: 'audio/webm', sizeBytes: 4000, durationMs: 4200 } });
  check('Nota de voz enviada y reproducible (URL de descarga y duración)', ack.ok && ack.data.type === 'AUDIO' && Boolean(ack.data.media?.url) && ack.data.media?.durationMs === 4200, ack);
  socket.disconnect();

  section('Reserva sin venta → disponible otra vez · venta concretada → comisión post-venta con Binance');
  // «Avísame si vuelve»: quien se quedó sin reserva espera el auto en negociación.
  res = await carla.put(`/api/vehicles/${v1.id}/watch`);
  check('«Avísame si vuelve» en un auto en negociación → 204', res.status === 204, res.body);
  res = await carla.get('/api/vehicles/watching');
  check('La compradora ve el auto en su lista de espera', res.body?.data?.includes(v1.id), res.body);
  res = await ana.put(`/api/vehicles/${v1.id}/watch`);
  check('El vendedor no espera su propio auto → 400 OWN_VEHICLE', res.status === 400 && res.body?.error?.code === 'OWN_VEHICLE', res.body);
  // «El trato» en el chat: estado, eventos reales del hilo y «En negociación».
  res = await ana.get(`/api/conversations/${conversationId}/deal`);
  let deal = res.body?.data;
  check('El trato (vendedor): reserva confirmada, eventos consulta → solicitud → confirmación', res.status === 200 && deal?.role === 'SELLER' && deal?.status === 'RESERVED' && deal?.publicStatus === 'RESERVED' && deal?.reservation?.id === betoRes.id && ['ASKED', 'REQUESTED', 'ACCEPTED'].every(kind => deal.events.some(e => e.kind === kind)), deal);
  check('El trato: 1 persona espera el auto y el vendedor ve su comisión (2,5 %)', deal?.watchers === 1 && deal?.commissionRate === 0.025 && deal?.rules?.reservationHoldDays === 7, deal);
  res = await beto.get(`/api/conversations/${conversationId}/deal`);
  check('El trato (comprador): sin la comisión del vendedor', res.status === 200 && res.body?.data?.role === 'BUYER' && res.body?.data?.commissionRate === null, res.body?.data);
  res = await carla.get(`/api/conversations/${conversationId}/deal`);
  check('Quien no participa no ve el trato → 403', res.status === 403, res.body);
  res = await beto.post(`/api/reservations/${betoRes.id}/negotiate`);
  check('Solo el vendedor pone en negociación → 403', res.status === 403 && res.body?.error?.code === 'NOT_SELLER', res.body);
  res = await ana.post(`/api/reservations/${betoRes.id}/negotiate`);
  check('Vendedor: «Poner en negociación» → negotiatingAt', res.status === 200 && Boolean(res.body?.data?.negotiatingAt), res.body);
  res = await client('10.0.0.88').get(`/api/vehicles/${v1.slug}`);
  check('El público lo ve «En negociación» (reservado con la venta en cierre)', res.body?.data?.status === 'RESERVED' && res.body?.data?.inNegotiation === true, res.body?.data);
  res = await ana.get(`/api/conversations/${conversationId}/deal`);
  check('El trato pasa a En negociación con su evento en el hilo', res.body?.data?.status === 'NEGOTIATING' && res.body?.data?.publicStatus === 'NEGOTIATING' && res.body?.data?.events?.at(-1)?.kind === 'NEGOTIATING', res.body?.data);
  check('Aviso al comprador: auto en negociación', Boolean(await waitFor(() => one("SELECT n.id FROM notifications n JOIN users u ON u.id = n.userId WHERE u.email = 'beto@test.com' AND n.type = 'RESERVATION_NEGOTIATING' LIMIT 1"))));
  res = await ana.get('/api/conversations');
  let summary = res.body?.data?.find(c => c.id === conversationId);
  check('Bandeja: estado del trato, último mensaje (nota de voz) y no leídos', summary?.dealStatus === 'NEGOTIATING' && summary?.lastMessage?.type === 'AUDIO' && summary?.lastMessage?.mine === false && summary?.unreadCount >= 3, summary);
  res = await beto.post(`/api/conversations/${conversationId}/report`, { reason: 'OTHER' });
  check('Reporte anónimo desde el chat → 201', res.status === 201, res.body);
  res = await beto.post(`/api/conversations/${conversationId}/report`, { reason: 'SPAM' });
  check('Reporte repetido de la misma conversación → 409', res.status === 409 && res.body?.error?.code === 'ALREADY_REPORTED', res.body);
  res = await admin.get('/api/admin/reports?status=OPEN');
  const chatReport = res.body?.data?.items?.find(r => r.kind === 'CHAT');
  check('Moderación recibe el reporte del chat con la persona reportada', chatReport?.reportedUser?.id === anaId && chatReport?.vehicle?.id === v1.id, chatReport);
  res = await admin.patch(`/api/admin/reports/${chatReport.id}`, { status: 'DISMISSED', note: 'Sin falta', archiveVehicle: true });
  check('Descartar un reporte del chat no retira el anuncio', res.status === 204 && (await vehicleRow(v1.id)).status === 'RESERVED', res.body);

  res = await beto.post(`/api/reservations/${betoRes.id}/cancel`, { note: 'Cambio de planes' });
  check('Comprador cancela la reserva confirmada → CANCELLED', res.status === 200 && res.body?.data?.status === 'CANCELLED', res.body);
  check('Al liberarse deja de estar en negociación', (await one('SELECT negotiatingAt FROM vehicles WHERE id = ?', [v1.id])).negotiatingAt === null);
  res = await ana.get(`/api/conversations/${conversationId}/deal`);
  deal = res.body?.data;
  check('El trato vuelve a Disponible con el evento «canceló la reserva» del comprador', deal?.status === 'AVAILABLE' && deal?.events?.at(-1)?.kind === 'CANCELLED' && deal?.events?.at(-1)?.by === 'BUYER', deal?.events);
  check('El vehículo vuelve a estar disponible (PUBLISHED, sin bloqueo)', (await vehicleRow(v1.id)).status === 'PUBLISHED' && (await vehicleRow(v1.id)).lockedReservationId === null);
  const watchNotice = await waitFor(() => one("SELECT n.body, n.link FROM notifications n JOIN users u ON u.id = n.userId WHERE u.email = 'carla@test.com' AND n.type = 'VEHICLE_AVAILABLE_AGAIN' ORDER BY n.createdAt DESC LIMIT 1"));
  check('Se avisa a quien esperaba: volvió a estar disponible (con enlace a la ficha)', watchNotice?.link === `/vehiculos/${v1.slug}` && /ya se puede reservar/.test(watchNotice.body), watchNotice);
  res = await carla.get('/api/vehicles/watching');
  check('Tras el aviso la lista de espera queda vacía', Array.isArray(res.body?.data) && !res.body.data.includes(v1.id), res.body);
  res = await carla.put(`/api/vehicles/${v1.id}/watch`);
  check('Un auto disponible no se espera → 409 NOT_IN_NEGOTIATION', res.status === 409 && res.body?.error?.code === 'NOT_IN_NEGOTIATION', res.body);
  const releaseNotice = await waitFor(() => one("SELECT n.body FROM notifications n JOIN users u ON u.id = n.userId WHERE u.email = 'ana@test.com' AND n.type = 'RESERVATION_CANCELLED' ORDER BY n.createdAt DESC LIMIT 1"));
  check('Aviso al vendedor (campana y correo): debe devolver el 100 % del abono', releaseNotice?.body?.includes('devolver el 100 % del abono') && Boolean(await mailTo('ana@test.com', /Reserva finalizada sin venta/)), releaseNotice);

  res = await carla.post('/api/reservations', { vehicleId: v1.id, acceptLegal: true });
  const sale = res.body?.data;
  res = await ana.post(`/api/reservations/${sale.id}/accept`);
  check('Nueva reserva confirmada', res.status === 200 && res.body?.data?.status === 'ACCEPTED', res.body);
  res = await carla.post(`/api/reservations/${sale.id}/commission/checkout`, { salePrice: '20000', method: 'MANUAL' });
  check('El comprador no puede marcar la venta → 403', res.status === 403, res.body);
  res = await carla.post(`/api/reservations/${sale.id}/rating`, { rating: 5 });
  check('No se puede valorar antes de concretar la venta', res.status === 409 && res.body?.error?.code === 'SALE_NOT_COMPLETED', res.body);
  res = await ana.post(`/api/reservations/${sale.id}/complete`, { salePrice: '20000' });
  check('Venta con comisión no se finaliza antes del pago → 409', res.status === 409 && res.body?.error?.code === 'COMMISSION_PAYMENT_REQUIRED', res.body);
  res = await ana.post(`/api/reservations/${sale.id}/commission/checkout`, { salePrice: '20000', method: 'MANUAL' });
  const commissionPay = res.body?.data;
  check('Cobro de la comisión con Binance (Pay ID): 500.00 USDT', res.status === 201 && commissionPay?.purpose === 'COMMISSION' && commissionPay?.amount === '500.00' && commissionPay?.manual?.payId === BINANCE.payId, res.body);
  check('Reserva y vehículo esperan aprobación, no venta finalizada', (await reservationRow(sale.id)).status === 'ACCEPTED' && (await vehicleRow(v1.id)).status === 'RESERVED');
  await ana.post(`/api/payments/${commissionPay.id}/submit`, { txId: '440000000000000001' });
  check('Comprobante de comisión queda en revisión sin sanción ni bloqueo', (await paymentRow(commissionPay.id)).status === 'SUBMITTED' && (await ana.get('/api/auth/me')).body?.data?.overdueCommissions === 0);
  res = await admin.get('/api/admin/payments?view=review');
  check('Admin recibe referencia e ID de transacción Binance', res.body?.data?.some(p => p.id === commissionPay.id && p.reference === commissionPay.reference && p.txId === '440000000000000001'), res.body);
  res = await admin.get('/api/admin/commissions');
  check('Panel de comisiones incluye venta en revisión sin sanción', res.body?.data?.some(c => c.recordId === sale.id && c.payment?.status === 'SUBMITTED' && c.commissionAmount === '500.00'), res.body);
  res = await admin.post(`/api/admin/payments/${commissionPay.id}/review`, { decision: 'APPROVE' });
  check('Admin aprueba → venta finalizada y comisión contabilizada (SALE_COMMISSION 500)', res.status === 204 && (await reservationRow(sale.id)).status === 'COMPLETED' && (await reservationRow(sale.id)).commissionPaidAt !== null && (await vehicleRow(v1.id)).status === 'SOLD' && Number((await one("SELECT SUM(amount) AS s FROM ledger_entries WHERE type = 'SALE_COMMISSION'")).s) === 500);
  res = await carla.get('/api/conversations');
  const saleConversation = res.body?.data?.find(c => c.vehicle.id === v1.id);
  res = await carla.get(`/api/conversations/${saleConversation?.id}/deal`);
  check('El trato termina en Vendido con el precio final en el hilo', res.body?.data?.status === 'SOLD' && res.body?.data?.events?.at(-1)?.kind === 'SOLD' && res.body?.data?.events?.at(-1)?.amount === '20000.00', res.body?.data);
  res = await client('10.0.0.71').get(`/api/users/${anaId}/rating-opportunities`);
  check('Solo usuarios autenticados pueden consultar sus oportunidades para puntuar', res.status === 401, res.body);
  res = await carla.get(`/api/users/${anaId}/rating-opportunities`);
  check('Compradora ve desde el perfil la venta completada que puede puntuar', res.status === 200 && res.body?.data?.length === 1 && res.body.data[0].reservationId === sale.id && res.body.data[0].vehicleTitle === 'Toyota Corolla 2020' && res.body.data[0].rating === null, res.body?.data);
  res = await beto.get(`/api/users/${anaId}/rating-opportunities`);
  check('Otro usuario no recibe oportunidades de puntuación de ese vendedor', res.status === 200 && res.body?.data?.length === 0, res.body?.data);
  res = await carla.post(`/api/reservations/${sale.id}/rating`, { rating: 5 });
  check('Compradora valora al vendedor tras venta completada', res.status === 200 && res.body?.data?.rating === 5, res.body);
  res = await carla.get(`/api/users/${anaId}/rating-opportunities`);
  check('El perfil muestra la puntuación guardada y permite actualizarla', res.status === 200 && res.body?.data?.[0]?.rating === 5, res.body?.data);
  res = await carla.post(`/api/reservations/${sale.id}/rating`, { rating: 4, comment: '  El auto estaba igual que en las fotos.  ' });
  check('La reseña acepta un comentario (sin espacios sobrantes)', res.status === 200 && res.body?.data?.rating === 4 && res.body?.data?.comment === 'El auto estaba igual que en las fotos.', res.body);
  res = await carla.post(`/api/reservations/${sale.id}/rating`, { rating: 5 });
  check('Cambiar solo las estrellas conserva el comentario', res.status === 200 && res.body?.data?.rating === 5 && res.body?.data?.comment === 'El auto estaba igual que en las fotos.', res.body);
  res = await carla.get(`/api/users/${anaId}/rating-opportunities`);
  check('Las oportunidades de puntuar traen el comentario guardado', res.body?.data?.[0]?.comment === 'El auto estaba igual que en las fotos.', res.body?.data);
  res = await carla.post(`/api/reservations/${sale.id}/rating`, { rating: 5, comment: 'x'.repeat(401) });
  check('Comentario de más de 400 caracteres → VALIDATION_ERROR', res.body?.error?.code === 'VALIDATION_ERROR', res.body);
  res = await beto.post(`/api/reservations/${sale.id}/rating`, { rating: 1 });
  check('Otra cuenta no puede valorar una venta ajena', res.status === 403 && res.body?.error?.code === 'NOT_BUYER', res.body);
  res = await client('10.0.0.70').get(`/api/users/${anaId}/profile`);
  check('Perfil público muestra biografía, foto, inventario y recomendación', res.status === 200 && res.body?.data?.bio === 'Vendedor de vehículos con atención personalizada.' && res.body?.data?.avatarUrl?.includes(`/avatars/${anaId}/`) && res.body?.data?.ratingAverage === 5 && res.body?.data?.ratingCount === 1 && Array.isArray(res.body?.data?.vehicles), res.body?.data);
  res = await ana.post(`/api/reservations/${sale.id}/commission/checkout`, { salePrice: '20000', method: 'MANUAL' });
  check('Pagar de nuevo una comisión pagada → 409 COMMISSION_ALREADY_PAID', res.status === 409 && res.body?.error?.code === 'COMMISSION_ALREADY_PAID', res.body);

  section('Plazos automáticos (jobs) · comisión vencida bloquea publicar y reservar');
  res = await beto.post('/api/reservations', { vehicleId: v2.id, acceptLegal: true });
  const held = res.body?.data;
  await ana.post(`/api/reservations/${held.id}/accept`);
  await q('UPDATE cart_reserves SET expiresAt = UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE WHERE id = ?', [held.id]);
  check('Job: la reserva vence sin venta → EXPIRED y el vehículo vuelve a estar disponible', Boolean(await waitFor(async () => (await reservationRow(held.id)).status === 'EXPIRED' && (await vehicleRow(v2.id)).status === 'PUBLISHED')));
  res = await carla.post('/api/reservations', { vehicleId: v3.id, acceptLegal: true });
  const ignored = res.body?.data;
  await q('UPDATE cart_reserves SET expiresAt = UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE WHERE id = ?', [ignored.id]);
  check('Job: el vendedor no respondió → EXPIRED', Boolean(await waitFor(async () => (await reservationRow(ignored.id)).status === 'EXPIRED')));

  res = await beto.post('/api/reservations', { vehicleId: kia1.id, acceptLegal: true });
  const dealerSale = res.body?.data;
  await dario.post(`/api/reservations/${dealerSale.id}/accept`);
  res = await dario.post(`/api/reservations/${dealerSale.id}/complete`, { salePrice: '30000' });
  check('Venta con comisión requiere aprobación del pago antes de finalizar', res.status === 409 && res.body?.error?.code === 'COMMISSION_PAYMENT_REQUIRED', res.body);
  await q("UPDATE cart_reserves SET status = 'COMPLETED', openKey = NULL, completedAt = UTC_TIMESTAMP(3), salePrice = 30000, commissionRate = 0.02, commissionAmount = 600, commissionDueAt = UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE WHERE id = ?", [dealerSale.id]);
  await q("UPDATE vehicles SET status = 'SOLD', lockedReservationId = NULL WHERE id = ?", [kia1.id]);
  await q('UPDATE cart_reserves SET commissionDueAt = UTC_TIMESTAMP(3) + INTERVAL 1 DAY WHERE id = ?', [dealerSale.id]);
  const darioId = (await one('SELECT id FROM users WHERE email = ?', ['dario@test.com'])).id;
  check('Job: recordatorio de comisión antes del vencimiento', Boolean(await waitFor(async () => Number((await one("SELECT COUNT(*) AS n FROM notifications WHERE userId = ? AND type = 'COMMISSION_REMINDER'", [darioId])).n) === 1)) && Boolean(await mailTo('dario@test.com', /comisión post-venta/i)));
  await q('UPDATE cart_reserves SET commissionDueAt = UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE WHERE id = ?', [dealerSale.id]);
  check('Job: comisión vencida → aviso (una sola vez) con advertencia legal', Boolean(await waitFor(async () => Number((await one("SELECT COUNT(*) AS n FROM notifications WHERE userId = ? AND type = 'COMMISSION_OVERDUE'", [darioId])).n) === 1)) && Boolean(await mailTo('dario@test.com', /Comisión vencida/)));
  res = await dario.get('/api/notifications');
  check('Campana recibe recordatorio y vencimiento de comisión', ['COMMISSION_REMINDER', 'COMMISSION_OVERDUE'].every(type => res.body?.data?.items?.some(item => item.type === type)), res.body?.data?.items?.map(item => item.type));
  res = await dario.get('/api/auth/me');
  check('El perfil indica 1 comisión vencida', res.body?.data?.overdueCommissions === 1, res.body?.data);
  await dario.post(`/api/vehicles/${kia2.id}/pause`);
  res = await dario.post(`/api/vehicles/${kia2.id}/publish`);
  check('Con comisión vencida no puede publicar → 403 COMMISSION_OVERDUE', res.status === 403 && res.body?.error?.code === 'COMMISSION_OVERDUE', res.body);
  res = await dario.post('/api/reservations', { vehicleId: v3.id, acceptLegal: true });
  check('Con comisión vencida no puede reservar → 403 COMMISSION_OVERDUE', res.status === 403 && res.body?.error?.code === 'COMMISSION_OVERDUE', res.body);
  res = await admin.get('/api/admin/commissions');
  check('Panel: comisión vencida del concesionario', res.body?.data?.some(c => c.recordId === dealerSale.id && c.recordType === 'RESERVATION' && c.overdue && c.seller.businessName === 'Autos Darío C.A.'), res.body);
  res = await dario.post(`/api/reservations/${dealerSale.id}/commission/checkout`, { salePrice: '30000', method: 'MERCHANT' });
  const dealerCommission = res.body?.data;
  hook = await payMerchant(dealerCommission.reference);
  check('Comisión pagada con Binance Pay (webhook) → se desbloquea la cuenta', hook.status === 200 && Boolean(await waitFor(async () => (await reservationRow(dealerSale.id)).commissionPaidAt !== null)) && (await dario.get('/api/auth/me')).body?.data?.overdueCommissions === 0);
  res = await dario.post(`/api/vehicles/${kia2.id}/publish`);
  check('Ya puede volver a publicar', res.status === 200, res.body);

  // ─────────────────────────────────────────────── Panel de administración ──
  section('Administración: membresías manuales, precios, lista negra, carrusel, moderación');
  res = await beto.get('/api/admin/metrics');
  check('Un usuario normal no entra al panel → 403', res.status === 403, res.status);
  res = await admin.post(`/api/admin/users/${darioId}/membership`, { planCode: 'DEALER_PRO', cycle: 'YEARLY', periods: 1, note: 'Cortesía' });
  check('Alta manual del plan Concesionario Pro anual', res.status === 204 && (await one('SELECT planCode FROM users WHERE id = ?', [darioId])).planCode === 'DEALER_PRO', res.body);
  check('Posicionamiento prioritario (searchBoost 3) aplicado a sus anuncios', Number((await one('SELECT MIN(searchBoost) AS b FROM vehicles WHERE sellerId = ?', [darioId])).b) === 3);
  res = await admin.patch('/api/admin/plans/PREMIUM', { priceMonthly: 12.5, priceYearly: 125, commissionRate: 0.03 });
  check('Edición de precios del plan', res.status === 200 && res.body?.data?.priceMonthly === 12.5, res.body);
  res = await admin.patch('/api/admin/plans/DEALER_BASIC', { priceMonthly: 24.99, priceYearly: 249, commissionRate: 0.02, maxActiveListings: 25 });
  check('Edición del cupo de anuncios del plan', res.status === 200 && res.body?.data?.maxActiveListings === 25, res.body);
  res = await client('10.0.0.82').get('/api/public/plans');
  check('Precios nuevos visibles al instante', res.body?.data?.find(p => p.code === 'PREMIUM')?.priceMonthly === 12.5, res.body);
  res = await admin.post('/api/admin/blocked-terms', { term: 'chatarrero' });
  check('Término añadido a la lista negra', res.status === 201, res.body);
  res = await ana.post('/api/vehicles', { ...corolla, description: 'No soy un CHATARRERO' });
  check('La lista negra aplica al instante en descripciones', res.status === 400 && res.body?.error?.code === 'BLOCKED_TERMS', res.body);
  res = await admin.put('/api/admin/carousel', { items: [{ vehicleId: v3.id }, { vehicleId: v2.id }] });
  check('Carrusel curado guardado', res.status === 200 && res.body?.data?.curated?.length === 2, res.body);
  res = await client('10.0.0.83').get('/api/public/carousel');
  check('Carrusel público: selección del admin primero (en orden)', res.body?.data?.[0]?.id === v3.id && res.body?.data?.[1]?.id === v2.id && res.body?.data?.[0]?.source === 'CURATED', res.body?.data?.map(i => i.source));
  const marketVehicle = await one("SELECT v.id,v.sellerId FROM vehicles v WHERE v.status = 'PUBLISHED' AND v.deletedAt IS NULL AND (v.expiresAt IS NULL OR v.expiresAt > UTC_TIMESTAMP(3)) AND (v.featuredUntil IS NULL OR v.featuredUntil <= UTC_TIMESTAMP(3)) AND NOT EXISTS (SELECT 1 FROM carousel_items ci WHERE ci.vehicleId = v.id) AND NOT EXISTS (SELECT 1 FROM reports rp WHERE rp.vehicleId = v.id AND rp.status = 'OPEN') AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.vehicleId = v.id) ORDER BY v.publishedAt DESC LIMIT 1");
  if (marketVehicle) {
    const marketBuyers = await q("SELECT id FROM users WHERE role = 'USER' AND status = 'ACTIVE' AND deletedAt IS NULL AND id <> ? ORDER BY createdAt LIMIT 8", [marketVehicle.sellerId]);
    for (const buyer of marketBuyers) {
      await q('INSERT INTO conversations (id,vehicleId,buyerId,sellerId,createdAt,updatedAt) VALUES (?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))', [randomUUID(), marketVehicle.id, buyer.id, marketVehicle.sellerId]);
    }
    res = await admin.get('/api/admin/carousel/recommendations');
    const recommendation = res.body?.data?.find(item => item.vehicle.id === marketVehicle.id);
    check('El ranking recomienda auto con contactos reales recientes', res.status === 200 && marketBuyers.length >= 3 && recommendation?.contactCount === marketBuyers.length, recommendation);
  } else {
    check('El ranking recomienda auto con contactos reales recientes', false, 'No hay vehículo disponible para crear fixture.');
  }
  res = await admin.get('/api/admin/carousel/recommendations');
  check('Recomendaciones del carrusel limitadas a 12 y puntuadas por demanda real', res.status === 200 && res.body?.data?.length <= 12 && res.body.data.every(item => item.influenceScore === item.contactCount + item.reservationCount * 3), res.body);
  res = await admin.get('/api/admin/carousel');
  check('Panel no descarga todos los destacados: muestra hasta 50 y conserva el total', res.status === 200 && res.body?.data?.featured?.length <= 50 && res.body?.data?.featuredTotal >= res.body?.data?.featured?.length, res.body);
  res = await admin.put('/api/admin/carousel', { items: Array.from({ length: 13 }, () => ({ vehicleId: v1.id, isActive: true })) });
  check('API rechaza carrusel mayor de 12 vehículos', res.status === 422, res.body);
  res = await carla.post(`/api/vehicles/${v2.id}/report`, { reason: 'WRONG_INFO', details: 'Este 1d10t4 anuncio es falso.' });
  check('Denuncia: grosería leetspeak rechazada → 400 BLOCKED_TERMS', res.status === 400 && res.body?.error?.code === 'BLOCKED_TERMS', res.body);
  res = await carla.post(`/api/vehicles/${v2.id}/report`, { reason: 'WRONG_INFO', details: 'El kilometraje no cuadra' });
  check('Denuncia de un anuncio', res.status === 201, res.body);
  res = await carla.post(`/api/vehicles/${v2.id}/report`, { reason: 'SPAM' });
  check('Denuncia duplicada → 409', res.status === 409, res.body);
  res = await admin.get('/api/admin/reports?status=OPEN');
  const report = res.body?.data?.items?.[0];
  res = await admin.patch(`/api/admin/reports/${report.id}`, { status: 'DISMISSED', note: 'Verificado con el vendedor' });
  check('Denuncia resuelta', res.status === 204, res.body);
  res = await beto.put('/api/reviews/mine', { rating: 1, comment: 'Este 1d10t4 vendedor no sirve para nada.' });
  check('Reseña: grosería leetspeak rechazada → 400 BLOCKED_TERMS', res.status === 400 && res.body?.error?.code === 'BLOCKED_TERMS', res.body);
  res = await beto.put('/api/reviews/mine', { rating: 5, comment: 'Reservé pagando el abono al vendedor y todo fue transparente.' });
  check('Reseña enviada (pendiente de moderación)', res.status === 200 && res.body?.data?.status === 'PENDING', res.body);
  res = await client('10.0.0.84').get('/api/public/reviews');
  check('Una reseña pendiente no es pública', res.body?.data?.total === 0, res.body);
  res = await admin.get('/api/admin/reviews?status=PENDING');
  await admin.patch(`/api/admin/reviews/${res.body?.data?.[0]?.id}`, { status: 'APPROVED' });
  res = await client('10.0.0.84').get('/api/public/reviews');
  check('Reseña aprobada visible con media real', res.body?.data?.total === 1 && res.body?.data?.average === 5, res.body);
  res = await client('10.0.0.85').post('/api/public/contact', { name: 'Laura', email: 'laura@test.com', message: 'Quiero información del plan Pro para mi concesionario.', ...human('contact') });
  check('Formulario de contacto con Turnstile', res.status === 201, res.body);
  res = await client('10.0.0.85').post('/api/public/contact', { name: 'Laura', email: 'laura@test.com', message: 'Este 1d10t4 no funciona para nada.', ...human('contact') });
  check('Contacto: grosería leetspeak rechazada → 400 BLOCKED_TERMS', res.status === 400 && res.body?.error?.code === 'BLOCKED_TERMS', res.body);
  res = await client('10.0.0.86').get('/api/public/chat-filter-stats');
  check('Portada: cifras reales del filtro del chat (mensajes y datos de contacto ocultos)', res.status === 200 && res.body?.data?.days === 30 && res.body?.data?.messages > 0 && res.body?.data?.conversations > 0 && res.body?.data?.contactHidden >= 1 && Number.isInteger(res.body?.data?.profanityHidden), res.body);
  res = await admin.get('/api/admin/contact');
  check('Mensaje de contacto en el panel', res.body?.data?.some(m => m.email === 'laura@test.com'), res.body);

  section('Panel: plazos, fondo dinámico del login (MySQL) y Términos editables');
  res = await client('10.0.0.89').get('/api/public/terms');
  const initialDocs = (res.body?.data?.content ?? '').split('\n').filter(line => line.startsWith('# ')).map(line => line.slice(2));
  check('Términos iniciales: 6 documentos (términos, privacidad, cookies, pagos, anuncios, compra segura)', JSON.stringify(initialDocs) === JSON.stringify(['Términos y condiciones', 'Política de privacidad', 'Política de cookies', 'Pagos y reembolsos', 'Reglas para anuncios', 'Compra segura']), initialDocs);
  check('Con las reglas reales: abono P2P al 100 %, comisión de tu plan y derechos de autor', /100 %/.test(res.body?.data?.content) && /comisión de su plan/.test(res.body?.data?.content) && !/no cobra comisión/.test(res.body?.data?.content) && /Todos los derechos reservados/.test(res.body?.data?.content) && res.body?.data?.updatedAt === null, res.body);
  res = await admin.put('/api/admin/settings', { sellerResponseHours: 24, reservationHoldDays: 5, commissionDueDays: 10 });
  check('Plazos guardados', res.status === 200 && res.body?.data?.reservationHoldDays === 5 && res.body?.data?.commissionDueDays === 10, res.body);
  res = await client('10.0.0.89').get('/api/public/settings');
  check('Plazos públicos para la ficha', res.body?.data?.reservationHoldDays === 5 && res.body?.data?.sellerResponseHours === 24, res.body);
  const terms = '# Términos de prueba\n\n## Reservas\n- El abono se paga directamente al vendedor y se descuenta del precio.\n- Si la venta no se concreta, el vendedor lo devuelve íntegro.';
  res = await beto.put('/api/admin/settings/terms', { content: terms });
  check('Un usuario no edita los Términos → 403', res.status === 403, res.status);
  res = await admin.put('/api/admin/settings/terms', { content: terms });
  check('Términos editados desde el panel', res.status === 200 && res.body?.data?.terms?.content === terms, res.body);
  res = await client('10.0.0.89').get('/api/public/terms');
  check('Página pública con los Términos nuevos y su fecha', res.body?.data?.content === terms && Boolean(res.body?.data?.updatedAt), res.body);
  const termsUpdatedAt = res.body?.data?.updatedAt;
  res = await beto.get('/api/auth/me');
  check('La sesión dice cuándo aceptó los Términos (antes de esta versión)', Boolean(res.body?.data?.termsAcceptedAt) && res.body.data.termsAcceptedAt < termsUpdatedAt, res.body?.data?.termsAcceptedAt);
  res = await beto.post('/api/auth/me/terms', {});
  check('Aceptar la versión vigente', res.status === 200 && res.body?.data?.termsAcceptedAt >= termsUpdatedAt, res.body?.data);
  const background = fileBytes('image/jpeg', 6000, 21);
  res = await admin.post('/api/admin/settings/login-background/upload', { mimeType: 'image/jpeg', sizeBytes: background.length });
  check('Fondo del login: URL prefirmada en la carpeta login-bg/', res.status === 200 && res.body?.data?.key?.startsWith('login-bg/'), res.body);
  await fetch(res.body.data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: background });
  res = await admin.put('/api/admin/settings/login-background', { key: res.body.data.key });
  check('Ruta del fondo guardada en MySQL', res.status === 200 && res.body?.data?.loginBackgroundUrl?.startsWith('http://cdn.test/media/login-bg/'), res.body);
  res = await client('10.0.0.89').get('/api/public/settings');
  check('El login recibe la imagen de fondo', res.body?.data?.loginBackgroundUrl?.startsWith('http://cdn.test/media/login-bg/'), res.body);
  res = await admin.post('/api/admin/settings/login-background/upload', { mimeType: 'image/png', sizeBytes: 3000 });
  await fetch(res.body.data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: Buffer.alloc(3000, 9) });
  res = await admin.put('/api/admin/settings/login-background', { key: res.body.data.key });
  check('Un archivo que no es una imagen real → 400 INVALID_IMAGE', res.status === 400 && res.body?.error?.code === 'INVALID_IMAGE', res.body);
  res = await client('10.0.0.89').get('/api/public/settings');
  check('Portada sin foto propia: la web usa la predeterminada', res.body?.data?.homeHeroUrl === null, res.body);
  const hero = fileBytes('image/jpeg', 7000, 33);
  res = await admin.post('/api/admin/settings/home-hero/upload', { mimeType: 'image/jpeg', sizeBytes: hero.length });
  check('Foto de la portada: URL prefirmada en la carpeta home-hero/', res.status === 200 && res.body?.data?.key?.startsWith('home-hero/'), res.body);
  await fetch(res.body.data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: hero });
  const heroKey = res.body.data.key;
  res = await admin.put('/api/admin/settings/login-background', { key: heroKey });
  check('Una foto de la portada no sirve como fondo del login → 403', res.status === 403 && res.body?.error?.code === 'MEDIA_KEY_FORBIDDEN', res.body);
  res = await admin.put('/api/admin/settings/home-hero', { key: heroKey });
  check('Ruta de la foto de la portada guardada en MySQL', res.status === 200 && res.body?.data?.homeHeroUrl?.startsWith('http://cdn.test/media/home-hero/'), res.body);
  res = await client('10.0.0.89').get('/api/public/settings');
  check('La portada recibe la foto que subió el panel', res.body?.data?.homeHeroUrl?.startsWith('http://cdn.test/media/home-hero/'), res.body);
  res = await admin.del('/api/admin/settings/home-hero');
  check('Quitar la foto: vuelve la predeterminada', res.status === 200 && res.body?.data?.homeHeroUrl === null, res.body);
  res = await admin.get('/api/admin/settings/history');
  check('Historial: cambios de la foto de la portada', JSON.stringify(res.body?.data ?? '').includes('Nueva foto de la portada'), res.body?.data?.slice?.(0, 3));

  section('Venta directa de anuncio · Pay ID con revisión administrativa');
  res = await ana.post(`/api/vehicles/${v2.id}/sale/checkout`, { salePrice: '30000', method: 'MANUAL' });
  let listingSalePay = res.body?.data?.payment;
  check('Calcula comisión sobre precio final declarado (3 % de 30.000 = 900 USDT)', res.status === 201 && res.body?.data?.commissionAmount === '900.00' && listingSalePay?.amount === '900.00' && listingSalePay?.reference, res.body);
  check('Anuncio queda pendiente, sin finalizar en espera de Binance', (await vehicleRow(v2.id)).status === 'PENDING_SALE' && (await ana.get('/api/auth/me')).body?.data?.overdueCommissions === 0);
  res = await ana.post(`/api/vehicles/${v3.id}/pause`);
  check('Cuenta no queda bloqueada mientras paga comisión', res.status === 204, res.body);
  res = await ana.post(`/api/vehicles/${v3.id}/publish`);
  check('Cuenta puede publicar durante revisión, sin sanción', res.status === 200, res.body);
  res = await ana.post(`/api/vehicles/${v3.id}/sale/checkout`, { salePrice: '26000', method: 'MANUAL' });
  const expiringSalePay = res.body?.data?.payment;
  await q('UPDATE payments SET expiresAt = UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE WHERE id = ?', [expiringSalePay.id]);
  check('Job vence pago de comisión y restaura anuncio', Boolean(await waitFor(async () => (await paymentRow(expiringSalePay.id)).status === 'EXPIRED' && (await vehicleRow(v3.id)).status === 'PUBLISHED')));
  await ana.post(`/api/payments/${listingSalePay.id}/submit`, { txId: '440000000000000002' });
  res = await admin.get('/api/admin/payments?view=review');
  check('Panel de pagos muestra referencia y comprobante de venta directa', res.body?.data?.some(p => p.id === listingSalePay.id && p.reference === listingSalePay.reference && p.txId === '440000000000000002'), res.body);
  res = await admin.post(`/api/admin/payments/${listingSalePay.id}/review`, { decision: 'REJECT', note: 'Transacción no encontrada.' });
  check('Rechazo libera anuncio sin finalizar ni sancionar', res.status === 204 && (await vehicleRow(v2.id)).status === 'PUBLISHED' && (await one('SELECT status FROM vehicle_sales WHERE paymentId = ?', [listingSalePay.id])).status === 'CANCELLED', res.body);
  res = await ana.post(`/api/vehicles/${v2.id}/sale/checkout`, { salePrice: '30000', method: 'MANUAL' });
  listingSalePay = res.body?.data?.payment;
  check('Vendedor puede reenviar pago tras rechazo', res.status === 201 && listingSalePay?.amount === '900.00', res.body);
  await ana.post(`/api/payments/${listingSalePay.id}/submit`, { txId: '440000000000000003' });
  res = await admin.post(`/api/admin/payments/${listingSalePay.id}/review`, { decision: 'APPROVE', note: 'Referencia y transacción verificadas en Binance.' });
  check('Aprobación finaliza anuncio y registra ingreso', res.status === 204 && (await vehicleRow(v2.id)).status === 'SOLD' && Number((await one("SELECT SUM(amount) AS s FROM ledger_entries WHERE type = 'SALE_COMMISSION'")).s) === 2000, res.body);

  section('Métricas, exportaciones y PDF de opiniones');
  res = await admin.get('/api/admin/metrics?months=12');
  const metrics = res.body?.data;
  check('Métricas: ingresos = membresías 44.97 + comisiones post-venta 2000', metrics?.totals?.membershipRevenue === 44.97 && metrics?.totals?.commissions === 2000 && metrics?.totals?.revenue === 2044.97, metrics?.totals);
  check('Métricas: sin comisiones pendientes ni vencidas', metrics?.totals?.commissionsPending === 0 && metrics?.totals?.commissionsOverdue === 0, metrics?.totals);
  check('Métricas: serie mensual de 12 meses', metrics?.monthly?.length === 12 && metrics.monthly.at(-1).membership === 44.97 && metrics.monthly.at(-1).commission === 2000, metrics?.monthly?.at(-1));
  check('Métricas: concesionarios y ventas concretadas', metrics?.counts?.dealers === 1 && metrics?.counts?.completedSales === 3, metrics?.counts);
  res = await admin.get('/api/admin/users?q=dario');
  check('Gestión de usuarios: tipo de cuenta y datos fiscales', res.body?.data?.items?.[0]?.accountType === 'DEALER' && res.body?.data?.items?.[0]?.taxId === 'J-40123456-7', res.body?.data?.items?.[0]);
  res = await admin.get('/api/admin/users?q=ana');
  check('Gestión de usuarios con plan efectivo', res.body?.data?.items?.[0]?.plan?.code === 'PREMIUM', res.body?.data?.items?.[0]);
  res = await admin.get('/api/admin/exports/payments?format=xlsx');
  check('Exportación .xlsx real (ZIP OOXML)', res.status === 200 && res.buffer.subarray(0, 2).toString() === 'PK' && res.headers.get('content-type').includes('spreadsheetml'), res.status);
  res = await admin.get('/api/admin/exports/vehicles?format=pdf');
  check('Exportación PDF real', res.status === 200 && res.buffer.subarray(0, 5).toString() === '%PDF-', res.status);
  res = await admin.get('/api/admin/exports/reviews?format=pdf');
  check('PDF de opiniones de usuarios (PDFKit)', res.status === 200 && res.buffer.subarray(0, 5).toString() === '%PDF-' && /reviews/.test(res.headers.get('content-disposition') ?? ''), res.status);
  res = await admin.get('/api/admin/exports/reviews?format=xlsx');
  check('Opiniones también en Excel', res.status === 200 && res.buffer.subarray(0, 2).toString() === 'PK', res.status);
  check('Todas las llamadas a Binance Pay iban firmadas correctamente', binance.state.badSignatures === 0, binance.state.badSignatures);

  // ────────────────────────────────────────────── Vencimiento de la membresía ──
  section('Membresía: aviso ≤10 días (una vez) y vencimiento → Gratis con pausa de excedentes');
  await q('UPDATE users SET planExpiresAt = UTC_TIMESTAMP(3) + INTERVAL 5 DAY WHERE id = ?', [anaId]);
  await q("UPDATE vehicles SET expiresAt = UTC_TIMESTAMP(3) + INTERVAL 5 DAY WHERE sellerId = ? AND status = 'PUBLISHED'", [anaId]);
  check('Aviso de vencimiento en ≤10 días (notificación + correo)', Boolean(await waitFor(async () => Number((await one("SELECT COUNT(*) AS n FROM notifications WHERE userId = ? AND type = 'MEMBERSHIP_EXPIRING'", [anaId])).n) === 1)) && Boolean(await mailTo('ana@test.com', /vence en 5 d/)));
  check('Aviso de anuncio a 7 días (notificación + correo)', Boolean(await waitFor(async () => Number((await one("SELECT COUNT(*) AS n FROM notifications WHERE userId = ? AND type = 'LISTING_EXPIRING'", [anaId])).n) === 1)) && Boolean(await mailTo('ana@test.com', /Tu anuncio .* vence el/)));
  res = await ana.get('/api/notifications');
  check('Campana muestra avisos de membresía y anuncio', ['MEMBERSHIP_EXPIRING', 'LISTING_EXPIRING'].every(type => res.body?.data?.items?.some(item => item.type === type)), res.body?.data?.items?.map(item => item.type));
  res = await ana.get('/api/auth/me');
  check('El perfil indica días restantes para el banner', res.body?.data?.plan?.daysRemaining === 5, res.body?.data?.plan);
  await sleep(2_500);
  check('El aviso no se duplica entre ejecuciones del job', Number((await one("SELECT COUNT(*) AS n FROM notifications WHERE userId = ? AND type = 'MEMBERSHIP_EXPIRING'", [anaId])).n) === 1);
  check('Aviso de vencimiento del anuncio no se duplica', Number((await one("SELECT COUNT(*) AS n FROM notifications WHERE userId = ? AND type = 'LISTING_EXPIRING'", [anaId])).n) === 1);
  await q('UPDATE users SET planExpiresAt = UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE WHERE id = ?', [anaId]);
  check('Vencida → plan FREE', Boolean(await waitFor(async () => (await one('SELECT planCode FROM users WHERE id = ?', [anaId])).planCode === 'FREE')));
  const statuses = (await q("SELECT status FROM vehicles WHERE sellerId = ? AND deletedAt IS NULL AND status IN ('PUBLISHED','PAUSED')", [anaId])).map(r => r.status);
  check('Anuncio activo sigue publicado; anuncios vendidos no ocupan cupo', statuses.filter(s => s === 'PUBLISHED').length === 1 && statuses.filter(s => s === 'PAUSED').length === 0 && Number((await one("SELECT COUNT(*) AS n FROM vehicles WHERE sellerId = ? AND status = 'SOLD'", [anaId])).n) === 2, statuses);
  check('Sin prioridad ni destacados tras vencer', Number((await one('SELECT MAX(searchBoost) AS b FROM vehicles WHERE sellerId = ?', [anaId])).b) === 0 && Number((await one('SELECT COUNT(*) AS n FROM vehicles WHERE sellerId = ? AND featuredUntil > UTC_TIMESTAMP(3)', [anaId])).n) === 0);
  check('Correo de membresía vencida', Boolean(await mailTo('ana@test.com', /ha vencido/)));
  await q("UPDATE vehicles SET expiresAt = UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE WHERE sellerId = ? AND status = 'PUBLISHED'", [anaId]);
  check('Job: anuncio vencido → EXPIRED', Boolean(await waitFor(async () => Number((await one("SELECT COUNT(*) AS n FROM vehicles WHERE sellerId = ? AND status = 'EXPIRED'", [anaId])).n) === 1)));
  check('Al vencer, la campana recibe LISTING_EXPIRED', Boolean(await waitFor(async () => Number((await one("SELECT COUNT(*) AS n FROM notifications WHERE userId = ? AND type = 'LISTING_EXPIRED'", [anaId])).n) === 1)));

  section('Vencimiento de identificación: alerta, bloqueo de operaciones y re-verificación');
  await q("UPDATE kyc_documents SET expiresAt = UTC_TIMESTAMP(3) + INTERVAL 5 DAY WHERE userId = ? AND type = 'NATIONAL_ID' AND status = 'APPROVED'", [anaId]);
  res = await ana.get('/api/kyc/status');
  check('La identidad permite renovar antes del vencimiento', res.status === 200 && res.body?.data?.canRenewIdentity === true && Boolean(res.body?.data?.identityExpiresAt), res.body?.data);
  check('Aviso de identificación próxima a vencer', Boolean(await waitFor(async () => Number((await one("SELECT COUNT(*) AS n FROM notifications WHERE userId = ? AND type = 'IDENTITY_DOCUMENT_EXPIRING'", [anaId])).n) > 0)));
  await q("UPDATE kyc_documents SET expiresAt = UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE WHERE userId = ? AND type = 'NATIONAL_ID' AND status = 'APPROVED'", [anaId]);
  check('Documento vencido quita verificación y avisa', Boolean(await waitFor(async () => (await one('SELECT isVerified FROM users WHERE id = ?', [anaId])).isVerified === 0 && Number((await one("SELECT COUNT(*) AS n FROM notifications WHERE userId = ? AND type = 'IDENTITY_DOCUMENT_EXPIRED'", [anaId])).n) === 1)));
  res = await ana.post('/api/reservations', { vehicleId: v1.id, acceptLegal: true });
  check('Documento vencido bloquea reservas inmediatamente', res.status === 403 && res.body?.error?.code === 'IDENTITY_NOT_VERIFIED', res.body);

  section('Admin One: roles exclusivos, supervisor limitado y autoaprobación KYC');
  const ownerDocumentId = randomUUID();
  await q('INSERT INTO kyc_documents (id,userId,type,status,s3Bucket,s3Key,mimeType,sizeBytes,sha256,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))', [
    ownerDocumentId, ADMIN_ID, 'NATIONAL_ID', 'PENDING', 'kyc-test', `kyc/${ADMIN_ID}/owner-test.jpg`, 'image/jpeg', 64, createHash('sha256').update('owner-kyc-test').digest('hex'),
  ]);
  res = await admin.patch(`/api/admin/kyc/${ownerDocumentId}`, { decision: 'APPROVE' });
  check('Admin normal no puede autoaprobar su KYC', res.status === 403 && res.body?.error?.code === 'SELF_REVIEW_FORBIDDEN', res.body);
  const carlaId = (await one('SELECT id FROM users WHERE email = ?', ['carla@test.com'])).id;
  res = await admin.patch(`/api/admin/users/${carlaId}/role`, { role: 'SUPERVISOR' });
  check('Admin normal no puede asignar roles', res.status === 403, res.body);

  await q("UPDATE users SET role = 'ADMIN_ONE' WHERE id = ?", [ADMIN_ID]);
  res = await admin.get('/api/admin/metrics');
  check('Admin One conserva acceso con token emitido antes del cambio de rol', res.status === 200, res.body);
  res = await admin.patch(`/api/admin/kyc/${ownerDocumentId}`, { decision: 'APPROVE' });
  const ownerReview = await one('SELECT status,reviewedById FROM kyc_documents WHERE id = ?', [ownerDocumentId]);
  const ownerAudit = await one("SELECT actorId FROM audit_logs WHERE action = 'KYC_APPROVED' AND entityId = ?", [ownerDocumentId]);
  check('Admin One puede autoaprobar su documento con auditoría', res.status === 200 && ownerReview.status === 'APPROVED' && ownerReview.reviewedById === ADMIN_ID && ownerAudit?.actorId === ADMIN_ID, res.body);
  res = await admin.patch(`/api/admin/users/${ADMIN_ID}/role`, { role: 'USER' });
  check('Admin One no puede cambiar su propio rol', res.status === 403 && res.body?.error?.code === 'OWNER_ROLE_PROTECTED', res.body);
  res = await admin.patch(`/api/admin/users/${carlaId}/role`, { role: 'ADMIN_ONE' });
  check('La API no permite delegar ADMIN_ONE', res.status === 422, res.body);
  res = await admin.patch(`/api/admin/users/${carlaId}/role`, { role: 'SUPERVISOR' });
  check('Admin One puede asignar el rol de supervisor', res.status === 204, res.body);
  res = await carla.post('/api/auth/refresh');
  check('Cambiar roles revoca sesiones de renovación anteriores', res.status === 401, res.body);
  res = await carla.post('/api/auth/login', { email: 'carla@test.com', password: 'Segura2026', ...human('login') });
  check('Supervisor inicia sesión con su rol actualizado', res.status === 200 && res.body?.data?.user?.role === 'SUPERVISOR', res.body);
  res = await carla.get('/api/admin/kyc?status=APPROVED');
  check('Supervisor puede consultar KYC', res.status === 200, res.body);
  res = await carla.get('/api/admin/reports?status=OPEN');
  check('Supervisor puede consultar moderación', res.status === 200, res.body);
  res = await carla.get('/api/admin/metrics');
  check('Supervisor no puede acceder a métricas administrativas', res.status === 403, res.body);
  res = await carla.get('/api/admin/users');
  check('Supervisor no puede gestionar usuarios', res.status === 403, res.body);
  res = await admin.patch(`/api/admin/users/${carlaId}/role`, { role: 'USER' });
  check('Admin One puede retirar el rol de supervisor', res.status === 204, res.body);

  // ─────────────────────────────────────────── Ajustes del panel (fase 1) ──
  section('Panel: cobro Binance solo del administrador principal · planes completos · marcas · redes · exportaciones');
  await q("UPDATE users SET role = 'ADMIN' WHERE id = ?", [carlaId]);
  res = await carla.post('/api/auth/login', { email: 'carla@test.com', password: 'Segura2026', ...human('login') });
  check('Segundo administrador (ADMIN) inicia sesión', res.status === 200 && res.body?.data?.user?.role === 'ADMIN', res.body);

  res = await admin.get('/api/admin/settings');
  check('Cobro: sin Pay ID en el panel se usa el del .env', res.status === 200 && res.body?.data?.binance?.source === 'ENV' && res.body?.data?.binance?.payId === BINANCE.payId && res.body?.data?.binance?.canEdit === true, res.body?.data?.binance);
  res = await carla.get('/api/admin/settings');
  check('Un ADMIN ve la cuenta de cobro pero no puede editarla', res.status === 200 && res.body?.data?.binance?.canEdit === false && res.body?.data?.binance?.payId === BINANCE.payId, res.body?.data?.binance);
  res = await carla.put('/api/admin/settings/binance', { payId: '999888777', payName: 'Otra cuenta', confirm: true });
  check('Un ADMIN no puede cambiar el Pay ID → 403', res.status === 403, res.body);
  res = await beto.put('/api/admin/settings/binance', { payId: '999888777', payName: 'Otra cuenta', confirm: true });
  check('Un usuario no puede cambiar el Pay ID → 403', res.status === 403, res.body);
  res = await admin.put('/api/admin/settings/binance', { payId: '12ab', payName: 'AutoMarket', confirm: true });
  check('Pay ID con letras → 422', res.status === 422, res.body);
  res = await admin.put('/api/admin/settings/binance', { payId: '555666777', payName: 'AutoMarket 3D C.A.' });
  check('Sin confirmación explícita → 422', res.status === 422, res.body);
  check('La base rechaza un Pay ID que no son cifras (CHECK)', await q("UPDATE platform_settings SET binancePayId = '12ab' WHERE id = 1").then(() => false, err => /platform_settings_binance_pay_id_digits/.test(err.message)));

  res = await ana.post('/api/memberships/checkout', { planCode: 'PREMIUM', cycle: 'MONTHLY', method: 'MANUAL' });
  const payBeforeChange = res.body?.data;
  check('Pago manual creado con la cuenta vigente', res.status === 201 && payBeforeChange?.manual?.payId === BINANCE.payId && (await one('SELECT payeePayId FROM payments WHERE id = ?', [payBeforeChange.id])).payeePayId === BINANCE.payId, res.body);
  res = await admin.put('/api/admin/settings/binance', { payId: '555666777', payName: 'AutoMarket 3D C.A.', confirm: true });
  check('El administrador principal cambia la cuenta de cobro', res.status === 200 && res.body?.data?.binance?.source === 'PANEL' && res.body?.data?.binance?.payId === '555666777' && res.body?.data?.binance?.updatedBy === 'Admin' && res.body?.data?.binance?.openManualPayments >= 1, res.body?.data?.binance);
  res = await ana.get('/api/payments/methods');
  check('Usuarios ven la cuenta nueva al pagar', res.body?.data?.manual?.payId === '555666777' && res.body?.data?.manual?.payName === 'AutoMarket 3D C.A.', res.body);
  res = await ana.get(`/api/payments/${payBeforeChange.id}`);
  check('Un pago abierto conserva la cuenta con la que se creó', res.body?.data?.manual?.payId === BINANCE.payId, res.body?.data?.manual);
  res = await ana.post('/api/memberships/checkout', { planCode: 'PREMIUM', cycle: 'MONTHLY', method: 'MANUAL' });
  const payAfterChange = res.body?.data;
  check('Los pagos nuevos van a la cuenta nueva', res.status === 201 && payAfterChange?.manual?.payId === '555666777' && (await one('SELECT payeePayId, payeeName FROM payments WHERE id = ?', [payAfterChange.id])).payeePayId === '555666777', res.body);
  check('Cambio de cuenta auditado con antes y después', Boolean(await one("SELECT id FROM audit_logs WHERE action = 'BINANCE_PAYEE_UPDATED' AND actorId = ? AND JSON_EXTRACT(metadata, '$.after.payId') = '555666777' AND JSON_EXTRACT(metadata, '$.before.payId') = ?", [ADMIN_ID, BINANCE.payId])));
  check('Todos los administradores reciben el aviso del cambio', Number((await one("SELECT COUNT(*) AS n FROM notifications WHERE userId = ? AND type = 'BINANCE_PAYEE_UPDATED'", [carlaId])).n) === 1);
  for (const p of [payBeforeChange, payAfterChange]) await ana.post(`/api/payments/${p.id}/cancel`);

  const qr = fileBytes('image/png', 3000, 31);
  res = await carla.post('/api/admin/settings/binance/qr/upload', { mimeType: 'image/png', sizeBytes: qr.length });
  check('Un ADMIN no puede subir el QR de cobro → 403', res.status === 403, res.body);
  res = await admin.post('/api/admin/settings/binance/qr/upload', { mimeType: 'image/png', sizeBytes: qr.length });
  check('QR del Pay ID: URL prefirmada en binance-qr/', res.status === 200 && res.body?.data?.key?.startsWith('binance-qr/'), res.body);
  await fetch(res.body.data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: qr });
  res = await admin.put('/api/admin/settings/binance/qr', { key: res.body.data.key });
  check('QR guardado y visible en el pago', res.status === 200 && res.body?.data?.binance?.qrImageUrl?.startsWith('http://cdn.test/media/binance-qr/') && (await ana.get('/api/payments/methods')).body?.data?.manual?.qrImageUrl?.startsWith('http://cdn.test/media/binance-qr/'), res.body?.data?.binance);

  const darioUser = await one('SELECT id, planCode FROM users WHERE email = ? AND planExpiresAt > UTC_TIMESTAMP(3)', ['dario@test.com']);
  const darioPlan = darioUser.planCode;
  const planRow = await one('SELECT priceMonthly, priceYearly, commissionRate, searchBoost, featuredSlots, monthlyFeaturedCredits, listingDurationDays FROM plans WHERE code = ?', [darioPlan]);
  const planBody = { priceMonthly: Number(planRow.priceMonthly), priceYearly: Number(planRow.priceYearly), commissionRate: Number(planRow.commissionRate) };
  const newBoost = Number(planRow.searchBoost) === 4 ? 5 : 4;
  res = await admin.patch(`/api/admin/plans/${darioPlan}`, { ...planBody, searchBoost: 11 });
  check('Prioridad fuera de rango → 422', res.status === 422, res.body);
  res = await admin.patch(`/api/admin/plans/${darioPlan}`, { ...planBody, searchBoost: newBoost, featuredSlots: 6, monthlyFeaturedCredits: 3, listingDurationDays: 120 });
  check('Plan con todos sus beneficios editables', res.status === 200 && res.body?.data?.searchBoost === newBoost && res.body?.data?.featuredSlots === 6 && res.body?.data?.monthlyFeaturedCredits === 3 && res.body?.data?.listingDurationDays === 120, res.body);
  const darioBoost = await one('SELECT MIN(searchBoost) AS lo, MAX(searchBoost) AS hi, COUNT(*) AS n FROM vehicles WHERE sellerId = ? AND deletedAt IS NULL', [darioUser.id]);
  check('Los anuncios de quien tiene el plan toman la prioridad nueva al instante', Number(darioBoost.n) > 0 && Number(darioBoost.lo) === newBoost && Number(darioBoost.hi) === newBoost, darioBoost);
  check('Los anuncios de otros planes no cambian', Number((await one('SELECT MAX(searchBoost) AS hi FROM vehicles WHERE sellerId = ? AND deletedAt IS NULL', [anaId])).hi) === 0);
  res = await admin.patch(`/api/admin/plans/${darioPlan}`, { ...planBody, listingDurationDays: '' });
  check('Vacío = los anuncios del plan no vencen', res.status === 200 && res.body?.data?.listingDurationDays === null, res.body);
  res = await admin.patch(`/api/admin/plans/${darioPlan}`, { ...planBody, searchBoost: Number(planRow.searchBoost), featuredSlots: Number(planRow.featuredSlots), monthlyFeaturedCredits: Number(planRow.monthlyFeaturedCredits), listingDurationDays: planRow.listingDurationDays === null ? '' : Number(planRow.listingDurationDays) });
  check('Restaurar el plan devuelve la prioridad a sus anuncios', res.status === 200 && Number((await one('SELECT MAX(searchBoost) AS hi FROM vehicles WHERE sellerId = ? AND deletedAt IS NULL', [darioUser.id])).hi) === Number(planRow.searchBoost), res.body);

  res = await admin.get('/api/admin/settings/history');
  const history = res.body?.data ?? [];
  check('Historial de ajustes legible (plan y cuenta de cobro)', res.status === 200 && history.some(h => h.action === 'PLAN_UPDATED' && h.summary.includes(`prioridad en búsquedas: ${Number(planRow.searchBoost)} → ${newBoost}`)) && history.some(h => h.action === 'BINANCE_PAYEE_UPDATED' && /555666777/.test(h.summary) && h.actor?.name === 'Admin'), history.slice(0, 4));

  res = await client('10.0.0.90').get('/api/public/catalog/brands');
  check('Catálogo de marcas vacío en una base nueva (no se inventan marcas)', res.status === 200 && Array.isArray(res.body?.data) && res.body.data.length === 0, res.body);
  res = await admin.get('/api/admin/catalog/missing');
  const listingMakes = Number((await one("SELECT COUNT(DISTINCT LOWER(TRIM(make))) AS n FROM vehicles WHERE deletedAt IS NULL")).n);
  check('Panel lista las marcas de los anuncios que faltan en el catálogo', res.status === 200 && res.body?.data?.length === listingMakes && res.body.data.some(b => b.name === 'Toyota' && b.vehicles > 0 && b.models.includes('Corolla')), res.body?.data);
  res = await beto.post('/api/admin/catalog/brands', { name: 'Toyota' });
  check('Un usuario no puede agregar marcas → 403', res.status === 403, res.status);
  res = await admin.post('/api/admin/catalog/brands', { name: 'Toyota', models: ['Corolla', 'Hilux', 'corolla'] });
  const toyota = res.body?.data?.find(b => b.name === 'Toyota');
  const toyotaVehicles = Number((await one("SELECT COUNT(*) AS n FROM vehicles WHERE make = 'Toyota' AND deletedAt IS NULL")).n);
  check('Marca nueva con sus modelos (sin duplicados) y cuántos anuncios la usan', res.status === 201 && toyota?.models?.length === 2 && toyota?.vehicles === toyotaVehicles && toyotaVehicles > 0, toyota);
  res = await admin.post('/api/admin/catalog/brands', { name: 'toyota' });
  check('Marca repetida (sin distinguir mayúsculas) → 409', res.status === 409 && res.body?.error?.code === 'BRAND_EXISTS', res.body);
  await admin.post('/api/admin/catalog/brands', { name: 'Kia', models: ['Sportage'] });
  res = await dario.post('/api/vehicles', { ...kia, make: 'Lada', model: 'Niva' });
  check('Con catálogo, una marca que no está → 400 BRAND_NOT_IN_CATALOG', res.status === 400 && res.body?.error?.code === 'BRAND_NOT_IN_CATALOG', res.body);
  res = await dario.post('/api/vehicles', { ...kia, make: 'kia' });
  const kiaDraft = res.body?.data;
  check('La marca se guarda con su ortografía del catálogo', res.status === 201 && (await one('SELECT make FROM vehicles WHERE id = ?', [kiaDraft.id])).make === 'Kia', res.body);
  await dario.del(`/api/vehicles/${kiaDraft.id}`);
  res = await admin.post(`/api/admin/catalog/brands/${toyota.id}/models`, { names: ['Fortuner', 'Hilux'] });
  const toyotaModels = res.body?.data?.find(b => b.id === toyota.id)?.models ?? [];
  check('Agregar modelos a una marca existente', res.status === 201 && toyotaModels.length === 3 && toyotaModels.some(m => m.name === 'Fortuner'), toyotaModels);
  res = await admin.patch(`/api/admin/catalog/models/${toyotaModels.find(m => m.name === 'Hilux').id}`, { isActive: false });
  res = await admin.patch(`/api/admin/catalog/brands/${(res.body?.data ?? []).find(b => b.name === 'Kia').id}`, { isActive: false });
  res = await client('10.0.0.90').get('/api/public/catalog/brands');
  check('El formulario de publicar solo ve marcas y modelos activos', res.body?.data?.length === 1 && res.body.data[0].name === 'Toyota' && res.body.data[0].models.join(',') === 'Corolla,Fortuner', res.body?.data);
  res = await admin.post('/api/admin/catalog/import-from-listings');
  const afterImport = await admin.get('/api/admin/catalog/missing');
  check('Importar desde los anuncios agrega las marcas que faltaban (sin tocar las existentes)', res.status === 201 && afterImport.body?.data?.length === 0 && res.body?.data?.length === listingMakes && res.body.data.find(b => b.name === 'Kia')?.isActive === false && Boolean(await one("SELECT id FROM audit_logs WHERE action = 'BRANDS_IMPORTED'")), { missing: afterImport.body?.data, brands: res.body?.data?.map(b => b.name) });

  res = await admin.put('/api/admin/settings/social', { links: [{ network: 'INSTAGRAM', url: 'https://evil.example/instagram.com' }] });
  check('Enlace que no es de la red indicada → 422', res.status === 422, res.body);
  res = await admin.put('/api/admin/settings/social', { links: [{ network: 'INSTAGRAM', url: 'https://www.instagram.com/automarket3d' }, { network: 'WHATSAPP', url: 'https://wa.me/584145550187' }] });
  check('Redes sociales guardadas', res.status === 200 && res.body?.data?.socialLinks?.length === 2, res.body);
  res = await client('10.0.0.90').get('/api/public/settings');
  check('El login y la landing reciben las redes', res.body?.data?.socialLinks?.map(l => l.network).join(',') === 'INSTAGRAM,WHATSAPP', res.body);

  const { default: ExcelJS } = await import('exceljs');
  const sheetOf = async buffer => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer);
    return book.worksheets[0];
  };
  res = await admin.get('/api/admin/exports/sales?format=xlsx');
  const salesSheet = res.status === 200 ? await sheetOf(res.buffer) : null;
  const completedSales = Number((await one("SELECT (SELECT COUNT(*) FROM cart_reserves WHERE type = 'RESERVATION' AND status = 'COMPLETED') + (SELECT COUNT(*) FROM vehicle_sales WHERE status = 'COMPLETED') AS n")).n);
  const salesDataRows = salesSheet ? salesSheet.getRows(2, salesSheet.rowCount - 1).filter(r => r.getCell(1).value && r.getCell(1).value !== 'Total').length : -1;
  const totalRow = salesSheet?.getRow(salesSheet.rowCount);
  check('Excel de ventas: una fila por venta real + fila de totales con fórmula', salesDataRows === completedSales && completedSales > 0 && totalRow?.getCell(1).value === 'Total' && /SUBTOTAL\(9,H2:H/.test(totalRow?.getCell(8).value?.formula ?? ''), { salesDataRows, completedSales, total: totalRow?.values });
  res = await admin.get('/api/admin/exports/memberships?format=xlsx');
  const membershipSheet = res.status === 200 ? await sheetOf(res.buffer) : null;
  const paidPeriods = Number((await one("SELECT COUNT(*) AS n FROM membership_periods WHERE planCode <> 'FREE'")).n);
  check('Excel de compras de planes con datos reales', membershipSheet?.getRows(2, paidPeriods)?.filter(r => r.getCell(1).value).length === paidPeriods && paidPeriods > 0, paidPeriods);
  res = await admin.get('/api/admin/exports/dealers?format=pdf');
  check('PDF de concesionarios', res.status === 200 && res.buffer.subarray(0, 5).toString() === '%PDF-', res.status);
  res = await admin.get('/api/admin/exports/sales?format=pdf');
  check('PDF de ventas', res.status === 200 && res.buffer.subarray(0, 5).toString() === '%PDF-', res.status);
  await q("UPDATE users SET role = 'USER' WHERE id = ?", [carlaId]);

  // ─────────────────────────────────────────── Copiloto al publicar (datos reales) ──
  section('Publicar: Copiloto con anuncios reales · ficha típica · valor de mercado');
  const insightRows = [
    // [estado, año, km, precio, caja, categoría, combustible, tracción, puertas, plazas, borrado]
    ['PUBLISHED', 2020, 60000, 15000, 'AUTOMATIC', 'SEDAN', 'GASOLINE', 'FWD', 4, 5, false],
    ['SOLD', 2021, 50000, 16000, 'AUTOMATIC', 'SEDAN', 'GASOLINE', 'FWD', 4, 5, false],
    ['RESERVED', 2022, 40000, 18000, 'MANUAL', 'SEDAN', 'GASOLINE', 'FWD', 4, 5, false],
    ['PUBLISHED', 2015, 150000, 8000, 'AUTOMATIC', 'SUV', 'DIESEL', 'AWD', 5, 7, false],
    ['DRAFT', 2021, 50000, 99999, 'MANUAL', 'PICKUP', 'DIESEL', 'FOUR_WD', 2, 2, false],
    ['PUBLISHED', 2021, 50000, 500, 'MANUAL', 'PICKUP', 'DIESEL', 'FOUR_WD', 2, 2, true],
  ];
  const insightIds = [];
  for (const [index, [status, year, km, price, transmission, category, fuelType, drivetrain, doors, seats, deleted]] of insightRows.entries()) {
    const id = randomUUID();
    insightIds.push(id);
    await q(
      `INSERT INTO vehicles (id, sellerId, slug, make, model, year, \`condition\`, ownersCount, mileageKm, price, category, fuelType, transmission, drivetrain, doors, seats, city, country, status, deletedAt, createdAt, updatedAt)
       VALUES (?, ?, ?, 'Probecar', 'Insight', ?, 'USED', 1, ?, ?, ?, ?, ?, ?, ?, ?, 'Caracas', 'VE', ?, ?, UTC_TIMESTAMP(3) - INTERVAL ? SECOND, UTC_TIMESTAMP(3))`,
      [id, carlaId, `probecar-insight-${index}-${id.slice(0, 8)}`, year, km, price, category, fuelType, transmission, drivetrain, doors, seats, status, deleted ? new Date() : null, index],
    );
  }
  res = await client('10.0.0.87').get('/api/vehicles/insights?make=Probecar&model=Insight&year=2021');
  check('Copiloto sin sesión → 401', res.status === 401, res.body);
  res = await ana.get('/api/vehicles/insights?make=probecar&model=INSIGHT&year=2021&mileageKm=50000&transmission=AUTOMATIC');
  const insight = res.body?.data;
  check(
    'Ficha típica con los anuncios públicos (sin borradores ni borrados, sin distinguir mayúsculas)',
    res.status === 200 && insight?.typical?.sample === 4 && insight.typical.category === 'SEDAN' && insight.typical.fuelType === 'GASOLINE' && insight.typical.transmission === 'AUTOMATIC' && insight.typical.drivetrain === 'FWD' && insight.typical.doors === 4 && insight.typical.seats === 5,
    insight,
  );
  check(
    'Valor de mercado con 3 parecidos (±2 años, ajustado por año, km y caja)',
    insight?.comparables === 3 && insight?.market?.sample === 3 && insight.market.value === 16590 && insight.market.low === 15260 && insight.market.high === 17920,
    insight,
  );
  res = await ana.get(`/api/vehicles/insights?make=Probecar&model=Insight&year=2021&excludeId=${insightIds[1]}`);
  check('El anuncio que se edita no se compara consigo mismo', res.status === 200 && res.body?.data?.comparables === 2 && res.body?.data?.market?.sample === 2, res.body?.data);
  res = await ana.get('/api/vehicles/insights?make=Probecar&model=Insight&year=2016');
  check('Con un solo parecido no se inventa un precio', res.status === 200 && res.body?.data?.comparables === 1 && res.body?.data?.market === null && res.body?.data?.typical?.sample === 4, res.body?.data);
  res = await ana.get('/api/vehicles/insights?make=Nadie&model=Fantasma&year=2021');
  check('Modelo sin anuncios → sin ficha típica ni precio', res.status === 200 && res.body?.data?.typical === null && res.body?.data?.market === null && res.body?.data?.comparables === 0, res.body?.data);
  res = await ana.get('/api/vehicles/insights?make=Probecar');
  check('Copiloto sin modelo → 422', res.status === 422 || res.status === 400, res.status);
  // Catálogo: filtros nuevos (caja, km máximo, 3D, verificados) y precio tope en las opciones.
  const count = async query => (await client('10.0.0.89').get(`/api/vehicles?make=Probecar&${query}`)).body?.data?.total;
  check('Catálogo: solo anuncios visibles (3 de 6)', (await count('')) === 3);
  check('Catálogo: caja manual / automática', (await count('gearbox=MANUAL')) === 1 && (await count('gearbox=AUTOMATIC')) === 2);
  check('Catálogo: kilometraje máximo', (await count('mileageMax=60000')) === 2);
  check('Catálogo: solo con 3D (ninguno) y solo verificados (los 3)', (await count('has3d=true')) === 0 && (await count('verified=true')) === 3);
  res = await client('10.0.0.89').get('/api/vehicles/facets');
  check('Opciones del catálogo: precio más alto publicado', res.status === 200 && Number.isInteger(res.body?.data?.priceMax) && res.body.data.priceMax >= 18000, res.body?.data?.priceMax);
  // Buscador inteligente: frase libre → filtros, con faltas y sinónimos venezolanos.
  const smart = async text => (await client('10.0.0.91').get(`/api/vehicles/smart?${new URLSearchParams({ q: text, limit: '4' })}`)).body?.data;
  let sm = await smart('probecar insigth automatico');
  check('Buscador: corrige «insigth» y entiende modelo + caja', sm?.understood?.some(u => u.includes('«insigth» → Insight')) && sm.chips.includes('Probecar Insight') && sm.chips.includes('Automático') && sm.total === 2 && sm.results.every(r => r.transmission !== 'MANUAL'), sm);
  sm = await smart('probecar insight sincronico');
  check('Buscador: «sincrónico» filtra la caja manual', sm?.total === 1 && sm.catalog.gearbox === 'MANUAL' && sm.insight.startsWith('Un solo auto'), sm);
  sm = await smart('jeepeta hasta 22 lucas');
  check('Buscador: «jeepeta» = camioneta y «22 lucas» = $22.000', sm?.understood?.includes('«jeepeta» = camioneta') && sm.understood.includes('«22 lucas» = $22.000') && sm.chips.includes('Camioneta') && sm.chips.includes('Hasta $22.000') && sm.catalog.priceMax === '22000', sm);
  sm = await smart('probec');
  check('Buscador: autocompleta la marca con su cantidad', sm?.suggestions?.some(s => s.kind === 'Marca' && s.word === 'Probecar' && s.count === 3), sm?.suggestions);
  res = await client('10.0.0.91').get('/api/vehicles/smart/start');
  check('Buscador: «lo más publicado» sale del catálogo real', res.status === 200 && Array.isArray(res.body?.data?.popular) && res.body.data.popular.length > 0, res.body);
  const shownSlug = (await one('SELECT slug FROM vehicles WHERE id = ?', [insightIds[0]])).slug;
  res = await ana.get(`/api/vehicles/${shownSlug}`);
  check('Ficha: el vendedor trae calificaciones y autos vendidos reales', res.status === 200 && res.body?.data?.seller?.soldCount >= 1 && typeof res.body.data.seller.ratingCount === 'number', res.body?.data?.seller);
  // Copiloto del comprador: chat con reglas sobre los anuncios reales (sin sesión, sin IA).
  const copilotAsk = async (body, ip = '10.0.0.93') => (await client(ip).post('/api/vehicles/copilot', body)).body?.data;
  const textsOf = reply => (reply?.blocks ?? []).filter(b => b.type === 'text').map(b => b.text).join(' ');
  const published = Number((await one("SELECT COUNT(*) AS n FROM vehicles WHERE deletedAt IS NULL AND status = 'PUBLISHED'")).n);
  let cp = await copilotAsk({ action: 'start' });
  check('Copiloto: abre con el número real de autos publicados y el menú', textsOf(cp).includes(`**${published} ${published === 1 ? 'auto publicado' : 'autos publicados'}**`) && cp.chips.some(c => c.label === 'Ayúdame a elegir') && cp.viewing === null, cp);
  check('Copiloto: sin saludos de bot al abrir (apertura directa)', !/^(¡?hola|buen[oa]s|estoy aquí|¿en qué)/i.test(textsOf(cp)), textsOf(cp));
  const plansNow = (await client('10.0.0.93').get('/api/public/plans')).body?.data ?? [];
  cp = await copilotAsk({ text: 'cuanto cobran por publicar' });
  check('Copiloto: comisiones de los planes reales (y «cobran» no se toma como «obra»)', plansNow.length > 0 && plansNow.every(plan => textsOf(cp).includes(`con ${plan.name}`)) && cp.context.use === null, cp);
  const settingsNow = (await client('10.0.0.93').get('/api/public/settings')).body?.data;
  cp = await copilotAsk({ text: '¿Cómo funciona la reserva?' });
  check('Copiloto: la reserva con los plazos del panel', textsOf(cp).includes(`${settingsNow.sellerResponseHours} horas`) && textsOf(cp).includes(`${settingsNow.reservationHoldDays} días`), cp);
  const lastText = reply => (reply?.blocks ?? []).filter(b => b.type === 'text').at(-1)?.text ?? '';
  check('Copiloto: pasos numerados y un solo cierre en negrita que lleva a la primera opción', /\n1\. /.test(textsOf(cp)) && /\n\n\*\*[^*]+\*\*$/.test(lastText(cp)) && cp.chips[0]?.href === '/cuenta/verificacion', cp);
  cp = await copilotAsk({ text: 'no' });
  check('Copiloto: «no» cierra sin insistir (no cae en «no lo sé»)', !/no lo sé responder/.test(textsOf(cp)) && cp.chips.length > 0, cp);
  cp = await copilotAsk({ text: 'probecar insigth automatico' });
  const cpPicks = cp?.blocks?.find(b => b.type === 'picks')?.items ?? [];
  check('Copiloto: corrige la falta y muestra solo automáticos reales', textsOf(cp).includes('«insigth» como Insight') && cpPicks.length === 2 && cpPicks.every(item => item.vehicle.make === 'Probecar' && item.vehicle.transmission !== 'MANUAL') && cp.context.intent === 'search', cp);
  cp = await copilotAsk({ text: 'y sincronicos', context: cp.context });
  const cpManual = cp?.blocks?.find(b => b.type === 'picks')?.items ?? [];
  check('Copiloto: «¿y sincrónicos?» sigue con el mismo modelo y avisa que el único está reservado', textsOf(cp).includes('No hay sincrónicos con eso') && cpManual.length === 2 && cpManual.every(item => item.vehicle.make === 'Probecar'), cp);
  cp = await copilotAsk({ text: 'probecar insight automatico o sincronico' });
  const cpGear = cp?.blocks?.find(b => b.type === 'gearbox');
  check('Copiloto: mismo modelo separado por caja', cpGear?.groups?.length === 2 && cpGear.groups.reduce((n, g) => n + g.count, 0) === 3 && cpGear.rows[0]?.cheapest === true, cp);
  cp = await copilotAsk({ text: 'probecar insight 2021 en 25000' });
  const cpGauge = cp?.blocks?.find(b => b.type === 'gauge');
  check('Copiloto: ¿precio justo? con el mismo valor estimado de la ficha', cpGauge?.price === 25000 && cpGauge.tone === 'warn' && cpGauge.rows.some(r => r.label === 'Valor estimado') && cpGauge.band.low > 0, cp);
  cp = await copilotAsk({ text: 'vendo mi probecar insight 2021 con 50 mil km' });
  check('Copiloto: ¿a cuánto vendo? con enlace para publicar con ese precio', cp?.blocks?.some(b => b.type === 'gauge' && b.verdict === 'Precio recomendado') && cp.chips.some(c => c.href?.startsWith('/cuenta/anuncios/nuevo?') && c.href.includes('modelo=Insight')), cp);
  cp = await copilotAsk({ text: 'ayudame a elegir' });
  check('Copiloto: «Ayúdame a elegir» pregunta el presupuesto con cortes reales', cp?.context?.guide === 1 && cp.chips.length === 4, cp);
  cp = await copilotAsk({ text: 'hasta 30000', context: cp.context });
  cp = await copilotAsk({ text: 'familia', context: cp.context });
  cp = await copilotAsk({ text: 'reventa', context: cp.context });
  check('Copiloto: la guía termina en autos reales dentro del presupuesto', cp?.context?.guide === null && cp.context.use === 'family' && (cp.blocks.find(b => b.type === 'picks')?.items ?? []).every(item => Number(item.vehicle.price) <= 30000 * 1.15), cp);
  // Dudas de la app (sin IA): temas con las reglas reales, luego los Términos publicados y, si no, lo dice.
  cp = await copilotAsk({ text: 'olvidé mi contraseña' });
  check('Copiloto: «olvidé mi contraseña» explica la recuperación y enlaza /recuperar', /Olvidaste tu contraseña/.test(textsOf(cp)) && cp.chips.some(c => c.href === '/recuperar'), cp);
  cp = await copilotAsk({ text: 'quiero borrar mi cuenta' });
  check('Copiloto: borrar la cuenta → escribir al equipo (Contacto)', /escríbele al equipo/i.test(textsOf(cp)) && cp.chips.some(c => c.href === '/#contacto'), cp);
  cp = await copilotAsk({ text: '¿Cómo destaco mi auto?' });
  const boostPrices = await one('SELECT boostPriceCity3 AS p3, boostPriceHome AS ph FROM platform_settings WHERE id = 1');
  check('Copiloto: Destacar con los precios del panel', textsOf(cp).includes(`$${Number(boostPrices.p3)}`) && textsOf(cp).includes(`$${Number(boostPrices.ph)}`), cp);
  cp = await copilotAsk({ text: 'quiero que me avisen cuando salga un probecar insight' });
  check('Copiloto: «avísame cuando salga…» explica Mis alertas aunque nombre un modelo', /Nueva alerta/.test(textsOf(cp)) && cp.chips.some(c => c.href === '/alertas'), cp);
  // (A esta altura los Términos son los de prueba que guardó el panel: «# Términos de prueba · ## Reservas».)
  cp = await copilotAsk({ text: '¿dónde se paga directamente?' });
  check('Copiloto: sin tema propio busca en los Términos publicados y enlaza el documento', /«Reservas»/.test(textsOf(cp)) && /directamente al vendedor/.test(textsOf(cp)) && cp.chips.some(c => c.href === '/terminos#terminos-de-prueba'), cp);
  cp = await copilotAsk({ text: 'xyzzy plugh' });
  check('Copiloto: si no sabe, lo dice y ofrece escribir al equipo', /no lo sé responder/.test(textsOf(cp)) && cp.chips.some(c => c.href === '/#contacto'), cp);
  res = await client('10.0.0.93').post('/api/vehicles/copilot', { text: 'x'.repeat(300) });
  check('Copiloto: mensaje demasiado largo → error de validación', res.status === 422 || res.body?.error?.code === 'VALIDATION_ERROR', res.body);
  cp = await copilotAsk({ text: '¿Este auto tiene buen precio?', vehicleSlug: shownSlug });
  check('Copiloto: «Estás viendo…» compara la ficha abierta (sin contarla a ella)', cp?.viewing?.slug === shownSlug && cp.blocks.some(b => b.type === 'gauge' || b.type === 'text'), cp);
  await q(`DELETE FROM vehicles WHERE id IN (${insightIds.map(() => '?').join(',')})`, insightIds);

  section('Mis alertas · perfil público con estrellas · denuncias de perfiles');
  res = await ana.post('/api/alerts', { city: 'Caracas' });
  check('Alerta sin marca, modelo ni precio → 422 con el mensaje del diseño', res.status === 422 && JSON.stringify(res.body).includes('Escribe al menos la marca, el modelo o un precio máximo'), res.body);
  res = await ana.post('/api/alerts', { make: 'Alertcar', yearFrom: 1970 });
  check('Año fuera de rango → 422', res.status === 422, res.body);
  res = await ana.post('/api/alerts', { make: 'Alertcar', model: 'Uno', maxPrice: 20000, frequency: 'INSTANT' });
  const alert = res.body?.data;
  check('Alerta creada (activa, sin nuevos) con los filtros del catálogo', res.status === 201 && alert?.active === true && alert?.newCount === 0 && alert?.catalogQuery?.includes('make=Alertcar') && alert.catalogQuery.includes('priceMax=20000'), res.body);
  const anaCountry = (await one("SELECT country FROM users WHERE email = 'ana@test.com'")).country ?? 'VE';
  const alertCars = [];
  for (const [price, tag] of [[18000, 'ok'], [25000, 'caro']]) {
    const id = randomUUID();
    alertCars.push(id);
    await q(
      `INSERT INTO vehicles (id, sellerId, slug, make, model, year, \`condition\`, ownersCount, mileageKm, price, category, fuelType, transmission, city, country, status, publishedAt, createdAt, updatedAt)
       VALUES (?, ?, ?, 'Alertcar', 'Uno', 2022, 'USED', 1, 30000, ?, 'SEDAN', 'GASOLINE', 'AUTOMATIC', 'Caracas', ?, 'PUBLISHED', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [id, carlaId, `alertcar-uno-${tag}-${id.slice(0, 8)}`, price, anaCountry],
    );
  }
  const alertNotice = await waitFor(() => one("SELECT n.title, n.link FROM notifications n JOIN users u ON u.id = n.userId WHERE u.email = 'ana@test.com' AND n.type = 'SEARCH_ALERT' LIMIT 1"));
  check('Motor de alertas: aviso al instante del auto que cumple (con enlace a la ficha)', alertNotice?.title === 'Nuevo: Alertcar Uno 2022' && alertNotice.link.startsWith('/vehiculos/alertcar-uno-ok'), alertNotice);
  check('No avisa del que pasa el precio máximo', Number((await one("SELECT COUNT(*) AS n FROM notifications n JOIN users u ON u.id = n.userId WHERE u.email = 'ana@test.com' AND n.type = 'SEARCH_ALERT'")).n) === 1);
  res = await ana.get('/api/alerts');
  check('Mis alertas: 1 nuevo y el aviso en «Avisos recientes»', res.body?.data?.alerts?.find(a => a.id === alert.id)?.newCount === 1 && res.body.data.recent.some(n => n.type === 'SEARCH_ALERT' && n.title === 'Nuevo: Alertcar Uno 2022'), res.body?.data);
  res = await ana.post(`/api/alerts/${alert.id}/seen`);
  check('«Ver autos» deja vistos los nuevos', res.status === 204 && (await ana.get('/api/alerts')).body?.data?.alerts?.find(a => a.id === alert.id)?.newCount === 0);
  res = await ana.patch(`/api/alerts/${alert.id}`, { active: false });
  check('Pausar la alerta', res.status === 200 && res.body?.data?.active === false, res.body);
  res = await beto.del(`/api/alerts/${alert.id}`);
  check('Nadie más borra mi alerta → 404', res.status === 404, res.body);
  res = await ana.del(`/api/alerts/${alert.id}`);
  check('Borrar la alerta → 204', res.status === 204 && (await ana.get('/api/alerts')).body?.data?.alerts?.every(a => a.id !== alert.id), res.body);
  await q(`DELETE FROM vehicles WHERE id IN (${alertCars.map(() => '?').join(',')})`, alertCars);

  res = await client('10.0.0.70').get(`/api/users/${anaId}/profile`);
  check('Perfil público: estrellas por puntuación y autos vendidos con reserva', JSON.stringify(res.body?.data?.ratingDistribution) === '[1,0,0,0,0]' && res.body?.data?.soldCount >= 1, res.body?.data);
  res = await beto.post(`/api/users/${anaId}/report`, { reason: 'SPAM' });
  check('Denuncia de un perfil → 201', res.status === 201, res.body);
  res = await beto.post(`/api/users/${anaId}/report`, { reason: 'FRAUD' });
  check('Denuncia repetida del mismo perfil → 409', res.status === 409 && res.body?.error?.code === 'ALREADY_REPORTED', res.body);
  res = await ana.post(`/api/users/${anaId}/report`, { reason: 'SPAM' });
  check('No se denuncia el propio perfil → 400', res.status === 400, res.body);
  res = await admin.get('/api/admin/reports?status=OPEN');
  const userReport = res.body?.data?.items?.find(r => r.kind === 'USER');
  check('Moderación recibe la denuncia del perfil (sin anuncio)', userReport?.reportedUser?.id === anaId && userReport?.vehicle === null, userReport);
  res = await admin.patch(`/api/admin/reports/${userReport.id}`, { status: 'DISMISSED', archiveVehicle: true });
  check('Resolver una denuncia de perfil no toca anuncios', res.status === 204, res.body);

  section('Concesionarios aliados: directorio real · seguir · aviso al publicar');
  res = await client('10.0.0.71').get('/api/dealers');
  const darioEntry = res.body?.data?.find(d => d.id === darioId);
  check('Directorio: solo agencias con RIF aprobado, con inventario, ventas y marcas reales', res.status === 200 && darioEntry?.name === 'Autos Darío C.A.' && darioEntry.soldLast6Months >= 1 && darioEntry.brands.includes('Kia') && darioEntry.following === false && res.body.data.every(d => d.id !== anaId && d.id !== carlaId), darioEntry);
  res = await ana.put(`/api/dealers/${carlaId}/follow`);
  check('Seguir a quien no es aliado → 404', res.status === 404, res.body);
  res = await dario.put(`/api/dealers/${darioId}/follow`);
  check('La agencia no se sigue a sí misma → 400', res.status === 400, res.body);
  res = await ana.put(`/api/dealers/${darioId}/follow`);
  check('Seguir a un aliado', res.status === 200 && res.body?.data?.following === true, res.body);
  res = await ana.put(`/api/dealers/${darioId}/follow`);
  check('Seguir dos veces no duplica', res.status === 200 && Number((await one('SELECT COUNT(*) AS n FROM dealer_follows WHERE dealerId = ?', [darioId])).n) === 1);
  res = await ana.get('/api/dealers');
  check('Con sesión: «Siguiendo»', res.body?.data?.find(d => d.id === darioId)?.following === true, res.body?.data);
  const kia2Status = (await one('SELECT status FROM vehicles WHERE id = ?', [kia2.id])).status;
  if (kia2Status === 'PUBLISHED') await dario.post(`/api/vehicles/${kia2.id}/pause`);
  res = await dario.post(`/api/vehicles/${kia2.id}/publish`);
  const followNotice = await waitFor(() => one("SELECT n.title, n.body, n.link FROM notifications n JOIN users u ON u.id = n.userId WHERE u.email = 'ana@test.com' AND n.type = 'DEALER_NEW_LISTING' LIMIT 1"));
  check('Al publicar, quien la sigue recibe el aviso con enlace a la ficha', res.status === 200 && followNotice?.title === 'Autos Darío C.A. publicó un auto' && followNotice.link === `/vehiculos/${kia2.slug}`, { publish: res.body, followNotice });
  await dario.post(`/api/vehicles/${kia2.id}/pause`);
  await dario.post(`/api/vehicles/${kia2.id}/publish`);
  await new Promise(resolve => setTimeout(resolve, 300));
  check('Pausar y volver a publicar no repite el aviso', Number((await one("SELECT COUNT(*) AS n FROM notifications n JOIN users u ON u.id = n.userId WHERE u.email = 'ana@test.com' AND n.type = 'DEALER_NEW_LISTING'")).n) === 1);
  res = await ana.get('/api/alerts');
  check('El aviso sale en «Avisos recientes» de Mis alertas', res.body?.data?.recent?.some(n => n.type === 'DEALER_NEW_LISTING'), res.body?.data?.recent);
  res = await ana.del(`/api/dealers/${darioId}/follow`);
  check('Dejar de seguir', res.status === 200 && res.body?.data?.following === false && Number((await one('SELECT COUNT(*) AS n FROM dealer_follows WHERE dealerId = ?', [darioId])).n) === 0, res.body);
  section('Panel del concesionario: vistas reales por día, contactos e inventario');
  const viewsOf = async () => Number((await one('SELECT COALESCE(SUM(views), 0) AS n FROM vehicle_view_days WHERE vehicleId = ?', [kia2.id])).n);
  const viewsBefore = await viewsOf();
  await ana.get(`/api/vehicles/${kia2.slug}`);
  await ana.get(`/api/vehicles/${kia2.slug}`);
  await dario.get(`/api/vehicles/${kia2.slug}`);
  const viewsAfter = await waitFor(async () => ((await viewsOf()) > viewsBefore ? viewsOf() : null));
  await sleep(300);
  check('La ficha cuenta una vista por persona y día; el dueño no cuenta', viewsAfter === viewsBefore + 1 && (await viewsOf()) === viewsBefore + 1, { viewsBefore, now: await viewsOf() });
  res = await dario.get('/api/dealers/me/dashboard');
  const panel = res.body?.data;
  const kiaRow = panel?.inventory?.find(item => item.id === kia2.id);
  check('Panel: indicadores, 14 días e inventario con vistas y contactos reales', res.status === 200 && panel.series.length === 14 && panel.series.at(-1).views >= 1 && panel.kpis.views7 >= 1 && kiaRow?.views >= 1 && typeof kiaRow.contacts === 'number' && panel.dealer.name === 'Autos Darío C.A.', { kpis: panel?.kpis, kiaRow });
  check('Panel: plan con destacados y comisión real del plan', typeof panel?.plan?.featuredSlots === 'number' && typeof panel.dealer.commissionRate === 'number' && Array.isArray(panel.tips), panel?.plan);
  res = await ana.get('/api/dealers/me/dashboard');
  check('Panel solo para cuentas de concesionario → 403', res.status === 403 && res.body?.error?.code === 'DEALER_ONLY', res.body);
  res = await dario.patch('/api/auth/me', { businessHours: 'Lun a vie 8:00–18:00 · Sáb 8:00–13:00' });
  check('El concesionario guarda su horario de atención', res.status === 200 && res.body?.data?.businessHours === 'Lun a vie 8:00–18:00 · Sáb 8:00–13:00', res.body?.data?.businessHours);
  res = await client('10.0.0.88').get(`/api/dealers/${darioId}/page`);
  const dealerPage = res.body?.data;
  check('Página pública del concesionario: datos, cifras reales e inventario', res.status === 200 && dealerPage?.name === 'Autos Darío C.A.' && dealerPage.initials === 'AD' && dealerPage.hours === 'Lun a vie 8:00–18:00 · Sáb 8:00–13:00' && typeof dealerPage.activeListings === 'number' && dealerPage.vehicles.length === dealerPage.activeListings && typeof dealerPage.soldCount === 'number' && dealerPage.following === false && dealerPage.isOwner === false, dealerPage && { ...dealerPage, vehicles: dealerPage.vehicles.length });
  const fiscalOnDetail = (await client('10.0.0.88').get(`/api/vehicles/${kia2.slug}`)).body?.data?.seller?.dealer;
  check('RIF y dirección fiscal en la página siguen la misma regla que la ficha (plan de concesionario)', dealerPage?.taxId === (fiscalOnDetail?.taxId ?? null) && dealerPage?.address === (fiscalOnDetail?.fiscalAddress ?? null), { page: { taxId: dealerPage?.taxId, address: dealerPage?.address }, fiscalOnDetail });
  res = await dario.get(`/api/dealers/${darioId}/page`);
  check('La agencia ve su propia página como dueña', res.status === 200 && res.body?.data?.isOwner === true, res.body?.data?.isOwner);
  res = await client('10.0.0.88').get(`/api/dealers/${anaId}/page`);
  check('Una cuenta particular no tiene página de concesionario → 404', res.status === 404 && res.body?.error?.code === 'DEALER_NOT_FOUND', res.body);
  // Copiloto para agencias: resumen real del costado y preguntas con reglas (sin IA).
  res = await dario.get('/api/dealers/me/copilot');
  const dcp = res.body?.data;
  check('Copiloto de agencia: inventario con vistas, cifras del país y lo último del mercado', res.status === 200 && dcp?.dealer?.name === 'Autos Darío C.A.' && dcp.inventory.some(i => i.id === kia2.id && i.views >= 1) && Number.isInteger(dcp.counts.listings) && Number.isInteger(dcp.counts.sales) && Array.isArray(dcp.feed), dcp);
  res = await dario.get(`/api/dealers/me/copilot?vehicleId=${kia2.id}`);
  const dsug = res.body?.data?.suggestion;
  check('Precio sugerido del auto elegido (redondeado a $100, confianza 30–95 %)', res.status === 200 && (dsug === null || (dsug.vehicleId === kia2.id && dsug.price % 100 === 0 && dsug.confidence >= 30 && dsug.confidence <= 95 && ['alta', 'media', 'baja'].includes(dsug.level))), dsug);
  res = await ana.get('/api/dealers/me/copilot');
  check('Copiloto de agencia solo para concesionarios → 403', res.status === 403 && res.body?.error?.code === 'DEALER_ONLY', res.body);
  const dask = async text => (await dario.post('/api/dealers/me/copilot', text ? { text } : { action: 'start' })).body?.data;
  let dr = await dask('');
  check('Copiloto de agencia: abre con el nombre y su inventario, sin saludo, y preguntas con sus autos', dr?.blocks?.[0]?.text?.startsWith('Autos Darío C.A tiene') && dr.chips.length >= 2, dr);
  const kiaModel = (await one('SELECT model FROM vehicles WHERE id = ?', [kia2.id])).model;
  dr = await dask(`escribeme la descripcion del ${kiaModel}`);
  check('Descripción solo con los datos del anuncio (sin inventar mantenimiento)', dr?.blocks?.some(b => b.type === 'quote' && b.text.includes(kiaModel) && !/facturas|mantenimiento al día/i.test(b.text)) && dr.vehicleId !== null, dr);
  dr = await dask('que autos me conviene traer');
  check('Qué traer: demanda con vistas y contactos reales (o aviso si no hay datos)', dr?.blocks?.some(b => b.type === 'demand' && b.rows.every(r => Number.isInteger(r.views) && Number.isInteger(r.contacts))) || dr?.blocks?.[0]?.text?.includes('Todavía no hay vistas'), dr);
  dr = await dask('como le respondo');
  check('Responder: tres respuestas para una conversación real (o aviso si no hay)', dr?.blocks?.some(b => b.type === 'replies' && b.items.length === 3 && b.conversationId) || dr?.blocks?.[0]?.text?.includes('Todavía no tienes conversaciones'), dr);
  dr = await dask('que aprendes');
  check('Qué aprende: dice que no usa IA y da cifras reales', dr?.blocks?.[0]?.text?.includes('No uso inteligencia artificial') && /\d+ anuncios? activos?/.test(dr.blocks[0].text), dr);
  if (kia2Status !== 'PUBLISHED') await dario.post(`/api/vehicles/${kia2.id}/pause`);

  section('Reportes: casos agrupados, KPIs, chat denunciado y decisiones (advertir, descartar)');
  res = await ana.post(`/api/vehicles/${kia2.id}/report`, { reason: 'FRAUD', details: 'Pide pagar el abono a otra cuenta.' });
  check('Primera denuncia del anuncio', res.status === 201 || res.status === 204 || res.status === 200, res.body);
  res = await carla.post(`/api/vehicles/${kia2.id}/report`, { reason: 'WRONG_INFO', details: 'El kilometraje no cuadra.' });
  res = await admin.get('/api/admin/reports/board?status=OPEN');
  const kiaCase = res.body?.data?.items?.find(item => item.vehicle?.id === kia2.id);
  check('Bandeja: un caso por anuncio con las 2 denuncias, el motivo más grave y la persona denunciada', res.status === 200 && kiaCase?.count === 2 && kiaCase.reason === 'FRAUD' && kiaCase.reporter.name === 'Varias personas' && kiaCase.reported?.name === 'Autos Darío C.A.' && kiaCase.reported.dealer === true && /^RP-[0-9A-F]{5}$/.test(kiaCase.code) && kiaCase.suggestion.length > 10, kiaCase);
  check('KPIs reales: abiertos y posible fraude', res.body?.data?.kpis?.open >= 1 && res.body.data.kpis.fraud >= 1 && res.body.data.counts.OPEN === res.body.data.kpis.open, res.body?.data?.kpis);
  check('Los de fraude van primero', res.body?.data?.items?.[0]?.reason === 'FRAUD', res.body?.data?.items?.map(i => i.reason));
  res = await beto.get('/api/admin/reports/board');
  check('La bandeja es solo para el equipo → 403', res.status === 403, res.status);
  res = await admin.post(`/api/admin/reports/${kiaCase.id}/decision`, { action: 'WARN', note: 'Primera vez, se le avisa.' });
  check('Advertir: resuelve el caso entero y avisa a la persona', res.status === 200 && res.body?.data?.status === 'RESOLVED' && res.body.data.reports === 2 && Boolean(await one("SELECT 1 AS ok FROM notifications WHERE userId = ? AND type = 'ACCOUNT_WARNING'", [darioId])), res.body);
  res = await admin.get('/api/admin/reports/board?status=RESOLVED');
  const kiaClosed = res.body?.data?.items?.find(item => item.vehicle?.id === kia2.id);
  check('Resueltos: el caso con su resultado y la nota del registro', Boolean(kiaClosed?.resolution?.note) && res.body.data.kpis.resolvedThisWeek >= 1, kiaClosed?.resolution);
  res = await admin.post(`/api/admin/reports/${kiaCase.id}/decision`, { action: 'DISMISS' });
  check('Un caso cerrado no se decide otra vez → 409', res.status === 409, res.body);
  const chatCase = await one("SELECT id FROM reports WHERE kind = 'CHAT' LIMIT 1");
  if (chatCase) {
    res = await admin.get(`/api/admin/reports/${chatCase.id}/chat`);
    check('Chat denunciado: solo ese hilo, con quién escribió y lo marcado (queda en auditoría)', res.status === 200 && Array.isArray(res.body?.data?.messages) && Boolean(await one("SELECT 1 AS ok FROM audit_logs WHERE action = 'REPORT_CHAT_VIEWED' AND entityId = ?", [chatCase.id])), res.body);
  }

  section('Destacar: impulsos pagados con Binance · cupos por zona · pantalla de entrada por orden de llegada');
  const caracasDay = (offset = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offset * 86_400_000));
  const boostCars = [];
  const insertCar = async (sellerId, tag, city = 'Boostville', category = 'SUV') => {
    const id = randomUUID();
    await q(
      `INSERT INTO vehicles (id, sellerId, slug, make, model, year, \`condition\`, ownersCount, mileageKm, price, category, fuelType, transmission, city, country, status, publishedAt, createdAt, updatedAt)
       VALUES (?, ?, ?, 'Boostcar', ?, 2021, 'USED', 1, 40000, 21000, ?, 'GASOLINE', 'AUTOMATIC', ?, 'VE', 'PUBLISHED', UTC_TIMESTAMP(3) - INTERVAL 5 DAY, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [id, sellerId, `boostcar-${tag}-${id.slice(0, 8)}`, tag, category, city],
    );
    boostCars.push(id);
    return id;
  };
  const [b1, b2, b3, b4] = [await insertCar(darioId, 'Uno'), await insertCar(darioId, 'Dos'), await insertCar(darioId, 'Tres'), await insertCar(darioId, 'Cuatro', 'Boostville', 'SEDAN')];
  res = await beto.put('/api/admin/settings/boosts', { city3: 3, city7: 6, home: 15, login1: 3, login2: 6, login3: 8, citySlots: 2, homeSlots: 10, loginSlots: 6 });
  check('Precios y cupos de Destacar: solo el administrador → 403', res.status === 403, res.status);
  res = await admin.put('/api/admin/settings/boosts', { city3: 3, city7: 6, home: 15, login1: 3, login2: 6, login3: 8, citySlots: 2, homeSlots: 10, loginSlots: 6 });
  check('El panel fija precios y cupos (2 por zona para la prueba)', res.status === 200 && res.body?.data?.slots?.city === 2 && JSON.stringify(res.body.data.prices.login) === '["3.00","6.00","8.00"]', res.body);
  res = await dario.get('/api/boosts/options');
  const optB1 = res.body?.data?.listings?.find(l => l.id === b1);
  check('Paso 1: tus anuncios con su zona real («Camionetas en Boostville»), cupos y días publicados', res.status === 200 && optB1?.zone?.label === 'Camionetas en Boostville' && optB1.zone.total === 2 && optB1.zone.used === 0 && optB1.daysPublished === 5 && res.body.data.today === caracasDay() && res.body.data.limit.max === 4 && res.body.data.loginOccupancy.length === 60, { optB1, today: res.body?.data?.today });
  res = await dario.get(`/api/boosts/preview?vehicleId=${b1}`);
  check('Vista previa: puesto real en el catálogo de su ciudad', res.status === 200 && res.body?.data?.city === 'Boostville' && res.body.data.total === 4 && res.body.data.rows.some(r => r.mine), res.body?.data);
  res = await beto.post('/api/boosts', { vehicleId: b1, kind: 'CITY_7D', method: 'MANUAL' });
  check('Nadie destaca un anuncio ajeno → 404', res.status === 404, res.body);

  res = await dario.post('/api/boosts', { vehicleId: b1, kind: 'CITY_7D', method: 'MANUAL' });
  const weekBoost = res.body?.data;
  check('Orden de «Semana destacada»: 6 USDT al Pay ID oficial con la referencia', res.status === 201 && weekBoost?.payment?.purpose === 'BOOST' && weekBoost.payment.amount === '6.00' && Boolean(weekBoost.payment.manual?.payId) && weekBoost.boost.status === 'PENDING_PAYMENT' && weekBoost.payment.boost?.kind === 'CITY_7D', res.body);
  res = await dario.post(`/api/payments/${weekBoost.payment.id}/submit`, { txId: 'BOOSTTX000001' });
  check('«Ya pagué» con el ID de la transacción → en revisión', res.status === 200 && res.body?.data?.status === 'SUBMITTED', res.body);
  const waiting = await one('SELECT b.status, (v.featuredUntil IS NOT NULL AND v.featuredUntil > UTC_TIMESTAMP(3)) AS featured FROM boosts b JOIN vehicles v ON v.id = b.vehicleId WHERE b.id = ?', [weekBoost.boost.id]);
  check('Sin la confirmación del equipo no se destaca: impulso en espera y anuncio sin destacar', waiting?.status === 'PENDING_PAYMENT' && Number(waiting.featured) === 0, waiting);
  res = await dario.get('/api/boosts/options');
  check('Destacar y Mis anuncios marcan el pago en revisión', res.body?.data?.listings?.find(l => l.id === b1)?.pendingReview === true && !res.body.data.listings.find(l => l.id === b1)?.activeBoost, res.body?.data?.listings);
  res = await dario.post('/api/boosts', { vehicleId: b1, kind: 'CITY_3D', method: 'MANUAL' });
  check('Con un pago en revisión no se abre otro para el mismo anuncio → 409', res.status === 409 && res.body?.error?.code === 'PAYMENT_IN_REVIEW', res.body);
  res = await admin.post(`/api/admin/payments/${weekBoost.payment.id}/review`, { decision: 'APPROVE' });
  const weekRow = await one('SELECT b.status, TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(3), b.endsAt) AS mins, (v.featuredUntil = b.endsAt) AS same FROM boosts b JOIN vehicles v ON v.id = b.vehicleId WHERE b.id = ?', [weekBoost.boost.id]);
  check('El equipo confirma → destacado 7 días (featuredUntil del anuncio) y aviso al vendedor', res.status === 204 && weekRow?.status === 'ACTIVE' && Math.abs(Number(weekRow.mins) - 7 * 24 * 60) <= 2 && Number(weekRow.same) === 1 && Boolean(await one("SELECT 1 AS ok FROM notifications WHERE userId = ? AND type = 'BOOST_CONFIRMED' AND title = 'Tu anuncio ya está destacado'", [darioId])), weekRow);
  check('Ingreso registrado en el libro contable', Number((await one("SELECT COUNT(*) AS n FROM ledger_entries WHERE type = 'BOOST_REVENUE' AND paymentId = ?", [weekBoost.payment.id])).n) === 1);
  res = await dario.post('/api/boosts', { vehicleId: b1, kind: 'CITY_3D' });
  check('Un anuncio con impulso vigente no compra otro de zona → 409', res.status === 409 && res.body?.error?.code === 'ALREADY_BOOSTED', res.body);

  res = await dario.post('/api/boosts', { vehicleId: b2, kind: 'CITY_3D', method: 'MERCHANT' });
  const merchantBoost = res.body?.data;
  check('«Impulso» con Binance Pay: QR y enlace de la orden', res.status === 201 && merchantBoost?.payment?.amount === '3.00' && Boolean(merchantBoost.payment.merchant?.checkoutUrl), res.body);
  hook = await payMerchant(merchantBoost.payment.reference);
  check('Webhook de Binance Pay → impulso activo 3 días', hook.status === 200 && (await one('SELECT status FROM boosts WHERE id = ?', [merchantBoost.boost.id])).status === 'ACTIVE');
  res = await dario.post('/api/boosts', { vehicleId: b3, kind: 'CITY_3D' });
  check('Zona llena (2 de 2) → 409 con la fecha en que se abre', res.status === 409 && res.body?.error?.code === 'ZONE_FULL' && Boolean(res.body?.error?.details?.nextOpenAt), res.body);
  res = await dario.post('/api/boosts/waitlist', { vehicleId: b3, kind: 'CITY_3D' });
  check('«Anotarme en la lista» sin pagar', res.status === 201 && res.body?.data?.boost?.status === 'WAITLISTED' && Boolean(res.body.data.nextOpenAt), res.body);
  await q('UPDATE boosts SET endsAt = UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE WHERE id = ?', [merchantBoost.boost.id]);
  check('Job: el impulso vence y la lista de espera recibe el aviso del cupo libre', Boolean(await waitFor(async () => (await one('SELECT status FROM boosts WHERE id = ?', [merchantBoost.boost.id])).status === 'EXPIRED' && Boolean(await one("SELECT 1 AS ok FROM notifications WHERE userId = ? AND type = 'BOOST_SLOT_OPEN'", [darioId])))));

  // Pantalla de entrada: viene apagada (el login ya no muestra autos) y el panel la puede volver a vender.
  res = await dario.post('/api/boosts', { vehicleId: b1, kind: 'LOGIN', days: 2, method: 'MANUAL' });
  check('Pantalla de entrada sin vender → 409 NOT_ON_SALE (no se cobra por algo que no se ve)', res.status === 409 && res.body?.error?.code === 'NOT_ON_SALE', res.body);
  res = await dario.get('/api/boosts/options');
  check('Destacar sabe que no está a la venta', res.body?.data?.settings?.loginOnSale === false, res.body?.data?.settings);
  res = await admin.put('/api/admin/settings/boosts', { city3: 3, city7: 6, home: 15, login1: 3, login2: 6, login3: 8, citySlots: 2, homeSlots: 10, loginSlots: 6, loginOnSale: true });
  check('El panel la vuelve a poner a la venta', res.status === 200 && res.body?.data?.loginOnSale === true, res.body);
  // Pantalla de entrada: 6 cupos por día ocupados hoy por otros → el turno se corre a mañana.
  res = await dario.post('/api/boosts', { vehicleId: b1, kind: 'LOGIN', days: 2, method: 'MANUAL' });
  const loginBoost = res.body?.data;
  check('Pantalla de entrada 2 días → 6 USDT, propone empezar hoy', res.status === 201 && loginBoost?.payment?.amount === '6.00' && loginBoost.boost.wantDate === caracasDay(), res.body);
  const fillers = [];
  for (let n = 0; n < 6; n++) fillers.push(await insertCar(carlaId, `Relleno${n}`, 'Fillertown', 'SEDAN'));
  for (const [n, vid] of fillers.entries()) {
    await q(`INSERT INTO boosts (id, userId, vehicleId, kind, days, status, amount, paidAt, startDate, endDate, turn, createdAt, updatedAt)
             VALUES (?, ?, ?, 'LOGIN', 1, 'ACTIVE', 3, UTC_TIMESTAMP(3), ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, [randomUUID(), carlaId, vid, caracasDay(), caracasDay(), 900 + n]);
  }
  res = await client('10.0.0.72').get('/api/public/login-showcase');
  check('Carrusel de Entrar: los 6 turnos de hoy primero, por orden de llegada', res.status === 200 && res.body?.data?.length === 6 && res.body.data.every(item => item.source === 'LOGIN'), res.body?.data?.map(item => item.source));
  await dario.post(`/api/payments/${loginBoost.payment.id}/submit`, { txId: 'BOOSTTX000002' });
  res = await admin.post(`/api/admin/payments/${loginBoost.payment.id}/review`, { decision: 'APPROVE' });
  const loginRow = await one('SELECT status, turn, moved, DATE_FORMAT(startDate, "%Y-%m-%d") AS s, DATE_FORMAT(endDate, "%Y-%m-%d") AS e FROM boosts WHERE id = ?', [loginBoost.boost.id]);
  check('Al confirmar: hoy está lleno → turno corrido a mañana y pasado (programado, turno #906)', res.status === 204 && loginRow?.status === 'SCHEDULED' && loginRow.moved === 1 && loginRow.s === caracasDay(1) && loginRow.e === caracasDay(2) && loginRow.turn === 906, loginRow);
  res = await dario.get('/api/boosts/options');
  check('Descanso: el mismo anuncio vuelve desde el fin + 2 días', res.body?.data?.listings?.find(l => l.id === b1)?.login?.restFrom === caracasDay(4), res.body?.data?.listings?.find(l => l.id === b1)?.login);
  check('Ocupación real de hoy y mañana en el calendario', res.body?.data?.loginOccupancy?.[0]?.used === 6 && res.body.data.loginOccupancy[1].used === 1, res.body?.data?.loginOccupancy?.slice(0, 3));
  res = await admin.get('/api/admin/login-spots');
  const spot = res.body?.data?.items?.find(item => item.boostId === loginBoost.boost.id);
  check('Panel «Pantalla de entrada»: turno, fechas, «se corrió» y cobros', res.status === 200 && spot?.state === 'SCHEDULED' && spot.moved === true && spot.turn === 906 && res.body.data.days[0].used === 6 && Number(res.body.data.collected) >= 6, spot);
  res = await beto.get('/api/admin/login-spots');
  check('El panel de turnos es solo para el equipo → 403', res.status === 403, res.status);

  res = await dario.post('/api/boosts', { vehicleId: b4, kind: 'LOGIN', days: 1, method: 'MANUAL' });
  const rejectedBoost = res.body?.data;
  await dario.post(`/api/payments/${rejectedBoost.payment.id}/submit`, { txId: 'BOOSTTX000003' });
  res = await admin.post(`/api/admin/payments/${rejectedBoost.payment.id}/review`, { decision: 'REJECT', note: 'No llegó.' });
  check('Pago rechazado → el impulso no se compra', res.status === 204 && (await one('SELECT status FROM boosts WHERE id = ?', [rejectedBoost.boost.id])).status === 'CANCELLED');

  res = await dario.post('/api/boosts', { vehicleId: b4, kind: 'HOME', method: 'MERCHANT' });
  const homeBoost = res.body?.data;
  hook = await payMerchant(homeBoost.payment.reference);
  res = await client('10.0.0.73').get('/api/public/carousel');
  check('«Portada» pagada: primera en el carrusel del inicio', hook.status === 200 && res.body?.data?.[0]?.id === b4, res.body?.data?.slice(0, 2));

  await admin.put('/api/admin/settings/boosts', { city3: 3, city7: 6, home: 15, login1: 3, login2: 6, login3: 8, citySlots: 3, homeSlots: 10, loginSlots: 6, loginOnSale: false });
  await q(`DELETE FROM vehicles WHERE id IN (${boostCars.map(() => '?').join(',')})`, boostCars);

  section('Estadísticas del panel: series mensuales reales');
  res = await admin.get('/api/admin/stats');
  const stats = res.body?.data;
  const nowMonth = stats?.months?.at(-1);
  check('6 meses, el último en curso', res.status === 200 && stats.months.length === 6 && nowMonth?.current === true && stats.currentDays >= 1, stats?.months);
  check('Ingresos del mes desde el libro contable: planes, comisiones, Destacar y pantalla de entrada', stats.plans.months.at(-1).boosts + stats.plans.months.at(-1).login > 0 && stats.plans.months.at(-1).plans > 0 && Math.abs(stats.plans.months.at(-1).total - (stats.plans.months.at(-1).plans + stats.plans.months.at(-1).commissions + stats.plans.months.at(-1).boosts + stats.plans.months.at(-1).login)) < 0.01, stats.plans.months.at(-1));
  check('Ventas concretadas y reservas del mes', stats.sales.months.at(-1).count >= 1 && stats.purchases.months.at(-1).reservations >= 1, { sales: stats.sales.months.at(-1), purchases: stats.purchases.months.at(-1) });
  check('Inventario, cuentas y concesionarios con datos reales', stats.cars.inventory.published >= 1 && stats.users.months.at(-1).total >= 1 && stats.dealers.list.some(d => d.name === 'Autos Darío C.A.'), { inventory: stats.cars.inventory, dealers: stats.dealers.list.length });
  res = await beto.get('/api/admin/stats');
  check('Estadísticas solo para administradores → 403', res.status === 403, res.status);

  section('Copiloto del admin: datos reales para responder (solo lectura)');
  const ledgerBefore = Number((await one('SELECT COUNT(*) AS n FROM ledger_entries')).n);
  res = await admin.get('/api/admin/copilot');
  const cop = res.body?.data;
  check('Trae las mismas series de Estadísticas y un desglose por cada mes', res.status === 200 && cop.stats.months.length === 6 && cop.months.length === 6 && cop.stats.sales.months.at(-1).count === stats.sales.months.at(-1).count, cop && { months: cop.months.length });
  const monthSales = cop.months.at(-1).brands.reduce((sum, b) => sum + b.value, 0);
  check('Las marcas del mes suman las ventas del mes', monthSales === cop.stats.sales.months.at(-1).count, { monthSales, sales: cop.stats.sales.months.at(-1).count });
  const openCases = Number((await one("SELECT COUNT(DISTINCT CONCAT(kind, ':', COALESCE(vehicleId, conversationId, reportedUserId))) AS n FROM reports WHERE status = 'OPEN'")).n);
  check('Reportes abiertos agrupados por caso y por motivo', cop.reports.open === openCases && Object.values(cop.reports.byReason).reduce((a, b) => a + b, 0) === openCases, { cop: cop.reports.open, openCases });
  const submitted = await one("SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'SUBMITTED'");
  check('Pagos por verificar con su concepto', cop.payments.count === Number(submitted.n) && Math.abs(cop.payments.total - Number(submitted.total)) < 0.01 && cop.payments.items.every(i => i.concept && i.amount > 0), cop.payments);
  check('Precios reales de los planes, cupos de Portada y de la pantalla de entrada', cop.plans.length === 3 && cop.plans.every(p => p.monthly > 0) && cop.home.slots > 0 && cop.login.slots > 0 && /^\d{4}-\d{2}-\d{2}$/.test(cop.login.date), { plans: cop.plans, home: cop.home, login: cop.login });
  check('Nombre del administrador y hora de Venezuela para el saludo', cop.adminName.length > 0 && cop.localHour >= 0 && cop.localHour <= 23, { name: cop.adminName, hour: cop.localHour });
  check('Leer el Copiloto no escribe nada en el libro contable', Number((await one('SELECT COUNT(*) AS n FROM ledger_entries')).n) === ledgerBefore);
  res = await beto.get('/api/admin/copilot');
  check('Copiloto solo para administradores → 403', res.status === 403, res.status);

  section('Resumen del panel: periodo, calendario, actividad, buscador y contadores');
  res = await admin.get('/api/admin/metrics?months=1');
  const m1 = res.body?.data;
  const boostLedger = Number((await one("SELECT COALESCE(SUM(amount), 0) AS t FROM ledger_entries WHERE type = 'BOOST_REVENUE'")).t);
  check('Métricas con Destacar y periodo (este mes) que suma planes + comisiones + destacados', res.status === 200 && Math.abs(m1.totals.boosts - boostLedger) < 0.01 && m1.period.months === 1 && Math.abs(m1.period.revenue - (m1.period.membership + m1.period.commissions + m1.period.boosts)) < 0.01 && m1.monthly.length === 1 && typeof m1.period.previousRevenue === 'number', { totals: m1?.totals, period: m1?.period });
  const monthKey = stats.months.at(-1).key;
  res = await admin.get(`/api/admin/overview/calendar?month=${monthKey}`);
  const cal = res.body?.data;
  const expectedDays = (await q(
    "SELECT DISTINCT DAY(CONVERT_TZ(expiresAt, '+00:00', '-04:00')) AS d FROM cart_reserves WHERE type = 'RESERVATION' AND status = 'ACCEPTED' AND DATE_FORMAT(CONVERT_TZ(expiresAt, '+00:00', '-04:00'), '%Y-%m') = ? ORDER BY d",
    [monthKey],
  )).map(row => Number(row.d));
  check('Calendario: días reales en que vencen reservas confirmadas', res.status === 200 && cal.month === monthKey && JSON.stringify(cal.reservations) === JSON.stringify(expectedDays) && cal.commissions.every(d => d >= 1 && d <= 31), { cal, expectedDays });
  res = await admin.get('/api/admin/overview/calendar?month=2026-13');
  check('Calendario: mes inválido → 422', res.status === 422, res.status);
  res = await admin.get('/api/admin/overview/activity');
  const feed = res.body?.data ?? [];
  check('Actividad reciente: hasta 6 eventos reales, del más nuevo al más viejo', res.status === 200 && feed.length > 0 && feed.length <= 6 && feed.every((item, i) => item.who && item.what && (i === 0 || feed[i - 1].at >= item.at)), feed);
  res = await admin.get('/api/admin/search?q=dario');
  check('Buscador: encuentra personas, anuncios y pagos', res.status === 200 && res.body.data.users.some(u => u.name === 'Autos Darío C.A.') && Array.isArray(res.body.data.vehicles) && Array.isArray(res.body.data.payments), res.body?.data?.users);
  res = await admin.get('/api/admin/payments/counts');
  const payCounts = await one("SELECT SUM(status = 'SUBMITTED') AS review, SUM(status = 'REFUND_PENDING') AS refunds FROM payments");
  check('Pagos: contadores por verificar y reembolsos', res.status === 200 && res.body.data.review === Number(payCounts.review) && res.body.data.refunds === Number(payCounts.refunds), { api: res.body?.data, db: payCounts });
  res = await admin.get('/api/admin/payments?view=all');
  check('Pagos: la bandeja trae tipo de cuenta y si la identidad está verificada', res.status === 200 && res.body.data.every(p => typeof p.user.isVerified === 'boolean' && p.user.accountType) && res.body.data.filter(p => p.boost).every(p => p.boost.days >= 1), res.body?.data?.[0]?.user);
  res = await admin.get('/api/admin/kyc/counts');
  const kycCounts = await one("SELECT SUM(status = 'PENDING') AS p, SUM(status = 'APPROVED') AS a, SUM(status = 'REJECTED') AS r FROM kyc_documents");
  check('KYC: conteos por estado', res.status === 200 && res.body.data.PENDING === Number(kycCounts.p ?? 0) && res.body.data.APPROVED === Number(kycCounts.a ?? 0) && res.body.data.REJECTED === Number(kycCounts.r ?? 0), { api: res.body?.data, db: kycCounts });
  res = await admin.get('/api/admin/kyc?status=APPROVED&limit=50');
  const withCompanion = (res.body?.data ?? []).find(item => item.type === 'SELFIE' && item.companion);
  check('KYC: la selfie viene con el documento de la misma persona (enlace temporal) y datos del perfil', res.status === 200 && withCompanion && ['NATIONAL_ID', 'PASSPORT', 'DRIVER_LICENSE'].includes(withCompanion.companion.type) && withCompanion.companion.fileUrl.startsWith('http') && typeof withCompanion.duplicateElsewhere === 'boolean' && withCompanion.user.accountType, withCompanion);
  res = await beto.get('/api/admin/overview/activity');
  check('Resumen solo para administradores → 403', res.status === 403, res.status);

  // ───────────────────────────────────────────────── Contadores en tiempo real ──
  section('Landing: contadores reales y en vivo (Socket.io /public)');
  res = await client('10.0.0.86').get('/api/public/stats');
  const expectedUsers = Number((await one("SELECT COUNT(*) AS n FROM users WHERE deletedAt IS NULL AND status = 'ACTIVE'")).n);
  check('Contadores desde la base de datos', res.body?.data?.users === expectedUsers && typeof res.body?.data?.vehicles === 'number', res.body);
  const pub = ioClient(`${BASE}/public`, { transports: ['websocket'] });
  const firstStats = await new Promise(resolve => pub.once('stats', resolve));
  check('Socket /public sin sesión recibe los contadores al conectar', firstStats.users === expectedUsers, firstStats);
  const nextStats = new Promise(resolve => pub.once('stats', resolve));
  await register(client('10.0.0.87'), { name: 'Nuevo Usuario', email: 'nuevo@test.com', country: 'PE', city: 'Lima', ...human('register') });
  const pushed = await Promise.race([nextStats, sleep(4_000).then(() => null)]);
  check('Un registro nuevo se emite en vivo a la landing', pushed?.users === expectedUsers + 1, pushed);
  pub.disconnect();

  res = await admin.patch(`/api/admin/users/${anaId}/status`, { status: 'SUSPENDED' });
  res = await ana.post('/api/vehicles', corolla);
  check('Usuario suspendido no puede publicar → 403', res.status === 403 && res.body?.error?.code === 'ACCOUNT_SUSPENDED', res.body);
} catch (err) {
  check('Ejecución sin excepciones', false, `${err.stack}\n--- API ---\n${apiLog.slice(-3000)}`);
} finally {
  api.kill();
  await pool.end().catch(() => undefined);
  await stopDatabase().catch(err => console.error('No se pudo limpiar la base de pruebas:', err.message));
  for (const server of [binance.server, turnstile.server, s3.server, jwks]) server.close();
  smtp.server.close();
}

let failed = 0;
for (const [status, name, extra] of results) {
  if (status === '') console.log(`\n▸ ${name}`);
  else {
    if (status === 'FAIL') failed += 1;
    console.log(`  ${status === 'PASS' ? '✔' : '✘'} ${name}${status === 'FAIL' && extra ? `\n      ↳ ${extra}` : ''}`);
  }
}
const total = results.filter(([s]) => s !== '').length;
console.log(`\n${total - failed}/${total} comprobaciones OK`);
if (failed > 0) {
  console.log('\n--- Log de la API (final) ---\n' + apiLog.slice(-4000));
  process.exitCode = 1;
}
