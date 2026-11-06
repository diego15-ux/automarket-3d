import { clientApiUrl, withLocalMedia } from '@/shared/config/env';
import { sessionStore, type SessionPayload } from './session';

/** Error de la API con el código estable del backend (KYC_REQUIRED, RATE_LIMITED…). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
}

async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as ErrorBody | null;
  return new ApiError(res.status, body?.error?.code ?? 'HTTP_ERROR', body?.error?.message ?? 'No pudimos completar la solicitud.', body?.error?.details);
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  headers?: HeadersInit;
  /** Las rutas de sesión no reintentan con refresh (evita bucles). */
  skipRefresh?: boolean;
}

/** Códigos con los que merece la pena renovar la sesión y reintentar una vez. */
const RECOVERABLE = new Set(['AUTH_REQUIRED', 'TOKEN_EXPIRED', 'INVALID_TOKEN']);

/** Cliente de la API: cookies de sesión, errores tipados y renovación transparente del access token. */
export async function apiFetch<T>(path: string, { method = 'GET', body, signal, skipRefresh = false, headers }: RequestOptions = {}): Promise<T> {
  const send = () =>
    fetch(`${clientApiUrl()}${path}`, {
      method,
      signal,
      credentials: 'include',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let res = await send();
  if (res.status === 401 && !skipRefresh) {
    const error = await toApiError(res.clone());
    if (RECOVERABLE.has(error.code) && (await refreshSession())) res = await send();
  }
  if (!res.ok) {
    const error = await toApiError(res);
    if (error.code === 'BLOCKED_TERMS' && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('automarket:blocked-terms'));
    }
    throw error;
  }
  return (res.status === 204 ? undefined : withLocalMedia(await res.json())) as T;
}

type Envelope<T> = { data: T };

/** Atajos que devuelven directamente `data` del sobre { data } de la API. */
export const api = {
  get: async <T>(path: string, signal?: AbortSignal, headers?: HeadersInit) => (await apiFetch<Envelope<T>>(path, { signal, headers })).data,
  post: async <T>(path: string, body: unknown = {}) => (await apiFetch<Envelope<T> | undefined>(path, { method: 'POST', body }))?.data as T,
  put: async <T>(path: string, body: unknown) => (await apiFetch<Envelope<T> | undefined>(path, { method: 'PUT', body }))?.data as T,
  patch: async <T>(path: string, body: unknown) => (await apiFetch<Envelope<T> | undefined>(path, { method: 'PATCH', body }))?.data as T,
  delete: (path: string) => apiFetch<void>(path, { method: 'DELETE' }),
};

let refreshing: Promise<SessionPayload | null> | null = null;

/**
 * Renueva la sesión con la cookie de refresh (rotatoria). Se serializa entre pestañas con
 * Web Locks: dos refresh simultáneos con el mismo token se detectarían como robo y la API
 * revocaría la sesión. Dentro de una pestaña, las llamadas concurrentes comparten promesa.
 */
export function refreshSession(): Promise<SessionPayload | null> {
  refreshing ??= (async () => {
    try {
      const request = () => fetch(`${clientApiUrl()}/api/auth/refresh`, { method: 'POST', credentials: 'include' });
      const res = typeof navigator !== 'undefined' && navigator.locks ? await navigator.locks.request('automarket:session-refresh', request) : await request();
      const payload = res.status === 200 ? withLocalMedia(((await res.json()) as { data: SessionPayload }).data) : null;
      sessionStore.set(payload);
      return payload;
    } catch {
      // Sin red: no cerramos la sesión, salvo que aún no supiéramos si existía.
      if (sessionStore.get().status === 'loading') sessionStore.set(null);
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}
