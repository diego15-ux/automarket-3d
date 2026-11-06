'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { applySuggestion, catalogHref, gearboxText, Icon, ICON, kmText, readRecent, ResultThumb, saveRecent, titleOf, usd, useSmartSearch, useSmartStart } from '../smart-search';

/**
 * Buscador inteligente de la cabecera en PC (diseño «buscador-pc»): escribe como hablas y ve al
 * momento qué entendió, sugerencias con su cantidad, los 4 mejores autos y el resumen de precios.
 */
export function SmartSearchBar({ className }: { className?: string }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const { data, loading } = useSmartSearch(q, 4);
  const start = useSmartStart(open);

  useEffect(() => {
    if (open) setRecent(readRecent());
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open]);

  const go = (href: string) => {
    saveRecent(q);
    setOpen(false);
    router.push(href);
  };
  const pick = (text: string) => {
    setQ(text.toLowerCase());
    setOpen(true);
    input.current?.focus();
  };
  const hasText = q.trim().length > 0;
  const total = data?.total ?? 0;

  return (
    <>
      {open && <button type="button" aria-label="Cerrar sugerencias" onClick={() => setOpen(false)} className="fixed inset-0 z-20 cursor-default bg-[rgb(17_19_18/0.28)]" />}
      <div ref={box} className={cn('relative z-30 max-w-[760px] flex-[1_1_420px]', className)}>
        <form
          role="search"
          aria-label="Buscar vehículos"
          onSubmit={event => {
            event.preventDefault();
            go(catalogHref(data, q));
          }}
          className={cn(
            'flex h-14 items-center gap-2.5 rounded-full border-2 bg-surface pr-1.5 pl-[18px] transition-[border-color,box-shadow] duration-200',
            open ? 'border-brand shadow-[0_0_0_4px_rgba(200,16,46,0.14)]' : 'border-[#D8DBE0] dark:border-line',
          )}
        >
          <Icon d={ICON.search} size={19} stroke={2.2} className="shrink-0 text-ink" />
          <label htmlFor={`${id}-q`} className="sr-only">
            Busca como hablas
          </label>
          <input
            ref={input}
            id={`${id}-q`}
            value={q}
            autoComplete="off"
            onFocus={() => setOpen(true)}
            onChange={event => {
              setQ(event.target.value);
              setOpen(true);
            }}
            role="combobox"
            aria-expanded={open}
            aria-controls={`${id}-list`}
            placeholder="Busca como hablas: camioneta automática hasta 20 mil en Valencia"
            className="min-w-0 flex-1 border-0 bg-transparent text-[15.5px] font-medium text-ink outline-none placeholder:text-[#6A707B] dark:placeholder:text-faint"
          />
          {hasText && (
            <button type="button" aria-label="Borrar la búsqueda" onClick={() => (setQ(''), input.current?.focus())} className="grid size-9 shrink-0 place-items-center rounded-full bg-canvas text-muted">
              <Icon d={ICON.close} size={14} stroke={2.6} />
            </button>
          )}
          <button type="submit" className="h-11 shrink-0 rounded-full bg-brand px-5 text-sm font-extrabold text-white hover:bg-brand-600">
            Buscar
          </button>
        </form>

        {open && (
          <div id={`${id}-list`} role="listbox" aria-label="Resultados al momento" className="am-in absolute top-[66px] right-0 left-0 overflow-hidden rounded-3xl border border-line bg-surface shadow-[0_30px_60px_-24px_rgba(21,23,26,0.35)]">
            {!hasText ? (
              <div className="px-5 py-[18px]">
                {!!start.data?.popular.length && (
                  <>
                    <p className="font-mono text-[11px] text-[#666C77] dark:text-muted">Lo más publicado ahora</p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {start.data.popular.map(item => (
                        <button key={item} type="button" onClick={() => pick(item)} className="h-[38px] rounded-full border border-[#D8DBE0] bg-surface px-3.5 text-[13.5px] font-semibold text-ink hover:border-ink dark:border-line">
                          {item}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {recent.length > 0 && (
                  <>
                    <p className="mt-[18px] font-mono text-[11px] text-[#666C77] dark:text-muted">Tus búsquedas recientes</p>
                    {recent.map(item => (
                      <button key={item} type="button" onClick={() => pick(item)} className="flex h-11 w-full items-center gap-2.5 text-left text-[14.5px] font-medium text-ink">
                        <Icon d={ICON.clock} className="text-[#666C77] dark:text-muted" />
                        {item}
                      </button>
                    ))}
                  </>
                )}
                {!start.data?.popular.length && recent.length === 0 && <p className="text-sm text-muted">Escribe como hablas: marca, precio, ciudad…</p>}
              </div>
            ) : (
              <>
                <div className="border-b border-[#ECEEF1] px-5 pt-4 pb-3.5 dark:border-line">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-extrabold text-ink">Entendí:</span>
                    {data?.chips.length ? (
                      data.chips.map(chip => (
                        <span key={chip} className="am-in inline-flex h-[30px] items-center rounded-full bg-soft px-3 text-[13px] font-bold text-brand-fg">
                          {chip}
                        </span>
                      ))
                    ) : (
                      <span className="text-[13px] text-muted">{loading ? 'leyendo…' : 'todo el catálogo'}</span>
                    )}
                  </div>
                  {!!data?.understood.length && (
                    <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
                      <Icon d={ICON.check} size={14} stroke={2.2} className="text-brand-fg" />
                      {data.understood.join(', ')}
                    </p>
                  )}
                </div>
                {!!data?.suggestions.length && (
                  <div className="border-b border-[#ECEEF1] px-3 py-2 dark:border-line">
                    {data.suggestions.map(item => (
                      <button key={`${item.kind}-${item.label}`} type="button" role="option" aria-selected={false} onClick={() => pick(applySuggestion(q, item.word))} className="flex h-11 w-full items-center gap-2.5 rounded-xl px-2 text-left text-[14.5px] font-semibold text-ink hover:bg-canvas">
                        <Icon d={ICON.search} className="text-[#666C77] dark:text-muted" />
                        <span className="flex-1 truncate">{item.label}</span>
                        <span className="font-mono text-[11.5px] font-normal text-[#666C77] dark:text-muted">
                          {item.kind} · {item.count}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="px-3 py-2.5">
                  {data?.relaxed && <p className="mx-2 mt-1 mb-2 text-[13px] font-semibold text-gold-fg">{data.relaxed}</p>}
                  {!data && loading ? (
                    Array.from({ length: 3 }, (_, i) => <div key={i} className="m-2 h-[52px] animate-pulse rounded-[14px] bg-canvas" />)
                  ) : data && data.results.length === 0 ? (
                    <p className="m-2 text-sm text-muted">No encontré autos con eso. Prueba otra palabra.</p>
                  ) : (
                    data?.results.map((vehicle, i) => (
                      <Link key={vehicle.id} href={`/vehiculos/${vehicle.slug}`} role="option" aria-selected={false} onClick={() => (saveRecent(q), setOpen(false))} className="am-in flex items-center gap-3 rounded-[14px] p-2 hover:bg-canvas">
                        <ResultThumb vehicle={vehicle} index={i} className="h-[52px] flex-[0_0_72px] rounded-[10px] bg-card-tile" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14.5px] font-bold text-ink">{titleOf(vehicle)}</span>
                          <span className="block truncate text-[13px] text-muted">
                            {kmText(vehicle.mileageKm)}, {gearboxText(vehicle).toLowerCase()}, {vehicle.city}
                          </span>
                        </span>
                        <span className="text-[15px] font-extrabold text-ink">{usd(vehicle.price)}</span>
                      </Link>
                    ))
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-[#ECEEF1] bg-[#F8F9FA] px-5 py-3 dark:border-line dark:bg-sunken">
                  <span className="text-[13px] text-muted">{data?.insight}</span>
                  <button type="button" onClick={() => go(total === 1 && data?.results[0] ? `/vehiculos/${data.results[0].slug}` : catalogHref(data, q))} className="h-10 rounded-full bg-brand px-4 text-[13.5px] font-extrabold text-white hover:bg-brand-600">
                    {total === 0 ? 'Ver catálogo' : total === 1 ? 'Ver el auto' : `Ver los ${total} autos`}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
