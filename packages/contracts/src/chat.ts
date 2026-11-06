import type { ContactCardDTO, ReservationDTO } from './commerce.js';
import { z } from 'zod';

/** Contrato de eventos Socket.io del chat (API ↔ web). */
export type MessageType = 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO';
export type ChatMediaType = Exclude<MessageType, 'TEXT'>;

export const ConversationRefSchema = z.object({ conversationId: z.uuid() });
export const TypingSchema = ConversationRefSchema.extend({ isTyping: z.boolean() });

const messageBase = {
  conversationId: z.uuid(),
  /** UUID generado en el cliente: permite reintentos sin duplicar mensajes. */
  clientId: z.string().min(8).max(64),
};

export const SendMessageSchema = z.discriminatedUnion('type', [
  z.object({ ...messageBase, type: z.literal('TEXT'), text: z.string().trim().min(1).max(2000) }),
  z.object({
    ...messageBase,
    type: z.enum(['IMAGE', 'VIDEO', 'AUDIO']),
    caption: z.string().trim().max(500).optional(),
    media: z.object({
      key: z.string().min(1).max(512),
      mimeType: z.string().min(3).max(100),
      sizeBytes: z.number().int().positive(),
      durationMs: z.number().int().positive().optional(),
      width: z.number().int().positive().max(20_000).optional(),
      height: z.number().int().positive().max(20_000).optional(),
    }),
  }),
]);
export type SendMessageInput = z.infer<typeof SendMessageSchema>;

export const ChatUploadSchema = z.object({
  conversationId: z.uuid(),
  type: z.enum(['IMAGE', 'VIDEO', 'AUDIO']),
  mimeType: z.string().min(3).max(100),
  sizeBytes: z.number().int().positive(),
});

export interface ChatMessageDTO {
  id: string;
  conversationId: string;
  senderId: string;
  clientId: string;
  type: MessageType;
  body: string | null;
  media: { url: string; mimeType: string; sizeBytes: number; durationMs: number | null; width: number | null; height: number | null } | null;
  moderationFlags: string[];
  createdAt: string;
}

/**
 * Estado del trato en una conversación (comprador ↔ vendedor de un auto):
 * AVAILABLE (consulta) → REQUESTED (reserva pedida) → RESERVED (reserva confirmada) →
 * NEGOTIATING (en negociación) → SOLD. UNAVAILABLE: el auto se reservó o vendió a otra persona,
 * o el anuncio ya no está publicado.
 */
export type DealStatus = 'AVAILABLE' | 'REQUESTED' | 'RESERVED' | 'NEGOTIATING' | 'SOLD' | 'UNAVAILABLE';
/** Lo que ve el público del auto (catálogo y ficha). */
export type PublicDealStatus = 'AVAILABLE' | 'RESERVED' | 'NEGOTIATING' | 'SOLD' | 'UNAVAILABLE';

/** Eventos del trato que se pintan en el hilo (salen de las reservas reales entre ambos). */
export type DealEventKind =
  | 'ASKED'
  | 'REQUESTED'
  | 'WITHDRAWN'
  | 'REQUEST_EXPIRED'
  | 'REJECTED'
  | 'REJECTED_OTHER'
  | 'ACCEPTED'
  | 'NEGOTIATING'
  | 'CANCELLED'
  | 'NOT_CONCLUDED'
  | 'EXPIRED'
  | 'SOLD';

export interface DealEventDTO {
  id: string;
  kind: DealEventKind;
  at: string;
  /** Quién lo hizo (null = el sistema). */
  by: 'BUYER' | 'SELLER' | 'TEAM' | null;
  /** Abono (pedido/confirmado) o precio final (vendido). */
  amount: string | null;
  /** Hasta cuándo queda apartado (reserva confirmada). */
  until: string | null;
}

export interface ChatDealDTO {
  conversationId: string;
  role: 'BUYER' | 'SELLER';
  status: DealStatus;
  publicStatus: PublicDealStatus;
  vehicle: {
    id: string;
    slug: string;
    make: string;
    model: string;
    version: string | null;
    year: number;
    mileageKm: number;
    transmission: string;
    city: string;
    country: string;
    price: string;
    currency: string;
    status: string;
    coverUrl: string | null;
    reservationAmount: string | null;
  };
  buyer: { id: string; name: string };
  seller: { id: string; name: string; isVerified: boolean };
  /** Última reserva entre ambos (abierta o cerrada). */
  reservation: ReservationDTO | null;
  events: DealEventDTO[];
  /** Personas que pidieron «Avísame si vuelve» para este auto. */
  watchers: number;
  /** Plazos vigentes: respuesta del vendedor (horas) y duración de la reserva (días). */
  rules: { sellerResponseHours: number; reservationHoldDays: number };
  /** Comisión del plan del vendedor al marcar vendido (solo la ve el vendedor). */
  commissionRate: number | null;
}

export const CHAT_REPORT_REASONS = ['FRAUD', 'OFFENSIVE', 'SPAM', 'OTHER'] as const;
export const ConversationReportSchema = z.object({
  reason: z.enum(CHAT_REPORT_REASONS),
  details: z.string().trim().max(2000).optional(),
});

export interface ConversationSummaryDTO {
  id: string;
  lastMessageAt: string | null;
  role: 'BUYER' | 'SELLER';
  unread: boolean;
  /** Mensajes de la otra persona sin leer. */
  unreadCount: number;
  /** Hasta cuándo leyó la otra persona («Visto»). */
  counterpartLastReadAt: string | null;
  /** Último mensaje (texto ya filtrado por el servidor). */
  lastMessage: { type: MessageType; body: string | null; mine: boolean; hidden: boolean } | null;
  dealStatus: DealStatus;
  vehicle: { id: string; slug: string; make: string; model: string; year: number };
  counterpart: { id: string; name: string; avatarUrl: string | null; isVerified?: boolean };
  /** Chat directo: reserva confirmada → datos verificados de la otra parte y notas de voz. */
  direct: boolean;
  contact: ContactCardDTO | null;
}

export type AckResponse<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
type Ack<T> = (response: AckResponse<T>) => void;

export interface ClientToServerEvents {
  'conversation:join': (payload: { conversationId: string }, ack: Ack<{ conversationId: string }>) => void;
  'conversation:leave': (payload: { conversationId: string }) => void;
  'message:send': (payload: SendMessageInput, ack: Ack<ChatMessageDTO>) => void;
  'message:read': (payload: { conversationId: string }, ack: Ack<{ readAt: string }>) => void;
  typing: (payload: { conversationId: string; isTyping: boolean }) => void;
}

export interface ServerToClientEvents {
  'message:new': (message: ChatMessageDTO) => void;
  'message:read': (payload: { conversationId: string; userId: string; readAt: string }) => void;
  typing: (payload: { conversationId: string; userId: string; isTyping: boolean }) => void;
  'inbox:updated': (payload: { conversationId: string; lastMessage: ChatMessageDTO }) => void;
  /** Cambió el trato (reserva, negociación, venta): la web vuelve a pedir el estado. */
  'deal:updated': (payload: { conversationId: string }) => void;
  /** Avisos de reservas, membresía, KYC… (campana de notificaciones). */
  'notification:new': (payload: NotificationDTO) => void;
}

/** Espacio público (/public): sin sesión, solo métricas de la landing. */
export interface PublicServerToClientEvents {
  stats: (payload: PublicStatsDTO) => void;
}

export interface PublicStatsDTO {
  users: number;
  vehicles: number;
}

export interface NotificationDTO {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}
