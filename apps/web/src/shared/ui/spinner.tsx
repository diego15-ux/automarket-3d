import { cn } from '@/shared/lib/cn';

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cn('inline-block size-4 animate-spin rounded-full border-[1.5px] border-current border-r-transparent', className)} />;
}

export function PageSpinner({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div role="status" className="grid min-h-[40vh] place-items-center text-muted">
      <div className="flex items-center gap-3 text-sm">
        <Spinner className="size-4" />
        {label}
      </div>
    </div>
  );
}
