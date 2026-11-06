import type { PaymentDTO, PublicSettingsDTO, ReservationDTO, SaleCommissionCheckoutInput } from '@automarket/contracts';
import { api } from '@/shared/lib/http';

export const reservationKeys = {
  all: ['reservations'] as const,
  list: (as: 'buyer' | 'seller') => ['reservations', as] as const,
  forVehicle: (vehicleId: string) => ['reservations', 'vehicle', vehicleId] as const,
  terms: ['reservations', 'terms'] as const,
};

export const reservationsApi = {
  /** Plazos vigentes: respuesta del vendedor, duración de la reserva y pago de la comisión. */
  terms: () => api.get<PublicSettingsDTO>('/api/public/settings'),
  list: (as: 'buyer' | 'seller') => api.get<ReservationDTO[]>(`/api/reservations?as=${as}`),
  forVehicle: (vehicleId: string) => api.get<ReservationDTO | null>(`/api/reservations/vehicle/${vehicleId}`),
  /** Solicita la reserva tras aceptar el aviso legal. Sin cobro: el abono se paga directamente al vendedor. */
  create: (vehicleId: string) => api.post<ReservationDTO>('/api/reservations', { vehicleId, acceptLegal: true }),
  accept: (id: string, note?: string) => api.post<ReservationDTO>(`/api/reservations/${id}/accept`, { note }),
  reject: (id: string, note?: string) => api.post<ReservationDTO>(`/api/reservations/${id}/reject`, { note }),
  cancel: (id: string, note?: string) => api.post<ReservationDTO>(`/api/reservations/${id}/cancel`, { note }),
  /** El vendedor avisa que está cerrando la venta: el público lo ve «En negociación». */
  negotiate: (id: string) => api.post<ReservationDTO>(`/api/reservations/${id}/negotiate`, {}),
  complete: (id: string, salePrice: string) => api.post<ReservationDTO>(`/api/reservations/${id}/complete`, { salePrice }),
  /** Cobro de la comisión post-venta con Binance (QR de Binance Pay o instrucciones del Pay ID). */
  payCommission: (id: string, input: SaleCommissionCheckoutInput) => api.post<PaymentDTO>(`/api/reservations/${id}/commission/checkout`, input),
  rateSeller: (id: string, rating: number) => api.post<{ rating: number }>(`/api/reservations/${id}/rating`, { rating }),
};
