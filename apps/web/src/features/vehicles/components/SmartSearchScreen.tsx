'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ThemeToggle } from '@/shared/ui/theme-toggle';
import { applySuggestion, catalogHref, gearboxText, Icon, ICON, kmText, readRecent, ResultThumb, saveRecent, titleOf, usd, useSmartSearch, useSmartStart } from '../smart-search';

/**
 * Buscador inteligente a pantalla completa en el teléfono (diseño «buscador-movil»): mismo motor
 * que en PC, hasta 5 autos, resumen de precios y barra inferior para ver todos.
 */
export function SmartSearchScreen() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const { data, loading } = useSmartSearch(q, 5);
  const start = useSmartStart(true);
  useEffect(() => {
    setRecent(readRecent());
    const initial = new URLSearchParams(window.location.search).get('q');
    if (initial) setQ(initial);
    input.current?.focus();
  }, []);

  const hasText = q.trim().length > 0;
  const total = data?.total ?? 0;
  const pick = (text: string) => {
    setQ(text.toLowerCase());
    input.current?.focus();
  };
  const seeAll = () => {
    saveRecent(q);
    router.push(total === 1 && data?.results[0] ? `/vehiculos/${data.results[0].slug}` : catalogHref(data, q));
  };

  return (
    <div className="relative flex min-h-dvh flex-col bg-surface text-ink transition-colors duration-300 dark:bg-[#0E0F11]">
      <form
        role="search"
        aria-label="Buscar vehículos"
        onSubmit={event => {
          event.preventDefault();
          seeAll();
        }}
        className="sticky top-0 z-10 flex items-center gap-2 bg-surface px-3.5 pt-[18px] pb-3 dark:bg-[#0E0F11]"
      >
        <button type="button" aria-label="Volver" onClick={() => (window.history.length > 1 ? router.back() : router.push('/'))} className="grid size-11 shrink-0 place-items-center rounded-full border border-edge dark:border-[#2E3238]">
          <Icon d={ICON.back} size={18} stroke={2.2} />
        </button>
        <div className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full border-2 border-brand bg-surface pr-1.5 pl-3.5 dark:border-mint dark:bg-[#17191c]">
          <label htmlFor="buscar-q" className="sr-only">
            Busca como hablas
          </label>
          <input
            ref={input}
            id="buscar-q"
            value={q}
            onChange={event => setQ(event.target.value)}
            autoComplete="off"
            enterKeyHint="search"
            placeholder="Busca como hablas"
            className="min-w-0 flex-1 border-0 bg-transparent text-[15px] font-medium text-ink outline-none placeholder:text-[#7D838D]"
          />
          {hasText && (
            <button type="button" aria-label="Borrar la búsqueda" onClick={() => (setQ(''), input.current?.focus())} className="grid size-[34px] shrink-0 place-items-center rounded-full bg-card-tile text-muted dark:bg-[#202328]">
              <Icon d={ICON.close} size={13} stroke={2.6} />
            </button>
          )}
        </div>
        <ThemeToggle className="shrink-0" />
      </form>

      <div className="flex-1 px-4 pb-[120px]">
        {!hasText ? (
          <>
            {!!start.data?.popular.length && (
              <>
                <p className="mt-2 font-mono text-[11px] text-[#666C77] dark:text-[#7D838D]">Lo más publicado ahora</p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {start.data.popular.map(item => (
                    <button key={item} type="button" onClick={() => pick(item)} className="h-[38px] rounded-full border border-edge px-3.5 text-[13.5px] font-medium dark:border-[#2E3238]">
                      {item}
                    </button>
                  ))}
                </div>
              </>
            )}
            {recent.length > 0 && (
              <>
                <p className="mt-5 mb-1 font-mono text-[11px] text-[#666C77] dark:text-[#7D838D]">Recientes</p>
                {recent.map(item => (
                  <button key={item} type="button" onClick={() => pick(item)} className="flex h-[46px] w-full items-center gap-2.5 border-b border-line text-left text-[15px] font-medium dark:border-[#25282d]">
                    <Icon d={ICON.clock} className="text-[#666C77] dark:text-[#7D838D]" />
                    {item}
                  </button>
                ))}
              </>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12.5px] font-semibold text-muted">Entendí</span>
              {(data?.chips.length ? data.chips : [loading ? 'Leyendo…' : 'Todo el catálogo']).map(chip => (
                <span key={chip} className="am-in inline-flex h-7 items-center rounded-full bg-soft px-[11px] text-[12.5px] font-semibold text-brand-fg ">
                  {chip}
                </span>
              ))}
            </div>
            {!!data?.understood.length && <p className="mt-2 font-mono text-[11px] text-[#666C77] dark:text-[#7D838D]">{data.understood.join(', ')}</p>}
            {!!data?.suggestions.length && (
              <div className="mt-2.5">
                {data.suggestions.map(item => (
                  <button key={`${item.kind}-${item.label}`} type="button" onClick={() => pick(applySuggestion(q, item.word))} className="flex h-[46px] w-full items-center gap-2.5 border-b border-line text-left text-[15px] font-medium dark:border-[#25282d]">
                    <Icon d={ICON.search} className="text-[#666C77] dark:text-[#7D838D]" />
                    <span className="flex-1 truncate">{item.label}</span>
                    <span className="font-mono text-[11px] text-[#666C77] dark:text-[#7D838D]">{item.count}</span>
                  </button>
                ))}
              </div>
            )}
            {data?.relaxed && <p className="mt-3 text-[13px] font-semibold text-gold-fg dark:text-[#F5C451]">{data.relaxed}</p>}
            {data && data.results.length === 0 ? (
              <p className="mt-3.5 text-sm text-muted">No encontré autos con eso. Prueba otra palabra.</p>
            ) : (
              <div className="mt-3.5 flex flex-col gap-2.5">
                {data?.results.map((vehicle, i) => (
                  <Link key={vehicle.id} href={`/vehiculos/${vehicle.slug}`} onClick={() => saveRecent(q)} className="am-in flex items-center gap-3 rounded-[18px] border border-line bg-surface p-2 dark:border-[#25282d] dark:bg-[#17191c]">
                    <ResultThumb vehicle={vehicle} index={i} className="h-[68px] flex-[0_0_92px] rounded-xl bg-card-tile dark:bg-[#202328]" wheel="#0C0D0F" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-semibold">{titleOf(vehicle)}</span>
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-[#666C77] dark:text-[#7D838D]">
                        {kmText(vehicle.mileageKm)}, {gearboxText(vehicle).toLowerCase()}, {vehicle.city}
                      </span>
                      <span className="mt-1 block text-[15px] font-semibold">{usd(vehicle.price)}</span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
            {data?.insight && <p className="mt-3 font-mono text-[11px] text-[#666C77] dark:text-[#7D838D]">{data.insight}</p>}
          </>
        )}
      </div>

      {hasText && (
        <div className="fixed inset-x-0 bottom-0 z-10 flex gap-2 border-t border-line bg-[rgba(255,255,255,0.94)] px-4 pt-3 pb-[max(22px,env(safe-area-inset-bottom))] backdrop-blur-[10px] dark:border-[#25282d] dark:bg-[rgba(10,11,11,0.92)]">
          <button type="button" onClick={seeAll} className="h-[52px] flex-1 rounded-full bg-brand text-[15px] font-bold text-white dark:bg-brand dark:text-on-brand">
            {total === 0 ? 'Ver catálogo' : total === 1 ? 'Ver el auto' : `Ver los ${total} autos`}
          </button>
        </div>
      )}
    </div>
  );
}
