import { usdPrice } from '@automarket/contracts';
import { BOOST_TIMEZONE } from '@automarket/contracts';

/** Fechas «AAAA-MM-DD» del calendario de Venezuela (el mismo motor de turnos que la API). */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const caracas = new Intl.DateTimeFormat('en-CA', { timeZone: BOOST_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
/** Día de Venezuela de un instante (fin de un destacado). */
export const dayOf = (iso: string) => caracas.format(new Date(iso));

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const long = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const weekday = new Intl.DateTimeFormat('es', { weekday: 'short', timeZone: 'UTC' });
const weekdayLong = new Intl.DateTimeFormat('es', { weekday: 'long', timeZone: 'UTC' });
const month = new Intl.DateTimeFormat('es', { month: 'short', timeZone: 'UTC' });
const monthLong = new Intl.DateTimeFormat('es', { month: 'long', timeZone: 'UTC' });
const clean = (text: string) => text.replace('.', '');

/** «el jueves 5 de noviembre» */
export const longDay = (day: string) => `el ${long.format(asDate(day)).replace(',', '')}`;
/** «jue 5 nov» */
export const shortDay = (day: string) => `${clean(weekday.format(asDate(day)))} ${asDate(day).getUTCDate()} ${clean(month.format(asDate(day)))}`;
/** «mié» */
export const weekdayShort = (day: string) => clean(weekday.format(asDate(day)));
/** «jueves 5 de noviembre» (lectores de pantalla) */
export const fullDay = (day: string) => `${weekdayLong.format(asDate(day))} ${asDate(day).getUTCDate()} de ${monthLong.format(asDate(day))}`;
export const dayNumber = (day: string) => asDate(day).getUTCDate();
/** «3 nov» */
export const dayMonth = (day: string) => `${asDate(day).getUTCDate()} ${clean(month.format(asDate(day)))}`;

/** Primer día desde `from` en el que caben `days` días seguidos con cupo (hasta 60 intentos). */
export function placeTurn(occupancy: Map<string, number>, from: string, days: number, slots: number): string {
  let start = from;
  for (let attempt = 0; attempt < 60; attempt++) {
    let fits = true;
    for (let offset = 0; offset < days; offset++) if ((occupancy.get(addDays(start, offset)) ?? 0) >= slots) fits = false;
    if (fits) return start;
    start = addDays(start, 1);
  }
  return start;
}

export const usd = (value: string | number) => usdPrice(Number(value));
