// MySQL 8.4 de desarrollo SIN Docker (binarios oficiales de Oracle vía mysql-memory-server).
// Los datos son efímeros: se pierden al detener el proceso. Con Docker usa docker compose
// (volumen persistente) y las mismas migraciones.
//
//   npm run dev:db      →   en apps/api/.env:
//     DATABASE_URL=mysql://root@127.0.0.1:3307/automarket
//
// Al arrancar aplica las migraciones (prisma migrate deploy) y el seed.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDB } from 'mysql-memory-server';

const PORT = Number(process.env.DEV_DB_PORT ?? 3307);
const API_DIR = fileURLToPath(new URL('..', import.meta.url));

const db = await createDB({
  version: '8.4.x',
  port: PORT,
  dbName: 'automarket',
  username: 'root',
  logLevel: 'ERROR',
  downloadBinaryOnce: true,
});

const url = `mysql://root@127.0.0.1:${db.port}/automarket`;
const run = (command) => {
  const result = spawnSync(command, { cwd: API_DIR, stdio: 'inherit', shell: true, env: { ...process.env, DATABASE_URL: url } });
  if (result.status !== 0) throw new Error(`Falló: ${command}`);
};

run('npx prisma migrate deploy');
if (process.env.DEV_DB_SEED !== 'false') run('npx prisma db seed');

console.log(`\nMySQL ${db.mysql.version} listo → DATABASE_URL=${url}\n(Ctrl+C para detener)`);

const stop = async () => {
  await db.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
