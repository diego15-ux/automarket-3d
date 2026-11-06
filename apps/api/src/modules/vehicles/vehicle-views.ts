import { createHash } from 'node:crypto';
import { localDay, toDbDate } from '../boosts/boost-calendar.js';
import { prisma } from '../../shared/infra/prisma.js';

/**
 * Vistas reales de los anuncios: una por persona (cuenta o IP) y día en el calendario de
 * Venezuela. El vendedor viendo su propio anuncio no cuenta. La memoria de «ya contada hoy» se
 * vacía al cambiar el día; si el servidor se reinicia, a lo sumo se cuenta otra vez a alguien ese día.
 */
let currentDay = '';
const seen = new Set<string>();
const MAX_SEEN = 200_000;

export function recordVehicleView(vehicle: { id: string; sellerId: string; status: string }, viewer: { userId: string | null; ip: string }) {
  if (viewer.userId === vehicle.sellerId || (vehicle.status !== 'PUBLISHED' && vehicle.status !== 'RESERVED')) return;
  const day = localDay();
  if (day !== currentDay) {
    currentDay = day;
    seen.clear();
  }
  const who = viewer.userId ?? `ip:${createHash('sha256').update(viewer.ip).digest('hex').slice(0, 16)}`;
  const key = `${vehicle.id}:${who}`;
  if (seen.has(key) || seen.size >= MAX_SEEN) return;
  seen.add(key);
  void prisma.$executeRaw`
    INSERT INTO vehicle_view_days (vehicleId, day, views) VALUES (${vehicle.id}, ${toDbDate(day)}, 1)
    ON DUPLICATE KEY UPDATE views = views + 1`.catch((err: unknown) => console.warn('No se pudo contar la vista del anuncio', err));
}
