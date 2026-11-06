import { BOOST_TIMEZONE, normalizeCity, type VehicleCategory } from '@automarket/contracts';

/**
 * Calendario de los impulsos: los días de la pantalla de entrada son días de Venezuela
 * (America/Caracas) y vencen a las 11:59 p. m. del último día. Fechas «AAAA-MM-DD».
 */
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: BOOST_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

export const localDay = (instant = new Date()) => dayFormat.format(instant);

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Columna DATE de MySQL ↔ «AAAA-MM-DD». */
export const toDbDate = (day: string) => new Date(`${day}T00:00:00Z`);
export const fromDbDate = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);
export const maxDay = (...days: Array<string | null | undefined>) => days.filter((day): day is string => Boolean(day)).sort().at(-1)!;

/**
 * Primer día desde `from` en el que caben `days` días seguidos sin pasar de `slots` por día
 * (si alguno está lleno, se corre un día y se vuelve a probar; hasta 60 veces).
 */
export function placeTurn(occupancy: Map<string, number>, from: string, days: number, slots: number): string {
  let start = from;
  for (let attempt = 0; attempt < 60; attempt++) {
    let fits = true;
    for (let offset = 0; offset < days; offset++) {
      if ((occupancy.get(addDays(start, offset)) ?? 0) >= slots) {
        fits = false;
        break;
      }
    }
    if (fits) return start;
    start = addDays(start, 1);
  }
  return start;
}

const CATEGORY_PLURAL: Record<VehicleCategory, string> = {
  SPORTS: 'Deportivos',
  SUV: 'Camionetas',
  SEDAN: 'Sedanes',
  ELECTRIC: 'Eléctricos',
  PICKUP: 'Pickups',
  CONVERTIBLE: 'Convertibles',
  HATCHBACK: 'Hatchbacks',
};

/** Zona de los impulsos de ciudad: país, ciudad y tipo de auto («Camionetas en Valencia»). */
export const zoneKeyOf = (vehicle: { country: string; city: string; category: VehicleCategory }) =>
  `${vehicle.country}:${normalizeCity(vehicle.city).toLowerCase()}:${vehicle.category}`.slice(0, 120);
export const zoneLabelOf = (vehicle: { city: string; category: VehicleCategory }) => `${CATEGORY_PLURAL[vehicle.category]} en ${vehicle.city}`;
export const HOME_ZONE = 'HOME';
export const HOME_LABEL = 'Portada en todo el país';
