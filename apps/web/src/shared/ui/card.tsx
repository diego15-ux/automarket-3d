import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

/** Tarjeta blanca de los diseños: radio de 22 px y borde fino. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-md border border-line bg-surface', className)} {...props} />;
}

/** Cabecera de página: antetítulo discreto, titular en serif y una regla que cierra el bloque. */
export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div data-page-header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <p data-page-eyebrow className="text-[13px] text-muted">
            {eyebrow}
          </p>
        )}
        <h1 data-page-title className="mt-0.5 font-display text-[28px] leading-tight text-balance sm:text-[32px]">
          {title}
        </h1>
        {description && <p className="mt-1 max-w-2xl text-[14.5px] text-pretty text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Estado vacío: qué pasa y qué hacer ahora. Icono monocromo opcional, sin ilustraciones. */
export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-edge px-6 py-12 text-center">
      {icon && <div className="mx-auto mb-3 grid place-items-center text-muted">{icon}</div>}
      <p className="font-display text-xl">{title}</p>
      {description && <p className="mx-auto mt-1.5 max-w-md text-sm text-pretty text-muted">{description}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
