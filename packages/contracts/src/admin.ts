import { z } from 'zod';
import { BILLING_CYCLES, PLAN_CODES, REPORT_STATUSES, REVIEW_STATUSES } from './enums.js';
import { EmailSchema, HumanCheckSchema } from './auth.js';

// ─────────────────────────────────────────────────── Panel de administración ──

export const PlanUpdateSchema = z.object({
  priceMonthly: z.coerce.number().min(0).max(100_000),
  priceYearly: z.coerce.number().min(0).max(1_000_000),
  /** Comisión post-venta sobre el precio de la venta: 0 – 20 %. */
  commissionRate: z.coerce.number().min(0).max(0.2),
  /** Anuncios en cupo: vacío o null = ilimitados; sin enviar = sin cambios. */
  maxActiveListings: z.preprocess(value => (value === '' || value === null ? null : value), z.coerce.number().int().min(1).max(10_000).nullable()).optional(),
  /** Días que dura un anuncio publicado: vacío o null = no vence; sin enviar = sin cambios. Aplica a lo que se publique después. */
  listingDurationDays: z.preprocess(value => (value === '' || value === null ? null : value), z.coerce.number().int().min(1, 'Un anuncio dura al menos 1 día.').max(3650).nullable()).optional(),
  /** Destacados simultáneos que elige el usuario. */
  featuredSlots: z.coerce.number().int().min(0).max(50).optional(),
  /** Destacados automáticos por mes. */
  monthlyFeaturedCredits: z.coerce.number().int().min(0).max(100).optional(),
  /** Prioridad en las búsquedas (0 = normal, 10 = máxima). */
  searchBoost: z.coerce.number().int().min(0).max(10).optional(),
});
export type PlanUpdateInput = z.infer<typeof PlanUpdateSchema>;

/** Activación o renovación manual de una membresía. */
export const ManualMembershipSchema = z.object({
  planCode: z.enum(PLAN_CODES),
  cycle: z.enum(BILLING_CYCLES).default('MONTHLY'),
  /** Cuántos periodos añadir (1 – 24). */
  periods: z.coerce.number().int().min(1).max(24).default(1),
  note: z.string().trim().max(500).optional(),
});
export type ManualMembershipInput = z.infer<typeof ManualMembershipSchema>;

export const PlatformSettingsSchema = z.object({
  /** Horas que tiene el vendedor para confirmar o rechazar una solicitud de reserva. */
  sellerResponseHours: z.coerce.number().int().min(1).max(72),
  /** Días que el vehículo queda reservado; después vuelve a estar disponible si no se vendió. */
  reservationHoldDays: z.coerce.number().int().min(1).max(30),
  /** Días para pagar la comisión post-venta. */
  commissionDueDays: z.coerce.number().int().min(1).max(60),
});
export type PlatformSettingsInput = z.infer<typeof PlatformSettingsSchema>;

/** Términos y Condiciones: texto con «# Título», «## Sección», párrafos y listas «- ». */
export const TermsUpdateSchema = z.object({
  content: z.string().trim().min(50, 'Los Términos deben tener al menos 50 caracteres.').max(200_000),
});

export const LOGIN_BACKGROUND_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_LOGIN_BACKGROUND_BYTES = 8 * 1024 * 1024;
export const LoginBackgroundUploadSchema = z.object({
  mimeType: z.enum(LOGIN_BACKGROUND_TYPES, { error: 'Usa una imagen JPG, PNG o WebP.' }),
  sizeBytes: z.number().int().positive().max(MAX_LOGIN_BACKGROUND_BYTES, 'La imagen no puede superar 8 MB.'),
});
export const LoginBackgroundRegisterSchema = z.object({ key: z.string().min(10).max(512) });

// ───────────────────────────────────────────────────────────── Redes sociales ──

export const SOCIAL_NETWORKS = ['INSTAGRAM', 'TIKTOK', 'FACEBOOK', 'WHATSAPP', 'YOUTUBE', 'X', 'TELEGRAM', 'LINKEDIN'] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];
export const SOCIAL_NETWORK_LABELS: Record<SocialNetwork, string> = {
  INSTAGRAM: 'Instagram',
  TIKTOK: 'TikTok',
  FACEBOOK: 'Facebook',
  WHATSAPP: 'WhatsApp',
  YOUTUBE: 'YouTube',
  X: 'X',
  TELEGRAM: 'Telegram',
  LINKEDIN: 'LinkedIn',
};
/** Dominios válidos de cada red: un enlace solo se acepta si apunta a la red que dice ser. */
export const SOCIAL_NETWORK_HOSTS: Record<SocialNetwork, readonly string[]> = {
  INSTAGRAM: ['instagram.com'],
  TIKTOK: ['tiktok.com'],
  FACEBOOK: ['facebook.com', 'fb.com', 'fb.me'],
  WHATSAPP: ['wa.me', 'whatsapp.com'],
  YOUTUBE: ['youtube.com', 'youtu.be'],
  X: ['x.com', 'twitter.com'],
  TELEGRAM: ['t.me', 'telegram.me'],
  LINKEDIN: ['linkedin.com'],
};
/** Host del enlace (sin usuario ni puerto); vacío si el enlace trae credenciales («usuario@host»). */
const hostOf = (url: string) => {
  const authority = /^https:\/\/([^/?#]+)/i.exec(url)?.[1] ?? '';
  return authority.includes('@') ? '' : (authority.split(':')[0] ?? '').toLowerCase();
};
const hostMatches = (host: string, allowed: readonly string[]) => host !== '' && allowed.some(domain => host === domain || host.endsWith(`.${domain}`));

export const SocialLinkSchema = z
  .object({
    network: z.enum(SOCIAL_NETWORKS),
    url: z.url({ protocol: /^https$/, error: 'Usa un enlace completo que empiece por https://' }).max(300),
  })
  .refine(link => hostMatches(hostOf(link.url), SOCIAL_NETWORK_HOSTS[link.network]), {
    error: issue => `Ese enlace no es de ${SOCIAL_NETWORK_LABELS[(issue.input as { network: SocialNetwork }).network] ?? 'esa red'}.`,
    path: ['url'],
  });
export type SocialLinkDTO = z.infer<typeof SocialLinkSchema>;

export const SocialLinksUpdateSchema = z.object({
  links: z
    .array(SocialLinkSchema)
    .max(SOCIAL_NETWORKS.length)
    .refine(links => new Set(links.map(link => link.network)).size === links.length, 'Cada red solo puede aparecer una vez.'),
});

// ───────────────────────────────────────────── Cobro con Binance (solo ADMIN_ONE) ──

export const BINANCE_PAY_ID_REGEX = /^\d{4,20}$/;
export const BinancePayeeUpdateSchema = z.object({
  payId: z.string().trim().regex(BINANCE_PAY_ID_REGEX, 'El Pay ID son solo números (de 4 a 20 cifras).'),
  payName: z.string().trim().min(2, 'Indica a nombre de quién está la cuenta.').max(80),
  /** El administrador principal confirma que el Pay ID es de la cuenta de la empresa. */
  confirm: z.literal(true, { error: 'Confirma que el Pay ID es de la cuenta de la empresa.' }),
});
export type BinancePayeeUpdateInput = z.infer<typeof BinancePayeeUpdateSchema>;

export const MAX_BINANCE_QR_BYTES = 2 * 1024 * 1024;
export const BinanceQrUploadSchema = z.object({
  mimeType: z.enum(LOGIN_BACKGROUND_TYPES, { error: 'Usa una imagen JPG, PNG o WebP.' }),
  sizeBytes: z.number().int().positive().max(MAX_BINANCE_QR_BYTES, 'El QR no puede superar 2 MB.'),
});

/** Cuenta de cobro vista desde el panel. */
export interface BinancePayeeDTO {
  payId: string | null;
  payName: string | null;
  qrImageUrl: string | null;
  /** PANEL = la fijó el administrador principal · ENV = viene del .env del servidor · NONE = sin configurar */
  source: 'PANEL' | 'ENV' | 'NONE';
  updatedAt: string | null;
  updatedBy: string | null;
  /** Solo el administrador principal (ADMIN_ONE) puede cambiarla. */
  canEdit: boolean;
  /** Pagos manuales abiertos: conservan la cuenta con la que se crearon. */
  openManualPayments: number;
}

/** Ajustes públicos: plazos de las reservas (ficha del vehículo), fondo del login y redes. */
export interface PublicSettingsDTO {
  sellerResponseHours: number;
  reservationHoldDays: number;
  commissionDueDays: number;
  loginBackgroundUrl: string | null;
  /** Foto de la portada que subió el administrador (null: la predeterminada de la web). */
  homeHeroUrl: string | null;
  socialLinks: SocialLinkDTO[];
}

/** Términos y Condiciones vigentes (editables desde el panel). */
export interface TermsDTO {
  content: string;
  updatedAt: string | null;
}

/** Ajustes del panel de administración. */
export interface AdminSettingsDTO extends PublicSettingsDTO {
  terms: TermsDTO;
  binance: BinancePayeeDTO;
}

/** Un cambio de ajustes, planes o catálogo (registro de auditoría). */
export interface SettingsHistoryEntryDTO {
  id: string;
  action: string;
  summary: string;
  actor: { name: string; email: string } | null;
  createdAt: string;
}

export const BlockedTermSchema = z.object({
  term: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(80)
    .regex(/^[\p{L}\p{N}][\p{L}\p{N} ]*$/u, 'Solo letras, números y espacios.'),
});

export const CarouselUpdateSchema = z.object({
  items: z
    .array(z.object({ vehicleId: z.uuid(), isActive: z.boolean().default(true) }))
    .max(12, 'El carrusel admite hasta 12 vehículos.'),
});
export type CarouselUpdateInput = z.infer<typeof CarouselUpdateSchema>;

export const UserStatusUpdateSchema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) });
export const UserRoleUpdateSchema = z.object({ role: z.enum(['USER', 'ADMIN', 'SUPERVISOR']) });

// ─────────────────────────────────────────────────── Estadísticas (panel) ──

export interface StatsBucketDTO {
  label: string;
  value: number;
}

/** Series mensuales reales (6 meses; el último es el mes en curso). */
export interface AdminStatsDTO {
  months: Array<{ key: string; current: boolean }>;
  /** Días transcurridos del mes en curso. */
  currentDays: number;
  sales: {
    months: Array<{ count: number; value: number; daysToSell: number | null }>;
    byBrand: StatsBucketDTO[];
    byCity: StatsBucketDTO[];
  };
  purchases: {
    months: Array<{ reservations: number; completed: number; cancelled: number; avgDeposit: number | null }>;
    outcome: { completed: number; cancelled: number; open: number };
  };
  cars: {
    months: Array<{ created: number; active: number }>;
    inventory: { published: number; reserved: number; negotiating: number; soldThisMonth: number };
    byCategory: StatsBucketDTO[];
  };
  users: {
    months: Array<{ created: number; verified: number; total: number }>;
    byCountry: StatsBucketDTO[];
  };
  plans: {
    months: Array<{ premium: number; basic: number; pro: number; plans: number; commissions: number; boosts: number; login: number; total: number }>;
  };
  dealers: {
    months: Array<{ active: number; withPlan: number; pro: number; sales: number; countries: number }>;
    list: Array<{ name: string; city: string | null; country: string | null; planCode: string; listings: number; soldLastMonth: number; sold6m: number; rating: number | null }>;
  };
}

// ─────────────────────────────────────────────────────── Resumen del panel ──

/** Calendario del Resumen: días del mes (1–31, hora de Venezuela) con vencimientos reales. */
export interface AdminCalendarDTO {
  month: string;
  today: string;
  /** Vence el plazo de una reserva confirmada. */
  reservations: number[];
  /** Vence una comisión post-venta sin pagar. */
  commissions: number[];
}

export type AdminActivityKind = 'KYC' | 'REPORT' | 'PAYMENT' | 'LISTING' | 'REVIEW';
export interface AdminActivityDTO {
  kind: AdminActivityKind;
  who: string;
  what: string;
  at: string;
  action: { label: string; href: string } | null;
}

export interface AdminSearchDTO {
  users: Array<{ id: string; name: string; email: string; accountType: 'INDIVIDUAL' | 'DEALER' }>;
  vehicles: Array<{ id: string; slug: string; title: string; seller: string; status: string }>;
  payments: Array<{ id: string; reference: string; user: string; amount: string; status: string }>;
}

/** Contadores de la bandeja de pagos. */
export interface AdminPaymentCountsDTO {
  review: number;
  refunds: number;
}

// ───────────────────────────────────────────────── Copiloto del admin (solo lectura) ──

/** Desglose de las ventas de un mes (mismo orden que `AdminStatsDTO.months`). */
export interface CopilotMonthDTO {
  brands: StatsBucketDTO[];
  cities: StatsBucketDTO[];
  /** Ventas y precio promedio por tipo de auto. */
  categories: Array<{ label: string; count: number; avgPrice: number }>;
  /** Concesionarios que más vendieron ese mes (hasta 5). */
  dealers: Array<{ name: string; city: string | null; planCode: string; sold: number; rating: number | null }>;
}

/**
 * Datos del Copiloto: las series de Estadísticas más los desgloses y alertas que se calculan con
 * reglas sobre la base (no usa un modelo de lenguaje y no cambia nada).
 */
export interface AdminCopilotDTO {
  adminName: string;
  /** Hora local de Venezuela (0–23), para el saludo. */
  localHour: number;
  stats: AdminStatsDTO;
  months: CopilotMonthDTO[];
  /** Cuentas y concesionarios verificados por país (código ISO o null). */
  countries: Array<{ code: string | null; users: number; dealers: number }>;
  plans: Array<{ code: 'PREMIUM' | 'DEALER_BASIC' | 'DEALER_PRO'; name: string; monthly: number; yearly: number }>;
  reports: {
    open: number;
    byReason: Record<ReportCaseReason, number>;
    /** Casos abiertos de posible fraude, el más reciente primero. */
    fraud: Array<{ code: string; title: string; price: number | null; diffPct: number | null; details: string | null; count: number }>;
  };
  /** Anuncios activos iguales del mismo vendedor (marca, modelo, año y kilometraje). */
  duplicates: Array<{ seller: string; title: string; count: number }>;
  /** Pagos manuales con Binance que esperan verificación. */
  payments: { count: number; total: number; items: Array<{ concept: string; amount: number }> };
  kyc: { pending: number };
  /** Pantalla de entrada de mañana (calendario de Venezuela). */
  login: { date: string; used: number; slots: number };
  /** Cupos de Portada ocupados ahora. */
  home: { used: number; slots: number };
  /** Cuentas creadas en el último mes completo y cuántas de ellas ya se verificaron. */
  verification: { created: number; verified: number };
  /** Concesionarios en plan Básico que ya venden cada semana o llenan su cupo. */
  upsell: Array<{ name: string; listings: number; soldLastMonth: number }>;
}

// ─────────────────────────────────────────────── Reportes (bandeja del diseño) ──

export const REPORT_DECISIONS = ['ARCHIVE', 'SUSPEND', 'WARN', 'DISMISS'] as const;
export type ReportDecision = (typeof REPORT_DECISIONS)[number];
/** Decisión sobre un caso (todas las denuncias abiertas del mismo anuncio, chat o perfil). */
export const ReportDecisionSchema = z.object({
  action: z.enum(REPORT_DECISIONS),
  /** Nota interna para el registro (la ve solo el equipo). */
  note: z.string().trim().max(400, 'La nota admite hasta 400 caracteres.').optional(),
});
export type ReportDecisionInput = z.infer<typeof ReportDecisionSchema>;

export type ReportCaseKind = 'VEHICLE' | 'USER' | 'CHAT';
export type ReportCaseReason = 'FRAUD' | 'WRONG_INFO' | 'OFFENSIVE' | 'SPAM' | 'OTHER';
export type ReportCaseStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED';

/** Un caso de la bandeja: las denuncias del mismo objeto agrupadas. */
export interface ReportCaseDTO {
  /** Id de la denuncia más reciente del caso (se usa para decidir). */
  id: string;
  /** Código visible «RP-XXXXX». */
  code: string;
  kind: ReportCaseKind;
  /** El motivo más grave del caso. */
  reason: ReportCaseReason;
  status: ReportCaseStatus;
  createdAt: string;
  /** Denuncias en el caso (personas distintas). */
  count: number;
  title: string;
  /** Mensaje del denunciante más reciente. */
  details: string | null;
  reporter: { name: string; many: boolean };
  reported: {
    id: string;
    name: string;
    dealer: boolean;
    planCode: string;
    verified: boolean;
    status: 'ACTIVE' | 'SUSPENDED';
    since: string;
    listings: number;
    /** Denuncias anteriores contra la misma persona (otros casos). */
    previousReports: number;
  } | null;
  vehicle: {
    id: string;
    slug: string;
    title: string;
    city: string;
    mileageKm: number;
    price: string;
    category: string;
    status: string;
    publishedAt: string | null;
    /** Valor de mercado con autos parecidos de AutoMarket (null si no hay suficientes). */
    market: { value: number; diffPct: number } | null;
  } | null;
  conversationId: string | null;
  /** Sugerencia del Copiloto (reglas con los datos del caso). */
  suggestion: string;
  resolution: { note: string | null; at: string | null; by: string | null } | null;
}

export interface ReportsBoardDTO {
  kpis: { open: number; fraud: number; resolvedThisWeek: number; avgResponseHours: number | null };
  counts: Record<ReportCaseStatus, number>;
  items: ReportCaseDTO[];
}

export interface ReportChatMessageDTO {
  id: string;
  author: string;
  role: 'BUYER' | 'SELLER';
  body: string | null;
  type: string;
  /** El mensaje lo ocultó el moderador (contacto o lenguaje). */
  hidden: boolean;
  /** Lo escribió la persona denunciada. */
  flagged: boolean;
  createdAt: string;
}

export interface ReportChatDTO {
  vehicleTitle: string;
  messages: ReportChatMessageDTO[];
}

export const ReportResolutionSchema = z.object({
  status: z.enum(REPORT_STATUSES).exclude(['OPEN']),
  note: z.string().trim().max(500).optional(),
  /** Retirar el anuncio denunciado. */
  archiveVehicle: z.boolean().default(false),
});

export const ReviewModerationSchema = z.object({ status: z.enum(REVIEW_STATUSES).exclude(['PENDING']) });

/** Verificación de un pago manual con Binance (el equipo comprueba la transacción en su app). */
export const PaymentReviewSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().trim().max(500).optional(),
});

/** Reembolso manual ya enviado desde Binance: se registra el id de esa transferencia. */
export const RefundCompleteSchema = z.object({
  refundTxId: z.string().trim().min(6, 'Indica el ID de la transferencia de reembolso.').max(100),
});

export const EXPORT_DATASETS = ['sales', 'reservations', 'vehicles', 'users', 'dealers', 'memberships', 'payments', 'reports', 'reviews'] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];
export const EXPORT_FORMATS = ['xlsx', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface AdminMetricsDTO {
  currency: string;
  totals: {
    revenue: number;
    membershipRevenue: number;
    /** Comisiones post-venta cobradas. */
    commissions: number;
    /** Comisiones post-venta generadas y aún sin pagar (las vencidas, aparte). */
    commissionsPending: number;
    commissionsOverdue: number;
    /** Destacar y pantalla de entrada cobrados (BOOST_REVENUE). */
    boosts: number;
  };
  /** Lo cobrado en el periodo pedido (los mismos meses de `monthly`) y en el periodo anterior de igual largo. */
  period: { months: number; membership: number; commissions: number; boosts: number; revenue: number; previousRevenue: number };
  monthly: Array<{ month: string; membership: number; commission: number; boosts: number }>;
  counts: { users: number; dealers: number; activeListings: number; acceptedReservations: number; completedSales: number; paidMemberships: number };
  plans: Array<{ code: string; users: number }>;
}

/** Comisión post-venta pendiente (vista del panel). */
export interface AdminCommissionDTO {
  recordId: string;
  recordType: 'RESERVATION' | 'VEHICLE_SALE';
  seller: { id: string; name: string; email: string; phone: string | null; businessName: string | null };
  vehicleTitle: string;
  salePrice: string;
  commissionAmount: string;
  currency: string;
  completedAt: string;
  commissionDueAt: string;
  overdue: boolean;
  payment: { id: string; status: string; reference: string } | null;
}

// ─────────────────────────────────────────────────────────── Vitrina pública ──

export const ContactSchema = z.object({
  name: z.string().trim().min(2, 'Indica tu nombre.').max(120),
  email: EmailSchema,
  subject: z.string().trim().max(160).optional(),
  message: z.string().trim().min(10, 'Cuéntanos un poco más (mínimo 10 caracteres).').max(4000),
  ...HumanCheckSchema.shape,
});
export type ContactInput = z.infer<typeof ContactSchema>;

export const ReviewSubmitSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().min(10, 'Escribe al menos 10 caracteres.').max(1000),
});

export interface PublicReviewDTO {
  id: string;
  rating: number;
  comment: string;
  author: string;
  city: string | null;
  createdAt: string;
}
