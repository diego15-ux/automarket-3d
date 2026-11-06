import { usdText } from '@automarket/contracts';
import { MAX_SAVED_VEHICLES, type SavedVehicleDTO } from '@automarket/contracts';
import { AppError } from '../../shared/errors/app-error.js';
import { isUniqueViolation, prisma, type Db } from '../../shared/infra/prisma.js';
import { notify, type PendingNotice } from '../../shared/notifications.js';
import { cardSelect, toCardDTO } from './vehicles.mapper.js';

/** Estados en los que un auto se puede guardar y sigue saliendo en «Tus guardados». */
const VISIBLE = ['PUBLISHED', 'RESERVED', 'SOLD'] as const;

const money = (value: number) => usdText(value);

/** «Guardar» en la ficha: autos guardados de cada persona y aviso cuando bajan de precio. */
export const savedService = {
  /** Ids de mis guardados (para pintar el corazón sin pedir la lista completa). */
  async ids(userId: string): Promise<string[]> {
    const rows = await prisma.vehicleFavorite.findMany({ where: { userId }, select: { vehicleId: true }, orderBy: { createdAt: 'desc' } });
    return rows.map(row => row.vehicleId);
  },

  /** «Tus guardados»: los disponibles primero; los vendidos o retirados al final (o no salen). */
  async list(userId: string): Promise<SavedVehicleDTO[]> {
    const rows = await prisma.vehicleFavorite.findMany({
      where: { userId, vehicle: { deletedAt: null, status: { in: [...VISIBLE] } } },
      orderBy: { createdAt: 'desc' },
      take: MAX_SAVED_VEHICLES,
      select: { savedPrice: true, createdAt: true, vehicle: { select: cardSelect } },
    });
    const rank = (status: string) => (status === 'PUBLISHED' ? 0 : status === 'RESERVED' ? 1 : 2);
    return rows
      .map(row => {
        const savedPrice = row.savedPrice.toNumber();
        const price = row.vehicle.price.toNumber();
        return { vehicle: toCardDTO(row.vehicle), savedPrice, priceDrop: Math.max(0, Math.round(savedPrice - price)), savedAt: row.createdAt.toISOString() };
      })
      .sort((a, b) => rank(a.vehicle.status) - rank(b.vehicle.status));
  },

  async save(vehicleId: string, userId: string): Promise<void> {
    const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null }, select: { status: true, sellerId: true, price: true } });
    if (!vehicle || !(VISIBLE as readonly string[]).includes(vehicle.status)) throw AppError.notFound('VEHICLE_NOT_FOUND', 'Vehículo no encontrado.');
    if (vehicle.sellerId === userId) throw AppError.badRequest('OWN_VEHICLE', 'Es tu propio anuncio.');
    if (vehicle.status === 'SOLD') throw AppError.conflict('VEHICLE_SOLD', 'Este auto ya se vendió.');
    const already = await prisma.vehicleFavorite.findUnique({ where: { userId_vehicleId: { userId, vehicleId } }, select: { userId: true } });
    if (already) return;
    if ((await prisma.vehicleFavorite.count({ where: { userId } })) >= MAX_SAVED_VEHICLES) {
      throw AppError.conflict('SAVED_LIMIT', `Puedes guardar hasta ${MAX_SAVED_VEHICLES} autos. Quita alguno para guardar otro.`);
    }
    try {
      await prisma.vehicleFavorite.create({ data: { userId, vehicleId, savedPrice: vehicle.price } });
    } catch (err) {
      // Doble clic: el otro pedido ya lo guardó.
      if (!isUniqueViolation(err)) throw err;
    }
  },

  async unsave(vehicleId: string, userId: string): Promise<void> {
    await prisma.vehicleFavorite.deleteMany({ where: { userId, vehicleId } });
  },
};

/**
 * El vendedor bajó el precio de un auto publicado: avisa a quienes lo guardaron (y no apagaron
 * «Bajadas de precio en tus guardados»). Va DENTRO de la transacción del cambio; tras el commit, `deliver()`.
 * Un aviso por persona y precio: si vuelve a subir y a bajar al mismo monto, no se repite.
 */
export async function notifyPriceDrop(
  db: Db,
  vehicle: { id: string; slug: string; make: string; model: string; version: string | null; year: number; sellerId: string },
  before: number,
  after: number,
): Promise<Array<PendingNotice | null>> {
  if (!(after < before)) return [];
  const savers = await db.vehicleFavorite.findMany({
    where: { vehicleId: vehicle.id, userId: { not: vehicle.sellerId }, user: { priceDropAlerts: true, status: 'ACTIVE', deletedAt: null } },
    select: { userId: true },
  });
  const name = `${vehicle.make} ${vehicle.model}${vehicle.version ? ` ${vehicle.version}` : ''}`;
  return Promise.all(
    savers.map(saver =>
      notify(db, {
        userId: saver.userId,
        type: 'PRICE_DROP',
        title: `Bajó de precio: ${name}`,
        body: `${vehicle.year} · de ${money(before)} a ${money(after)}`,
        link: `/vehiculos/${vehicle.slug}`,
        dedupeKey: `price-drop:${vehicle.id}:${saver.userId}:${Math.round(after * 100)}`,
      }),
    ),
  );
}
