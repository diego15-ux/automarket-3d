'use client';

import { CATEGORY_LABELS, FUEL_LABELS, VEHICLE_CATEGORIES, type VehicleCardDTO, type VehicleCategory } from '@automarket/contracts';
import { ArrowRight, BadgeCheck, ChevronLeft, ChevronRight, Cog, Fuel, Gauge, MapPin, Star, User, Zap } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { CATEGORY_PLURALS } from '@/features/landing/categories';
import { cn } from '@/shared/lib/cn';
import { formatKm, formatMoney } from '@/shared/lib/format';
import { MediaImage } from '@/shared/ui/media-image';

type Filter = 'ALL' | VehicleCategory;

const badge = 'inline-flex items-center gap-1 rounded-full px-2.5 py-[0.32rem] text-[11px] leading-none font-semibold';

/** Tarjeta del showroom, como la del index.html (sin favoritos ni 3D: no existen en la app). */
function ShowroomCard({ vehicle, eager }: { vehicle: VehicleCardDTO; eager: boolean }) {
  const href = `/vehiculos/${vehicle.slug}`;
  const electric = vehicle.fuelType === 'ELECTRIC';
  const gearbox = vehicle.transmission === 'MANUAL' ? 'Manual' : 'Automática';
  const place = [vehicle.city, vehicle.country].filter(Boolean).join(', ');

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-[1.25rem] border border-line bg-surface transition-[transform,border-color] duration-300 ease-out hover:-translate-y-1 hover:border-edge has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-[3px] has-[a:focus-visible]:outline-ink">
      <div className="relative aspect-[16/10] overflow-hidden bg-sunken">
        {vehicle.coverUrl ? (
          <MediaImage
            src={vehicle.coverUrl}
            alt=""
            fill
            draggable={false}
            loading={eager ? 'eager' : 'lazy'}
            sizes="(min-width: 1280px) 300px, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 85vw"
            className="object-cover transition-transform duration-700 ease-out select-none group-hover:scale-105"
          />
        ) : (
          <span className="grid h-full place-items-center text-sm text-muted">Sin foto</span>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 to-black/25" />
        <div className="absolute top-3 left-3 flex max-w-[80%] flex-wrap gap-1.5">
          {vehicle.sellerVerified && (
            <span className={cn(badge, 'bg-brand text-on-brand')}>
              <BadgeCheck className="size-[13px]" />
              Verificado
            </span>
          )}
          {vehicle.ownersCount === 1 && (
            <span className={cn(badge, 'bg-black/65 text-white ring-1 ring-white/15 ring-inset')}>
              <User className="size-[13px] text-[#e2c58f]" />
              Único dueño
            </span>
          )}
          {vehicle.isFeatured && (
            <span className={cn(badge, 'bg-[#efe3c8] text-[#4a360c]')}>
              <Star className="size-[13px] fill-current" />
              Destacado
            </span>
          )}
          {vehicle.status === 'RESERVED' && <span className={cn(badge, 'bg-white text-[#15171a]')}>{vehicle.inNegotiation ? 'En negociación' : 'Reservado'}</span>}
        </div>
        <span className="absolute bottom-3 left-3 rounded-md bg-black/55 px-2 py-1 text-[11px] font-semibold tracking-wider text-white uppercase">{CATEGORY_LABELS[vehicle.category]}</span>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold tracking-wider text-muted uppercase">{vehicle.make}</span>
          <span className="rounded-md bg-ink/5 px-2 py-0.5 font-semibold text-muted figures">{vehicle.year}</span>
        </div>
        <h3 className="mt-1.5 font-display text-lg leading-snug font-bold">
          <Link href={href} draggable={false} className="after:absolute after:inset-0 after:z-[1] focus-visible:outline-none">
            {vehicle.model}
            {vehicle.version ? ` ${vehicle.version}` : ''}
          </Link>
        </h3>
        <ul className="mt-4 flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs whitespace-nowrap text-muted">
          <li className="flex items-center gap-1.5" title="Kilometraje">
            <Gauge className="size-4 shrink-0" strokeWidth={1.8} />
            {formatKm(vehicle.mileageKm)}
          </li>
          <li className="flex items-center gap-1.5" title="Combustible">
            {electric ? <Zap className="size-4 shrink-0" strokeWidth={1.8} /> : <Fuel className="size-4 shrink-0" strokeWidth={1.8} />}
            {FUEL_LABELS[vehicle.fuelType]}
          </li>
          <li className="flex items-center gap-1.5" title="Transmisión">
            <Cog className="size-4 shrink-0" strokeWidth={1.8} />
            {gearbox}
          </li>
        </ul>
        <p className="mt-3 mb-4 flex min-w-0 items-center gap-1.5 text-xs text-muted">
          <MapPin className="size-4 shrink-0" strokeWidth={1.8} />
          <span className="truncate">
            {place}
            {vehicle.sellerDealerName ? ` · ${vehicle.sellerDealerName}` : ' · Particular'}
          </span>
        </p>
        <div className="mt-auto flex items-end justify-between gap-3 border-t border-line pt-4">
          <div>
            <p className="text-[11px] font-medium tracking-wider text-muted uppercase">Precio · {vehicle.currency}</p>
            <p className="font-display text-xl font-extrabold tracking-tight figures">{formatMoney(vehicle.price, vehicle.currency)}</p>
          </div>
          <span aria-hidden className="inline-flex h-8 items-center gap-1.5 rounded-full border border-edge px-3.5 text-xs font-semibold transition-colors group-hover:border-ink">
            Ver detalles <ArrowRight className="size-3.5" />
          </span>
        </div>
      </div>
    </article>
  );
}

/**
 * Showroom de la portada: filtros por categoría con su conteo real, carrusel que se arrastra,
 * flechas a los lados y barra de avance, como el index.html.
 */
export function Showroom({ vehicles }: { vehicles: VehicleCardDTO[] }) {
  const [filter, setFilter] = useState<Filter>('ALL');
  const track = useRef<HTMLUListElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const [view, setView] = useState({ start: true, end: true, ratio: 1, progress: 0 });

  const counts = useMemo(() => {
    const map = new Map<VehicleCategory, number>();
    for (const vehicle of vehicles) map.set(vehicle.category, (map.get(vehicle.category) ?? 0) + 1);
    return map;
  }, [vehicles]);
  const chips: Array<{ key: Filter; label: string; count: number }> = [
    { key: 'ALL', label: 'Todos', count: vehicles.length },
    ...VEHICLE_CATEGORIES.filter(category => counts.has(category)).map(category => ({ key: category as Filter, label: CATEGORY_PLURALS[category], count: counts.get(category)! })),
  ];
  const shown = filter === 'ALL' ? vehicles : vehicles.filter(vehicle => vehicle.category === filter);

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setView({ start: el.scrollLeft <= 4, end: el.scrollLeft >= max - 4, ratio: el.scrollWidth ? el.clientWidth / el.scrollWidth : 1, progress: max > 0 ? el.scrollLeft / max : 0 });
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    el.scrollLeft = 0;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [filter, measure]);

  const step = (direction: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: smooth ? 'smooth' : 'auto' });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    step(event.key === 'ArrowRight' ? 1 : -1);
  };

  // Arrastre con el ratón (en el teléfono ya se desliza con el dedo).
  const onPointerDown = (event: PointerEvent<HTMLUListElement>) => {
    if (event.pointerType !== 'mouse' || !track.current) return;
    drag.current = { x: event.clientX, left: track.current.scrollLeft, moved: false };
  };
  const onPointerMove = (event: PointerEvent<HTMLUListElement>) => {
    const el = track.current;
    const state = drag.current;
    if (!el || !state) return;
    const delta = event.clientX - state.x;
    if (!state.moved && Math.abs(delta) > 6) {
      state.moved = true;
      el.setPointerCapture(event.pointerId);
      el.style.scrollSnapType = 'none';
    }
    if (state.moved) el.scrollLeft = state.left - delta;
  };
  const endDrag = () => {
    const el = track.current;
    if (el) el.style.scrollSnapType = '';
    window.setTimeout(() => (drag.current = null), 0);
  };
  const onClickCapture = (event: MouseEvent<HTMLUListElement>) => {
    if (drag.current?.moved) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const arrow =
    'absolute top-[34%] z-[5] grid size-11 place-items-center rounded-full border border-line bg-surface text-ink shadow-[0_14px_30px_-12px_rgb(0_0_0/0.55)] transition-[opacity,background-color,border-color,color] duration-200 hover:border-brand hover:bg-brand hover:text-on-brand disabled:pointer-events-none disabled:opacity-0 lg:size-13';

  return (
    <>
      <div role="group" aria-label="Filtrar por categoría" className="scrollbar-none -mx-4 mt-10 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {chips.map(chip => {
          const on = filter === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(chip.key)}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-[0.55rem] text-sm font-medium whitespace-nowrap transition-colors',
                on ? 'border-brand bg-brand text-on-brand' : 'border-line bg-surface text-muted hover:border-edge hover:text-ink',
              )}
            >
              {chip.label}
              <span className={cn('min-w-[1.4rem] rounded-full px-1.5 py-px text-center text-[0.7rem] font-semibold figures', on ? 'bg-white/20' : 'bg-ink/[0.08]')}>{chip.count}</span>
            </button>
          );
        })}
      </div>

      <div role="region" aria-roledescription="carrusel" aria-label="Vehículos seleccionados" className="relative mt-8">
        <button type="button" onClick={() => step(-1)} disabled={view.start} aria-label="Ver vehículos anteriores" title="Anteriores" className={cn(arrow, 'left-1 lg:-left-[1.6rem]')}>
          <ChevronLeft className="size-5" />
        </button>
        <ul
          ref={track}
          tabIndex={0}
          aria-label="Lista de vehículos. Usa las flechas del teclado para desplazarte."
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClickCapture={onClickCapture}
          data-fade-left={view.start ? undefined : ''}
          data-fade-right={view.end ? undefined : ''}
          className="am-showroom-track scrollbar-none relative -mx-1 -mt-3 flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain px-1 pt-3 pb-8 focus-visible:rounded-3xl sm:gap-5"
        >
          {shown.map((vehicle, index) => (
            <li key={vehicle.id} className="shrink-0 basis-[85%] snap-start sm:basis-[calc((100%-1.25rem)/2)] lg:basis-[calc((100%-2.5rem)/3)] xl:basis-[calc((100%-3.75rem)/4)]">
              <ShowroomCard vehicle={vehicle} eager={index < 4} />
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => step(1)} disabled={view.end} aria-label="Ver más vehículos" title="Siguientes" className={cn(arrow, 'right-1 lg:-right-[1.6rem]')}>
          <ChevronRight className="size-5" />
        </button>

        {view.ratio < 1 && (
          <div aria-hidden className="mx-auto mt-2 h-1 max-w-xs overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-brand-fg" style={{ width: `${Math.max(12, view.ratio * 100)}%`, marginLeft: `${view.progress * (100 - Math.max(12, view.ratio * 100))}%` }} />
          </div>
        )}
      </div>
    </>
  );
}
