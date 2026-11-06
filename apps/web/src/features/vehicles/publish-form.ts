import { usdText } from '@automarket/contracts';
import {
  CATEGORY_LABELS,
  DRIVETRAIN_LABELS,
  FUEL_LABELS,
  TRANSMISSION_LABELS,
  type Drivetrain,
  type FuelType,
  type Transmission,
  type VehicleCategory,
  type VehicleCondition,
  type VehicleDetailDTO,
  type VehicleDraftInput,
} from '@automarket/contracts';

/** Pasos del asistente, en el orden de los diseños. */
export const PUBLISH_STEPS = [
  { label: 'El auto', hint: 'Marca, modelo y ficha' },
  { label: 'Fotos', hint: 'Hasta 10 fotos o videos' },
  { label: 'Precio', hint: 'Con ayuda del Copiloto' },
  { label: 'Ubicación', hint: 'Zona y descripción' },
  { label: 'Publicar', hint: 'Revisa y listo' },
] as const;
export type PublishStep = 1 | 2 | 3 | 4 | 5;

export const CATEGORY_ORDER: VehicleCategory[] = ['SEDAN', 'SUV', 'PICKUP', 'HATCHBACK', 'ELECTRIC', 'SPORTS', 'CONVERTIBLE'];
export const FUEL_ORDER: FuelType[] = ['GASOLINE', 'DIESEL', 'HYBRID', 'PLUG_IN_HYBRID', 'ELECTRIC'];
export const TRANSMISSION_ORDER: Transmission[] = ['MANUAL', 'AUTOMATIC', 'DUAL_CLUTCH', 'CVT'];
export const DRIVETRAIN_ORDER: Drivetrain[] = ['FWD', 'RWD', 'AWD', 'FOUR_WD'];
export const OWNER_OPTIONS = [
  ['1', 'Único dueño'],
  ['2', '2 dueños'],
  ['3', '3 o más'],
] as const;
export const COLOR_SWATCHES = [
  ['Gris', '#3A4452'],
  ['Blanco', '#E9E7E2'],
  ['Negro', '#1C1D1F'],
  ['Plata', '#A7ADB2'],
  ['Rojo', '#9E2A2B'],
  ['Azul', '#2F4A7A'],
] as const;
/** Montos rápidos de abono (el vendedor puede escribir otro). */
export const RESERVE_PRESETS = [200, 300, 500] as const;
/** Tomas que más miran los compradores (sugerencias, no obligatorias). */
export const SUGGESTED_SHOTS = ['Frente', 'Lado', 'Atrás', 'Interior', 'Tablero (km)', 'Motor'] as const;

export { CATEGORY_LABELS, DRIVETRAIN_LABELS, FUEL_LABELS, TRANSMISSION_LABELS };

export interface PublishForm {
  make: string;
  model: string;
  version: string;
  year: string;
  condition: VehicleCondition;
  owners: '1' | '2' | '3';
  km: string;
  category: VehicleCategory | '';
  fuelType: FuelType | '';
  transmission: Transmission | '';
  drivetrain: Drivetrain | '';
  horsepower: string;
  color: string;
  doors: string;
  seats: string;
  price: string;
  reserve: string;
  reserveCustom: boolean;
  country: string;
  city: string;
  description: string;
}

export type FormField = keyof PublishForm;

export const emptyForm = (country = '', city = ''): PublishForm => ({
  make: '', model: '', version: '', year: '', condition: 'USED', owners: '1', km: '',
  category: '', fuelType: '', transmission: '', drivetrain: '', horsepower: '', color: '', doors: '', seats: '',
  price: '', reserve: '', reserveCustom: false, country, city, description: '',
});

const text = (value: number | string | null | undefined) => (value === null || value === undefined ? '' : String(value));

/** Formulario a partir de un anuncio guardado (al editar). */
export function formFromVehicle(vehicle: VehicleDetailDTO): PublishForm {
  const reserve = vehicle.reservationAmount ? String(Math.round(Number(vehicle.reservationAmount))) : '';
  return {
    make: vehicle.make,
    model: vehicle.model,
    version: vehicle.version ?? '',
    year: String(vehicle.year),
    condition: vehicle.condition,
    owners: String(Math.min(3, Math.max(1, vehicle.ownersCount))) as PublishForm['owners'],
    km: vehicle.condition === 'USED' ? String(vehicle.mileageKm) : '',
    category: vehicle.category,
    fuelType: vehicle.fuelType,
    transmission: vehicle.transmission,
    drivetrain: vehicle.drivetrain ?? '',
    horsepower: text(vehicle.horsepower),
    color: vehicle.exteriorColor ?? '',
    doors: text(vehicle.doors),
    seats: text(vehicle.seats),
    price: String(Math.round(Number(vehicle.price))),
    reserve,
    reserveCustom: reserve !== '' && !RESERVE_PRESETS.includes(Number(reserve) as (typeof RESERVE_PRESETS)[number]),
    country: vehicle.country,
    city: vehicle.city,
    description: vehicle.description ?? '',
  };
}

/** Solo cifras (kilometraje, precio, año…). */
export const digits = (value: string) => value.replace(/[^\d]/g, '');
export const toNumber = (value: string) => Number(digits(value)) || 0;

/** Teléfonos, correos o enlaces: los compradores escriben por el chat de AutoMarket. */
const CONTACT = /(\+?\d[\d\s.\-()]{8,}\d)|([^\s@]+@[^\s@]+\.[a-z]{2,})|(https?:\/\/|www\.)/i;

const MAX_YEAR = () => new Date().getFullYear() + 1;

export const RULES: Partial<Record<FormField, (form: PublishForm) => string>> = {
  make: f => (f.make.trim().length >= 2 ? '' : 'Elige la marca'),
  model: f => (f.model.trim() ? '' : 'Escribe el modelo'),
  year: f => (toNumber(f.year) >= 1950 && toNumber(f.year) <= MAX_YEAR() ? '' : `Escribe un año entre 1950 y ${MAX_YEAR()}`),
  km: f => (f.condition === 'NEW' || (f.km.trim() !== '' && toNumber(f.km) <= 2_000_000) ? '' : 'Escribe el kilometraje del tablero'),
  category: f => (f.category ? '' : 'Elige el tipo de auto'),
  fuelType: f => (f.fuelType ? '' : 'Elige el combustible'),
  transmission: f => (f.transmission ? '' : 'Elige la caja'),
  horsepower: f => (!f.horsepower || (toNumber(f.horsepower) >= 1 && toNumber(f.horsepower) <= 3000) ? '' : 'Escribe una potencia entre 1 y 3000 hp'),
  doors: f => (!f.doors || (toNumber(f.doors) >= 1 && toNumber(f.doors) <= 9) ? '' : 'Entre 1 y 9 puertas'),
  seats: f => (!f.seats || (toNumber(f.seats) >= 1 && toNumber(f.seats) <= 60) ? '' : 'Entre 1 y 60 plazas'),
  price: f => (toNumber(f.price) > 0 && toNumber(f.price) <= 100_000_000 ? '' : 'Escribe el precio en dólares'),
  reserve: f => (!toNumber(f.reserve) ? 'Elige el abono de reserva' : toNumber(f.price) && toNumber(f.reserve) > toNumber(f.price) ? 'El abono no puede ser mayor que el precio' : ''),
  country: f => (f.country ? '' : 'Elige el país'),
  city: f => (f.city.trim().length >= 2 ? '' : 'Escribe la ciudad donde está el auto'),
  description: f => (CONTACT.test(f.description) ? 'Quita teléfonos, correos o enlaces. Los compradores te escriben por el chat: así queda registro y evitas estafas.' : ''),
};

/** Campos que se revisan al pasar de cada paso (el 2 son las fotos). */
export const STEP_FIELDS: Record<PublishStep, FormField[]> = {
  1: ['make', 'model', 'year', 'km', 'category', 'fuelType', 'transmission', 'horsepower', 'doors', 'seats'],
  2: [],
  3: ['price', 'reserve'],
  4: ['country', 'city', 'description'],
  5: [],
};

export const errorOf = (form: PublishForm, field: FormField) => RULES[field]?.(form) ?? '';
export const badFields = (form: PublishForm, step: PublishStep) => STEP_FIELDS[step].filter(field => errorOf(form, field));

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * Datos para la API. Un auto nuevo va con 0 dueños; su kilometraje se conserva si ya
 * estaba guardado (la API acepta hasta 1.000 km para un nuevo).
 */
export function toPayload(form: PublishForm, options: { savedNewKm?: number; location?: Coordinates | null } = {}): VehicleDraftInput {
  const isNew = form.condition === 'NEW';
  const optionalNumber = (value: string) => (value ? toNumber(value) : undefined);
  return {
    make: form.make.trim(),
    model: form.model.trim(),
    version: form.version.trim() || undefined,
    year: toNumber(form.year),
    condition: form.condition,
    ownersCount: isNew ? 0 : Number(form.owners),
    mileageKm: isNew ? Math.min(options.savedNewKm ?? 0, 1_000) : toNumber(form.km),
    price: toNumber(form.price),
    reservationAmount: optionalNumber(form.reserve),
    currency: 'USD',
    category: form.category as VehicleCategory,
    fuelType: form.fuelType as FuelType,
    transmission: form.transmission as Transmission,
    drivetrain: form.drivetrain || undefined,
    horsepower: optionalNumber(form.horsepower),
    exteriorColor: form.color.trim() || undefined,
    doors: optionalNumber(form.doors),
    seats: optionalNumber(form.seats),
    country: form.country as VehicleDraftInput['country'],
    city: form.city.trim(),
    ...(options.location ?? {}),
    description: form.description.trim() || undefined,
  };
}

const kmText = (km: number) => new Intl.NumberFormat('de-DE').format(km);

/** Texto de partida con los datos que el vendedor ya llenó (lo puede cambiar todo). */
export function writeDescription(form: PublishForm): string {
  const parts = [`${form.make} ${form.model}${form.version ? ' ' + form.version.trim() : ''} ${form.year}`.trim()];
  if (form.transmission) parts.push(`caja ${TRANSMISSION_LABELS[form.transmission].toLowerCase()}`);
  if (form.condition === 'NEW') parts.push('0 km');
  else if (form.km) parts.push(`${kmText(toNumber(form.km))} km`);
  let out = parts.join(', ') + '.';
  if (form.condition !== 'NEW') out += form.owners === '1' ? ' Único dueño.' : form.owners === '2' ? ' Dos dueños.' : ' Tres dueños o más.';
  if (form.fuelType) out += ` Motor a ${FUEL_LABELS[form.fuelType].toLowerCase()}`;
  if (form.drivetrain) out += `, tracción ${DRIVETRAIN_LABELS[form.drivetrain].toLowerCase()}`;
  if (form.fuelType) out += '.';
  if (form.color) out += ` Color ${form.color.toLowerCase()}.`;
  if (form.city) out += ` Está en ${form.city.trim()}.`;
  return out + ' Escríbeme por el chat para coordinar una visita.';
}

/** Avance del anuncio (lo que más miran los compradores). */
export function completion(form: PublishForm, photos: number): number {
  const checks = [
    Boolean(form.make && form.model && form.year),
    form.condition === 'NEW' || Boolean(form.km),
    photos >= 1,
    photos >= SUGGESTED_SHOTS.length,
    toNumber(form.price) > 0,
    toNumber(form.reserve) > 0,
    Boolean(form.city.trim()),
    form.description.trim().length >= 60,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export const money = (value: number) => usdText(value);
export const kilometers = (value: string) => `${kmText(toNumber(value))} km`;
