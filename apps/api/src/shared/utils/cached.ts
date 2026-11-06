import { env } from '../../config/env.js';

/**
 * Guarda unos segundos en memoria el resultado de una consulta pesada que es igual para todos
 * (directorio, estadísticas del panel). Las peticiones que llegan a la vez comparten la misma
 * consulta. En las pruebas (NODE_ENV=test) siempre consulta la base.
 */
export function cached<T>(ttlMs: number, load: () => Promise<T>): () => Promise<T> {
  let entry: { at: number; promise: Promise<T> } | null = null;
  return () => {
    if (env.NODE_ENV === 'test') return load();
    const now = Date.now();
    if (!entry || now - entry.at > ttlMs) {
      const promise = load();
      entry = { at: now, promise };
      // Si falla, no se guarda: la próxima petición vuelve a intentar.
      promise.catch(() => {
        if (entry?.promise === promise) entry = null;
      });
    }
    return entry.promise;
  };
}
