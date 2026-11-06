import type { SearchResultDTO, VehicleCardDTO, VehicleSearchInput } from '@automarket/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../shared/errors/app-error.js';
import { prisma } from '../../shared/infra/prisma.js';
import { cardSelect, toCardDTO } from './vehicles.mapper.js';

/** Ubicación del usuario (perfil o, si es anónimo, cabecera CF-IPCountry de Cloudflare). */
export interface Locality {
  country: string | null;
  city: string | null;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

const VISIBLE = Prisma.sql`v.deletedAt IS NULL AND v.status IN ('PUBLISHED', 'RESERVED')`;
const NEARBY_RADIUS_KM = 100;

/** Escapa comodines de LIKE: lo que escribe el usuario se busca literalmente. */
const like = (term: string) => `%${term.replace(/[\\%_]/g, char => `\\${char}`)}%`;

/**
 * 2 = misma ciudad · 1 = mismo país · 0 = resto (la colación utf8mb4_unicode_ci ignora mayúsculas
 * y acentos). Sin ubicación devuelve null: un `ORDER BY 0` literal MySQL lo lee como posición de columna.
 */
function localityScore({ country, city }: Locality): Prisma.Sql | null {
  if (!country) return null;
  if (!city) return Prisma.sql`(CASE WHEN v.country = ${country} THEN 1 ELSE 0 END)`;
  return Prisma.sql`(CASE WHEN v.country = ${country} AND v.city = ${city} THEN 2 WHEN v.country = ${country} THEN 1 ELSE 0 END)`;
}

function distanceKm({ latitude, longitude }: Coordinates): Prisma.Sql {
  return Prisma.sql`(2 * 6371 * ASIN(SQRT(LEAST(1,
    POW(SIN(RADIANS(v.latitude - ${latitude}) / 2), 2) +
    COS(RADIANS(${latitude})) * COS(RADIANS(v.latitude)) *
    POW(SIN(RADIANS(v.longitude - ${longitude}) / 2), 2)
  ))))`;
}

const featuredScore = (now: Date) => Prisma.sql`(v.featuredUntil IS NOT NULL AND v.featuredUntil > ${now})`;

/** "a DESC, b DESC…" omitiendo los criterios que no aplican. */
const orderBy = (...criteria: Array<Prisma.Sql | null>) =>
  Prisma.join(
    criteria.filter((criterion): criterion is Prisma.Sql => criterion !== null),
    ', ',
  );
const desc = (expression: Prisma.Sql | null) => (expression ? Prisma.sql`${expression} DESC` : null);

/** Recupera las tarjetas en el orden exacto de los ids calculado por SQL. */
export async function cardsInOrder(ids: string[]): Promise<VehicleCardDTO[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.vehicle.findMany({ where: { id: { in: ids } }, select: cardSelect });
  const byId = new Map(rows.map(row => [row.id, row]));
  return ids.flatMap(id => {
    const row = byId.get(id);
    return row ? [toCardDTO(row)] : [];
  });
}

const intRaw = (value: number) => Prisma.raw(String(Math.trunc(value)));

export const vehicleSearch = {
  /**
   * Cerca de mí requiere coordenadas y ordena por distancia real. El resto de búsquedas
   * prioriza la ubicación del perfil (misma ciudad > mismo país), disponibilidad,
   * destacados, prioridad del plan del vendedor (Pro = máxima) y recencia.
   */
  async search(input: VehicleSearchInput, locality: Locality, coordinates: Coordinates | null = null): Promise<SearchResultDTO> {
    const now = new Date();
    const where: Prisma.Sql[] = [VISIBLE];
    if (input.nearby) {
      if (!coordinates) throw AppError.badRequest('LOCATION_REQUIRED', 'Permite el acceso a tu ubicación para encontrar vehículos cercanos.');
      where.push(Prisma.sql`v.latitude IS NOT NULL AND v.longitude IS NOT NULL`);
      where.push(Prisma.sql`${distanceKm(coordinates)} <= ${NEARBY_RADIUS_KM}`);
    }

    for (const term of (input.q ?? '').split(/\s+/).filter(Boolean).slice(0, 5)) {
      const pattern = like(term);
      where.push(Prisma.sql`(v.make LIKE ${pattern} OR v.model LIKE ${pattern} OR v.version LIKE ${pattern})`);
    }
    if (input.make) where.push(Prisma.sql`v.make = ${input.make}`);
    if (input.model) where.push(Prisma.sql`v.model LIKE ${like(input.model)}`);
    if (input.category) where.push(Prisma.sql`v.category = ${input.category}`);
    if (input.condition) where.push(Prisma.sql`v.\`condition\` = ${input.condition}`); // palabra reservada en MySQL/MariaDB
    if (input.owners !== undefined) where.push(input.owners >= 3 ? Prisma.sql`v.ownersCount >= 3` : Prisma.sql`v.ownersCount = ${input.owners}`);
    if (input.yearMin !== undefined) where.push(Prisma.sql`v.year >= ${input.yearMin}`);
    if (input.yearMax !== undefined) where.push(Prisma.sql`v.year <= ${input.yearMax}`);
    if (input.priceMin !== undefined) where.push(Prisma.sql`v.price >= ${input.priceMin}`);
    if (input.priceMax !== undefined) where.push(Prisma.sql`v.price <= ${input.priceMax}`);
    if (input.country) where.push(Prisma.sql`v.country = ${input.country}`);
    if (input.city) where.push(Prisma.sql`v.city = ${input.city}`);
    if (input.gearbox === 'MANUAL') where.push(Prisma.sql`v.transmission = 'MANUAL'`);
    if (input.gearbox === 'AUTOMATIC') where.push(Prisma.sql`v.transmission <> 'MANUAL'`);
    if (input.mileageMax !== undefined) where.push(Prisma.sql`v.mileageKm <= ${input.mileageMax}`);
    if (input.fuel === 'ELECTRIC') where.push(Prisma.sql`(v.fuelType = 'ELECTRIC' OR v.category = 'ELECTRIC')`);
    else if (input.fuel) where.push(Prisma.sql`v.fuelType = ${input.fuel}`);
    if (input.has3d) where.push(Prisma.sql`v.model3dUrl IS NOT NULL`);
    if (input.verified) where.push(Prisma.sql`EXISTS (SELECT 1 FROM users u WHERE u.id = v.sellerId AND u.isVerified = TRUE)`);

    const whereSql = Prisma.join(where, ' AND ');
    const sorting = input.nearby && coordinates ? orderBy(
      Prisma.sql`${distanceKm(coordinates)} ASC`,
      Prisma.sql`v.publishedAt DESC`,
    ) : {
      relevance: orderBy(desc(localityScore(locality)), Prisma.sql`(v.status = 'PUBLISHED') DESC`, desc(featuredScore(now)), Prisma.sql`v.searchBoost DESC, v.publishedAt DESC`),
      price_asc: Prisma.sql`v.price ASC, v.publishedAt DESC`,
      price_desc: Prisma.sql`v.price DESC, v.publishedAt DESC`,
      year_desc: Prisma.sql`v.year DESC, v.publishedAt DESC`,
      newest: Prisma.sql`v.publishedAt DESC`,
    }[input.sort];

    const offset = (input.page - 1) * input.pageSize;
    const near = input.nearby && coordinates ? coordinates : null;
    const [rows, totals] = await Promise.all([
      prisma.$queryRaw<Array<{ id: string; distance: number | null }>>`
        SELECT v.id, ${near ? distanceKm(near) : Prisma.sql`NULL`} AS distance FROM vehicles v WHERE ${whereSql}
        ORDER BY ${sorting}, v.id
        LIMIT ${intRaw(input.pageSize)} OFFSET ${intRaw(offset)}`,
      prisma.$queryRaw<Array<{ total: bigint }>>`SELECT COUNT(*) AS total FROM vehicles v WHERE ${whereSql}`,
    ]);
    const cards = await cardsInOrder(rows.map(row => row.id));
    const distances = new Map(rows.map(row => [row.id, row.distance === null ? null : Math.max(0, Math.round(Number(row.distance)))]));

    return {
      items: near ? cards.map(card => ({ ...card, distanceKm: distances.get(card.id) ?? null })) : cards,
      total: Number(totals[0]?.total ?? 0),
      page: input.page,
      pageSize: input.pageSize,
    };
  },

  /** Opciones de los filtros con recuento real: marcas, modelos de una marca y ciudades de un país. */
  async facets({ make, country }: { make?: string; country?: string }) {
    const [makes, models, cities, prices] = await Promise.all([
      prisma.$queryRaw<Array<{ value: string; count: bigint }>>`
        SELECT v.make AS value, COUNT(*) AS count FROM vehicles v WHERE ${VISIBLE} GROUP BY v.make ORDER BY v.make`,
      make
        ? prisma.$queryRaw<Array<{ value: string; count: bigint }>>`
            SELECT v.model AS value, COUNT(*) AS count FROM vehicles v WHERE ${VISIBLE} AND v.make = ${make} GROUP BY v.model ORDER BY v.model`
        : Promise.resolve([]),
      country
        ? prisma.$queryRaw<Array<{ value: string; count: bigint }>>`
            SELECT v.city AS value, COUNT(*) AS count FROM vehicles v WHERE ${VISIBLE} AND v.country = ${country} GROUP BY v.city ORDER BY v.city`
        : Promise.resolve([]),
      prisma.$queryRaw<Array<{ max: unknown }>>`SELECT MAX(v.price) AS max FROM vehicles v WHERE ${VISIBLE}`,
    ]);
    const plain = (list: Array<{ value: string; count: bigint }>) => list.map(item => ({ value: item.value, count: Number(item.count) }));
    const top = prices[0]?.max;
    return { makes: plain(makes), models: plain(models), cities: plain(cities), priceMax: top === null || top === undefined ? null : Math.ceil(Number(top)) };
  },

  /** Similares: misma categoría o marca, precio cercano, priorizando la zona del anuncio. */
  async similar(vehicle: { id: string; make: string; category: string; price: Prisma.Decimal; country: string; city: string }, limit = 6) {
    const now = new Date();
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT v.id FROM vehicles v
      WHERE ${VISIBLE} AND v.status = 'PUBLISHED' AND v.id <> ${vehicle.id}
        AND (v.category = ${vehicle.category} OR v.make = ${vehicle.make})
      ORDER BY ${orderBy(
        Prisma.sql`(v.category = ${vehicle.category}) + (v.make = ${vehicle.make}) DESC`,
        desc(localityScore({ country: vehicle.country, city: vehicle.city })),
        Prisma.sql`ABS(v.price - ${vehicle.price}) / ${vehicle.price} ASC`,
        desc(featuredScore(now)),
        Prisma.sql`v.searchBoost DESC`,
      )}
      LIMIT ${intRaw(limit)}`;
    return cardsInOrder(rows.map(row => row.id));
  },

  /**
   * Recomendaciones: cercanía + intereses reales del usuario (categorías y marcas de los
   * vehículos sobre los que chateó o que reservó) + destacados y prioridad del plan.
   */
  async recommended(userId: string | null, locality: Locality, limit = 8) {
    const now = new Date();
    let categories: string[] = [];
    let makes: string[] = [];
    if (userId) {
      const interests = await prisma.$queryRaw<Array<{ category: string; make: string }>>`
        SELECT DISTINCT v.category, v.make FROM vehicles v
        WHERE v.id IN (SELECT c.vehicleId FROM conversations c WHERE c.buyerId = ${userId})
           OR v.id IN (SELECT r.vehicleId FROM cart_reserves r WHERE r.buyerId = ${userId})
        LIMIT 50`;
      categories = [...new Set(interests.map(row => row.category))];
      makes = [...new Set(interests.map(row => row.make))];
    }
    const inList = (column: Prisma.Sql, values: string[]) => (values.length ? Prisma.sql`(${column} IN (${Prisma.join(values)}))` : null);
    const interest = [inList(Prisma.sql`v.category`, categories), inList(Prisma.sql`v.make`, makes)].filter((part): part is Prisma.Sql => part !== null);

    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT v.id FROM vehicles v
      WHERE ${VISIBLE} AND v.status = 'PUBLISHED' ${userId ? Prisma.sql`AND v.sellerId <> ${userId}` : Prisma.empty}
      ORDER BY ${orderBy(
        desc(localityScore(locality)),
        interest.length ? desc(Prisma.sql`(${Prisma.join(interest, ' + ')})`) : null,
        desc(featuredScore(now)),
        Prisma.sql`v.searchBoost DESC, v.publishedAt DESC`,
      )}
      LIMIT ${intRaw(limit)}`;
    return cardsInOrder(rows.map(row => row.id));
  },
};
