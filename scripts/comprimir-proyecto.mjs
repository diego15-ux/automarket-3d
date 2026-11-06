// AutoMarket 3D · guarda el proyecto completo en un zip junto con la base de datos en .sql.
//
//   node scripts/comprimir-proyecto.mjs      (lo usa comprimir-proyecto.cmd)
//
// Deja en copias-del-proyecto/:
//   automarket-<base>-AAAA-MM-DD_HH-MM.sql   la base de datos completa (mysqldump de XAMPP)
//   automarket-3d-AAAA-MM-DD_HH-MM.zip       el proyecto, con ese .sql adentro (base-de-datos/)
//                                            y COMO-RESTAURAR.txt
// No entran: node_modules, compilaciones (.next, dist), .git, las fotos subidas (apps/api/.dev-s3),
// las copias viejas ni los archivos .env con claves (sí los .env.example).
// Lee DATABASE_URL de apps/api/.env sin mostrarla. Nada sale de esta computadora.
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'copias-del-proyecto');
const KEEP = 10;
const TOP = 'automarket-3d';

function fail(message) {
  console.log(`No se pudo guardar la copia: ${message}`);
  process.exit(1);
}

let archiver;
try {
  archiver = (await import('archiver')).default;
} catch {
  fail('falta una pieza para armar el zip. Corre «npm install» en la carpeta del proyecto y vuelve a intentar.');
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

// Carpetas que no se recorren (se rehacen con npm install / al compilar, o son copias y datos aparte).
const SKIP_ANYWHERE = new Set(['node_modules', '.next', 'dist', 'coverage', '.turbo', '.git']);
const SKIP_PATHS = new Set(['copias-del-proyecto', 'para-el-servidor', 'respaldos', 'scripts/parches-respaldo', 'apps/api/.dev-s3', 'apps/api/.dev-db', 'deploy/respaldos']);

/** Archivos con claves: .env y .env.* (menos .env.example). */
const isSecret = (name) => name === '.env' || (name.startsWith('.env.') && name !== '.env.example');
const isJunk = (name) => name.endsWith('.log') || name.endsWith('.tsbuildinfo');

function collect(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (entry.isSymbolicLink() || lstatSync(abs).isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (SKIP_ANYWHERE.has(entry.name) || SKIP_PATHS.has(rel)) continue;
      collect(abs, found);
    } else if (entry.isFile() && !isSecret(entry.name) && !isJunk(entry.name)) {
      found.push({ abs, rel });
    }
  }
  return found;
}

const keepNewest = (pattern) => {
  const files = readdirSync(OUT)
    .filter((name) => pattern.test(name))
    .map((name) => ({ name, time: statSync(path.join(OUT, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  for (const old of files.slice(KEEP)) unlinkSync(path.join(OUT, old.name));
};

const size = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

// 1. Base de datos en .sql
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
const sqlName = `automarket-${database.replace(/[^\w-]+/g, '_')}-${stamp}.sql`;
const sqlPath = path.join(OUT, sqlName);

const args = [
  `--host=${url.hostname || '127.0.0.1'}`,
  `--port=${url.port || '3306'}`,
  `--user=${decodeURIComponent(url.username || 'root')}`,
  '--single-transaction',
  '--routines',
  '--triggers',
  '--hex-blob',
  '--default-character-set=utf8mb4',
  '--databases',
  database,
];
// La clave va por MYSQL_PWD (no queda en la línea de comandos ni en la pantalla).
const env = { ...process.env, MYSQL_PWD: decodeURIComponent(url.password ?? '') };

console.log(`1/2  Copiando la base «${database}» a un archivo .sql…`);
const dump = spawn(dumpCommand(), args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
const sqlFile = createWriteStream(sqlPath);
let errors = '';
dump.stderr.on('data', (chunk) => (errors += chunk));
const sqlWritten = new Promise((resolve) => sqlFile.on('close', resolve));
const exited = new Promise((resolve) => {
  dump.on('error', () => resolve('missing'));
  dump.on('close', (code) => resolve(code));
});
dump.stdout.pipe(sqlFile);
const code = await exited;
if (code === 'missing') sqlFile.destroy();
await sqlWritten;
if (code !== 0) {
  if (existsSync(sqlPath)) unlinkSync(sqlPath);
  if (code === 'missing') fail('no encuentro mysqldump. ¿Está instalado XAMPP en C:\\xampp?');
  // El mensaje de mysqldump nunca trae la clave; se recorta por si es largo.
  fail(`mysqldump terminó con error (${code}). ${errors.trim().split(/\r?\n/).slice(-2).join(' ')} ¿Está encendido MySQL en XAMPP?`);
}
console.log(`     Listo: ${sqlName} (${size(statSync(sqlPath).size)}).`);

// 2. Zip del proyecto con el .sql adentro
const guide = [
  'AutoMarket 3D · cómo volver a usar esta copia',
  '',
  `Copia del ${stamp.replace('_', ' a las ').replace(/-(\d\d)$/, ':$1')}. Base de datos: ${database}.`,
  '',
  '1. Descomprime la carpeta automarket-3d donde quieras.',
  '2. Base de datos: en phpMyAdmin (XAMPP) usa «Importar» con base-de-datos/' + sqlName + '.',
  `   El archivo crea la base «${database}» si no existe y carga todas las tablas.`,
  '   (O en una consola: mysql -u root -p < base-de-datos/' + sqlName + ')',
  '3. Claves: copia apps/api/.env.example como apps/api/.env y apps/web/.env.example como',
  '   apps/web/.env.local, y pon tus valores. Los .env no vienen en el zip por seguridad.',
  '4. En la carpeta automarket-3d corre: npm install',
  '5. Luego: npm run db:generate -w @automarket/api',
  '6. Doble clic en AutoMarket.exe.',
  '',
  'No vienen las fotos subidas (apps/api/.dev-s3). Para llevarlas usa preparar-servidor.cmd,',
  'que arma fotos.tar.gz.',
  '',
].join('\r\n');

const files = collect(ROOT);
const zipName = `automarket-3d-${stamp}.zip`;
const zipPath = path.join(OUT, zipName);
console.log(`2/2  Armando ${zipName} con ${files.length} archivos del proyecto y la base…`);

const archive = archiver('zip', { zlib: { level: 9 } });
const zipFile = createWriteStream(zipPath);
const zipWritten = new Promise((resolve, reject) => {
  zipFile.on('close', resolve);
  archive.on('error', reject);
  zipFile.on('error', reject);
});
archive.on('warning', (err) => console.log(`     Aviso: ${err.message}`));
archive.pipe(zipFile);
for (const file of files) archive.file(file.abs, { name: `${TOP}/${file.rel}` });
archive.file(sqlPath, { name: `${TOP}/base-de-datos/${sqlName}` });
archive.append(guide, { name: `${TOP}/COMO-RESTAURAR.txt` });
try {
  await archive.finalize();
  await zipWritten;
} catch (err) {
  if (existsSync(zipPath)) unlinkSync(zipPath);
  fail(`no se pudo escribir el zip (${err instanceof Error ? err.message : err}).`);
}

keepNewest(/^automarket-3d-.+\.zip$/);
keepNewest(/^automarket-.+\.sql$/);
console.log(`     Listo: ${zipName} (${size(statSync(zipPath).size)}).`);
console.log('');
console.log(`Todo quedó en la carpeta copias-del-proyecto. Se guardan las últimas ${KEEP} copias.`);
console.log('El zip trae la base en base-de-datos/ y los pasos en COMO-RESTAURAR.txt.');
