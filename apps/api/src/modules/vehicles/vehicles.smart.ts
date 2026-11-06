import { normalizeText, smartParse, smartUnderstood, usdText, type SmartParse, type SmartSearchDTO, type SmartSearchStartDTO, type SmartVocabulary } from '@automarket/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../shared/infra/prisma.js';
import { cardsInOrder } from './vehicles.search.js';

/**
 * Buscador inteligente (diseños «buscador-pc» y «buscador-movil»): reglas sobre el catálogo real,
 * sin IA. Entiende la frase, filtra en MySQL, afloja filtros si no hay nada (ciudad → caja → tope
 * +15 %), ordena por uso/prioridad y kilometraje y resume los precios del conjunto completo.
 */
const VISIBLE = Prisma.sql`v.deletedAt IS NULL AND v.status IN ('PUBLISHED', 'RESERVED')`;
const CATEGORY_CHIP: Record<string, string> = { SUV: 'Camioneta', PICKUP: 'Pickup', SEDAN: 'Sedán', HATCHBACK: 'Compacto', SPORTS: 'Deportivo', CONVERTIBLE: 'Convertible' };
const USE_LABEL = { city: 'Para ciudad', family: 'Para familia', work: 'Para trabajo' } as const;
const PRIORITY_LABEL = { fuel: 'Que gaste poco', value: 'Buena reventa', space: 'Espacioso' } as const;
export const USE_FIT: Record<keyof typeof USE_LABEL, Record<string, number>> = {
  city: { HATCHBACK: 3, SEDAN: 3, ELECTRIC: 3, SUV: 1, PICKUP: 0 },
  family: { SUV: 3, SEDAN: 2, PICKUP: 2, HATCHBACK: 1 },
  work: { PICKUP: 3, SUV: 2, SEDAN: 0, HATCHBACK: 0 },
};
type Row = { id: string; make: string; model: string; category: string; fuelType: string; mileageKm: number; price: unknown };
export const PRIORITY_FIT: Record<keyof typeof PRIORITY_LABEL, (row: Row) => number> = {
  fuel: row => (row.fuelType === 'ELECTRIC' ? 3 : row.fuelType === 'HYBRID' || row.fuelType === 'PLUG_IN_HYBRID' ? 2.5 : row.category === 'HATCHBACK' || row.category === 'SEDAN' ? 2 : 0),
  value: row => (row.make === 'Toyota' ? 3 : row.make === 'Kia' || row.make === 'Hyundai' ? 2 : 1),
  space: row => (row.category === 'SUV' ? 3 : row.category === 'PICKUP' ? 2 : row.category === 'SEDAN' ? 1 : 0),
};
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export type Vocabulary = SmartVocabulary & { counts: { models: Map<string, number>; brands: Map<string, number>; cities: Map<string, number> }; brandLabel: Map<string, string> };
let cache: { at: number; vocab: Vocabulary } | null = null;

/** Vocabulario del catálogo publicado (marcas, modelos y ciudades con su cantidad); se renueva cada minuto. */
export async function vocabulary(): Promise<Vocabulary> {
  if (cache && Date.now() - cache.at < 60_000) return cache.vocab;
  const rows = await prisma.$queryRaw<Array<{ make: string; model: string; city: string; n: bigint }>>`
    SELECT v.make, v.model, v.city, COUNT(*) AS n FROM vehicles v WHERE ${VISIBLE} GROUP BY v.make, v.model, v.city`;
  const vocab: Vocabulary = { models: {}, brands: [], cities: [], counts: { models: new Map(), brands: new Map(), cities: new Map() }, brandLabel: new Map() };
  const add = (map: Map<string, number>, key: string, n: number) => map.set(key, (map.get(key) ?? 0) + n);
  for (const row of rows) {
    const n = Number(row.n);
    const model = normalizeText(row.model);
    const brand = normalizeText(row.make);
    vocab.models[model] ??= { make: row.make, label: row.model };
    vocab.brandLabel.set(brand, row.make);
    add(vocab.counts.models, model, n);
    add(vocab.counts.brands, brand, n);
    add(vocab.counts.cities, row.city, n);
  }
  vocab.brands = [...vocab.counts.brands.keys()];
  vocab.cities = [...vocab.counts.cities.keys()];
  cache = { at: Date.now(), vocab };
  return vocab;
}

interface Filters {
  models: string[];
  brand: string | null;
  gearbox: 'AUTOMATIC' | 'MANUAL' | null;
  category: string | null;
  electric: boolean;
  city: string | null;
  year: number | null;
  min: number | null;
  max: number | null;
}

function whereOf(f: Filters, vocab: Vocabulary): Prisma.Sql {
  const where: Prisma.Sql[] = [VISIBLE];
  if (f.models.length) where.push(Prisma.sql`v.model IN (${Prisma.join(f.models.map(m => vocab.models[m]!.label))})`);
  if (f.brand) where.push(Prisma.sql`v.make = ${vocab.brandLabel.get(f.brand) ?? f.brand}`);
  if (f.gearbox === 'MANUAL') where.push(Prisma.sql`v.transmission = 'MANUAL'`);
  if (f.gearbox === 'AUTOMATIC') where.push(Prisma.sql`v.transmission <> 'MANUAL'`);
  if (f.category) where.push(Prisma.sql`v.category = ${f.category}`);
  if (f.electric) where.push(Prisma.sql`(v.fuelType = 'ELECTRIC' OR v.category = 'ELECTRIC')`);
  if (f.city) where.push(Prisma.sql`v.city = ${f.city}`);
  if (f.year) where.push(Prisma.sql`v.year BETWEEN ${f.year - 1} AND ${f.year + 1}`);
  if (f.min !== null) where.push(Prisma.sql`v.price >= ${f.min}`);
  if (f.max !== null) where.push(Prisma.sql`v.price <= ${f.max}`);
  return Prisma.join(where, ' AND ');
}

const match = (f: Filters, vocab: Vocabulary) =>
  prisma.$queryRaw<Row[]>`
    SELECT v.id, v.make, v.model, v.category, v.fuelType, v.mileageKm, v.price FROM vehicles v
    WHERE ${whereOf(f, vocab)} ORDER BY v.price ASC LIMIT 1000`;

/** Parámetros del catálogo con los mismos filtros (para «Ver los N autos»). */
function catalogParams(f: Filters, vocab: Vocabulary): Record<string, string> {
  const params: Record<string, string> = {};
  const model = f.models[0];
  if (model) {
    params.make = vocab.models[model]!.make;
    params.model = vocab.models[model]!.label;
  } else if (f.brand) params.make = vocab.brandLabel.get(f.brand) ?? f.brand;
  if (f.gearbox) params.gearbox = f.gearbox;
  if (f.category) params.category = f.category;
  if (f.electric) params.fuel = 'ELECTRIC';
  if (f.city) params.city = f.city;
  if (f.year) {
    params.yearMin = String(f.year - 1);
    params.yearMax = String(f.year + 1);
  }
  if (f.min !== null) params.priceMin = String(Math.round(f.min));
  if (f.max !== null) params.priceMax = String(Math.round(f.max));
  return params;
}

function chipsOf(f: Filters, e: SmartParse, vocab: Vocabulary): string[] {
  const chips: string[] = [];
  for (const model of f.models) chips.push(`${vocab.models[model]!.make} ${vocab.models[model]!.label}`);
  if (f.brand) chips.push(vocab.brandLabel.get(f.brand) ?? cap(f.brand));
  if (f.category) chips.push(CATEGORY_CHIP[f.category] ?? f.category);
  if (f.electric) chips.push('Eléctrico');
  if (f.gearbox) chips.push(f.gearbox === 'AUTOMATIC' ? 'Automático' : 'Sincrónico');
  if (f.year) chips.push(`${f.year - 1}–${f.year + 1}`);
  if (f.min !== null && f.max !== null) chips.push(`${usdText(f.min)} a ${usdText(f.max)}`);
  else if (f.max !== null) chips.push(`Hasta ${usdText(f.max)}`);
  else if (f.min !== null) chips.push(`Desde ${usdText(f.min)}`);
  if (f.city) chips.push(f.city);
  if (e.use) chips.push(USE_LABEL[e.use]);
  if (e.priority) chips.push(PRIORITY_LABEL[e.priority]);
  return chips;
}

export const smartSearch = {
  async search(text: string, limit: number): Promise<SmartSearchDTO> {
    const vocab = await vocabulary();
    const e = smartParse(text, vocab);
    const f: Filters = {
      models: e.models,
      brand: e.models.length ? null : e.brand,
      gearbox: e.gearbox,
      category: e.category,
      electric: e.electric,
      city: e.city,
      year: e.year,
      max: e.max ?? (e.amount !== null && !e.isFair ? e.amount : null),
      min: e.min,
    };
    let used = f;
    let rows = await match(f, vocab);
    let relaxed: string | null = null;
    if (!rows.length && f.city) {
      const next = { ...f, city: null };
      rows = await match(next, vocab);
      if (rows.length) [used, relaxed] = [next, `No hay en ${f.city}; te muestro de todo el país.`];
    }
    if (!rows.length && f.gearbox) {
      const next = { ...f, gearbox: null, city: null };
      rows = await match(next, vocab);
      if (rows.length) [used, relaxed] = [next, `No hay ${f.gearbox === 'AUTOMATIC' ? 'automático' : 'sincrónico'}s con eso; te muestro de ambas cajas.`];
    }
    if (!rows.length && f.max !== null) {
      const next = { ...f, max: f.max * 1.15, gearbox: null, city: null };
      rows = await match(next, vocab);
      if (rows.length) [used, relaxed] = [next, `Nada hasta ${usdText(f.max)}; esto es lo más cercano.`];
    }
    const score = (row: Row) => (e.use ? (USE_FIT[e.use][row.category] ?? 0) * 2 : 0) + (e.priority ? PRIORITY_FIT[e.priority](row) * 2 : 0) - row.mileageKm / 60_000;
    const sorted = [...rows].sort((a, b) => score(b) - score(a) || Number(a.price) - Number(b.price));
    const results = await cardsInOrder(sorted.slice(0, limit).map(row => row.id));

    const last = /([^\s]+)$/.exec(text)?.[1] ?? '';
    const token = text.endsWith(' ') ? '' : normalizeText(last);
    const suggestions: SmartSearchDTO['suggestions'] = [];
    if (token.length >= 2) {
      for (const [model, info] of Object.entries(vocab.models)) if (model.startsWith(token) && model !== token) suggestions.push({ label: `${info.make} ${info.label}`, kind: 'Modelo', count: vocab.counts.models.get(model) ?? 0, word: info.label });
      for (const brand of vocab.brands) if (brand.startsWith(token) && brand !== token) suggestions.push({ label: vocab.brandLabel.get(brand) ?? cap(brand), kind: 'Marca', count: vocab.counts.brands.get(brand) ?? 0, word: vocab.brandLabel.get(brand) ?? cap(brand) });
      for (const city of vocab.cities) if (normalizeText(city).startsWith(token) && normalizeText(city) !== token) suggestions.push({ label: city, kind: 'Ciudad', count: vocab.counts.cities.get(city) ?? 0, word: city });
    }
    const prices = rows.map(row => Number(row.price));
    const insight = !prices.length
      ? ''
      : prices.length === 1
        ? `Un solo auto, en ${usdText(prices[0]!)}`
        : `Precio medio ${usdText(prices.reduce((a, b) => a + b, 0) / prices.length)} · de ${usdText(Math.min(...prices))} a ${usdText(Math.max(...prices))}`;
    return {
      query: text,
      chips: chipsOf(used, e, vocab),
      understood: smartUnderstood(text, e, vocab),
      relaxed,
      suggestions: suggestions.sort((a, b) => b.count - a.count).slice(0, 4),
      results,
      total: rows.length,
      insight,
      question: e.isQuestion,
      catalog: catalogParams(used, vocab),
    };
  },

  /** «Lo más publicado»: modelos, tipo y ciudad con más anuncios ahora mismo. */
  async start(): Promise<SmartSearchStartDTO> {
    const vocab = await vocabulary();
    const top = <K>(map: Map<K, number>, n: number) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n);
    const categories = await prisma.$queryRaw<Array<{ category: string; n: bigint }>>`
      SELECT v.category, COUNT(*) AS n FROM vehicles v WHERE ${VISIBLE} GROUP BY v.category ORDER BY n DESC LIMIT 2`;
    const [electric] = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM vehicles v WHERE ${VISIBLE} AND (v.fuelType = 'ELECTRIC' OR v.category = 'ELECTRIC')`;
    const plural: Record<string, string> = { SUV: 'Camionetas', PICKUP: 'Pickups', SEDAN: 'Sedanes', HATCHBACK: 'Compactos', SPORTS: 'Deportivos', CONVERTIBLE: 'Convertibles' };
    const popular = [
      ...top(vocab.counts.models, 3).map(([model]) => vocab.models[model]!.label),
      ...categories.flatMap(row => (plural[row.category] ? [plural[row.category]!] : [])),
      ...top(vocab.counts.cities, 1).map(([city]) => `Autos en ${city}`),
      ...(Number(electric?.n ?? 0) > 0 ? ['Eléctricos'] : []),
    ];
    return { popular: [...new Set(popular)].slice(0, 6) };
  },
};
