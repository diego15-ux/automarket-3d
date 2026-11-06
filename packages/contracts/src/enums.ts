/**
 * Enumeraciones del dominio. Son la fuente de verdad para la API (validación),
 * la web (formularios) y deben coincidir con los enums de prisma/schema.prisma.
 */

/** ADMIN_ONE controla roles; ADMIN gestiona la plataforma; SUPERVISOR revisa KYC y moderación. */
export const ROLES = ['USER', 'ADMIN', 'ADMIN_ONE', 'SUPERVISOR'] as const;
export type Role = (typeof ROLES)[number];

/** Persona natural o concesionario (este con razón social, RIF, dirección fiscal y teléfono corporativo). */
export const ACCOUNT_TYPES = ['INDIVIDUAL', 'DEALER'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const VEHICLE_CATEGORIES = ['SPORTS', 'SUV', 'SEDAN', 'ELECTRIC', 'PICKUP', 'CONVERTIBLE', 'HATCHBACK'] as const;
export type VehicleCategory = (typeof VEHICLE_CATEGORIES)[number];

export const FUEL_TYPES = ['GASOLINE', 'DIESEL', 'HYBRID', 'PLUG_IN_HYBRID', 'ELECTRIC'] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const TRANSMISSIONS = ['MANUAL', 'AUTOMATIC', 'DUAL_CLUTCH', 'CVT'] as const;
export type Transmission = (typeof TRANSMISSIONS)[number];

export const DRIVETRAINS = ['FWD', 'RWD', 'AWD', 'FOUR_WD'] as const;
export type Drivetrain = (typeof DRIVETRAINS)[number];

export const VEHICLE_CONDITIONS = ['NEW', 'USED'] as const;
export type VehicleCondition = (typeof VEHICLE_CONDITIONS)[number];

export const VEHICLE_STATUSES = ['DRAFT', 'PUBLISHED', 'PAUSED', 'RESERVED', 'PENDING_SALE', 'SOLD', 'EXPIRED', 'ARCHIVED'] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const VEHICLE_SALE_STATUSES = ['PENDING_PAYMENT', 'COMPLETED', 'CANCELLED'] as const;
export type VehicleSaleStatus = (typeof VEHICLE_SALE_STATUSES)[number];

export const CURRENCIES = ['USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const MEDIA_KINDS = ['IMAGE', 'VIDEO'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Dueños anteriores: 0 = nuevo, 1 = único dueño, 2 = dos dueños, 3 = tres o más. */
export const MAX_OWNERS_OPTION = 3;

/** FREE: cualquier cuenta · PREMIUM: personas naturales · DEALER_*: concesionarios. */
export const PLAN_CODES = ['FREE', 'PREMIUM', 'DEALER_BASIC', 'DEALER_PRO'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];
export const PAID_PLAN_CODES = ['PREMIUM', 'DEALER_BASIC', 'DEALER_PRO'] as const;
export type PaidPlanCode = (typeof PAID_PLAN_CODES)[number];
/** Tipo de cuenta que puede contratar cada plan de pago. */
export const PLAN_ACCOUNT_TYPE: Record<PaidPlanCode, AccountType> = { PREMIUM: 'INDIVIDUAL', DEALER_BASIC: 'DEALER', DEALER_PRO: 'DEALER' };

export const BILLING_CYCLES = ['MONTHLY', 'YEARLY'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const RESERVE_TYPES = ['CART', 'RESERVATION'] as const;
export type ReserveType = (typeof RESERVE_TYPES)[number];

/**
 * Ciclo de vida de apartados (CART: ACTIVE → EXPIRED | CANCELLED | COMPLETED) y de
 * reservas P2P (el abono se paga directamente al vendedor):
 *   AWAITING_SELLER → ACCEPTED (vehículo bloqueado, chat directo) → COMPLETED (venta; comisión post-venta)
 *                   ↘ REJECTED / EXPIRED     ↘ CANCELLED / EXPIRED (vuelve a estar disponible; el vendedor devuelve el abono)
 */
export const RESERVE_STATUSES = ['ACTIVE', 'AWAITING_SELLER', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'COMPLETED'] as const;
export type ReserveStatus = (typeof RESERVE_STATUSES)[number];

export const KYC_DOCUMENT_TYPES = ['NATIONAL_ID', 'PASSPORT', 'DRIVER_LICENSE', 'SELFIE', 'PROOF_OF_ADDRESS', 'BUSINESS_REGISTRATION'] as const;
export type KycDocumentType = (typeof KYC_DOCUMENT_TYPES)[number];

export const REPORT_REASONS = ['FRAUD', 'WRONG_INFO', 'OFFENSIVE', 'SPAM', 'OTHER'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUSES = ['OPEN', 'RESOLVED', 'DISMISSED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REVIEW_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const LEDGER_TYPES = ['MEMBERSHIP_REVENUE', 'SALE_COMMISSION', 'BOOST_REVENUE'] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];
