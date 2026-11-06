import { io, type Socket } from 'socket.io-client';
import { clientApiUrl, sameOriginApi } from '@/shared/config/env';
import { refreshSession } from '@/shared/lib/http';
import { sessionStore } from '@/shared/lib/session';
import type { ClientToServerEvents, ServerToClientEvents } from '../types';

export type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const AUTH_ERRORS = new Set(['AUTH_REQUIRED', 'TOKEN_EXPIRED', 'INVALID_TOKEN']);
const MAX_RECOVERIES_PER_MINUTE = 3;

let socket: ChatSocket | null = null;
let recoveries: number[] = [];

/**
 * El servidor rechaza el handshake con un token caducado y corta la conexión cuando
 * el JWT expira. En ambos casos renovamos la sesión y reconectamos (con freno anti-bucle).
 */
async function recover() {
  const now = Date.now();
  recoveries = recoveries.filter(time => now - time < 60_000);
  if (recoveries.length >= MAX_RECOVERIES_PER_MINUTE) return;
  recoveries.push(now);
  if (await refreshSession()) socket?.connect();
}

/** Conexión única por pestaña, compartida por la bandeja y los hilos abiertos. */
export function getChatSocket(): ChatSocket {
  if (!socket) {
    socket = io(clientApiUrl(), {
      autoConnect: false,
      // Por el mismo origen (Next hace de puente) se empieza por HTTP y luego sube a WebSocket.
      transports: sameOriginApi() ? ['polling', 'websocket'] : ['websocket'],
      withCredentials: true,
      // Función: en cada (re)conexión se envía el access token vigente.
      auth: callback => {
        const session = sessionStore.get();
        callback({ token: session.status === 'authenticated' ? session.accessToken : '' });
      },
    });
    socket.on('connect_error', error => {
      if (AUTH_ERRORS.has(error.message)) void recover();
    });
    socket.on('disconnect', reason => {
      if (reason === 'io server disconnect') void recover();
    });
  }
  return socket;
}

export function disconnectChatSocket() {
  socket?.disconnect();
}
