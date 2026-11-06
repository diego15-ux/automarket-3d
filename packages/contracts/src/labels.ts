import type { AccountType, BillingCycle, Drivetrain, FuelType, PlanCode, ReserveStatus, Transmission, VehicleCategory, VehicleCondition, VehicleStatus } from './enums.js';

/** Textos en español compartidos por la web, los correos y las exportaciones. */
export const CATEGORY_LABELS: Record<VehicleCategory, string> = {
  SPORTS: 'Deportivo',
  SUV: 'SUV',
  SEDAN: 'Sedán',
  ELECTRIC: 'Eléctrico',
  PICKUP: 'Pickup',
  CONVERTIBLE: 'Convertible',
  HATCHBACK: 'Hatchback',
};

export const FUEL_LABELS: Record<FuelType, string> = {
  GASOLINE: 'Gasolina',
  DIESEL: 'Diésel',
  HYBRID: 'Híbrido',
  PLUG_IN_HYBRID: 'Híbrido enchufable',
  ELECTRIC: 'Eléctrico',
};

export const TRANSMISSION_LABELS: Record<Transmission, string> = {
  MANUAL: 'Manual',
  AUTOMATIC: 'Automática',
  DUAL_CLUTCH: 'Doble embrague',
  CVT: 'CVT',
};

export const DRIVETRAIN_LABELS: Record<Drivetrain, string> = {
  FWD: 'Delantera',
  RWD: 'Trasera',
  AWD: 'Integral (AWD)',
  FOUR_WD: '4x4',
};

export const CONDITION_LABELS: Record<VehicleCondition, string> = { NEW: 'Nuevo', USED: 'Usado' };

export const VEHICLE_STATUS_LABELS: Record<VehicleStatus, string> = {
  DRAFT: 'Borrador',
  PUBLISHED: 'Publicado',
  PAUSED: 'Pausado',
  RESERVED: 'Reservado',
  PENDING_SALE: 'Comisión en revisión',
  SOLD: 'Vendido',
  EXPIRED: 'Vencido',
  ARCHIVED: 'Archivado',
};

export const RESERVE_STATUS_LABELS: Record<ReserveStatus, string> = {
  ACTIVE: 'Apartado',
  AWAITING_SELLER: 'Esperando al vendedor',
  ACCEPTED: 'Reservado',
  REJECTED: 'Rechazada',
  CANCELLED: 'Cancelada',
  EXPIRED: 'Vencida',
  COMPLETED: 'Venta concretada',
};

export const PLAN_LABELS: Record<PlanCode, string> = { FREE: 'Gratis', PREMIUM: 'Premium', DEALER_BASIC: 'Concesionario Básico', DEALER_PRO: 'Concesionario Pro' };

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = { INDIVIDUAL: 'Persona natural', DEALER: 'Concesionario' };

/** Mensaje formal que ve cualquiera mientras un vehículo está reservado. */
export const RESERVED_VEHICLE_NOTICE =
  'Este vehículo se encuentra en proceso de reserva. Si la compra no se concreta, volverá a estar disponible para reserva automáticamente.';

/** Aviso de copyright del pie de página y de las cabeceras del código. */
export const COPYRIGHT_NOTICE = '© Todos los derechos reservados. Sistema desarrollado bajo licencia exclusiva del propietario de la plataforma.';

export const CYCLE_LABELS: Record<BillingCycle, string> = { MONTHLY: 'Mensual', YEARLY: 'Anual' };

/** 0 → "Nuevo (sin dueños)", 1 → "Único dueño", 2 → "2 dueños", 3 → "3 o más dueños". */
export const ownersLabel = (owners: number) => (owners <= 0 ? 'Sin dueños anteriores' : owners === 1 ? 'Único dueño' : owners === 2 ? '2 dueños' : '3 o más dueños');
