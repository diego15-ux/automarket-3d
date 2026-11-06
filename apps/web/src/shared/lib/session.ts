import type { PublicUser, Role, SessionPayload } from '@automarket/contracts';

export type { Role, SessionPayload };
/** Usuario de la sesión (roles unificados: todo USER compra, reserva y publica). */
export type SessionUser = PublicUser;

export type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: SessionUser; accessToken: string };

export const LOADING_SESSION: SessionState = { status: 'loading' };
let state: SessionState = LOADING_SESSION;
const listeners = new Set<() => void>();

// Cerrar sesión en una pestaña la cierra en todas.
const channel = typeof window !== 'undefined' && 'BroadcastChannel' in window ? new BroadcastChannel('automarket:session') : null;

/**
 * Estado de sesión en memoria. El access token nunca toca localStorage:
 * las cookies httpOnly hacen el trabajo y aquí solo guardamos lo que necesita la UI
 * (usuario) y Socket.io (token para el handshake).
 */
export const sessionStore = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  set(payload: SessionPayload | null, { broadcastLogout = false } = {}) {
    state = payload ? { status: 'authenticated', user: payload.user, accessToken: payload.accessToken } : { status: 'anonymous' };
    listeners.forEach(listener => listener());
    if (broadcastLogout && !payload) channel?.postMessage('logout');
  },
};

channel?.addEventListener('message', event => {
  if (event.data === 'logout') sessionStore.set(null);
});

