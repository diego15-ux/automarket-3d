// AutoMarket 3D · arranca en UNA sola ventana lo que hace falta para trabajar en local:
//   api → la API (puerto 4000) · web → la página (puerto 3000) · img → el almacén local de imágenes (puerto 9000)
// Ctrl + C (o cerrar la ventana) los detiene a los tres. MySQL (XAMPP) debe estar encendido.
//
// Por defecto la web corre en modo RÁPIDO (versión compilada, como en un servidor de verdad): las
// páginas abren en menos de un segundo. Solo se vuelve a compilar (1–3 min) cuando cambia el código.
// Con --desarrollo corre como antes (`next dev`: recarga al editar, pero cada página tarda en abrir).
//
//   npm run dev                       (modo rápido; también AutoMarket.exe)
//   npm run dev -- --desarrollo       (o doble clic en iniciar.cmd)
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'apps', 'web');
const developmentMode = process.argv.includes('--desarrollo') || process.env.AM_MODO === 'desarrollo';

const tag = (service) => `\x1b[${service.color}m[${service.name}]\x1b[0m`;
const children = [];
let stopping = false;
let browserOpened = process.env.AM_NO_BROWSER === '1';

/** Abre la página en el navegador una sola vez, cuando la web dice que está lista. */
function openBrowser() {
  if (browserOpened) return;
  browserOpened = true;
  const url = 'http://localhost:3000';
  const opener = process.platform === 'win32' ? `start "" ${url}` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
  spawn(opener, { shell: true, stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  console.log(`\nAutoMarket listo: ${url}\n`);
}

/** Arranca un programa con sus líneas marcadas [api] / [web] / [img]. */
function launch(service, { onExit } = {}) {
  const child = spawn(service.command, { cwd: ROOT, shell: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '1' } });
  children.push(child);
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => {
      console.log(`${tag(service)} ${line}`);
      if (service.name === 'web' && /Ready in/.test(line)) openBrowser();
    });
  }
  child.on('exit', (code) => {
    if (onExit) return onExit(code);
    if (!stopping) console.log(`${tag(service)} se detuvo (código ${code ?? 'sin código'}). Los otros siguen encendidos.`);
  });
  return child;
}

/** El archivo más nuevo dentro de una carpeta (sin node_modules ni .next). */
function newestIn(target) {
  if (!existsSync(target)) return 0;
  const stat = statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = 0;
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    newest = Math.max(newest, newestIn(path.join(target, entry.name)));
  }
  return newest;
}

/** Hace falta compilar si no hay compilación o si algo de la web cambió después de la última. */
function webNeedsBuild() {
  const buildId = path.join(WEB, '.next', 'BUILD_ID');
  if (!existsSync(buildId)) return true;
  const built = statSync(buildId).mtimeMs;
  const sources = ['src', 'public', 'next.config.ts', 'package.json', '.env', '.env.local', '.env.production', 'postcss.config.mjs', 'tsconfig.json'].map((name) => path.join(WEB, name));
  sources.push(path.join(ROOT, 'packages', 'contracts', 'dist'));
  return sources.some((source) => newestIn(source) > built);
}

const WEB_SERVICE = { name: 'web', color: 36 };

function startWebDevelopment() {
  launch({ ...WEB_SERVICE, command: 'npm run dev -w @automarket/web' });
}

function startWebFast() {
  launch({ ...WEB_SERVICE, command: 'npm run start -w @automarket/web -- --hostname 0.0.0.0' });
}

console.log(`AutoMarket 3D: arrancando la API, la web y las imágenes (modo ${developmentMode ? 'desarrollo' : 'rápido'}). Ctrl + C para detener todo.\n`);
launch({ name: 'api', color: 32, command: 'npm run dev -w @automarket/api' });
launch({ name: 'img', color: 35, command: 'npm run dev:s3 -w @automarket/api' });
// Copia de seguridad de la base: una al día, sin frenar el arranque (si falla, solo avisa).
launch({ name: 'copia', color: 33, command: 'node scripts/respaldar-base.mjs --si-hace-falta' }, { onExit: () => {} });

if (developmentMode) {
  startWebDevelopment();
} else if (!webNeedsBuild()) {
  startWebFast();
} else {
  console.log(`${tag(WEB_SERVICE)} Preparando la versión rápida de la página (1 a 3 minutos; solo pasa la primera vez o después de una actualización)…`);
  launch(
    { ...WEB_SERVICE, command: 'npm run build -w @automarket/web' },
    {
      onExit: (code) => {
        if (stopping) return;
        if (code === 0) {
          console.log(`${tag(WEB_SERVICE)} Versión rápida lista.`);
          startWebFast();
        } else {
          console.log(`${tag(WEB_SERVICE)} No se pudo preparar la versión rápida (mira los mensajes de arriba). Abro la página en modo desarrollo.`);
          startWebDevelopment();
        }
      },
    },
  );
}

/** Detiene solo los procesos que abrió este script (y sus hijos). */
function stopAll() {
  if (stopping) return;
  stopping = true;
  console.log('\nDeteniendo la API, la web y las imágenes…');
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue;
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(0), 1500);
}

process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
process.on('SIGHUP', stopAll);
