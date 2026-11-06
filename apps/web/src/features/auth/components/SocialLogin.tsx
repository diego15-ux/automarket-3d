'use client';

import { useEffect, useRef } from 'react';
import { publicEnv } from '@/shared/config/env';
import { ApiError } from '@/shared/lib/http';
import { loadScript } from '@/shared/lib/load-script';
import { Button } from '@/shared/ui/button';
import { useToast } from '@/shared/ui/toaster';
import { authApi, type OAuthProvider } from '../api';
import { GOOGLE_SDK_URL } from '../lib/oauth-sdks';

/**
 * El SDK de Google devuelve un ID token (OIDC) que la API verifica; el nonce
 * aleatorio impide reutilizar un token interceptado.
 */
export function SocialLogin() {
  const toast = useToast();
  const googleSlot = useRef<HTMLDivElement>(null);

  const complete = async (provider: OAuthProvider, payload: { idToken: string; nonce: string; name?: string }) => {
    try {
      await authApi.oauth(provider, payload); // la página reacciona al cambio de sesión y redirige
    } catch (err) {
      toast({ tone: 'error', title: 'No pudimos iniciar sesión', description: err instanceof ApiError ? err.message : undefined });
    }
  };

  // Google pinta su propio botón (requisito de marca) dentro de nuestro hueco.
  useEffect(() => {
    if (!publicEnv.googleClientId) return;
    let cancelled = false;
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    loadScript(GOOGLE_SDK_URL)
      .then(() => {
        const slot = googleSlot.current;
        if (cancelled || !slot || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: publicEnv.googleClientId,
          nonce,
          ux_mode: 'popup',
          callback: ({ credential }) => void complete('google', { idToken: credential, nonce }),
        });
        window.google.accounts.id.renderButton(slot, { type: 'standard', theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', locale: 'es', width: slot.clientWidth || 320 });
      })
      .catch(() => toast({ tone: 'error', title: 'No se pudo cargar el acceso con Google' }));
    return () => {
      cancelled = true;
    };
    // El botón se inicializa una sola vez; `complete` y `toast` no cambian de comportamiento.
  }, []);

  return (
    <div>
      <div className="grid gap-3">
        {publicEnv.googleClientId ? (
          <div ref={googleSlot} className="flex h-[50px] items-center justify-center overflow-hidden rounded-full" />
        ) : (
          <Button variant="outline" disabled title="Configura NEXT_PUBLIC_GOOGLE_CLIENT_ID para activar el acceso con Google" className="h-[50px] gap-2.5 text-[15px] font-semibold">
            <span aria-hidden className="grid size-[26px] place-items-center rounded-full border border-line text-[13px] font-extrabold">G</span> Continuar con Google
          </Button>
        )}
      </div>
      {!publicEnv.googleClientId && <p className="mt-2 text-[12px] text-muted">Acceso con Google desactivado en este entorno.</p>}
    </div>
  );
}

