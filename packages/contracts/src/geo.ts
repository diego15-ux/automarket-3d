import { z } from 'zod';

/** Países donde opera la plataforma (ISO 3166-1 alfa-2). */
export const COUNTRIES = [
  { code: 'AR', name: 'Argentina' },
  { code: 'BO', name: 'Bolivia' },
  { code: 'BR', name: 'Brasil' },
  { code: 'CA', name: 'Canadá' },
  { code: 'CL', name: 'Chile' },
  { code: 'CO', name: 'Colombia' },
  { code: 'CR', name: 'Costa Rica' },
  { code: 'DO', name: 'República Dominicana' },
  { code: 'EC', name: 'Ecuador' },
  { code: 'ES', name: 'España' },
  { code: 'GT', name: 'Guatemala' },
  { code: 'HN', name: 'Honduras' },
  { code: 'MX', name: 'México' },
  { code: 'NI', name: 'Nicaragua' },
  { code: 'PA', name: 'Panamá' },
  { code: 'PE', name: 'Perú' },
  { code: 'PR', name: 'Puerto Rico' },
  { code: 'PT', name: 'Portugal' },
  { code: 'PY', name: 'Paraguay' },
  { code: 'SV', name: 'El Salvador' },
  { code: 'US', name: 'Estados Unidos' },
  { code: 'UY', name: 'Uruguay' },
  { code: 'VE', name: 'Venezuela' },
] as const;

export type CountryCode = (typeof COUNTRIES)[number]['code'];
export const COUNTRY_CODES = COUNTRIES.map(country => country.code) as [CountryCode, ...CountryCode[]];

export const countryName = (code: string | null | undefined) => COUNTRIES.find(country => country.code === code)?.name ?? code ?? '';

const LOWERCASE_WORDS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e']);

/** "  ciudad DE   méxico " → "Ciudad de México": las búsquedas por ciudad dependen de un formato estable. */
export function normalizeCity(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es')
    .split(' ')
    .map((word, index) => (index > 0 && LOWERCASE_WORDS.has(word) ? word : word.charAt(0).toLocaleUpperCase('es') + word.slice(1)))
    .join(' ');
}

export const CountrySchema = z.enum(COUNTRY_CODES, { error: 'Selecciona un país.' });

export const CitySchema = z
  .string()
  .trim()
  .min(2, 'Indica tu ciudad.')
  .max(80)
  .regex(/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u, 'La ciudad solo puede contener letras.')
  .transform(normalizeCity);
