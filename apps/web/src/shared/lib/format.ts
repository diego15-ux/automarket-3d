import { usdPrice, usdText } from '@automarket/contracts';

const numberFormat = new Intl.NumberFormat('de-DE');

/** Precio redondeado: $46.900. Otras monedas llevan su código delante (EUR 46.900). */
export const formatMoney = (value: number | string, currency = 'USD') =>
  currency === 'USD' ? usdText(Number(value)) : `${currency} ${numberFormat.format(Math.round(Number(value)))}`;

/** Precio con céntimos solo cuando los tiene (planes: $24,99 · vehículos: $46.900). */
export const formatPrice = (value: number | string, currency = 'USD') =>
  currency === 'USD' ? usdPrice(Number(value)) : `${currency} ${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(Number(value))}`;

/** Kilómetros con punto de miles, como en los diseños («55.000 km»); así no se confunde con las comas de la lista. */
export const formatKm = (km: number) => `${km.toLocaleString('es-VE')} km`;

export const formatNumber = (value: number) => numberFormat.format(value);

export const formatTime = (iso: string) => new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

export const formatDate = (iso: string) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

/** "hoy 14:05", "ayer", "12 oct." */
export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  const days = Math.floor((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  if (days === 0) return formatTime(iso);
  if (days === 1) return 'ayer';
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(date);
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** 95_000 ms → "1:35" */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

/** Tiempo restante legible: "en 25 min", "en 47 h", "vencido". */
export function formatRemaining(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return 'vencido';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `en ${minutes} min`;
  return `en ${Math.round(minutes / 60)} h`;
}

export const formatBytes = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(word => word[0] ?? '')
    .join('')
    .toUpperCase() || 'AM';
