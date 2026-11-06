import type { DealerDirectoryEntryDTO, PlanDTO, PublicReviewDTO, PublicSettingsDTO, PublicStatsDTO, SearchResultDTO, TermsDTO, VehicleCardDTO } from '@automarket/contracts';
import { networkInterfaces } from 'node:os';
import { serverApiUrl, withLocalMedia } from '@/shared/config/env';

/**
 * Si la API apunta a una IP de esta misma PC (p. ej. 192.168.0.173 para abrir desde el teléfono),
 * el servidor de la web la lee por 127.0.0.1: una VPN o el firewall pueden bloquear la conexión a la
 * IP propia (EACCES) y la portada saldría sin datos. Otras direcciones no se tocan.
 */
function apiBase(): string {
  const raw = serverApiUrl();
  try {
    const url = new URL(raw);
    const own = Object.values(networkInterfaces()).some((list) => list?.some((i) => i.address === url.hostname));
    if (own) url.hostname = '127.0.0.1';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return raw;
  }
}

export type CarouselItem = VehicleCardDTO & { source: 'CURATED' | 'FEATURED' };
export interface ReviewsData {
  items: PublicReviewDTO[];
  average: number | null;
  total: number;
}

const warned = new Map<string, number>();

/** Avisa en la consola de la web (una vez por minuto y ruta) para que se vea por qué falta una sección. */
function warn(path: string, reason: string) {
  const now = Date.now();
  if (now - (warned.get(path) ?? 0) < 60_000) return;
  warned.set(path, now);
  console.warn(`[web] No se pudo leer ${path} de la API (${apiBase()}): ${reason}`);
}

/** Lectura desde el servidor (render por petición): si la API falla, la sección se oculta. */
async function read<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${apiBase()}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(6_000) });
    if (!res.ok) {
      warn(path, `respondió ${res.status}`);
      return fallback;
    }
    // Las fotos del almacén local van por el mismo origen de la web (/s3/…).
    return withLocalMedia(((await res.json()) as { data: T }).data);
  } catch (error) {
    const cause = error instanceof Error ? ((error.cause as Error | undefined)?.message ?? error.message) : String(error);
    warn(path, cause);
    return fallback;
  }
}

export async function getLandingData() {
  const [stats, carousel, plans, reviews, latest] = await Promise.all([
    read<PublicStatsDTO | null>('/api/public/stats', null),
    read<CarouselItem[]>('/api/public/carousel', []),
    read<PlanDTO[]>('/api/public/plans', []),
    read<ReviewsData>('/api/public/reviews', { items: [], average: null, total: 0 }),
    // Lo último que se publicó: rellena la portada si el panel aún no eligió destacados.
    read<SearchResultDTO | null>('/api/vehicles?sort=newest&pageSize=24', null),
  ]);
  return { stats, carousel, plans, reviews, latest: latest?.items ?? [] };
}

/** Lo que hizo el filtro del chat en las conversaciones reales (GET /api/public/chat-filter-stats). */
export interface ChatFilterStats {
  days: number;
  messages: number;
  conversations: number;
  contactHidden: number;
  profanityHidden: number;
}
export const getChatFilterStats = () => read<ChatFilterStats | null>('/api/public/chat-filter-stats', null);

/** Concesionarios aliados (RIF o documento fiscal verificado), para la sección de la portada. */
export const getDealers = () => read<DealerDirectoryEntryDTO[]>('/api/dealers', []);

/** Plazos de las reservas, fondo del login y redes sociales (gestionado desde el panel). */
export const getPublicSettings = () => read<PublicSettingsDTO | null>('/api/public/settings', null);

/** Términos y Condiciones vigentes (se editan desde el panel y viven en MySQL). */
export const getTerms = () => read<TermsDTO | null>('/api/public/terms', null);
