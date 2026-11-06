import type { ComponentProps, LabelHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

// Campos de los diseños: 48 px de alto, radio de 12 px y foco verde (menta en modo oscuro).
const control =
  'w-full rounded-sm border border-edge bg-surface text-ink placeholder:text-faint transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/20 disabled:opacity-60 dark:bg-sunken';

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('mb-1.5 block text-sm font-bold text-ink', className)} {...props} />;
}

// `cn` no resuelve conflictos: la altura y el tamaño de letra por defecto solo se aplican si el
// llamador no trae los suyos (p. ej. `h-9 text-[13px]` en selectores compactos).
const sized = (className: string | undefined, height: string) =>
  cn(/(^|\s)h-/.test(className ?? '') ? '' : height, /(^|\s)text-(xs|sm|base|\[)/.test(className ?? '') ? '' : 'text-[15px]');

// React 19: `ref` llega como prop normal y se reenvía al elemento nativo con `...props`.
export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(control, sized(className, 'h-12'), 'px-3.5', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(control, sized(className, ''), 'px-3.5 py-3 leading-relaxed', className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(control, sized(className, 'h-12'), 'cursor-pointer px-3.5', className)} {...props} />;
}

export function FieldError({ id, children }: { id?: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="mt-1.5 text-[13px] text-danger-fg">
      {children}
    </p>
  );
}

/** Etiqueta + control + error, con los aria-* conectados. */
export function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor: string; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <FieldError id={`${htmlFor}-error`}>{error}</FieldError> : hint ? <p className="mt-1.5 text-[13px] text-muted">{hint}</p> : null}
    </div>
  );
}
