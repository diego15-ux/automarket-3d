import { z } from 'zod';
import {
  CURRENCIES,
  DRIVETRAINS,
  FUEL_TYPES,
  MAX_OWNERS_OPTION,
  MEDIA_KINDS,
  REPORT_REASONS,
  TRANSMISSIONS,
  VEHICLE_CATEGORIES,
  VEHICLE_CONDITIONS,
  type AccountType,
  type Drivetrain,
  type FuelType,
  type MediaKind,
  type PlanCode,
  type Transmission,
  type VehicleCategory,
  type VehicleCondition,
  type VehicleStatus,
} from './enums.js';
import { COUNTRY_CODES, CitySchema, CountrySchema } from './geo.js';

/** Máximo de archivos (fotos + vídeos) por anuncio. */
export const MAX_VEHICLE_MEDIA = 10;
export const MAX_VEHICLE_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VEHICLE_VIDEO_BYTES = 200 * 1024 * 1024;
export const VEHICLE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const VEHICLE_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;

const currentYear = () => new Date().getFullYear();

/** '' en formularios / query strings = "sin valor". */
const blankToUndefined = (value: unknown) => (value === '' || value === null ? undefined : value);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema.optional());

/** Campos editables de un anuncio. El vendedor fija el precio y la ficha técnica. */
export const VehicleFieldsSchema = z.object({
  make: z.string().trim().min(2, 'Indica la marca.').max(60),
  model: z.string().trim().min(1, 'Indica el modelo.').max(80),
  version: optional(z.string().trim().max(120)),
  year: z.coerce.number().int().min(1950, 'Año inválido.').max(currentYear() + 1, 'Año inválido.'),
  condition: z.enum(VEHICLE_CONDITIONS, { error: 'Elige si es nuevo o usado.' }),
  /** 0 = nuevo; 1 = único dueño; 2 = dos dueños; 3 = tres o más. */
  ownersCount: z.coerce.number().int().min(0).max(MAX_OWNERS_OPTION),
  mileageKm: z.coerce.number().int().min(0, 'Kilometraje inválido.').max(2_000_000),
  price: z.coerce.number().positive('Indica el precio.').max(100_000_000),
  /** Abono de reserva que fija el vendedor (obligatorio para publicar; ≤ precio). */
  reservationAmount: optional(z.coerce.number().positive('El abono de reserva debe ser mayor que 0.').max(100_000_000)),
  currency: z.enum(CURRENCIES).default('USD'),
  category: z.enum(VEHICLE_CATEGORIES, { error: 'Elige una categoría.' }),
  fuelType: z.enum(FUEL_TYPES, { error: 'Elige el combustible.' }),
  transmission: z.enum(TRANSMISSIONS, { error: 'Elige la transmisión.' }),
  drivetrain: optional(z.enum(DRIVETRAINS)),
  horsepower: optional(z.coerce.number().int().positive().max(3000)),
  exteriorColor: optional(z.string().trim().max(40)),
  doors: optional(z.coerce.number().int().min(1).max(9)),
  seats: optional(z.coerce.number().int().min(1).max(60)),
  country: CountrySchema,
  city: CitySchema,
  latitude: optional(z.coerce.number().min(-90).max(90)),
  longitude: optional(z.coerce.number().min(-180).max(180)),
  description: optional(z.string().trim().max(5000)),
});

/** Coherencia entre condición, dueños y kilometraje, y abono de reserva ≤ precio. */
function checkCondition(
  value: { condition?: VehicleCondition; ownersCount?: number; mileageKm?: number; price?: number; reservationAmount?: number; latitude?: number; longitude?: number },
  ctx: z.RefinementCtx,
) {
  if ((value.latitude === undefined) !== (value.longitude === undefined)) {
    ctx.addIssue({ code: 'custom', path: ['latitude'], message: 'La ubicación necesita latitud y longitud.' });
  }
  if (value.price !== undefined && value.reservationAmount !== undefined && value.reservationAmount > value.price) {
    ctx.addIssue({ code: 'custom', path: ['reservationAmount'], message: 'El abono de reserva no puede superar el precio.' });
  }
  if (value.condition === 'NEW' && value.ownersCount !== undefined && value.ownersCount !== 0) {
    ctx.addIssue({ code: 'custom', path: ['ownersCount'], message: 'Un vehículo nuevo no tiene dueños anteriores.' });
  }
  if (value.condition === 'USED' && value.ownersCount !== undefined && value.ownersCount < 1) {
    ctx.addIssue({ code: 'custom', path: ['ownersCount'], message: 'Indica el número de dueños anteriores.' });
  }
  if (value.condition === 'NEW' && value.mileageKm !== undefined && value.mileageKm > 1_000) {
    ctx.addIssue({ code: 'custom', path: ['mileageKm'], message: 'Un vehículo nuevo no puede superar 1.000 km.' });
  }
}

export const VehicleDraftSchema = VehicleFieldsSchema.superRefine(checkCondition);
export type VehicleDraftInput = z.infer<typeof VehicleDraftSchema>;

export const VehicleUpdateSchema = VehicleFieldsSchema.partial().superRefine(checkCondition);
export type VehicleUpdateInput = z.infer<typeof VehicleUpdateSchema>;

/**
 * Copiloto al publicar: ficha típica de un modelo y valor de mercado, calculados con los
 * anuncios reales de la base (publicados, reservados o vendidos). Nada se inventa: si hay
 * pocos autos parecidos, la respuesta lo dice.
 */
export const VehicleInsightsQuerySchema = z.object({
  make: z.string().trim().min(2).max(60),
  model: z.string().trim().min(1).max(80),
  year: optional(z.coerce.number().int().min(1950).max(2100)),
  mileageKm: optional(z.coerce.number().int().min(0).max(2_000_000)),
  transmission: optional(z.enum(TRANSMISSIONS)),
  /** El anuncio que se está editando no cuenta como comparable de sí mismo. */
  excludeId: optional(z.uuid()),
});
export type VehicleInsightsQuery = z.infer<typeof VehicleInsightsQuerySchema>;

/** Mínimo de autos parecidos (±2 años) para estimar un valor de mercado. */
export const MIN_MARKET_COMPARABLES = 2;

export interface VehicleInsightsDTO {
  /** Lo más común entre los anuncios de esa marca y modelo; null si todavía no hay ninguno. */
  typical: {
    category: VehicleCategory | null;
    fuelType: FuelType | null;
    transmission: Transmission | null;
    drivetrain: Drivetrain | null;
    doors: number | null;
    seats: number | null;
    sample: number;
  } | null;
  /** Valor de mercado en USD con autos parecidos (misma marca y modelo, ±2 años). */
  market: { value: number; low: number; high: number; sample: number } | null;
  /** Autos parecidos encontrados (aunque no alcancen para estimar). */
  comparables: number;
}

export const MediaUploadRequestSchema = z.object({
  mimeType: z.string().min(3).max(100),
  sizeBytes: z.number().int().positive(),
});

export const MediaRegisterSchema = z.object({
  key: z.string().min(10).max(512),
  width: z.number().int().positive().max(20_000).optional(),
  height: z.number().int().positive().max(20_000).optional(),
  durationMs: z.number().int().positive().max(30 * 60_000).optional(),
});

export const MediaOrderSchema = z.object({ mediaIds: z.array(z.uuid()).min(1).max(MAX_VEHICLE_MEDIA) });

export const VEHICLE_SORTS = ['relevance', 'price_asc', 'price_desc', 'year_desc', 'newest'] as const;
export type VehicleSort = (typeof VEHICLE_SORTS)[number];

/** Filtros del buscador avanzado (query string). */
export const VehicleSearchSchema = z.object({
  q: optional(z.string().trim().max(80)),
  make: optional(z.string().trim().max(60)),
  model: optional(z.string().trim().max(80)),
  category: optional(z.enum(VEHICLE_CATEGORIES)),
  condition: optional(z.enum(VEHICLE_CONDITIONS)),
  owners: optional(z.coerce.number().int().min(1).max(MAX_OWNERS_OPTION)),
  yearMin: optional(z.coerce.number().int().min(1950).max(2100)),
  yearMax: optional(z.coerce.number().int().min(1950).max(2100)),
  priceMin: optional(z.coerce.number().nonnegative()),
  priceMax: optional(z.coerce.number().nonnegative()),
  country: optional(z.enum(COUNTRY_CODES)),
  city: optional(z.string().trim().max(80)),
  nearby: z.preprocess(value => value === 'true', z.boolean().default(false)),
  /** Caja: AUTOMATIC = cualquier caja que no sea manual (automática, doble embrague, CVT). */
  gearbox: optional(z.enum(['AUTOMATIC', 'MANUAL'])),
  mileageMax: optional(z.coerce.number().int().min(0).max(2_000_000)),
  /** Combustible (el buscador inteligente lo usa para «eléctricos»). */
  fuel: optional(z.enum(FUEL_TYPES)),
  /** Solo anuncios con showroom 3D. */
  has3d: z.preprocess(value => value === 'true', z.boolean().default(false)),
  /** Solo vendedores con identidad verificada. */
  verified: z.preprocess(value => value === 'true', z.boolean().default(false)),
  sort: z.preprocess(blankToUndefined, z.enum(VEHICLE_SORTS).default('relevance')),
  page: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(500).default(1)),
  pageSize: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(48).default(24)),
});
export type VehicleSearchInput = z.infer<typeof VehicleSearchSchema>;

export const ReportSchema = z.object({
  reason: z.enum(REPORT_REASONS),
  details: optional(z.string().trim().max(2000)),
});

export interface VehicleMediaDTO {
  id: string;
  kind: MediaKind;
  url: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  position: number;
}

/** Tarjeta del catálogo: una sola foto principal. */
export interface VehicleCardDTO {
  id: string;
  slug: string;
  make: string;
  model: string;
  version: string | null;
  year: number;
  condition: VehicleCondition;
  ownersCount: number;
  mileageKm: number;
  price: string;
  currency: string;
  category: VehicleCategory;
  fuelType: FuelType;
  transmission: Transmission;
  country: string;
  city: string;
  isFeatured: boolean;
  status: VehicleStatus;
  coverUrl: string | null;
  has3d: boolean;
  sellerVerified: boolean;
  /** Razón social si el vendedor es un concesionario (insignia en la tarjeta). */
  sellerDealerName: string | null;
  /** Reservado y con la venta en cierre: el público lo ve «En negociación» (si no, «Reservado»). */
  inNegotiation: boolean;
  /** Distancia en km a la persona (solo en «Cerca de mí», con su permiso de ubicación). */
  distanceKm?: number | null;
}

/** Insignia del concesionario: la razón social siempre; RIF, dirección y teléfono con un plan de concesionario. */
export interface DealerBadgeDTO {
  businessName: string;
  taxId: string | null;
  fiscalAddress: string | null;
  businessPhone: string | null;
}

/** Ficha completa: galería, vídeo y datos del vendedor. */
export interface VehicleDetailDTO extends VehicleCardDTO {
  description: string | null;
  drivetrain: Drivetrain | null;
  horsepower: number | null;
  exteriorColor: string | null;
  doors: number | null;
  seats: number | null;
  publishedAt: string | null;
  expiresAt: string | null;
  model3dUrl: string | null;
  model3dPosterUrl: string | null;
  /** Abono de reserva que fijó el vendedor (se le paga directamente a él). */
  reservationAmount: string | null;
  media: VehicleMediaDTO[];
  seller: {
    id: string;
    name: string;
    avatarUrl: string | null;
    isVerified: boolean;
    city: string | null;
    country: string | null;
    memberSince: string;
    accountType: AccountType;
    dealer: DealerBadgeDTO | null;
    /** Promedio (1–5) y número de calificaciones de compradores que le compraron. */
    ratingAverage: number | null;
    ratingCount: number;
    /** Ventas concretadas en AutoMarket. */
    soldCount: number;
  };
}

/** Buscador inteligente: lo que entendió, sugerencias, los mejores autos y un resumen de precios. */
export interface SmartSearchDTO {
  query: string;
  /** Filtros entendidos («Camioneta», «Automático», «Hasta $22,000»). */
  chips: string[];
  /** Correcciones y sinónimos (««jeepeta» = camioneta»). */
  understood: string[];
  /** Aviso cuando hubo que aflojar un filtro para mostrar algo. */
  relaxed: string | null;
  suggestions: Array<{ label: string; kind: 'Modelo' | 'Marca' | 'Ciudad'; count: number; word: string }>;
  results: VehicleCardDTO[];
  total: number;
  /** «Precio medio $19,800 · de $18,100 a $21,500» (del conjunto completo). */
  insight: string;
  /** La frase parece una pregunta (para ofrecer el Copiloto). */
  question: boolean;
  /** Filtros para abrir el catálogo con lo mismo. */
  catalog: Record<string, string>;
}

/** Arranque del buscador: lo más publicado ahora (sale del catálogo real). */
export interface SmartSearchStartDTO {
  popular: string[];
}

export interface SearchResultDTO {
  items: VehicleCardDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SellerProfileDTO {
  id: string;
  name: string;
  avatarUrl: string | null;
  bio: string | null;
  city: string | null;
  country: string | null;
  memberSince: string;
  accountType: AccountType;
  isVerified: boolean;
  dealerName: string | null;
  ratingAverage: number | null;
  ratingCount: number;
  /** Puntuaciones por estrellas: [5★, 4★, 3★, 2★, 1★]. */
  ratingDistribution: [number, number, number, number, number];
  /** Autos vendidos con reserva en AutoMarket. */
  soldCount: number;
  /** Publicados, reservados o en negociación. */
  vehicles: VehicleCardDTO[];
}

/** Concesionario aliado del directorio público (agencias con RIF revisado por AutoMarket). */
export interface DealerDirectoryEntryDTO {
  id: string;
  /** Razón social (nombre comercial de la agencia). */
  name: string;
  avatarUrl: string | null;
  city: string | null;
  country: string | null;
  /** Plan vigente: DEALER_PRO lleva el sello «Pro». */
  planCode: PlanCode;
  /** Anuncios publicados o reservados. */
  activeListings: number;
  /** Ventas cerradas en AutoMarket en los últimos 6 meses (orden «Más ventas»). */
  soldLast6Months: number;
  ratingAverage: number | null;
  ratingCount: number;
  /** Año de alta como aliado (verificación del RIF). */
  memberSinceYear: number;
  /** Marcas más frecuentes de su inventario (hasta 3). */
  brands: string[];
  /** La persona con sesión lo sigue (false sin sesión). */
  following: boolean;
}

/** Denuncia de un perfil (página pública del vendedor). */
export const USER_REPORT_REASONS = ['FRAUD', 'OFFENSIVE', 'SPAM', 'OTHER'] as const;
export const UserReportSchema = z.object({
  reason: z.enum(USER_REPORT_REASONS),
  details: optional(z.string().trim().max(2000)),
});

// ── Mis alertas ──────────────────────────────────────────────────────────────
export const ALERT_FREQUENCIES = ['INSTANT', 'DAILY', 'WEEKLY'] as const;
export type AlertFrequency = (typeof ALERT_FREQUENCIES)[number];
export const ALERT_FREQUENCY_LABELS: Record<AlertFrequency, string> = { INSTANT: 'Al instante', DAILY: 'Una vez al día', WEEKLY: 'Una vez a la semana' };
export const ALERT_MIN_YEAR = 1980;
export const MAX_ALERTS_PER_USER = 20;

export const SearchAlertCreateSchema = z
  .object({
    make: optional(z.string().trim().max(60)),
    model: optional(z.string().trim().max(80)),
    maxPrice: optional(z.coerce.number().int().min(1, 'El precio máximo debe ser mayor que 0').max(100_000_000)),
    city: optional(z.string().trim().max(80)),
    yearFrom: optional(z.coerce.number().int()),
    frequency: z.enum(ALERT_FREQUENCIES).default('INSTANT'),
  })
  .superRefine((value, ctx) => {
    if (!value.make && !value.model && value.maxPrice === undefined) {
      ctx.addIssue({ code: 'custom', path: ['make'], message: 'Escribe al menos la marca, el modelo o un precio máximo' });
    }
    const top = new Date().getFullYear() + 1;
    if (value.yearFrom !== undefined && (value.yearFrom < ALERT_MIN_YEAR || value.yearFrom > top)) {
      ctx.addIssue({ code: 'custom', path: ['yearFrom'], message: `El año va de ${ALERT_MIN_YEAR} a ${top}` });
    }
  });
export type SearchAlertCreateInput = z.infer<typeof SearchAlertCreateSchema>;
export const SearchAlertUpdateSchema = z.object({ active: z.boolean() });

export interface SearchAlertDTO {
  id: string;
  make: string | null;
  model: string | null;
  maxPrice: number | null;
  country: string | null;
  city: string | null;
  yearFrom: number | null;
  frequency: AlertFrequency;
  active: boolean;
  /** Autos que la cumplen publicados desde la última vez que la persona los vio. */
  newCount: number;
  createdAt: string;
  /** Filtros del catálogo para «Ver autos» (query string). */
  catalogQuery: string;
}

/** «Avísame si vuelve»: un auto reservado o en negociación que la persona espera. */
export interface WatchAlertDTO {
  vehicleId: string;
  slug: string;
  title: string;
  status: VehicleStatus;
  inNegotiation: boolean;
  coverUrl: string | null;
  createdAt: string;
}

/** Aviso reciente de una alerta (campana): autos nuevos o que volvieron a estar disponibles. */
export interface AlertNoticeDTO {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  coverUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

/** «Bajadas de precio en tus guardados»: la alerta fija de los autos guardados. */
export interface PriceDropAlertDTO {
  /** Autos guardados que siguen publicados o reservados. */
  saved: number;
  active: boolean;
  /** Avisos de bajada sin leer. */
  newCount: number;
}

export interface AlertsOverviewDTO {
  alerts: SearchAlertDTO[];
  watches: WatchAlertDTO[];
  priceDrops: PriceDropAlertDTO;
  recent: AlertNoticeDTO[];
}

export const PriceDropAlertsSchema = z.object({ active: z.boolean() });

// ── Guardados («Guardar» en la ficha) ────────────────────────────────────────
export const MAX_SAVED_VEHICLES = 100;

export interface SavedVehicleDTO {
  vehicle: VehicleCardDTO;
  /** Precio que tenía al guardarlo. */
  savedPrice: number;
  /** Cuánto bajó desde que lo guardaste (0 si no bajó). */
  priceDrop: number;
  savedAt: string;
}

export interface SellerRatingOpportunityDTO {
  reservationId: string;
  vehicleTitle: string;
  completedAt: string;
  rating: number | null;
  /** Comentario que dejó (si dejó uno). */
  comment: string | null;
}

export const MEDIA_KIND_OF = (mimeType: string): MediaKind | null =>
  (VEHICLE_IMAGE_TYPES as readonly string[]).includes(mimeType) ? 'IMAGE' : (VEHICLE_VIDEO_TYPES as readonly string[]).includes(mimeType) ? 'VIDEO' : null;

export { MEDIA_KINDS };

// ── Copiloto del comprador: chat con reglas y anuncios reales (sin IA) ──────────────────

export const COPILOT_INTENTS = ['search', 'cheap', 'count', 'fair', 'same', 'versus', 'sell', 'info'] as const;
export type CopilotIntent = (typeof COPILOT_INTENTS)[number];

/**
 * Lo que la conversación ya sabe (marca, presupuesto, uso…). Lo arma la API y la web lo
 * devuelve tal cual en el siguiente mensaje; se valida como cualquier otra entrada.
 */
export const CopilotContextSchema = z.object({
  intent: z.enum(COPILOT_INTENTS).nullable().default(null),
  models: z.array(z.string().max(80)).max(3).default([]),
  brand: z.string().max(60).nullable().default(null),
  gearbox: z.enum(['AUTOMATIC', 'MANUAL']).nullable().default(null),
  category: z.enum(['SUV', 'PICKUP', 'SEDAN', 'HATCHBACK', 'SPORTS', 'CONVERTIBLE']).nullable().default(null),
  electric: z.boolean().default(false),
  city: z.string().max(80).nullable().default(null),
  year: z.number().int().min(1950).max(2100).nullable().default(null),
  km: z.number().int().min(0).max(2_000_000).nullable().default(null),
  min: z.number().min(0).max(10_000_000).nullable().default(null),
  max: z.number().min(0).max(10_000_000).nullable().default(null),
  amount: z.number().min(0).max(10_000_000).nullable().default(null),
  use: z.enum(['city', 'family', 'work']).nullable().default(null),
  priority: z.enum(['fuel', 'value', 'space']).nullable().default(null),
  /** Estado del auto al tasar: 1,04 como nuevo · 0,90 con detalles. */
  condition: z.number().min(0.5).max(1.5).nullable().default(null),
  /** «Ayúdame a elegir»: paso de la guía (1 presupuesto, 2 uso, 3 prioridad). */
  guide: z.number().int().min(1).max(3).nullable().default(null),
});
export type CopilotContext = z.infer<typeof CopilotContextSchema>;

export const CopilotAskSchema = z.object({
  text: z.string().trim().max(240).default(''),
  /** Saludo inicial o reinicio (sin texto). */
  action: z.enum(['start', 'reset']).optional(),
  context: CopilotContextSchema.nullish(),
  /** La ficha que la persona tiene abierta («Estás viendo…»). */
  vehicleSlug: z.string().trim().max(200).optional(),
});
export type CopilotAskInput = z.infer<typeof CopilotAskSchema>;

export interface CopilotChipDTO {
  label: string;
  /** Lo que se envía al tocarlo (si no hay `href`). */
  text?: string;
  href?: string;
}

export interface CopilotPickDTO {
  vehicle: VehicleCardDTO;
  /** «El más barato», «#2 en precio»… (null: solo el puesto). */
  tag: string | null;
  reasons: string[];
}

export type CopilotBlockDTO =
  | { type: 'text'; text: string }
  | { type: 'picks'; items: CopilotPickDTO[] }
  | {
      type: 'gauge';
      title: string;
      subtitle: string;
      verdict: string;
      tone: 'good' | 'warn' | 'neutral';
      /** Escala del medidor y franja «justa» en USD. */
      scale: { min: number; max: number };
      band: { low: number; high: number };
      /** Precio que se revisa (marcador); null: sin marcador. */
      price: number | null;
      rows: Array<{ label: string; value: string }>;
    }
  | {
      type: 'gearbox';
      title: string;
      groups: Array<{ label: string; count: number; avg: number }>;
      rows: Array<{ vehicle: VehicleCardDTO; cheapest: boolean }>;
    }
  | { type: 'versus'; columns: [string, string]; rows: Array<{ label: string; values: [string, string] }> }
  | { type: 'note'; text: string };

export interface CopilotReplyDTO {
  blocks: CopilotBlockDTO[];
  chips: CopilotChipDTO[];
  context: CopilotContext;
  /** La ficha abierta, para la barra «Estás viendo…». */
  viewing: { slug: string; title: string; price: number } | null;
}
