import type { AlertsOverviewDTO, PriceDropAlertDTO, SearchAlertCreateInput, SearchAlertDTO } from '@automarket/contracts';
import { api } from '@/shared/lib/http';

export const alertKeys = { overview: ['alerts'] as const };

export const alertsApi = {
  overview: () => api.get<AlertsOverviewDTO>('/api/alerts'),
  create: (input: Partial<SearchAlertCreateInput>) => api.post<SearchAlertDTO>('/api/alerts', input),
  setActive: (id: string, active: boolean) => api.patch<SearchAlertDTO>(`/api/alerts/${id}`, { active }),
  markSeen: (id: string) => api.post<void>(`/api/alerts/${id}/seen`, {}),
  remove: (id: string) => api.delete(`/api/alerts/${id}`),
  /** «Bajadas de precio en tus guardados». */
  setPriceDrops: (active: boolean) => api.put<PriceDropAlertDTO>('/api/alerts/price-drops', { active }),
};
