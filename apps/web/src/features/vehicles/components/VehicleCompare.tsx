'use client';

import { DRIVETRAIN_LABELS, FUEL_LABELS, TRANSMISSION_LABELS, type VehicleDetailDTO } from '@automarket/contracts';
import { useQueries } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { formatMoney } from '@/shared/lib/format';
import { MediaImage } from '@/shared/ui/media-image';
import { vehicleKeys, vehiclesApi } from '../api';
import { MAX_COMPARE, pickOf, useCompare } from '../compare';
import { Switch } from './VehicleSearch';

type Better = 'low' | 'high' | null;
interface Row {
  label: string;
  value: (v: VehicleDetailDTO) => string;
  /** Valor numérico para «Mejor» (null = no compite). */
  score?: (v: VehicleDetailDTO) => number | null;
  better?: Better;
}

const km = (value: number) => `${value.toLocaleString('de-DE')} km`;
const yesNo = (value: boolean) => (value ? 'Sí' : 'No');

/** Filas del comparador con datos que la app sí guarda (sin inventar consumo ni motor). */
const ROWS: Row[] = [
  { label: 'Precio', value: v => formatMoney(v.price, v.currency), score: v => Number(v.price), better: 'low' },
  { label: 'Año', value: v => String(v.year), score: v => v.year, better: 'high' },
  { label: 'Kilómetros', value: v => km(v.mileageKm), score: v => v.mileageKm, better: 'low' },
  { label: 'Transmisión', value: v => TRANSMISSION_LABELS[v.transmission] },
  { label: 'Combustible', value: v => FUEL_LABELS[v.fuelType] },
  { label: 'Dueños anteriores', value: v => (v.condition === 'NEW' ? 'Nuevo' : String(v.ownersCount >= 3 ? '3 o más' : v.ownersCount)) },
  { label: 'Potencia', value: v => (v.horsepower ? `${v.horsepower} hp` : '—'), score: v => v.horsepower, better: 'high' },
  { label: 'Tracción', value: v => (v.drivetrain ? DRIVETRAIN_LABELS[v.drivetrain] : '—') },
  { label: 'Puertas', value: v => (v.doors ? String(v.doors) : '—') },
  { label: 'Ciudad', value: v => v.city },
  { label: 'Vendedor verificado', value: v => yesNo(v.seller.isVerified) },
  { label: 'Abono de reserva', value: v => (v.reservationAmount ? formatMoney(v.reservationAmount, v.currency) : '—') },
];

/** Comparador (diseño «Comparar autos»): hasta 3 autos lado a lado con «Mejor» y «Solo lo que cambia». */
export function VehicleCompare() {
  const params = useSearchParams();
  const compare = useCompare();
  const [onlyDiff, setOnlyDiff] = useState(false);
  // Un enlace compartido (?autos=slug1,slug2) reemplaza la selección guardada en este navegador.
  const shared = useMemo(() => (params.get('autos') ?? '').split(',').map(slug => slug.trim()).filter(Boolean).slice(0, MAX_COMPARE), [params]);
  const slugs = shared.length ? shared : compare.picks.map(pick => pick.slug);
  const queries = useQueries({ queries: slugs.map(slug => ({ queryKey: vehicleKeys.detail(slug), queryFn: () => vehiclesApi.bySlug(slug), retry: 1 })) });
  const vehicles = queries.flatMap(query => (query.data ? [query.data] : []));
  const loading = queries.some(query => query.isPending);
  const missing = queries.filter(query => query.isError).length;

  useEffect(() => {
    if (!shared.length || loading) return;
    const same = shared.join(',') === compare.picks.map(pick => pick.slug).join(',');
    if (!same && vehicles.length) {
      compare.clear();
      vehicles.forEach(vehicle => compare.toggle(pickOf({ ...vehicle, coverUrl: vehicle.coverUrl })));
    }
    // Solo sincroniza cuando llegan los autos del enlace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const remove = (vehicle: VehicleDetailDTO) => {
    compare.remove(vehicle.id);
    if (shared.length) window.history.replaceState(null, '', `/comparar?autos=${slugs.filter(slug => slug !== vehicle.slug).join(',')}`);
  };

  const rows = ROWS.filter(row => !onlyDiff || (vehicles.length > 1 && new Set(vehicles.map(row.value)).size > 1));
  const columns = vehicles.length + (vehicles.length < MAX_COMPARE ? 1 : 0);
  const grid = { gridTemplateColumns: `200px repeat(${columns}, minmax(0, 1fr))` };
  const bestOf = (row: Row): string | null => {
    if (!row.score || !row.better || vehicles.length < 2) return null;
    const scored = vehicles.map(vehicle => ({ id: vehicle.id, score: row.score!(vehicle) })).filter((item): item is { id: string; score: number } => item.score !== null);
    if (scored.length < 2) return null;
    const best = row.better === 'low' ? Math.min(...scored.map(item => item.score)) : Math.max(...scored.map(item => item.score));
    const winners = scored.filter(item => item.score === best);
    return winners.length === 1 ? winners[0]!.id : null;
  };

  return (
    <div data-own-header>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="Ruta" className="text-[13px] text-muted">
            <Link href="/vehiculos" className="hover:text-ink hover:underline">
              Catálogo
            </Link>{' '}
            / Comparar
          </nav>
          <h1 className="mt-1 text-[30px] font-extrabold tracking-[-0.03em]">Comparar autos</h1>
        </div>
        <div className={cn('inline-flex h-11 items-center rounded-full border border-edge/70 bg-surface pr-2 pl-4', vehicles.length < 2 && 'opacity-60')}>
          <Switch label="Solo lo que cambia" on={onlyDiff && vehicles.length > 1} onToggle={on => vehicles.length > 1 && setOnlyDiff(on)} />
        </div>
      </div>

      {!loading && vehicles.length === 0 ? (
        <div className="mt-5 rounded-[20px] border border-dashed border-edge bg-surface px-6 py-12 text-center">
          <p className="text-[17px] font-extrabold">Aún no elegiste autos para comparar</p>
          <p className="mt-1.5 mb-4 text-sm text-muted">En el catálogo marca «Comparar» en hasta {MAX_COMPARE} autos.</p>
          <Link href="/vehiculos" className="inline-flex h-11 items-center rounded-full bg-ink px-5 text-sm font-bold text-surface">
            Ir al catálogo
          </Link>
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-[24px] border border-line bg-surface">
          <div className="min-w-[860px]">
            <div className="grid border-b border-line" style={grid}>
              <div className="sticky left-0 flex flex-col justify-end bg-surface p-5 text-sm text-muted">
                {loading ? 'Cargando…' : `${vehicles.length} ${vehicles.length === 1 ? 'auto' : 'autos'} · ${rows.length} datos`}
              </div>
              {vehicles.map(vehicle => {
                const name = `${vehicle.make} ${vehicle.model}${vehicle.version ? ` ${vehicle.version}` : ''}`;
                const available = vehicle.status === 'PUBLISHED';
                return (
                  <div key={vehicle.id} className="relative border-l border-line/70 p-4">
                    <button type="button" onClick={() => remove(vehicle)} aria-label={`Quitar ${name} de la comparación`} className="absolute top-[22px] right-[22px] z-[1] grid size-9 place-items-center rounded-full bg-white text-[#15171a] shadow-[0_2px_6px_rgb(0_0_0/0.15)]">
                      <X className="size-3.5" strokeWidth={2.6} aria-hidden />
                    </button>
                    <div className="relative aspect-[16/10] overflow-hidden rounded-[16px] bg-card-tile">
                      {vehicle.coverUrl ? <MediaImage src={vehicle.coverUrl} alt="" fill sizes="320px" className={cn('object-cover', vehicle.status === 'SOLD' && 'opacity-55 grayscale')} /> : <span className="grid h-full place-items-center text-[13px] text-muted">Sin foto</span>}
                      {!available && (
                        <span className="absolute bottom-2.5 left-2.5 inline-flex h-[26px] items-center rounded-full bg-[#FFF4DB] px-2.5 text-xs font-bold text-[#8A5A00]">{vehicle.status === 'RESERVED' ? (vehicle.inNegotiation ? 'En negociación' : 'Reservado') : vehicle.status === 'SOLD' ? 'Vendido' : 'No disponible'}</span>
                      )}
                    </div>
                    <p className="mt-3 text-base font-extrabold">{name}</p>
                    <p className="mt-0.5 text-[22px] font-extrabold tracking-[-0.02em]">{formatMoney(vehicle.price, vehicle.currency)}</p>
                    <div className="mt-3 flex gap-1.5">
                      <Link href={`/vehiculos/${vehicle.slug}`} className="inline-flex h-11 flex-1 items-center justify-center rounded-full border border-ink text-[13.5px] font-bold">
                        Ver ficha
                      </Link>
                      {available ? (
                        <Link href={`/vehiculos/${vehicle.slug}#reservar`} className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-brand text-[13.5px] font-bold text-on-brand">
                          Reservar
                        </Link>
                      ) : (
                        <span className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-sunken text-[13.5px] font-bold text-muted">No disponible</span>
                      )}
                    </div>
                  </div>
                );
              })}
              {vehicles.length < MAX_COMPARE && (
                <div className="border-l border-line/70 p-4">
                  <Link href="/vehiculos" className="flex h-full min-h-[260px] flex-col items-center justify-center gap-2.5 rounded-[16px] border-2 border-dashed border-edge text-sm font-bold text-ink/80 hover:border-ink">
                    <span className="grid size-11 place-items-center rounded-full bg-canvas">
                      <Plus className="size-[18px]" strokeWidth={2.4} aria-hidden />
                    </span>
                    Agregar otro auto
                  </Link>
                </div>
              )}
            </div>
            {rows.map((row, index) => {
              const best = bestOf(row);
              return (
                <div key={row.label} className={cn('grid border-b border-line/70 last:border-b-0', index % 2 ? 'bg-[#fafbfc] dark:bg-white/[0.02]' : 'bg-surface')} style={grid}>
                  <div className={cn('sticky left-0 px-5 py-3.5 text-sm text-muted', index % 2 ? 'bg-[#fafbfc] dark:bg-[#171918]' : 'bg-surface')}>{row.label}</div>
                  {vehicles.map(vehicle => (
                    <div key={vehicle.id} className={cn('flex items-center gap-2 border-l border-line/70 px-4 py-3.5 text-[14.5px]', best === vehicle.id ? 'font-extrabold' : 'font-semibold')}>
                      {row.value(vehicle)}
                      {best === vehicle.id && <span className="inline-flex h-[22px] items-center rounded-full bg-success-soft px-2 text-[11.5px] font-extrabold text-success-fg">Mejor</span>}
                    </div>
                  ))}
                  {vehicles.length < MAX_COMPARE && <div className="border-l border-line/70" />}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <p className="mt-3.5 text-[13px] text-muted">
        Puedes comparar hasta {MAX_COMPARE} autos. «Mejor» marca el precio más bajo, el año más nuevo, menos kilómetros y más potencia.
        {missing > 0 && ` ${missing === 1 ? 'Un auto ya no está disponible' : `${missing} autos ya no están disponibles`} y no se muestra.`}
      </p>
    </div>
  );
}
