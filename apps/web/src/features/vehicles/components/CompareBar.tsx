'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/shared/lib/cn';
import { MAX_COMPARE, useCompare } from '../compare';

/** Barra flotante «Comparar» (hasta 3 autos): aparece en cuanto eliges uno. */
export function CompareBar() {
  const compare = useCompare();
  const visible = compare.picks.length > 0;
  return (
    <div
      role="region"
      aria-label="Autos para comparar"
      aria-hidden={!visible}
      className={cn(
        'fixed bottom-5 left-1/2 z-30 flex max-w-[calc(100vw-24px)] items-center gap-3.5 rounded-[22px] bg-night py-2.5 pr-2.5 pl-[18px] text-white shadow-[0_24px_48px_-20px_rgb(0_0_0/0.55)] transition-[transform,opacity] duration-[420ms,300ms] ease-[cubic-bezier(.2,.9,.25,1)] motion-reduce:transition-none max-sm:gap-2.5 max-sm:pl-3.5',
        visible ? '-translate-x-1/2 translate-y-0 opacity-100' : 'pointer-events-none -translate-x-1/2 translate-y-[160%] opacity-0',
      )}
    >
      <span className="text-sm font-bold whitespace-nowrap max-sm:hidden">Comparar</span>
      <span className="flex gap-1.5">
        {compare.picks.map(pick => (
          <span key={pick.id} title={pick.name} className="relative h-11 w-16 overflow-hidden rounded-[10px] bg-[#202328] max-sm:w-12">
            {pick.coverUrl && (
              // Miniatura de la portada (URL pública del anuncio).
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pick.coverUrl} alt="" className="size-full object-cover" />
            )}
          </span>
        ))}
      </span>
      <span className="font-mono text-xs whitespace-nowrap text-[#a2a7b0]">
        {compare.picks.length} de {MAX_COMPARE}
      </span>
      <Link
        href={`/comparar?autos=${compare.picks.map(pick => pick.slug).join(',')}`}
        tabIndex={visible ? undefined : -1}
        className="inline-flex h-11 items-center rounded-[16px] bg-brand px-[18px] text-sm font-extrabold whitespace-nowrap text-on-brand"
      >
        Comparar ahora
      </Link>
      <button type="button" tabIndex={visible ? undefined : -1} aria-label="Quitar todos de la comparación" onClick={compare.clear} className="grid size-11 shrink-0 place-items-center rounded-[14px] text-[#a2a7b0] hover:bg-white/10 hover:text-white">
        <X className="size-4" strokeWidth={2.4} aria-hidden />
      </button>
    </div>
  );
}
