import { SocialLinkSchema, type ManualInstructionsDTO, type SocialLinkDTO } from '@automarket/contracts';
import { env } from '../config/env.js';
import { prisma, type Db } from './infra/prisma.js';

/**
 * Ajustes que se leen en cada pago o página pública (cuenta de cobro de Binance y redes),
 * guardados en MySQL y cacheados en memoria. La caché se renueva sola cada pocos segundos,
 * así que varias instancias de la API ven el cambio del panel casi al instante.
 *
 * La cuenta de cobro solo la cambia el administrador principal (ADMIN_ONE) desde el panel.
 * Si nunca se configuró allí, se usa BINANCE_PAY_ID del .env (instalaciones anteriores).
 */

export type PayeeSource = 'PANEL' | 'ENV' | 'NONE';

interface PlatformConfig {
  payee: ManualInstructionsDTO | null;
  payeeSource: PayeeSource;
  socialLinks: SocialLinkDTO[];
  loadedAt: number;
}

const MAX_AGE_MS = 15_000;
let cache: PlatformConfig | null = null;
let loading: Promise<PlatformConfig> | null = null;

const envPayee = (): ManualInstructionsDTO | null =>
  env.BINANCE_PAY_ID ? { payId: env.BINANCE_PAY_ID, payName: env.BINANCE_PAY_NAME ?? null, qrImageUrl: env.BINANCE_PAY_QR_IMAGE_URL ?? null } : null;

/** Solo enlaces que siguen siendo válidos (la columna JSON podría editarse a mano). */
export function parseSocialLinks(value: unknown): SocialLinkDTO[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const parsed = SocialLinkSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

async function load(db: Db = prisma): Promise<PlatformConfig> {
  const row = await db.platformSettings.findUnique({
    where: { id: 1 },
    select: { binancePayId: true, binancePayName: true, binanceQrUrl: true, socialLinks: true },
  });
  const fromPanel = row?.binancePayId ? { payId: row.binancePayId, payName: row.binancePayName, qrImageUrl: row.binanceQrUrl } : null;
  const fallback = envPayee();
  return {
    payee: fromPanel ?? fallback,
    payeeSource: fromPanel ? 'PANEL' : fallback ? 'ENV' : 'NONE',
    socialLinks: parseSocialLinks(row?.socialLinks),
    loadedAt: Date.now(),
  };
}

/** Vuelve a leer los ajustes (al arrancar, tras un cambio en el panel y desde el planificador). */
export async function refreshPlatformConfig(db: Db = prisma): Promise<PlatformConfig> {
  if (db === prisma && loading) return loading;
  const run = load(db).then(config => {
    cache = config;
    return config;
  });
  if (db === prisma) {
    loading = run.finally(() => {
      loading = null;
    });
    return loading;
  }
  return run;
}

/** Versión síncrona para los DTO: si la caché está vieja la renueva en segundo plano. */
function snapshot(): PlatformConfig {
  if (!cache) {
    void refreshPlatformConfig().catch(err => console.error('[ajustes] no se pudieron leer:', err));
    return { payee: envPayee(), payeeSource: envPayee() ? 'ENV' : 'NONE', socialLinks: [], loadedAt: 0 };
  }
  if (Date.now() - cache.loadedAt > MAX_AGE_MS) void refreshPlatformConfig().catch(err => console.error('[ajustes] no se pudieron leer:', err));
  return cache;
}

/** Cuenta de cobro vigente (lectura rápida, puede tener unos segundos de retraso). */
export const currentPayee = () => snapshot().payee;
export const currentPayeeSource = () => snapshot().payeeSource;
export const currentSocialLinks = () => snapshot().socialLinks;

/** Cuenta de cobro leída de la base en este momento: la usan los pagos nuevos. */
export async function freshPayee(): Promise<ManualInstructionsDTO | null> {
  if (cache && Date.now() - cache.loadedAt <= 2_000) return cache.payee;
  return (await refreshPlatformConfig()).payee;
}
