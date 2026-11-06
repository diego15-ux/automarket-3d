import type { DealStatus, PublicDealStatus } from '@automarket/contracts';
import type { ReserveStatus, VehicleStatus } from '../../generated/prisma/enums.js';

/** Estado del trato para la pareja comprador ↔ auto, a partir de su última reserva y del anuncio. */
export function dealStatusOf(vehicleStatus: VehicleStatus | string, latest: { status: ReserveStatus | string; negotiatingAt: Date | null } | null): DealStatus {
  if (latest?.status === 'AWAITING_SELLER') return 'REQUESTED';
  if (latest?.status === 'ACCEPTED') return latest.negotiatingAt ? 'NEGOTIATING' : 'RESERVED';
  if (latest?.status === 'COMPLETED') return 'SOLD';
  return vehicleStatus === 'PUBLISHED' ? 'AVAILABLE' : 'UNAVAILABLE';
}

/** Lo que ve el público del auto. */
export function publicStatusOf(vehicle: { status: VehicleStatus | string; negotiatingAt: Date | null }): PublicDealStatus {
  if (vehicle.status === 'PUBLISHED') return 'AVAILABLE';
  if (vehicle.status === 'RESERVED') return vehicle.negotiatingAt ? 'NEGOTIATING' : 'RESERVED';
  if (vehicle.status === 'SOLD' || vehicle.status === 'PENDING_SALE') return 'SOLD';
  return 'UNAVAILABLE';
}
