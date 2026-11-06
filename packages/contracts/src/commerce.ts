import { z } from 'zod';
import type { DealerFields } from './auth.js';
import { BILLING_CYCLES, PAID_PLAN_CODES, type AccountType, type BillingCycle, type PlanCode, type ReserveStatus, type ReserveType } from './enums.js';

// ──────────────────────────────────────────────────────────── Pagos Binance ──

/** MERCHANT = Binance Pay (API de comercio: QR y confirmación automática) · MANUAL = pago al Pay ID verificado por el equipo. */
export const PAYMENT_METHODS = ['MERCHANT', 'MANUAL'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['PENDING', 'SUBMITTED', 'PAID', 'REJECTED', 'EXPIRED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED', 'FAILED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: 'Pendiente de pago',
  SUBMITTED: 'En verificación',
  PAID: 'Pagado',
  REJECTED: 'Rechazado',
  EXPIRED: 'Vencido',
  CANCELLED: 'Cancelado',
  REFUND_PENDING: 'Reembolso en curso',
  REFUNDED: 'Reembolsado',
  PARTIALLY_REFUNDED: 'Reembolsado en parte',
  FAILED: 'Fallido',
};

/** Métodos disponibles según la configuración del servidor. */
export interface PaymentMethodsDTO {
  currency: string;
  merchant: boolean;
  manual: ManualInstructionsDTO | null;
}

export interface ManualInstructionsDTO {
  payId: string;
  payName: string | null;
  qrImageUrl: string | null;
}

/** Lo que cobra la plataforma: membresías y comisiones post-venta (RESERVATION: depósitos históricos). */
export type PaymentPurpose = 'MEMBERSHIP' | 'RESERVATION' | 'COMMISSION' | 'BOOST';

export interface PaymentDTO {
  id: string;
  purpose: PaymentPurpose;
  mode: PaymentMethod;
  status: PaymentStatus;
  amount: string;
  currency: string;
  /** Va en la nota del pago (manual) y como número de orden (comercio). */
  reference: string;
  expiresAt: string | null;
  createdAt: string;
  submittedAt: string | null;
  paidAt: string | null;
  txId: string | null;
  reviewNote: string | null;
  refundDue: string | null;
  refundedAmount: string;
  merchant: { checkoutUrl: string | null; qrcodeLink: string | null; qrContent: string | null; deeplink: string | null } | null;
  manual: ManualInstructionsDTO | null;
  plan: { code: PlanCode; cycle: BillingCycle } | null;
  reservation: { id: string; status: ReserveStatus; vehicleSlug: string; vehicleTitle: string } | null;
  vehicleSale: { id: string; status: 'PENDING_PAYMENT' | 'COMPLETED' | 'CANCELLED'; vehicleSlug: string; vehicleTitle: string } | null;
  /** Impulso de «Destacar» (purpose = BOOST). */
  boost: { id: string; kind: 'CITY_3D' | 'CITY_7D' | 'HOME' | 'LOGIN'; days: number; status: string; vehicleSlug: string; vehicleTitle: string } | null;
}

const SalePriceSchema = z
  .string()
  .trim()
  .regex(/^\d{1,10}(?:\.\d{1,2})?$/, 'Indica un precio válido con hasta dos decimales.')
  .refine(value => Number(value) > 0, 'El precio final debe ser mayor que cero.');

/** Precio final declarado por vendedor y, si hay comisión, método Binance. */
export const SaleCommissionCheckoutSchema = z.object({
  salePrice: SalePriceSchema,
  method: z.enum(PAYMENT_METHODS).optional(),
});
export type SaleCommissionCheckoutInput = z.infer<typeof SaleCommissionCheckoutSchema>;

export const SaleCompletionSchema = z.object({ salePrice: SalePriceSchema });

export interface VehicleSaleCheckoutDTO {
  saleId: string;
  salePrice: string;
  commissionRate: number;
  commissionAmount: string;
  payment: PaymentDTO | null;
}

/** El usuario ya pagó en la app de Binance (modo manual) y envía el comprobante. */
export const PaymentSubmitSchema = z.object({
  txId: z
    .string()
    .trim()
    .min(6, 'Indica el ID de la transacción de Binance.')
    .max(100)
    .regex(/^[A-Za-z0-9_-]+$/, 'El ID solo puede tener letras, números, guiones y guiones bajos.'),
  /** Pay ID / Binance ID del pagador (opcional): ayuda al equipo a localizar el pago. */
  payerBinanceId: z
    .string()
    .trim()
    .regex(/^\d{4,20}$/, 'El Pay ID de Binance son solo números.')
    .optional(),
});
export type PaymentSubmitInput = z.infer<typeof PaymentSubmitSchema>;

// ───────────────────────────────────────────────────────────── Membresías ──

export interface PlanDTO {
  code: PlanCode;
  name: string;
  /** Tipo de cuenta que puede contratarlo (null = cualquiera). */
  accountType: AccountType | null;
  /** null = publicaciones ilimitadas. */
  maxActiveListings: number | null;
  /** null = publicaciones sin vencimiento. */
  listingDurationDays: number | null;
  /** 0.05 = 5 % sobre el precio de cada venta concretada (comisión post-venta). */
  commissionRate: number;
  /** Destacados simultáneos (Concesionario Pro). */
  featuredSlots: number;
  /** Destacados automáticos por mes (Concesionario Básico). */
  monthlyFeaturedCredits: number;
  /** Prioridad en búsquedas (0 = normal). */
  searchBoost: number;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
}

export const MembershipCheckoutSchema = z.object({
  planCode: z.enum(PAID_PLAN_CODES),
  cycle: z.enum(BILLING_CYCLES),
  method: z.enum(PAYMENT_METHODS),
});
export type MembershipCheckoutInput = z.infer<typeof MembershipCheckoutSchema>;

export interface MembershipStatusDTO {
  plan: PlanDTO;
  cycle: BillingCycle | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  /** ≤ 10 días: la web muestra el aviso de renovación. */
  expiringSoon: boolean;
  activeListings: number;
  featuredInUse: number;
  history: Array<{ id: string; planCode: PlanCode; cycle: BillingCycle | null; source: 'BINANCE' | 'ADMIN' | 'SYSTEM'; startsAt: string; endsAt: string | null; amount: string | null }>;
}

// ───────────────────────────────────────────────────────────── Reservas ──

/**
 * Aviso legal que el comprador acepta antes de reservar (modelo P2P: la plataforma no cobra
 * ni custodia el abono). Se guarda la fecha de aceptación en la reserva.
 */
export const RESERVATION_LEGAL_CLAUSES = [
  'El abono de reserva se paga directamente al vendedor. AutoMarket no cobra, no custodia ni garantiza ese dinero.',
  'El abono forma parte del precio: se descuenta del precio total acordado del vehículo.',
  'Si la venta no se concreta, el vendedor está obligado a devolver el 100 % del abono al comprador.',
  'AutoMarket no se hace responsable de los encuentros presenciales entre las partes. Reúnete en lugares públicos y seguros, revisa el vehículo y su documentación antes de pagar.',
] as const;

/** Advertencia que acompaña al cobro de la comisión post-venta. */
export const COMMISSION_LEGAL_WARNING =
  'La comisión post-venta es una obligación aceptada en los Términos y Condiciones. Si no se paga en el plazo indicado, la cuenta queda bloqueada para publicar y reservar, y AutoMarket podrá iniciar acciones legales y judiciales para su cobro.';

export const ReservationCreateSchema = z.object({
  vehicleId: z.uuid(),
  acceptLegal: z.literal(true, { error: 'Debes aceptar el aviso legal para reservar.' }),
});
export const ReservationDecisionSchema = z.object({ note: z.string().trim().max(500).optional() });

/** Datos verificados de la otra parte: solo con la reserva confirmada (chat directo). */
export interface ContactCardDTO {
  name: string;
  email: string;
  phone: string | null;
  city: string | null;
  country: string | null;
  isVerified: boolean;
  accountType: AccountType;
  dealer: DealerFields | null;
}

export interface ReservationDTO {
  id: string;
  type: ReserveType;
  status: ReserveStatus;
  /** Abono que el comprador paga directamente al vendedor. */
  depositAmount: string | null;
  salePrice: string | null;
  commissionRate: number | null;
  commissionAmount: string | null;
  commissionDueAt: string | null;
  commissionPaidAt: string | null;
  currency: string;
  expiresAt: string | null;
  acceptedAt: string | null;
  completedAt: string | null;
  /** El vendedor la puso «En negociación» (cerrando la venta). */
  negotiatingAt: string | null;
  createdAt: string;
  decisionNote: string | null;
  sellerReviewRating: number | null;
  /** Último intento de pago de la comisión (solo lo ve el vendedor). */
  payment: { id: string; status: PaymentStatus; mode: PaymentMethod } | null;
  vehicle: { id: string; slug: string; make: string; model: string; year: number; price: string; currency: string; status: string; coverUrl: string | null };
  buyer: { id: string; name: string; avatarUrl: string | null };
  seller: { id: string; name: string; avatarUrl: string | null };
  /** Contacto verificado de la otra parte (reserva confirmada o venta concretada). */
  contact: ContactCardDTO | null;
}

export const SellerRatingSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  /** Comentario opcional (sale en la página pública del vendedor). Vacío = sin comentario. */
  comment: z.string().trim().max(400, 'El comentario no puede superar 400 caracteres.').optional(),
});
