import type { ContactCardDTO, DealStatus, NotificationDTO } from '@automarket/contracts';

/** Tipos del chat en la web. El contrato de eventos es el de @automarket/contracts (mismas formas). */
export type MessageType = 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO';
export type MediaType = Exclude<MessageType, 'TEXT'>;

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  clientId: string;
  type: MessageType;
  body: string | null;
  media: {
    url: string;
    mimeType: string;
    sizeBytes: number;
    durationMs: number | null;
    width: number | null;
    height: number | null;
  } | null;
  moderationFlags: string[];
  createdAt: string;
}

export interface ConversationSummary {
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
  /** Reserva confirmada: datos verificados de la otra parte y notas de voz. */
  direct: boolean;
  contact: ContactCardDTO | null;
}

export type SendMessagePayload =
  | { conversationId: string; clientId: string; type: 'TEXT'; text: string }
  | {
      conversationId: string;
      clientId: string;
      type: MediaType;
      caption?: string;
      media: { key: string; mimeType: string; sizeBytes: number; durationMs?: number; width?: number; height?: number };
    };

export type AckResponse<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export interface ServerToClientEvents {
  'message:new': (message: ChatMessage) => void;
  'message:read': (payload: { conversationId: string; userId: string; readAt: string }) => void;
  typing: (payload: { conversationId: string; userId: string; isTyping: boolean }) => void;
  'inbox:updated': (payload: { conversationId: string; lastMessage: ChatMessage }) => void;
  /** Cambió el trato (reserva, negociación, venta) de una conversación. */
  'deal:updated': (payload: { conversationId: string }) => void;
  /** Avisos de reservas, membresía y anuncios (campana de la cabecera). */
  'notification:new': (payload: NotificationDTO) => void;
}

export interface ClientToServerEvents {
  'conversation:join': (payload: { conversationId: string }, ack: (response: AckResponse<{ conversationId: string }>) => void) => void;
  'conversation:leave': (payload: { conversationId: string }) => void;
  'message:send': (payload: SendMessagePayload, ack: (response: AckResponse<ChatMessage>) => void) => void;
  'message:read': (payload: { conversationId: string }, ack: (response: AckResponse<{ readAt: string }>) => void) => void;
  typing: (payload: { conversationId: string; isTyping: boolean }) => void;
}

/** Mensaje propio aún no confirmado por el servidor (envío optimista). */
export interface OutgoingMessage {
  clientId: string;
  type: MessageType;
  text?: string;
  file?: File;
  /** URL local (blob:) para previsualizar imágenes, vídeos y audios antes de subirlos. */
  previewUrl?: string;
  durationMs?: number;
  width?: number;
  height?: number;
  /** Clave en S3 tras subir: un reintento no vuelve a subir el archivo. */
  uploadedKey?: string;
  progress?: number;
  state: 'sending' | 'failed';
  error?: string;
  createdAt: string;
}
