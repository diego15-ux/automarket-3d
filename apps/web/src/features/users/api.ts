import type { SellerProfileDTO, SellerRatingOpportunityDTO } from '@automarket/contracts';
import { api } from '@/shared/lib/http';

export const usersApi = {
  sellerProfile: (id: string) => api.get<SellerProfileDTO>(`/api/users/${id}/profile`),
  sellerRatingOpportunities: (id: string) => api.get<SellerRatingOpportunityDTO[]>(`/api/users/${id}/rating-opportunities`),
  rateSeller: (reservationId: string, rating: number, comment?: string) => api.post<{ rating: number; comment: string | null }>(`/api/reservations/${reservationId}/rating`, { rating, ...(comment !== undefined && { comment }) }),
  /** Denuncia anónima del perfil (la revisa el equipo en Moderación). */
  report: (id: string, input: { reason: string; details?: string }) => api.post<{ message: string }>(`/api/users/${id}/report`, input),
};
