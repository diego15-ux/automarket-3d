/**
 * Configuración pública (se incrusta en el bundle del navegador en el build).
 * Las variables NEXT_PUBLIC_* deben leerse de forma literal para que Next las sustituya.
 */
export const publicEnv = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '',
  appleClientId: process.env.NEXT_PUBLIC_APPLE_CLIENT_ID ?? '',
  appleRedirectUri: process.env.NEXT_PUBLIC_APPLE_REDIRECT_URI ?? '',
  /** Cloudflare Turnstile (anti-bot). Clave de prueba que siempre pasa: 1x00000000000000000000AA */
  turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '',
};

const isLocalHost = (hostname: string) =>
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  hostname === '::1' ||
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
  /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname);

/**
 * API en tu PC o en tu red local: el navegador la usa por el MISMO origen de la web (Next pasa
 * /api, /socket.io y /s3 a la API y al almacén de fotos; ver next.config.ts). Así funciona igual en
 * localhost, desde el teléfono, en el navegador de la app de Claude y con un enlace público temporal
 * (túnel), sin abrir los puertos 4000 y 9000. En un servidor de verdad la API tiene su dominio y no se toca.
 */
export const sameOriginApi = () => {
  try {
    return isLocalHost(new URL(publicEnv.apiUrl).hostname);
  } catch {
    return false;
  }
};

export const clientApiUrl = () => {
  if (typeof window === 'undefined') return publicEnv.apiUrl;
  if (sameOriginApi()) return '';
  return publicEnv.apiUrl.replace(/\/+$/, '');
};

/** Puerto del almacén de fotos local (scripts/dev-s3.mjs). */
const LOCAL_STORAGE_PORT = process.env.NEXT_PUBLIC_LOCAL_STORAGE_PORT ?? '9000';
const LOCAL_STORAGE_URL = /^https?:\/\/([^/:?#]+):(\d+)\/(.*)$/;

/** Foto o enlace firmado del almacén local (http://192.168.0.173:9000/bucket/clave) → /s3/bucket/clave por el mismo origen. */
export function localMediaUrl(value: string): string {
  const match = LOCAL_STORAGE_URL.exec(value);
  if (!match || match[2] !== LOCAL_STORAGE_PORT || !isLocalHost(match[1]!)) return value;
  return `/s3/${match[3]}`;
}

/** Recorre una respuesta de la API y cambia las URLs del almacén local (solo en modo mismo origen). */
export function withLocalMedia<T>(value: T): T {
  if (!sameOriginApi()) return value;
  const walk = (item: unknown): unknown => {
    if (typeof item === 'string') return item.startsWith('http') ? localMediaUrl(item) : item;
    if (Array.isArray(item)) return item.map(walk);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, walk(entry)]));
    return item;
  };
  return walk(value) as T;
}

/**
 * Solo servidor: URL interna de la API (en Docker/Kubernetes suele diferir de la pública).
 * Si la API pública es local o de la red de casa (192.168.x…), la web y la API corren en la misma
 * PC: se lee por el mismo destino que el puente /api (127.0.0.1:4000). Así no importa si la IP de
 * la PC cambió ni si el firewall bloquea la IP propia (EACCES).
 * «localhost» pasa a 127.0.0.1: en Windows Node puede probar primero ::1 (IPv6) y la API escucha
 * solo en IPv4.
 */
export const serverApiUrl = () => {
  if (!process.env.API_URL && sameOriginApi()) return (process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');
  const raw = process.env.API_URL ?? publicEnv.apiUrl;
  try {
    const url = new URL(raw);
    if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return raw;
  }
};
