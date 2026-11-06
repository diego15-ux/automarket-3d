// S3 local para desarrollo, sin Docker: implementa lo que usa la plataforma
// (PUT/GET/HEAD de objetos con URLs prefirmadas path-style, CORS y peticiones Range
// para reproducir audio y vídeo). NO valida firmas: solo para desarrollo.
//
//   npm run dev:s3   →   S3_ENDPOINT=http://localhost:9000 en apps/api/.env
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.DEV_S3_PORT ?? 9000);
const ROOT = path.resolve(process.env.DEV_S3_DIR ?? fileURLToPath(new URL('../.dev-s3', import.meta.url)));

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'ETag, Content-Length, Content-Range, Accept-Ranges',
};

http
  .createServer((req, res) => {
    // Path-style: /<bucket>/<clave>. La query string (firma) se ignora.
    const key = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname).replace(/^\/+/, '');
    const file = path.join(ROOT, key);
    if (!key || !file.startsWith(ROOT + path.sep)) return void res.writeHead(400, CORS).end();
    const metaFile = `${file}.__meta.json`;

    if (req.method === 'OPTIONS') return void res.writeHead(204, CORS).end();

    if (req.method === 'PUT') {
      mkdirSync(path.dirname(file), { recursive: true });
      const out = createWriteStream(file);
      out.on('finish', () => {
        writeFileSync(metaFile, JSON.stringify({ contentType: req.headers['content-type'] ?? 'application/octet-stream' }));
        res.writeHead(200, { ...CORS, ETag: '"dev"' }).end();
      });
      out.on('error', () => res.writeHead(500, CORS).end());
      return void req.pipe(out);
    }

    if (req.method === 'DELETE') {
      rmSync(file, { force: true });
      rmSync(metaFile, { force: true });
      return void res.writeHead(204, CORS).end();
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405, CORS).end();
    if (!existsSync(file) || !existsSync(metaFile)) return void res.writeHead(404, CORS).end();

    const { size, mtime } = statSync(file);
    const { contentType } = JSON.parse(readFileSync(metaFile, 'utf8'));
    const headers = { ...CORS, 'Content-Type': contentType, 'Accept-Ranges': 'bytes', ETag: '"dev"', 'Last-Modified': mtime.toUTCString() };

    // Range: los navegadores lo usan para reproducir y adelantar audio/vídeo.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && req.method === 'GET' && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) return void res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` }).end();
      res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}` });
      return void createReadStream(file, { start, end }).pipe(res);
    }

    res.writeHead(200, { ...headers, 'Content-Length': size });
    if (req.method === 'HEAD') return void res.end();
    createReadStream(file).pipe(res);
  })
  .listen(PORT, () => console.log(`🪣 S3 de desarrollo en http://localhost:${PORT} (datos en ${ROOT})`));
