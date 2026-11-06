import { z } from 'zod';

/** "a, b,c" → ['a', 'b', 'c'] */
const csv = (fallback = '') =>
  z
    .string()
    .default(fallback)
    .transform(value => value.split(',').map(item => item.trim()).filter(Boolean));

const blank = (value: unknown) => (value === '' ? undefined : value);
const optionalSecret = z.preprocess(blank, z.string().min(1).optional());
const optionalUrl = z.preprocess(blank, z.url().optional());

/** Integraciones sin las que la plataforma no puede operar en producción. */
const REQUIRED_IN_PRODUCTION = ['TURNSTILE_SECRET_KEY', 'SMTP_URL', 'REDIS_URL'] as const;

/**
 * Variables de entorno validadas al arrancar: si falta algo crítico el proceso
 * no inicia (fail fast) en lugar de fallar en producción a mitad de una petición.
 */
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    /** Saltos de proxy de confianza (ALB, Nginx, Cloudflare) para obtener la IP real del cliente. */
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),
    /** URL pública de la web: enlaces de los correos y retorno desde Binance Pay. */
    WEB_URL: z.url().default('http://localhost:3000'),

    DATABASE_URL: z.string().regex(/^(mysql|mariadb):\/\//, 'DATABASE_URL debe tener el formato mysql://usuario:clave@host:3306/base'),
    DATABASE_POOL_SIZE: z.coerce.number().int().positive().default(10),

    CORS_ORIGINS: csv('http://localhost:3000'),

    // Sesión: access token JWT corto + refresh token opaco rotado
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET debe tener al menos 32 caracteres'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    JWT_REFRESH_TTL_DAYS: z.coerce.number().positive().default(30),
    JWT_ISSUER: z.string().default('automarket-api'),
    JWT_AUDIENCE: z.string().default('automarket-web'),
    COOKIE_DOMAIN: z.string().optional(),
    COOKIE_SECURE: z.stringbool().optional(),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(30),

    // OAuth (OpenID Connect): ids de cliente admitidos como `aud` del ID token
    GOOGLE_CLIENT_IDS: csv(),
    APPLE_CLIENT_IDS: csv(),
    GOOGLE_JWKS_URL: z.url().default('https://www.googleapis.com/oauth2/v3/certs'),
    APPLE_JWKS_URL: z.url().default('https://appleid.apple.com/auth/keys'),

    // Anti-bot: Cloudflare Turnstile (+ honeypot y rate limit en Redis)
    TURNSTILE_SECRET_KEY: optionalSecret,
    TURNSTILE_VERIFY_URL: z.url().default('https://challenges.cloudflare.com/turnstile/v0/siteverify'),

    // Correo transaccional (smtp://usuario:clave@host:587 · smtps://…:465)
    SMTP_URL: optionalSecret,
    MAIL_FROM: z.string().default('AutoMarket <no-reply@automarket.dev>'),

    // Almacenamiento
    AWS_REGION: z.string().default('us-east-1'),
    S3_BUCKET_MEDIA: z.string().min(3),
    S3_BUCKET_KYC: z.string().min(3),
    S3_ENDPOINT: z.url().optional(),
    /** CDN / origen público de las fotos y vídeos de los anuncios (prefijo vehicles/). */
    MEDIA_PUBLIC_BASE_URL: z.url().optional(),

    /** URL pública de esta API (Binance Pay envía aquí sus notificaciones). */
    API_PUBLIC_URL: optionalUrl,

    // Pagos con Binance (a la cuenta de la empresa). Se cobra en esta moneda, 1 USDT = 1 USD.
    PAYMENT_CURRENCY: z.enum(['USDT', 'USDC', 'FDUSD']).default('USDT'),
    // Modo manual: el usuario paga a nuestro Pay ID y un administrador verifica la transacción.
    // El Pay ID lo fija el administrador principal en el panel; este valor solo se usa si allí no hay ninguno.
    BINANCE_PAY_ID: z.preprocess(blank, z.string().regex(/^\d{4,20}$/, 'BINANCE_PAY_ID son solo números').optional()),
    BINANCE_PAY_NAME: optionalSecret,
    BINANCE_PAY_QR_IMAGE_URL: optionalUrl,
    MANUAL_PAYMENT_WINDOW_HOURS: z.coerce.number().positive().max(168).default(24),
    // Modo comercio: API de Binance Pay (cuenta Merchant verificada).
    BINANCE_PAY_API_KEY: optionalSecret,
    BINANCE_PAY_SECRET_KEY: optionalSecret,
    BINANCE_PAY_API_BASE: z.url().default('https://bpay.binanceapi.com'),

    // Reservas y tareas programadas
    CART_TTL_HOURS: z.coerce.number().positive().default(48),
    JOBS_ENABLED: z.stringbool().default(true),
    JOBS_INTERVAL_MS: z.coerce.number().int().min(1_000).default(60_000),

    /** Rate limiting distribuido + adapter de Socket.io (obligatorio en producción). */
    REDIS_URL: z.url().optional(),

    /**
     * Arranque temporal en producción sin correo o sin Turnstile (p. ej. el primer día, antes de
     * tener las llaves). La API avisa al arrancar; se quitan en cuanto estén SMTP_URL y Turnstile.
     */
    MAIL_DISABLED: z.stringbool().default(false),
    TURNSTILE_DISABLED: z.stringbool().default(false),
  })
  .superRefine((value, ctx) => {
    if (Boolean(value.BINANCE_PAY_API_KEY) !== Boolean(value.BINANCE_PAY_SECRET_KEY)) {
      ctx.addIssue({ code: 'custom', path: ['BINANCE_PAY_SECRET_KEY'], message: 'BINANCE_PAY_API_KEY y BINANCE_PAY_SECRET_KEY van juntas' });
    }
    if (value.NODE_ENV !== 'production') return;
    for (const key of REQUIRED_IN_PRODUCTION) {
      if (key === 'SMTP_URL' && value.MAIL_DISABLED) continue;
      if (key === 'TURNSTILE_SECRET_KEY' && value.TURNSTILE_DISABLED) continue;
      if (!value[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} es obligatoria en producción` });
    }
  });

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Configuración inválida:\n' + z.prettifyError(parsed.error));
  process.exit(1);
}

const data = parsed.data;

export const env = {
  ...data,
  // Cookies `Secure` por defecto en producción (HTTPS); configurable para entornos intermedios.
  COOKIE_SECURE: data.COOKIE_SECURE ?? data.NODE_ENV === 'production',
  MEDIA_PUBLIC_BASE_URL: (
    data.MEDIA_PUBLIC_BASE_URL ??
    (data.S3_ENDPOINT ? `${data.S3_ENDPOINT}/${data.S3_BUCKET_MEDIA}` : `https://${data.S3_BUCKET_MEDIA}.s3.${data.AWS_REGION}.amazonaws.com`)
  ).replace(/\/+$/, ''),
  WEB_URL: data.WEB_URL.replace(/\/+$/, ''),
};
export type Env = typeof env;
