'use client';

import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

type Tone = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  title: string;
  description?: string;
  tone: Tone;
}

type ToastInput = Omit<Toast, 'id' | 'tone'> & { tone?: Tone };

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

const ICONS = { info: Info, success: CircleCheck, error: CircleAlert } satisfies Record<Tone, unknown>;
const TONES: Record<Tone, string> = { info: 'text-muted', success: 'text-success-fg', error: 'text-danger-fg' };

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts(list => list.filter(toast => toast.id !== id)), []);

  const push = useCallback(
    ({ tone = 'info', ...toast }: ToastInput) => {
      const id = nextId++;
      setToasts(list => [...list.slice(-3), { ...toast, tone, id }]);
      setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  const value = useMemo(() => push, [push]);

  useEffect(() => {
    const alertBlockedTerms = () => push({
      tone: 'error',
      title: 'Lenguaje no permitido',
      description: 'Cambia las palabras marcadas e inténtalo de nuevo.',
    });
    window.addEventListener('automarket:blocked-terms', alertBlockedTerms);
    return () => window.removeEventListener('automarket:blocked-terms', alertBlockedTerms);
  }, [push]);

  return (
    <ToastContext value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 print:hidden flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end">
        {toasts.map(toast => {
          const Icon = ICONS[toast.tone];
          return (
            <div key={toast.id} role={toast.tone === 'error' ? 'alert' : 'status'} className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-sm border border-line bg-surface p-4 text-sm shadow-pop">
              <Icon className={cn('mt-0.5 size-4 shrink-0', TONES[toast.tone])} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{toast.title}</p>
                {toast.description && <p className="mt-0.5 text-muted">{toast.description}</p>}
              </div>
              <button type="button" onClick={() => dismiss(toast.id)} className="text-muted hover:text-ink" aria-label="Cerrar notificación">
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext>
  );
}

export function useToast() {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error('useToast debe usarse dentro de <ToastProvider>');
  return toast;
}
