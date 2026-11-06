import { z } from 'zod';
import type { PlanCode, VehicleCategory } from './enums.js';
import type { CopilotBlockDTO, CopilotChipDTO, VehicleCardDTO } from './vehicles.js';

/** Panel del concesionario (diseños «concesionario-pc» y «concesionario-movil»): todo sale de la base. */
export type DealerPriceCheck = 'GOOD' | 'FAIR' | 'HIGH';

export interface DealerInventoryItemDTO {
  id: string;
  slug: string;
  title: string;
  make: string;
  model: string;
  year: number;
  mileageKm: number;
  manual: boolean;
  price: number;
  status: 'ACTIVE' | 'RESERVED' | 'PAUSED';
  /** Vistas contadas (una por persona y día) desde que empezó el conteo. */
  views: number;
  /** Conversaciones abiertas por compradores en el chat. */
  contacts: number;
  /** Días desde que se publicó. */
  days: number;
  category: VehicleCategory;
  coverUrl: string | null;
  /** Días que le quedan de destacado (null si no lo está). */
  featuredDaysLeft: number | null;
  /** Precio contra autos parecidos de AutoMarket (null si no hay suficientes). */
  priceCheck: { level: DealerPriceCheck; diffPct: number; market: number; sample: number } | null;
}

export interface DealerContactDTO {
  conversationId: string;
  buyerName: string;
  vehicleTitle: string;
  lastMessage: string | null;
  at: string;
  unread: boolean;
}

export type DealerTipDTO =
  | { kind: 'STALE'; text: string; count: number }
  | { kind: 'PRICE'; text: string; vehicleId: string; title: string; suggestedPrice: number }
  | { kind: 'FEATURE'; text: string; vehicleId: string; title: string };

export interface DealerDashboardDTO {
  dealer: { id: string; name: string; taxId: string | null; verified: boolean; planCode: PlanCode; planName: string; city: string | null; planExpiresAt: string | null; commissionRate: number };
  /** Hoy en Venezuela (AAAA-MM-DD). */
  today: string;
  /** Desde cuándo hay vistas contadas (null si todavía ninguna). */
  viewsSince: string | null;
  badges: { activeListings: number; unreadMessages: number; pendingReservations: number };
  kpis: { views7: number; viewsPrev7: number; contacts7: number; contactsPrev7: number; activeReservations: number; activeListings: number; maxListings: number | null };
  /** Últimos 14 días, el último es hoy. */
  series: Array<{ day: string; views: number; contacts: number }>;
  inventory: DealerInventoryItemDTO[];
  contacts: DealerContactDTO[];
  plan: { featuredSlots: number; featuredInUse: number; monthlyCredits: number; creditUsedThisMonth: boolean };
  tips: DealerTipDTO[];
}

/** Reseña de quien compró con reserva (estrellas y, si quiso, un comentario). */
export interface DealerPageReviewDTO {
  id: string;
  rating: number;
  comment: string | null;
  /** Nombre corto del comprador (p. ej. «Ana R.»). */
  buyer: string;
  vehicleTitle: string;
  createdAt: string;
}

/** Página pública del concesionario (diseño «concesionario-publico-pc»): todo sale de la base. */
export interface DealerPageDTO {
  id: string;
  name: string;
  initials: string;
  avatarUrl: string | null;
  /** RIF aprobado por cumplimiento. */
  verified: boolean;
  /** Aliado del directorio (se puede seguir). */
  ally: boolean;
  city: string | null;
  country: string | null;
  /** Dirección fiscal y RIF: públicos solo con un plan de concesionario vigente (como en la ficha). */
  address: string | null;
  hours: string | null;
  bio: string | null;
  taxId: string | null;
  memberSince: string;
  ratingAverage: number | null;
  ratingCount: number;
  activeListings: number;
  /** Ventas concretadas en AutoMarket (con reserva o directas con la comisión pagada). */
  soldCount: number;
  /** Mediana de minutos hasta la primera respuesta en el chat (últimos 90 días; null si hay menos de 3 casos). */
  responseMinutes: number | null;
  following: boolean;
  isOwner: boolean;
  vehicles: VehicleCardDTO[];
  reviews: DealerPageReviewDTO[];
}

// ── Copiloto para agencias: precios, demanda, descripciones y respuestas con datos reales (sin IA) ──

export const DealerCopilotAskSchema = z.object({
  text: z.string().trim().max(240).default(''),
  action: z.enum(['start']).optional(),
  /** Auto del inventario del que se viene hablando (lo devuelve la respuesta anterior). */
  vehicleId: z.uuid().nullish(),
});
export type DealerCopilotAskInput = z.infer<typeof DealerCopilotAskSchema>;

export const DealerCopilotOverviewQuerySchema = z.object({ vehicleId: z.uuid().optional() });

/** Precio sugerido: anuncios parecidos activos (mitad) + ventas cerradas (mitad), ajustado por km. */
export interface DealerSuggestionDTO {
  vehicleId: string | null;
  title: string;
  price: number;
  /** Precio publicado de la agencia (null si el auto no es suyo). */
  current: number | null;
  /** (publicado − sugerido) / sugerido. */
  diff: number | null;
  listings: { count: number; avg: number | null };
  sales: { count: number; avg: number | null };
  /** 30 % + 8 % por dato, hasta 95 %. */
  confidence: number;
  level: 'alta' | 'media' | 'baja';
  /** Días que tardaron en venderse los parecidos (null: no hay ventas con fecha de publicación). */
  baseDays: number | null;
  /** Días estimados a su precio actual (más si está caro, menos si está barato). */
  days: number | null;
}

export interface DealerCopilotInventoryItemDTO {
  id: string;
  slug: string;
  title: string;
  model: string;
  year: number;
  price: number;
  mileageKm: number;
  days: number;
  photos: number;
  views: number;
  contacts: number;
}

export interface DealerCopilotEventDTO {
  type: 'listing' | 'sale' | 'contact';
  text: string;
  at: string;
}

export interface DealerCopilotOverviewDTO {
  dealer: { name: string; city: string | null; country: string | null };
  inventory: DealerCopilotInventoryItemDTO[];
  /** Anuncios activos y ventas cerradas (90 días) en el país de la agencia; contactos propios de 7 días. */
  counts: { listings: number; sales: number; contacts: number };
  /** Lo último que pasó: anuncios y ventas del país y contactos a tus autos (con su hora real). */
  feed: DealerCopilotEventDTO[];
  suggestion: DealerSuggestionDTO | null;
}

export type DealerCopilotBlockDTO =
  | CopilotBlockDTO
  | { type: 'quote'; text: string }
  | {
      type: 'demand';
      title: string;
      rows: Array<{ segment: string; views: number; contacts: number; listings: number; tag: 'high' | 'normal' | 'low' }>;
    }
  | { type: 'replies'; to: string; conversationId: string; items: Array<{ tone: string; text: string }> };

export interface DealerCopilotReplyDTO {
  blocks: DealerCopilotBlockDTO[];
  chips: CopilotChipDTO[];
  vehicleId: string | null;
}
