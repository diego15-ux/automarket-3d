import type { ChatDealDTO } from '@automarket/contracts';
import { api, apiFetch } from '@/shared/lib/http';
import type { PresignedUpload } from '@/shared/lib/upload';
import type { ChatMessage, ConversationSummary, MediaType } from './types';

export const MESSAGES_PAGE_SIZE = 30;

export const chatKeys = {
  conversations: ['conversations'] as const,
  messages: (conversationId: string) => ['conversations', conversationId, 'messages'] as const,
  deal: (conversationId: string) => ['conversations', conversationId, 'deal'] as const,
};

export const chatApi = {
  /** "Contactar al vendedor": abre o reutiliza el hilo del vehículo. */
  open: (vehicleId: string) => apiFetch<{ data: { id: string } }>('/api/conversations', { method: 'POST', body: { vehicleId } }).then(response => response.data),

  list: () => apiFetch<{ data: ConversationSummary[] }>('/api/conversations').then(response => response.data),

  /** Historial hacia atrás: del más reciente al más antiguo. */
  messages: (conversationId: string, before?: string) => {
    const query = new URLSearchParams({ limit: String(MESSAGES_PAGE_SIZE), ...(before ? { before } : {}) });
    return apiFetch<{ data: ChatMessage[] }>(`/api/conversations/${conversationId}/messages?${query}`).then(response => response.data);
  },

  /** «El trato»: estado de la reserva y la venta, eventos del hilo y plazos. */
  deal: (conversationId: string) => api.get<ChatDealDTO>(`/api/conversations/${conversationId}/deal`),

  /** Reporte anónimo de la otra persona. */
  report: (conversationId: string, input: { reason: string; details?: string }) => api.post<{ message: string }>(`/api/conversations/${conversationId}/report`, input),

  requestUpload: (input: { conversationId: string; type: MediaType; mimeType: string; sizeBytes: number }) =>
    apiFetch<{ data: PresignedUpload }>('/api/media/chat-uploads', { method: 'POST', body: input }).then(response => response.data),
};
