'use client';

import { useSyncExternalStore } from 'react';
import { LOADING_SESSION, sessionStore, type SessionState } from './session';

/**
 * Sesión actual para componentes cliente. Vive aparte del store para que los módulos
 * que solo usan `sessionStore` (API, socket) puedan importarse también desde el servidor.
 */
export function useSession(): SessionState {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.get, () => LOADING_SESSION);
}
