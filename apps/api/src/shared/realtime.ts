import type { PublicServerToClientEvents, PublicStatsDTO, ServerToClientEvents } from '@automarket/contracts';
import type { Namespace, Server } from 'socket.io';
import { prisma } from './infra/prisma.js';

/**
 * Puente entre los casos de uso (HTTP, jobs, webhooks) y Socket.io. Los servicios
 * emiten DESPUÉS de confirmar su transacción; con el adapter Redis el evento llega
 * a sockets conectados a cualquier instancia.
 */
let io: Server<never, ServerToClientEvents> | null = null;
let publicNs: Namespace<never, PublicServerToClientEvents> | null = null;
let statsTimer: NodeJS.Timeout | null = null;

export const userRoom = (userId: string) => `user:${userId}`;

/** Contadores en vivo de la landing (datos reales de MySQL). */
export async function readPublicStats(): Promise<PublicStatsDTO> {
  const [users, vehicles] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
    prisma.vehicle.count({ where: { deletedAt: null, status: { in: ['PUBLISHED', 'RESERVED'] } } }),
  ]);
  return { users, vehicles };
}

export const realtime = {
  attach(server: Server, ns: Namespace) {
    io = server as unknown as Server<never, ServerToClientEvents>;
    publicNs = ns as unknown as Namespace<never, PublicServerToClientEvents>;
  },

  toUser<E extends keyof ServerToClientEvents>(userId: string, event: E, ...args: Parameters<ServerToClientEvents[E]>) {
    io?.to(userRoom(userId)).emit(event, ...args);
  },

  /** Agrupa cambios (altas, publicaciones) y emite una sola vez por segundo. */
  statsChanged() {
    if (!publicNs || statsTimer) return;
    statsTimer = setTimeout(() => {
      statsTimer = null;
      readPublicStats()
        .then(stats => publicNs?.emit('stats', stats))
        .catch(err => console.error('[realtime] stats', err));
    }, 1_000);
    statsTimer.unref();
  },
};
