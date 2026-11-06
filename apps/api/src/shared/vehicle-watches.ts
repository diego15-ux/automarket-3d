import type { Db } from './infra/prisma.js';
import { notify, type PendingNotice } from './notifications.js';

/**
 * «Avísame si vuelve»: el auto dejó de estar en negociación sin venta. Avisa a quienes lo
 * esperaban y borra la lista (si vuelve a negociarse, cada quien se anota de nuevo).
 * Va DENTRO de la transacción que lo devuelve a publicado; tras el commit, `deliver()`.
 */
export async function notifyWatchersAvailable(db: Db, vehicle: { id: string; slug: string; make: string; model: string; year: number }): Promise<Array<PendingNotice | null>> {
  const watches = await db.vehicleWatch.findMany({ where: { vehicleId: vehicle.id }, select: { userId: true } });
  if (!watches.length) return [];
  await db.vehicleWatch.deleteMany({ where: { vehicleId: vehicle.id } });
  const name = `${vehicle.make} ${vehicle.model} ${vehicle.year}`;
  return Promise.all(
    watches.map(watch =>
      notify(db, {
        userId: watch.userId,
        type: 'VEHICLE_AVAILABLE_AGAIN',
        title: 'Volvió a estar disponible',
        body: `El ${name} que esperabas ya se puede reservar: la negociación no se concretó.`,
        link: `/vehiculos/${vehicle.slug}`,
      }),
    ),
  );
}

/** Se vendió: ya no hay nada que esperar. */
export async function clearWatchers(db: Db, vehicleId: string): Promise<void> {
  await db.vehicleWatch.deleteMany({ where: { vehicleId } });
}
