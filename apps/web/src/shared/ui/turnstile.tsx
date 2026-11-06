'use client';

import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { publicEnv } from '@/shared/config/env';
import { loadScript } from '@/shared/lib/load-script';

interface TurnstileApi {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export interface TurnstileHandle {
  reset: () => void;
}

/**
 * Widget de Cloudflare Turnstile (verificación anti-bot sin puzles). El token se envía al
 * backend como `captchaToken` y allí se valida con siteverify, ligado a la `action`.
 * Sin NEXT_PUBLIC_TURNSTILE_SITE_KEY (solo desarrollo) no se muestra nada.
 */
export function Turnstile({ action, onToken, ref }: { action: string; onToken: (token: string | null) => void; ref?: Ref<TurnstileHandle> }) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useImperativeHandle(ref, () => ({
    reset: () => {
      onTokenRef.current(null);
      if (widgetId.current) window.turnstile?.reset(widgetId.current);
    },
  }));

  useEffect(() => {
    if (!publicEnv.turnstileSiteKey || !container.current) return;
    let cancelled = false;
    loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit')
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(container.current, {
          sitekey: publicEnv.turnstileSiteKey,
          action,
          theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
          language: 'es',
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
        });
      })
      .catch(() => onTokenRef.current(null));
    return () => {
      cancelled = true;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [action]);

  if (!publicEnv.turnstileSiteKey) return null;
  return <div ref={container} className="min-h-[65px]" />;
}

/** Campo trampa: invisible para personas (y lectores de pantalla); los bots lo rellenan. */
export function Honeypot() {
  return (
    <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
      <label>
        Sitio web
        <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
      </label>
    </div>
  );
}

/** Si hay clave pública, el formulario no se envía hasta tener token. */
export const turnstileRequired = () => Boolean(publicEnv.turnstileSiteKey);
