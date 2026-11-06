'use client';

import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Fila que se desplaza a mano (arrastre, rueda o flechas). Sin autoavance: el usuario decide
 * el ritmo y nada se mueve mientras lee. Cada hijo trae su propio ancho y `snap-start`.
 */
export function ScrollRow({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: count <= 1 });

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const update = () => setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [count]);

  const scrollBy = (direction: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: smooth ? 'smooth' : 'auto' });
  };

  const arrows = !(edges.start && edges.end);
  const button = 'grid size-10 place-items-center rounded-sm border border-edge text-ink transition-colors hover:border-ink disabled:opacity-35 disabled:hover:border-edge';

  return (
    <div className="@container">
      <div
        ref={track}
        tabIndex={0}
        aria-label={label}
        className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-6 overflow-x-auto scroll-px-4 px-4 pb-1 sm:-mx-6 sm:scroll-px-6 sm:px-6"
      >
        {children}
      </div>
      {arrows && (
        <div className="mt-6 flex items-center justify-end gap-1.5">
          <button type="button" onClick={() => scrollBy(-1)} disabled={edges.start} aria-label="Ver anteriores" title="Anteriores" className={button}>
            <ArrowLeft className="size-4" />
          </button>
          <button type="button" onClick={() => scrollBy(1)} disabled={edges.end} aria-label="Ver siguientes" title="Siguientes" className={button}>
            <ArrowRight className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
