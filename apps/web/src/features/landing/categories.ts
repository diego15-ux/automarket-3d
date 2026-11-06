import type { VehicleCategory } from '@automarket/contracts';

/** Categorías en plural para los filtros de la portada (como el index.html). */
export const CATEGORY_PLURALS: Record<VehicleCategory, string> = {
  SPORTS: 'Deportivos',
  SUV: 'SUV',
  SEDAN: 'Sedanes',
  ELECTRIC: 'Eléctricos',
  PICKUP: 'Pickups',
  CONVERTIBLE: 'Convertibles',
  HATCHBACK: 'Hatchbacks',
};
