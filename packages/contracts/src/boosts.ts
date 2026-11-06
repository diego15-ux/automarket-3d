import { z } from 'zod';
import { PAYMENT_METHODS, type PaymentDTO, type PaymentMethodsDTO } from './commerce.js';
import type { VehicleCategory } from './enums.js';

// ─────────────────────────────────────────────── Destacar (impulsos pagados) ──

/**
 * CITY_3D «Impulso» (3 días en su zona) · CITY_7D «Semana destacada» (7 días, comparte cupo) ·
 * HOME «Portada» (7 días en todo el país) · LOGIN «Pantalla de entrada» (1 a 3 días seguidos).
 */
export const BOOST_KINDS = ['CITY_3D', 'CITY_7D', 'HOME', 'LOGIN'] as const;
export type BoostKind = (typeof BOOST_KINDS)[number];
export const ZONE_BOOST_KINDS = ['CITY_3D', 'CITY_7D', 'HOME'] as const;
export type BoostStatus = 'PENDING_PAYMENT' | 'WAITLISTED' | 'SCHEDULED' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';

export const BOOST_LABELS: Record<BoostKind, string> = {
  CITY_3D: 'Impulso',
  CITY_7D: 'Semana destacada',
  HOME: 'Portada',
  LOGIN: 'Pantalla de entrada',
};
/** Días fijos de los impulsos de zona y portada. */
export const BOOST_DAYS: Record<Exclude<BoostKind, 'LOGIN'>, number> = { CITY_3D: 3, CITY_7D: 7, HOME: 7 };

/** Regla fija: máximo 3 días seguidos por compra en la pantalla de entrada. */
export const LOGIN_MAX_DAYS = 3;
/** El mismo anuncio vuelve a la pantalla de entrada desde el fin de su turno + 2 días (uno libre en medio). */
export const LOGIN_REST_DAYS = 2;
/** Autos destacados a la vez por persona (cualquier impulso activo o programado). */
export const MAX_BOOSTED_LISTINGS = 4;
/** Calendario de los turnos: hora de Venezuela (corte a las 11:59 p. m.). */
export const BOOST_TIMEZONE = 'America/Caracas';

export const BoostCheckoutSchema = z.object({
  vehicleId: z.uuid(),
  kind: z.enum(BOOST_KINDS),
  /** Solo pantalla de entrada: 1, 2 o 3 días. */
  days: z.coerce.number().int().min(1).max(LOGIN_MAX_DAYS).optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
});
export type BoostCheckoutInput = z.infer<typeof BoostCheckoutSchema>;

export const BoostWaitlistSchema = z.object({ vehicleId: z.uuid(), kind: z.enum(ZONE_BOOST_KINDS) });

const price = z.coerce.number().min(0.5, 'El precio mínimo es 0,50.').max(10_000);
const slots = (max: number) => z.coerce.number().int().min(1, 'Al menos 1 cupo.').max(max);
/** Precios (USDT) y cupos de «Destacar»: solo el administrador. */
export const BoostSettingsSchema = z.object({
  city3: price,
  city7: price,
  home: price,
  login1: price,
  login2: price,
  login3: price,
  citySlots: slots(20),
  homeSlots: slots(50),
  loginSlots: slots(24),
  /** Vender la «Pantalla de entrada» (apagado mientras el login no muestre autos). */
  loginOnSale: z.boolean().optional(),
});
export type BoostSettingsInput = z.infer<typeof BoostSettingsSchema>;

export interface BoostSettingsDTO {
  prices: { city3: string; city7: string; home: string; login: [string, string, string] };
  slots: { city: number; home: number; login: number };
  /** La «Pantalla de entrada» se puede comprar (si no, Destacar no la ofrece). */
  loginOnSale: boolean;
}

export interface BoostZoneDTO {
  /** «VE:caracas:SUV» */
  key: string;
  /** «Camionetas en Valencia» */
  label: string;
  total: number;
  /** Activos + pagados en cola. */
  used: number;
  /** Cuándo se libera el próximo cupo (si está lleno). */
  nextOpenAt: string | null;
}

export interface BoostListingDTO {
  id: string;
  slug: string;
  title: string;
  price: string;
  currency: string;
  city: string;
  country: string;
  category: VehicleCategory;
  coverUrl: string | null;
  daysPublished: number;
  zone: BoostZoneDTO;
  /** Impulso de zona o portada vigente (activo o en cola). */
  activeBoost: { kind: BoostKind; until: string | null } | null;
  /** Pantalla de entrada: fin del turno vigente y desde cuándo puede volver (AAAA-MM-DD). */
  login: { currentEnd: string | null; restFrom: string | null };
  /** Hay un pago enviado por revisar para este anuncio. */
  pendingReview: boolean;
}

export interface BoostOptionsDTO {
  /** Hoy en America/Caracas (AAAA-MM-DD). */
  today: string;
  settings: BoostSettingsDTO;
  limit: { max: number; active: number };
  listings: BoostListingDTO[];
  home: { total: number; used: number; nextOpenAt: string | null };
  /** Cupos ocupados por día en la pantalla de entrada, desde hoy (60 días). */
  loginOccupancy: Array<{ date: string; used: number }>;
  /** Impulso más comprado en los últimos 90 días (sello «El más elegido»). */
  popularKind: BoostKind | null;
  payment: PaymentMethodsDTO;
}

export interface BoostPreviewRowDTO {
  id: string;
  title: string;
  price: string;
  coverUrl: string | null;
  category: VehicleCategory;
  mine: boolean;
}

/** «Así te ven en el catálogo de {ciudad}»: puesto real del anuncio en su ciudad y con impulso. */
export interface BoostPreviewDTO {
  city: string;
  position: number;
  boostedPosition: number;
  total: number;
  rows: BoostPreviewRowDTO[];
}

export interface BoostDTO {
  id: string;
  kind: BoostKind;
  days: number;
  status: BoostStatus;
  amount: string;
  zoneLabel: string | null;
  vehicle: { id: string; slug: string; title: string };
  startsAt: string | null;
  endsAt: string | null;
  wantDate: string | null;
  startDate: string | null;
  endDate: string | null;
  turn: number | null;
  moved: boolean;
  paidAt: string | null;
  createdAt: string;
  paymentId: string | null;
}

export interface BoostCheckoutDTO {
  boost: BoostDTO;
  payment: PaymentDTO;
}

export interface BoostWaitlistDTO {
  boost: BoostDTO;
  nextOpenAt: string | null;
}

/** Panel «Pantalla de entrada»: estado de cada compra según el motor de turnos. */
export type LoginSpotState = 'LIVE' | 'SCHEDULED' | 'PENDING' | 'EXPIRED' | 'CANCELLED';

export interface LoginSpotDTO {
  boostId: string;
  paymentId: string | null;
  reference: string | null;
  paymentStatus: string | null;
  txId: string | null;
  turn: number | null;
  state: LoginSpotState;
  vehicle: { id: string; slug: string; title: string; year: number; price: string; city: string; coverUrl: string | null; category: VehicleCategory };
  seller: { name: string; dealer: boolean };
  amount: string;
  days: number;
  wantDate: string | null;
  startDate: string | null;
  endDate: string | null;
  moved: boolean;
  paidAt: string | null;
  createdAt: string;
}

export interface LoginSpotsDTO {
  today: string;
  slots: number;
  prices: [string, string, string];
  items: LoginSpotDTO[];
  /** Próximos 7 días desde hoy. */
  days: Array<{ date: string; used: number }>;
  collected: string;
  pending: string;
}
