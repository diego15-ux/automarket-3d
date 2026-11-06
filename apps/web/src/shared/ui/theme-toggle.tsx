'use client';

import { Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { cn } from '@/shared/lib/cn';
import { preferencesAllowed } from '@/shared/lib/cookie-consent';

const STORAGE_KEY = 'am-theme';

/** Se ejecuta en <head> antes de pintar: tema guardado o, si no hay, el del sistema. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d)}catch(e){}})();`;

const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
};
const isDark = () => document.documentElement.classList.contains('dark');

/** Interruptor día/noche: guarda la preferencia y la aplica al instante en toda la app. */
export function ThemeToggle({ className }: { className?: string }) {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);

  const toggle = () => {
    const next = !isDark();
    document.documentElement.classList.toggle('dark', next);
    try {
      // Se recuerda solo si la persona dejó encendidas las cookies de «Preferencias».
      if (preferencesAllowed()) localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
    } catch {
      // modo privado sin almacenamiento: el cambio dura hasta recargar
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Activar modo día' : 'Activar modo noche'}
      title={dark ? 'Modo día' : 'Modo noche'}
      className={cn('grid size-11 place-items-center rounded-full border border-edge text-ink transition-colors hover:border-ink', className)}
    >
      {dark ? <Sun className="size-4" strokeWidth={1.75} /> : <Moon className="size-4" strokeWidth={1.75} />}
    </button>
  );
}
