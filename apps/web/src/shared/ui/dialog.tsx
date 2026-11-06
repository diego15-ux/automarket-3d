'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Diálogo modal sobre <dialog> nativo: foco atrapado, Esc para cerrar y fondo inerte sin
 * dependencias. `open` lo controla el padre; `onClose` se llama al cerrarse por cualquier vía.
 */
export function Dialog({ open, onClose, title, children, className }: { open: boolean; onClose: () => void; title: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={event => {
        if (event.target === ref.current) onClose(); // clic en el fondo
      }}
      className={cn(
        'm-auto max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100%-2rem))] overflow-y-auto rounded-md border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-black/55',
        className,
      )}
    >
      <div className="p-6 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="font-display text-2xl">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="-m-1 rounded-sm p-1 text-muted hover:bg-sunken hover:text-ink">
            <X className="size-5" />
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </dialog>
  );
}
