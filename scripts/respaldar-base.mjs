// AutoMarket 3D · copia de seguridad de la base de datos (MySQL / MariaDB de XAMPP).
//
//   node scripts/respaldar-base.mjs                 copia ahora (lo usa respaldar-base.cmd)
//   node scripts/respaldar-base.mjs --si-hace-falta  solo si la última copia tiene más de 20 horas
//                                                    (lo usa AutoMarket al abrirse)
//
// Lee DATABASE_URL de apps/api/.env (no la muestra), corre mysqldump y guarda
// respaldos/automarket-<base>-AAAA-MM-DD_HH-MM.sql.gz. Se quedan las últimas 30 copias.
// Para volver a una copia: descomprimir el .sql.gz e importarlo en phpMyAdmin o con mysql.
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'respaldos');
const KEEP = 30;
const onlyIfStale = process.argv.includes('--si-hace-falta');
const STALE_MS = 20 * 60 * 60 * 1000;
const PATTERN = /^automarket-.+\.sql\.gz$/;

function fail(message) {
  console.log(`No se pudo hacer la copia: ${message}`);
  process.exit(1);
}

/** DATABASE_URL de apps/api/.env (o de AM_ENV_FILE). Solo esa línea; nada se imprime. */
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = process.env.AM_ENV_FILE ?? path.join(ROOT, 'apps', 'api', '.env');
  if (!existsSync(file)) fail('no encuentro apps/api/.env.');
  const line = readFileSync(file, 'utf8').split(/\r?\n/).find((l) => /^\s*DATABASE_URL\s*=/.test(l));
  if (!line) fail('apps/api/.env no tiene DATABASE_URL.');
  return line.replace(/^\s*DATABASE_URL\s*=\s*/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
}

/** mysqldump de XAMPP, o el que esté en el PATH. */
function dumpCommand() {
  const candidates = [process.env.AM_MYSQLDUMP, process.env.AUTOMARKET_XAMPP && path.join(process.env.AUTOMARKET_XAMPP, 'mysql', 'bin', 'mysqldump.exe')];
  for (const drive of ['C:', 'D:', 'E:']) candidates.push(`${drive}\\xampp\\mysql\\bin\\mysqldump.exe`);
  return candidates.find((c) => c && existsSync(c)) ?? (process.platform === 'win32' ? 'mysqldump' : 'mariadb-dump');
}

const backups = () =>
  existsSync(OUT)
    ? readdirSync(OUT)
        .filter((name) => PATTERN.test(name))
        .map((name) => ({ name, time: statSync(path.join(OUT, name)).mtimeMs }))
        .sort((a, b) => b.time - a.time)
    : [];

if (onlyIfStale) {
  const last = backups()[0];
  if (last && Date.now() - last.time < STALE_MS) process.exit(0);
}

let url;
try {
  url = new URL(databaseUrl());
} catch {
  fail('DATABASE_URL no tiene el formato mysql://usuario:clave@host:3306/base.');
}
const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
if (!database) fail('DATABASE_URL no dice el nombre de la base.');

mkdirSync(OUT, { recursive: true });
const stamp = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
const target = path.join(OUT, `automarket-${database.replace(/[^\w-]+/g, '_')}-${stamp}.sql.gz`);

const args = [
  `--host=${url.hostname || '127.0.0.1'}`,
  `--port=${url.port || '3306'}`,
  `--user=${decodeURIComponent(url.username || 'root')}`,
  '--single-transaction',
  '--routines',
  '--triggers',
  '--hex-blob',
  '--default-character-set=utf8mb4',
  database,
];
// La clave va por MYSQL_PWD (no queda en la línea de comandos ni en la pantalla).
const env = { ...process.env, MYSQL_PWD: decodeURIComponent(url.password ?? '') };

console.log(`Copiando la base «${database}»…`);
const dump = spawn(dumpCommand(), args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
const file = createWriteStream(target);
let errors = '';
dump.stderr.on('data', (chunk) => (errors += chunk));
const written = new Promise((resolve) => file.on('close', resolve));
const exited = new Promise((resolve) => {
  dump.on('error', () => resolve('missing'));
  dump.on('close', (code) => resolve(code));
});
dump.stdout.pipe(createGzip()).pipe(file);

const code = await exited;
if (code === 'missing') file.destroy();
await written;
if (code !== 0) {
  if (existsSync(target)) unlinkSync(target);
  if (code === 'missing') fail('no encuentro mysqldump. ¿Está instalado XAMPP en C:\\xampp?');
  // El mensaje de mysqldump nunca trae la clave; se recorta por si es largo.
  fail(`mysqldump terminó con error (${code}). ${errors.trim().split(/\r?\n/).slice(-2).join(' ')} ¿Está encendido MySQL en XAMPP?`);
}
const kb = Math.max(1, Math.round(statSync(target).size / 1024));
for (const old of backups().slice(KEEP)) unlinkSync(path.join(OUT, old.name));
console.log(`Listo: respaldos${path.sep}${path.basename(target)} (${kb} KB). Se guardan las últimas ${KEEP} copias.`);
