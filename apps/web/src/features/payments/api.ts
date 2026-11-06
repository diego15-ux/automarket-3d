import type { PaymentDTO, PaymentMethodsDTO, PaymentSubmitInput } from '@automarket/contracts';
import { api } from '@/shared/lib/http';

export const paymentKeys = {
  methods: ['payments', 'methods'] as const,
  detail: (id: string) => ['payments', id] as const,
};

/** Pagos con Binance: métodos disponibles, estado, comprobante manual y cancelación. */
export const paymentsApi = {
  methods: () => api.get<PaymentMethodsDTO>('/api/payments/methods'),
  get: (id: string) => api.get<PaymentDTO>(`/api/payments/${id}`),
  submit: (id: string, input: PaymentSubmitInput) => api.post<PaymentDTO>(`/api/payments/${id}/submit`, input),
  cancel: (id: string) => api.post<PaymentDTO>(`/api/payments/${id}/cancel`),
};

/** Estados en los que la página de pago sigue consultando (Binance Pay confirma por webhook). */
export const isWaiting = (payment: PaymentDTO) => payment.status === 'PENDING' || payment.status === 'SUBMITTED' || payment.status === 'REFUND_PENDING';
