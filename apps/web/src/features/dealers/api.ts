import type { DealerCopilotAskInput, DealerCopilotOverviewDTO, DealerCopilotReplyDTO, DealerDashboardDTO, DealerDirectoryEntryDTO, DealerPageDTO } from '@automarket/contracts';
import { api } from '@/shared/lib/http';

export const dealerKeys = {
  directory: (viewer: string) => ['dealers', viewer] as const,
  dashboard: ['dealers', 'me', 'dashboard'] as const,
  copilot: (vehicleId: string) => ['dealers', 'me', 'copilot', vehicleId] as const,
};

export const dealersApi = {
  directory: () => api.get<DealerDirectoryEntryDTO[]>('/api/dealers'),
  follow: (id: string) => api.put<{ following: true; name: string }>(`/api/dealers/${id}/follow`, {}),
  unfollow: (id: string) => api.delete(`/api/dealers/${id}/follow`),
  dashboard: () => api.get<DealerDashboardDTO>('/api/dealers/me/dashboard'),
  /** Página pública de la agencia (/vendedores/[id] cuando es concesionario). */
  page: (id: string) => api.get<DealerPageDTO>(`/api/dealers/${id}/page`),
  /** Copiloto para agencias: resumen del costado (precio sugerido de un auto, cifras y lo último del mercado). */
  copilotOverview: (vehicleId?: string) => api.get<DealerCopilotOverviewDTO>(`/api/dealers/me/copilot${vehicleId ? `?vehicleId=${vehicleId}` : ''}`),
  copilotAsk: (input: DealerCopilotAskInput) => api.post<DealerCopilotReplyDTO>('/api/dealers/me/copilot', input),
};
