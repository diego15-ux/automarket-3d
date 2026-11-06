'use client';

import { usdText } from '@automarket/contracts';
import { CATEGORY_LABELS, COUNTRIES, FUEL_LABELS, type VehicleCardDTO, type VehicleSearchInput } from '@automarket/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { LayoutGrid, List, MapPin, SlidersHorizontal, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { formatNumber } from '@/shared/lib/format';
import { getCurrentLocation, type Coordinates } from '@/shared/lib/geolocation';
import { useSession } from '@/shared/lib/use-session';
import { vehicleKeys, vehiclesApi } from '../api';
import { MAX_COMPARE, pickOf, useCompare, useWatching } from '../compare';
import { CompareBar } from './CompareBar';
import { VehicleCard } from './VehicleCard';

const SORTS: Array<{ value: VehicleSearchInput['sort']; label: string }> = [
  { value: 'relevance', label: 'Relevancia' },
  { value: 'price_asc', label: 'Precio: menor a mayor' },
  { value: 'price_desc', label: 'Precio: mayor a menor' },
  { value: 'year_desc', label: 'Año: más nuevos' },
  { value: 'newest', label: 'Más recientes' },
];
const YEARS = [2010, 2015, 2018, 2020, 2022];
const MILEAGES = [50_000, 100_000, 150_000];
/** Regla de los diseños: como máximo 1 destacado por cada 4 autos, y se turnan cada 5 s. */
const ORGANIC_PER_FEATURED = 4;
const TURN_MS = 5_000;
const money = (value: number) => usdText(value);
const thousands = (value: number) => (value >= 1000 ? `$${Math.round(value / 1000)}k` : money(value));

/**
 * Catálogo (diseño «Catálogo con filtros»): los filtros viven en la URL (se comparten y
 * funcionan con «atrás»); la cercanía usa la ubicación del navegador solo para ordenar.
 */
export function VehicleSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const session = useSession();
  const compare = useCompare();
  const watching = useWatching();
  const [drawer, setDrawer] = useState(false);
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [nearbyLocation, setNearbyLocation] = useState<Coordinates | null>(null);
  const [nearbyStatus, setNearbyStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  const query = params.toString();
  const make = params.get('make') ?? '';
  const country = params.get('country') ?? '';
  const nearby = params.get('nearby') === 'true';
  const page = Number(params.get('page') ?? 1);

  useEffect(() => {
    if (!nearby) return;
    let active = true;
    getCurrentLocation()
      .then(location => {
        if (!active) return;
        setNearbyLocation(location);
        setNearbyStatus('ready');
      })
      .catch(error => {
        if (!active) return;
        setNearbyError(error instanceof Error ? error.message : 'No se pudo obtener la ubicación.');
        setNearbyStatus('error');
      });
    return () => {
      active = false;
    };
  }, [nearby]);

  const results = useQuery({
    queryKey: [...vehicleKeys.search(query), session.status, nearbyLocation?.latitude, nearbyLocation?.longitude],
    queryFn: ({ signal }) => vehiclesApi.search(query, signal, nearby ? nearbyLocation : null),
    placeholderData: keepPreviousData,
    enabled: session.status !== 'loading' && (!nearby || Boolean(nearbyLocation)),
  });
  const facets = useQuery({ queryKey: vehicleKeys.facets(make, country), queryFn: () => vehiclesApi.facets(make, country), staleTime: 60_000 });

  const navigate = (next: URLSearchParams) => {
    next.delete('page');
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
  };
  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if ('make' in patch) next.delete('model');
    if ('country' in patch) next.delete('city');
    if (patch.nearby) {
      setNearbyStatus('loading');
      setNearbyError(null);
    }
    if ('nearby' in patch && !patch.nearby) {
      setNearbyLocation(null);
      setNearbyStatus('idle');
    }
    navigate(next);
  };
  const clearAll = () => navigate(new URLSearchParams());

  // Precio máximo: deslizador con el tope real del catálogo; se aplica al soltar.
  const ceiling = Math.max(5_000, Math.ceil((facets.data?.priceMax ?? 45_000) / 1_000) * 1_000);
  const priceParam = params.get('priceMax');
  const [priceDraft, setPriceDraft] = useState<number | null>(null);
  const priceValue = priceDraft ?? (priceParam ? Math.min(Number(priceParam), ceiling) : ceiling);
  const commitPrice = (value: number) => {
    setPriceDraft(null);
    setParams({ priceMax: value >= ceiling ? null : String(value) });
  };

  const items = useMemo(() => results.data?.items ?? [], [results.data]);
  const featured = useFeaturedTurns(items);
  const total = results.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (results.data?.pageSize ?? 24)));
  const goToPage = (target: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(target));
    router.replace(`${pathname}?${next}`);
  };

  const gearbox = params.get('gearbox');
  const chips = activeChips(params);
  const filters = (
    <FiltersPanel
      params={params}
      facetsCities={facets.data?.cities ?? []}
      ceiling={ceiling}
      priceValue={priceValue}
      onPriceDraft={setPriceDraft}
      onPriceCommit={commitPrice}
      gearbox={gearbox}
      onChange={setParams}
      onClear={clearAll}
      onClose={() => setDrawer(false)}
    />
  );

  // Las marcas con más autos publicados primero (hasta 12); la elegida siempre se ve.
  const topMakes = (() => {
    const list = [...(facets.data?.makes ?? [])].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'es'));
    const top = list.slice(0, 12);
    const chosen = make ? list.find(item => item.value.toLocaleLowerCase('es') === make.toLocaleLowerCase('es')) : undefined;
    if (chosen && !top.includes(chosen)) top.push(chosen);
    return top.map(item => ({ value: item.value, label: item.value, count: item.count as number | null }));
  })();

  return (
    <div data-own-header className="pb-[120px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="Ruta" className="text-[13px] text-muted">
            <Link href="/" className="hover:text-ink hover:underline">
              Inicio
            </Link>{' '}
            / Catálogo
          </nav>
          <h1 className="mt-1 text-[30px] font-extrabold tracking-[-0.03em]">Autos en venta</h1>
        </div>
        <p aria-live="polite" className="text-sm text-muted">
          {results.isPending ? (
            'Buscando…'
          ) : (
            <>
              <strong className="text-ink">
                {formatNumber(total)} {total === 1 ? 'auto' : 'autos'}
              </strong>
              {!nearby && !params.get('sort') && session.status === 'authenticated' && session.user.city ? `, primero los de ${session.user.city}` : ''}
            </>
          )}
        </p>
      </div>

      <nav aria-label="Marcas" className="mt-4 flex gap-6 overflow-x-auto border-b border-line [scrollbar-width:thin]">
        {[{ value: '', label: 'Todas', count: null as number | null }, ...topMakes].map(item => {
          const pressed = make.toLocaleLowerCase('es') === item.value.toLocaleLowerCase('es');
          return (
            <button
              key={item.value || 'all'}
              type="button"
              aria-pressed={pressed}
              onClick={() => setParams({ make: item.value || null })}
              className={cn(
                '-mb-px flex h-11 shrink-0 items-center gap-1.5 border-b-2 text-[15px] transition-colors duration-200',
                pressed ? 'border-brand font-extrabold text-ink' : 'border-transparent font-semibold text-muted hover:text-ink',
              )}
            >
              {item.label}
              {item.count !== null && <span className="text-[12.5px] font-medium text-faint">{item.count}</span>}
            </button>
          );
        })}
      </nav>

      <div className="mt-5 flex flex-wrap items-start gap-6">
        <aside aria-label="Filtros" className="hidden max-w-full flex-[1_1_260px] min-[860px]:block min-[860px]:max-w-[300px]">
          {filters}
        </aside>
        {drawer && (
          <div className="fixed inset-0 z-40 overflow-y-auto bg-canvas p-4 min-[860px]:hidden" role="dialog" aria-modal="true" aria-label="Filtros">
            {filters}
            <button type="button" onClick={() => setDrawer(false)} className="sticky bottom-4 mt-4 h-[52px] w-full rounded-full bg-brand text-base font-bold text-on-brand shadow-pop">
              Ver {formatNumber(total)} {total === 1 ? 'auto' : 'autos'}
            </button>
          </div>
        )}

        <section aria-label="Resultados" className="min-w-0 flex-[999_1_560px]">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setDrawer(true)} className="inline-flex h-11 items-center gap-2 rounded-full border border-ink px-4 text-sm font-bold min-[860px]:hidden">
              <SlidersHorizontal className="size-4" aria-hidden /> Filtros{chips.length ? ` (${chips.length})` : ''}
            </button>
            {chips.map(chip => (
              <button
                key={chip.key}
                type="button"
                onClick={() => setParams(chip.clear)}
                aria-label={`Quitar filtro ${chip.label}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-edge/70 bg-surface pr-2.5 pl-3.5 text-[13px] font-semibold hover:border-ink"
              >
                {chip.label}
                <X className="size-3.5" strokeWidth={2.4} aria-hidden />
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <label htmlFor="sort" className="sr-only">
                Ordenar
              </label>
              <select
                id="sort"
                value={nearby ? 'relevance' : (params.get('sort') ?? 'relevance')}
                disabled={nearby}
                onChange={event => setParams({ sort: event.target.value === 'relevance' ? null : event.target.value })}
                className="h-11 rounded-full border border-edge/70 bg-surface px-3.5 text-sm font-semibold disabled:opacity-70"
              >
                {SORTS.map(sort => (
                  <option key={sort.value} value={sort.value}>
                    {sort.value === 'relevance' && nearby ? 'Más cerca primero' : sort.label}
                  </option>
                ))}
              </select>
              <div role="group" aria-label="Vista" className="inline-flex rounded-full bg-sunken p-1 max-sm:hidden">
                {(
                  [
                    ['grid', 'Ver en cuadrícula', LayoutGrid],
                    ['list', 'Ver en lista', List],
                  ] as const
                ).map(([value, label, Icon]) => (
                  <button key={value} type="button" aria-label={label} aria-pressed={layout === value} onClick={() => setLayout(value)} className={cn('grid h-9 w-10 place-items-center rounded-full', layout === value && 'bg-surface shadow-[0_1px_3px_rgb(17_19_18/0.12)]')}>
                    <Icon className="size-4" aria-hidden />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {nearby && nearbyStatus === 'loading' ? (
            <EmptyBox title="Buscando tu ubicación" text="El navegador te pedirá permiso para ordenar los anuncios por distancia." />
          ) : nearby && nearbyStatus === 'error' ? (
            <EmptyBox title="No pudimos obtener tu ubicación" text={nearbyError ?? 'Permite el acceso a la ubicación y vuelve a intentarlo.'} action={{ label: 'Quitar «A menos de 100 km»', onClick: () => setParams({ nearby: null }) }} />
          ) : results.isError ? (
            <EmptyBox title="No pudimos cargar el catálogo" text={results.error.message} />
          ) : results.data && items.length === 0 ? (
            <EmptyBox title="Ningún auto con estos filtros" text={nearby ? 'No hay autos publicados a menos de 100 km de ti.' : 'Sube el precio máximo o quita algún filtro.'} action={{ label: 'Limpiar filtros', onClick: clearAll }} />
          ) : (
            <div
              className={cn(
                'mt-4 grid gap-[18px] transition-opacity duration-200',
                layout === 'grid' ? 'grid-cols-[repeat(auto-fill,minmax(250px,1fr))]' : 'grid-cols-1',
                results.isPlaceholderData && 'opacity-50',
              )}
            >
              {results.isPending
                ? Array.from({ length: 6 }, (_, i) => (
                    <div key={i} aria-hidden className="overflow-hidden rounded-[20px] border border-line bg-surface">
                      <div className="aspect-[4/3] animate-pulse bg-card-tile" />
                      <div className="space-y-2 p-4">
                        <div className="h-4 w-2/3 animate-pulse rounded bg-sunken" />
                        <div className="h-3 w-1/2 animate-pulse rounded bg-sunken" />
                      </div>
                    </div>
                  ))
                : featured.ordered.map((vehicle, index) => (
                    <VehicleCard
                      key={vehicle.id}
                      vehicle={vehicle}
                      layout={layout}
                      priority={index < 3}
                      featuredLabel={featured.labelOf(vehicle)}
                      compare={{
                        selected: compare.has(vehicle.id),
                        disabled: vehicle.status === 'SOLD' || (compare.full && !compare.has(vehicle.id)),
                        onToggle: () => compare.toggle(pickOf(vehicle)),
                      }}
                      watch={
                        vehicle.status === 'RESERVED' && watching.signedIn
                          ? { watching: watching.isWatching(vehicle.id), busy: watching.busy, onToggle: () => watching.toggle(vehicle.id) }
                          : undefined
                      }
                    />
                  ))}
            </div>
          )}

          {pages > 1 && (
            <nav aria-label="Paginación" className="mt-10 flex items-center justify-between gap-2 border-t border-line pt-5">
              <button type="button" disabled={page <= 1} onClick={() => goToPage(page - 1)} className="h-11 rounded-full border border-field-line bg-field px-[18px] text-sm font-bold disabled:opacity-50">
                Anterior
              </button>
              <span className="font-mono text-[13px] text-muted">
                Página {page} de {pages}
              </span>
              <button type="button" disabled={page >= pages} onClick={() => goToPage(page + 1)} className="h-11 rounded-full border border-field-line bg-field px-[18px] text-sm font-bold disabled:opacity-50">
                Siguiente
              </button>
            </nav>
          )}
        </section>
      </div>
      <CompareBar />
      <span className="sr-only">Puedes comparar hasta {MAX_COMPARE} autos.</span>
    </div>
  );
}

// ── Filtros ──────────────────────────────────────────────────────────────────

function FiltersPanel({
  params,
  facetsCities,
  ceiling,
  priceValue,
  onPriceDraft,
  onPriceCommit,
  gearbox,
  onChange,
  onClear,
  onClose,
}: {
  params: URLSearchParams;
  facetsCities: Array<{ value: string; count: number }>;
  ceiling: number;
  priceValue: number;
  onPriceDraft: (value: number) => void;
  onPriceCommit: (value: number) => void;
  gearbox: string | null;
  onChange: (patch: Record<string, string | null>) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const condition = params.get('condition') ?? '';
  const country = params.get('country') ?? '';
  const automatic = gearbox !== 'MANUAL';
  const manual = gearbox !== 'AUTOMATIC';
  const setGearbox = (nextAutomatic: boolean, nextManual: boolean) => onChange({ gearbox: nextAutomatic && nextManual ? null : nextAutomatic ? 'AUTOMATIC' : 'MANUAL' });
  const select = 'mt-1.5 h-11 w-full rounded-[12px] border border-edge bg-surface px-2.5 text-sm';
  return (
    <div className="flex flex-col gap-[22px] rounded-[20px] border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] font-extrabold">Filtros</h2>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onClear} className="h-9 rounded-full px-3 text-[13.5px] font-bold text-brand-fg hover:bg-soft">
            Limpiar
          </button>
          <button type="button" onClick={onClose} aria-label="Cerrar filtros" className="grid size-9 place-items-center rounded-full hover:bg-sunken min-[860px]:hidden">
            <X className="size-5" aria-hidden />
          </button>
        </div>
      </div>

      <div>
        <p className="text-[13px] font-bold">Condición</p>
        <div role="group" aria-label="Condición" className="mt-2 grid grid-cols-3 rounded-full bg-sunken p-1">
          {(
            [
              ['', 'Todos'],
              ['NEW', 'Nuevos'],
              ['USED', 'Usados'],
            ] as const
          ).map(([value, label]) => (
            <button key={label} type="button" aria-pressed={condition === value} onClick={() => onChange({ condition: value || null })} className={cn('h-9 rounded-full text-[13px] font-bold transition-colors duration-200', condition === value ? 'bg-surface text-ink shadow-[0_1px_3px_rgb(17_19_18/0.12)] dark:bg-[#2a2e34]' : 'text-muted')}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <label htmlFor="f-price" className="text-[13px] font-bold">
            Precio máximo
          </label>
          <span className="text-[15px] font-extrabold">{money(priceValue)}</span>
        </div>
        <input
          id="f-price"
          type="range"
          min={1_000}
          max={ceiling}
          step={1_000}
          value={priceValue}
          onChange={event => onPriceDraft(Number(event.target.value))}
          onPointerUp={event => onPriceCommit(Number(event.currentTarget.value))}
          onKeyUp={event => onPriceCommit(Number(event.currentTarget.value))}
          className="mt-2.5 w-full accent-brand"
        />
        <div className="flex justify-between font-mono text-[11px] text-faint">
          <span>$1k</span>
          <span>{thousands(ceiling)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <label className="block text-[13px] font-bold">
          Año desde
          <select value={params.get('yearMin') ?? ''} onChange={event => onChange({ yearMin: event.target.value || null })} className={select}>
            <option value="">Cualquiera</option>
            {YEARS.map(year => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[13px] font-bold">
          Km hasta
          <select value={params.get('mileageMax') ?? ''} onChange={event => onChange({ mileageMax: event.target.value || null })} className={select}>
            <option value="">Cualquiera</option>
            {MILEAGES.map(km => (
              <option key={km} value={km}>
                {km.toLocaleString('de-DE')}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset>
        <legend className="text-[13px] font-bold">Transmisión</legend>
        {(
          [
            ['Automática', automatic, () => setGearbox(!automatic, manual)],
            ['Manual', manual, () => setGearbox(automatic, !manual)],
          ] as const
        ).map(([label, checked, toggle]) => (
          <label key={label} className="flex min-h-10 items-center gap-2.5 text-sm">
            {/* Siempre queda al menos una marcada: sin ninguna no habría autos. */}
            <input type="checkbox" checked={checked} disabled={checked && (label === 'Automática' ? !manual : !automatic)} onChange={toggle} className="size-[18px] accent-brand" />
            {label}
          </label>
        ))}
      </fieldset>

      <div className="grid gap-2.5">
        <label className="block text-[13px] font-bold">
          País
          <select value={country} onChange={event => onChange({ country: event.target.value || null })} className={select}>
            <option value="">Todos</option>
            {COUNTRIES.map(item => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {country && (
          <label className="block text-[13px] font-bold">
            Ciudad
            <select value={params.get('city') ?? ''} onChange={event => onChange({ city: event.target.value || null })} className={select}>
              <option value="">Todas</option>
              {facetsCities.map(item => (
                <option key={item.value} value={item.value}>
                  {item.value} ({item.count})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-line/70 pt-3.5">
        <Switch label="Solo vendedores verificados" on={params.get('verified') === 'true'} onToggle={on => onChange({ verified: on ? 'true' : null })} />
        <Switch label="A menos de 100 km" on={params.get('nearby') === 'true'} onToggle={on => onChange({ nearby: on ? 'true' : null, ...(on ? { city: null, country: null } : {}) })} />
      </div>
    </div>
  );
}

export function Switch({ label, on, onToggle }: { label: string; on: boolean; onToggle: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onToggle(!on)} className="flex min-h-11 items-center justify-between gap-3 text-left text-sm font-semibold">
      {label}
      <span aria-hidden className={cn('relative h-[26px] w-11 shrink-0 rounded-full transition-colors duration-200', on ? 'bg-brand' : 'bg-edge')}>
        <span className={cn('absolute top-[3px] left-[3px] size-5 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-transform duration-[220ms] ease-[cubic-bezier(.2,.9,.25,1)] motion-reduce:transition-none', on && 'translate-x-[18px]')} />
      </span>
    </button>
  );
}

function EmptyBox({ title, text, action }: { title: string; text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="mt-4 rounded-[20px] border border-dashed border-edge bg-surface px-6 py-12 text-center">
      <p className="text-[17px] font-extrabold">{title}</p>
      <p className="mt-1.5 mb-4 text-sm text-muted">{text}</p>
      {action && (
        <button type="button" onClick={action.onClick} className="h-11 rounded-full bg-ink px-5 text-sm font-bold text-surface">
          {action.label}
        </button>
      )}
    </div>
  );
}

// ── Chips de filtros activos ────────────────────────────────────────────────

function activeChips(params: URLSearchParams): Array<{ key: string; label: string; clear: Record<string, null> }> {
  const chips: Array<{ key: string; label: string; clear: Record<string, null> }> = [];
  const add = (key: string, label: string, clear: Record<string, null> = { [key]: null }) => chips.push({ key, label, clear });
  const value = (key: string) => params.get(key);
  if (value('q')) add('q', `«${value('q')}»`);
  if (value('make')) add('make', value('make')!, { make: null, model: null });
  if (value('model')) add('model', value('model')!);
  if (value('category')) add('category', CATEGORY_LABELS[value('category') as keyof typeof CATEGORY_LABELS] ?? value('category')!);
  if (value('condition')) add('condition', value('condition') === 'NEW' ? 'Nuevos' : 'Usados');
  if (value('priceMax')) add('priceMax', `Hasta ${money(Number(value('priceMax')))}`);
  if (value('priceMin')) add('priceMin', `Desde ${money(Number(value('priceMin')))}`);
  if (value('yearMin')) add('yearMin', `Desde ${value('yearMin')}`);
  if (value('yearMax')) add('yearMax', `Hasta ${value('yearMax')}`);
  if (value('mileageMax')) add('mileageMax', `Hasta ${Number(value('mileageMax')).toLocaleString('de-DE')} km`);
  if (value('gearbox')) add('gearbox', value('gearbox') === 'MANUAL' ? 'Solo manual' : 'Solo automática');
  if (value('fuel')) add('fuel', value('fuel') === 'ELECTRIC' ? 'Eléctricos' : (FUEL_LABELS[value('fuel') as keyof typeof FUEL_LABELS] ?? value('fuel')!));
  if (value('owners')) add('owners', value('owners') === '1' ? 'Único dueño' : value('owners') === '2' ? '2 dueños' : '3 o más dueños');
  if (value('country')) add('country', COUNTRIES.find(item => item.code === value('country'))?.name ?? value('country')!, { country: null, city: null });
  if (value('city')) add('city', value('city')!);
  if (value('verified') === 'true') add('verified', 'Solo verificados');
  if (value('nearby') === 'true') add('nearby', 'A menos de 100 km');
  return chips;
}

// ── Destacados: 1 por cada 4 autos, por turnos ──────────────────────────────

function useFeaturedTurns(items: VehicleCardDTO[]) {
  const [turn, setTurn] = useState(0);
  const candidates = useMemo(() => items.filter(vehicle => vehicle.isFeatured && vehicle.status === 'PUBLISHED'), [items]);
  const organic = items.length - candidates.length;
  const slots = candidates.length ? Math.min(candidates.length, Math.max(1, Math.ceil(organic / ORGANIC_PER_FEATURED))) : 0;
  const rotating = candidates.length > slots;

  useEffect(() => {
    if (!rotating || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setTurn(value => value + 1), TURN_MS);
    return () => window.clearInterval(timer);
  }, [rotating]);

  return useMemo(() => {
    const offset = candidates.length ? turn % candidates.length : 0;
    const rotated = [...candidates.slice(offset), ...candidates.slice(0, offset)];
    const inTurn = new Set(rotated.slice(0, slots).map(vehicle => vehicle.id));
    const queue = rotated.filter(vehicle => inTurn.has(vehicle.id));
    const rest = items.filter(vehicle => !inTurn.has(vehicle.id));
    const ordered: VehicleCardDTO[] = [];
    while (queue.length || rest.length) {
      const next = ordered.length % (ORGANIC_PER_FEATURED + 1) === 0 && queue.length ? queue.shift() : (rest.shift() ?? queue.shift());
      if (next) ordered.push(next);
    }
    return {
      candidates,
      inTurn,
      ordered,
      // Solo lleva la etiqueta quien ocupa un cupo en este turno.
      labelOf: (vehicle: VehicleCardDTO) => (inTurn.has(vehicle.id) ? 'Destacado' : null),
    };
  }, [candidates, items, rotating, slots, turn]);
}
