import { MIN_MARKET_COMPARABLES, type VehicleInsightsDTO, type VehicleInsightsQuery } from '@automarket/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../shared/infra/prisma.js';

/** Solo cuentan anuncios que salieron al público: los borradores no son mercado. */
const LISTED_STATUSES = ['PUBLISHED', 'RESERVED', 'PENDING_SALE', 'SOLD'] as const;
/** Ajustes del valor de mercado entre un comparable y el auto del vendedor. */
const PER_YEAR = 0.07;
const PER_100K_KM = 0.08;
const AUTOMATIC_PREMIUM = 0.06;
/** Rango «justo» alrededor del valor estimado. */
const FAIR_BAND = 0.08;
const MAX_SAMPLE = 500;

const roundTo10 = (value: number) => Math.round(value / 10) * 10;

/** El valor más repetido (empates: el que apareció primero, o sea el anuncio más reciente). */
function mostCommon<T extends string | number>(values: Array<T | null>): T | null {
  const counts = new Map<T, number>();
  for (const value of values) if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: T | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Ficha típica y valor de mercado de un modelo con los anuncios reales de AutoMarket.
 * La marca y el modelo se comparan sin distinguir mayúsculas ni acentos (colación de la base).
 */
export async function vehicleInsights(query: VehicleInsightsQuery): Promise<VehicleInsightsDTO> {
  const where: Prisma.VehicleWhereInput = {
    deletedAt: null,
    status: { in: [...LISTED_STATUSES] },
    currency: 'USD',
    make: query.make,
    model: query.model,
    ...(query.excludeId && { id: { not: query.excludeId } }),
  };
  const rows = await prisma.vehicle.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: MAX_SAMPLE,
    select: { year: true, mileageKm: true, price: true, transmission: true, category: true, fuelType: true, drivetrain: true, doors: true, seats: true },
  });

  const typical: VehicleInsightsDTO['typical'] = rows.length
    ? {
        category: mostCommon(rows.map(row => row.category)),
        fuelType: mostCommon(rows.map(row => row.fuelType)),
        transmission: mostCommon(rows.map(row => row.transmission)),
        drivetrain: mostCommon(rows.map(row => row.drivetrain)),
        doors: mostCommon(rows.map(row => row.doors)),
        seats: mostCommon(rows.map(row => row.seats)),
        sample: rows.length,
      }
    : null;

  if (query.year === undefined) return { typical, market: null, comparables: 0 };
  const year = query.year;
  const comparables = rows.filter(row => Math.abs(row.year - year) <= 2);
  if (comparables.length < MIN_MARKET_COMPARABLES) return { typical, market: null, comparables: comparables.length };

  const automatic = query.transmission ? query.transmission !== 'MANUAL' : null;
  const adjusted = comparables.map(row => {
    let price = Number(row.price) * (1 + PER_YEAR * (year - row.year));
    if (query.mileageKm !== undefined) price *= 1 + ((row.mileageKm - query.mileageKm) / 100_000) * PER_100K_KM;
    if (automatic !== null && automatic !== (row.transmission !== 'MANUAL')) price *= automatic ? 1 + AUTOMATIC_PREMIUM : 1 - AUTOMATIC_PREMIUM;
    return price;
  });
  const value = roundTo10(adjusted.reduce((sum, price) => sum + price, 0) / adjusted.length);
  if (value <= 0) return { typical, market: null, comparables: comparables.length };
  return {
    typical,
    market: { value, low: roundTo10(value * (1 - FAIR_BAND)), high: roundTo10(value * (1 + FAIR_BAND)), sample: comparables.length },
    comparables: comparables.length,
  };
}
