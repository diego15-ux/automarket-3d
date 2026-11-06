import type { BoostCheckoutDTO, BoostCheckoutInput, BoostDTO, BoostOptionsDTO, BoostPreviewDTO, BoostSettingsDTO, BoostSettingsInput, BoostWaitlistDTO, LoginSpotsDTO } from '@automarket/contracts';
import { api } from '@/shared/lib/http';

export const boostKeys = {
  options: ['boosts', 'options'] as const,
  preview: (vehicleId: string) => ['boosts', 'preview', vehicleId] as const,
  settings: ['admin', 'boost-settings'] as const,
  loginSpots: ['admin', 'login-spots'] as const,
};

export const boostsApi = {
  options: () => api.get<BoostOptionsDTO>('/api/boosts/options'),
  preview: (vehicleId: string) => api.get<BoostPreviewDTO>(`/api/boosts/preview?vehicleId=${vehicleId}`),
  checkout: (input: BoostCheckoutInput) => api.post<BoostCheckoutDTO>('/api/boosts', input),
  waitlist: (input: { vehicleId: string; kind: 'CITY_3D' | 'CITY_7D' | 'HOME' }) => api.post<BoostWaitlistDTO>('/api/boosts/waitlist', input),
  get: (id: string) => api.get<BoostDTO>(`/api/boosts/${id}`),
  settings: () => api.get<BoostSettingsDTO>('/api/admin/settings/boosts'),
  updateSettings: (input: BoostSettingsInput) => api.put<BoostSettingsDTO>('/api/admin/settings/boosts', input),
  loginSpots: () => api.get<LoginSpotsDTO>('/api/admin/login-spots'),
};
