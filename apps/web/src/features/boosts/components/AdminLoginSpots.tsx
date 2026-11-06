'use client';

import { LOGIN_MAX_DAYS, type LoginSpotDTO, type LoginSpotState } from '@automarket/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ConfirmButton } from '@/features/reservations/components/ConfirmButton';
import { cn } from '@/shared/lib/cn';
import { api } from '@/shared/lib/http';
import { MediaImage } from '@/shared/ui/media-image';
import { PageSpinner } from '@/shared/ui/spinner';
import { useToast } from '@/shared/ui/toaster';
import { boostKeys, boostsApi } from '../api';
import { dayMonth, dayOf, fullDay, longDay, shortDay, usd, weekdayShort } from '../calendar';
import { CarSilhouette } from './CarSilhouette';

type Filter = 'ALL' | 'LIVE' | 'SCHEDULED' | 'PENDING' | 'EXPIRED';
const FILTERS: Array<[Filter, string]> = [
  ['ALL', 'Todos'],
  ['LIVE', 'En pantalla'],
  ['SCHEDULED', 'Programados'],
  ['PENDING', 'Pendientes'],
  ['EXPIRED', 'Vencidos'],
];
const PILL: Record<LoginSpotState, { label: string; className: string }> = {
  LIVE: { label: 'En pantalla', className: 'bg-success-soft text-success-fg' },
  SCHEDULED: { label: 'Programado', className: 'bg-reserved-soft text-reserved-fg' },
  PENDING: { label: 'Pago pendiente', className: 'bg-gold-soft text-gold-fg' },
  EXPIRED: { label: 'Vencido', className: 'bg-sunken text-muted' },
  CANCELLED: { label: 'Cancelado', className: 'bg-sunken text-muted' },
};
const COLS = 'grid grid-cols-[56px_minmax(200px,2fr)_minmax(120px,1fr)_120px_minmax(170px,1.4fr)_136px_minmax(132px,auto)] items-center gap-3 px-[18px] py-3';

const clock = new Intl.DateTimeFormat('es', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Caracas' });
/** «2 nov · 3:31 p. m.» (hora de Venezuela) */
const time = (iso: string) => `${dayMonth(dayOf(iso))} · ${clock.format(new Date(iso))}`;

/** Panel «Pantalla de entrada» (diseño «admin-login»): turnos por orden de llegada con datos reales. */
export function AdminLoginSpots() {
  const spots = useQuery({ queryKey: boostKeys.loginSpots, queryFn: boostsApi.loginSpots, refetchInterval: 30_000 });
  const boostSettings = useQuery({ queryKey: boostKeys.settings, queryFn: boostsApi.settings });
  const onSale = boostSettings.data?.loginOnSale ?? false;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [view, setView] = useState<'list' | 'days'>('list');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [confirmed, setConfirmed] = useState<string | null>(null);

  const review = useMutation({
    mutationFn: ({ spot, decision }: { spot: LoginSpotDTO; decision: 'APPROVE' | 'REJECT' }) =>
      api.post<void>(`/api/admin/payments/${spot.paymentId}/review`, { decision, note: decision === 'APPROVE' ? 'Confirmado desde Pantalla de entrada' : 'No encontramos el pago en Binance.' }),
    onSuccess: async (_data, { spot, decision }) => {
      const fresh = await queryClient.fetchQuery({ queryKey: boostKeys.loginSpots, queryFn: boostsApi.loginSpots, staleTime: 0 });
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
      if (decision === 'REJECT') return toast({ tone: 'info', title: 'Pago rechazado. Avisamos al vendedor.' });
      const item = fresh.items.find(row => row.boostId === spot.boostId);
      setConfirmed(spot.boostId);
      toast({
        tone: 'success',
        title: item?.turn && item.startDate && item.endDate ? `Pago confirmado. Turno #${item.turn}: sale ${longDay(item.startDate)}${item.endDate !== item.startDate ? ` hasta ${longDay(item.endDate)}` : ''}.` : 'Pago confirmado.',
      });
    },
    onError: (error: Error) => toast({ tone: 'error', title: 'No se pudo completar', description: error.message }),
  });

  if (spots.isPending) return <PageSpinner />;
  if (spots.isError) return <p className="text-danger-fg">{spots.error.message}</p>;
  const data = spots.data;
  const { today, slots } = data;
  const live = data.items.filter(item => item.state === 'LIVE');
  const endingToday = live.filter(item => item.endDate === today);
  const sold = data.days.reduce((total, day) => total + Math.min(day.used, slots), 0);
  const counts: Record<Filter, number> = {
    ALL: data.items.length,
    LIVE: live.length,
    SCHEDULED: data.items.filter(item => item.state === 'SCHEDULED').length,
    PENDING: data.items.filter(item => item.state === 'PENDING').length,
    EXPIRED: data.items.filter(item => item.state === 'EXPIRED').length,
  };
  const rows = filter === 'ALL' ? data.items : data.items.filter(item => item.state === filter);
  const free = Math.max(0, slots - (data.days[0]?.used ?? 0));

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-[1_1_320px]">
          <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-ink">Pantalla de entrada</h1>
          <p className="mt-0.5 text-sm text-muted">
            Turnos pagados para Entrar y Crear cuenta. {slots} cupos por día, máximo {LOGIN_MAX_DAYS} días por anuncio, por orden de llegada.
          </p>
        </div>
      </div>

      {boostSettings.data && !onSale && (
        <p role="status" className="rounded-[16px] border border-gold/40 bg-gold-soft px-4 py-3 text-sm leading-[1.45] text-ink">
          <strong>No está a la venta.</strong> Entrar y Crear cuenta ya no muestran autos, así que Destacar no la ofrece. Aquí quedan los turnos que ya se pagaron y sus cobros.{' '}
          <Link href="/admin/planes#destacar" className="font-bold text-brand-fg underline underline-offset-2">
            Volver a venderla
          </Link>
        </p>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
        <Kpi label="En pantalla hoy" value={`${Math.min(data.days[0]?.used ?? 0, slots)} de ${slots}`} sub={free === 0 ? 'Hoy está lleno' : free === 1 ? '1 cupo libre hoy' : `${free} cupos libres hoy`} subClass="text-brand-fg" />
        <Kpi label="Vencen hoy a las 11:59 p. m." value={String(endingToday.length)} sub={endingToday.length ? endingToday.map(item => item.vehicle.title).join(', ') : 'Ninguno'} />
        <Kpi label="Ocupación próximos 7 días" value={`${Math.round((sold / (slots * 7)) * 100)} %`} sub={`${sold} de ${slots * 7} cupos vendidos`} />
        <Kpi label="Cobrado" value={usd(data.collected)} sub={Number(data.pending) > 0 ? `${usd(data.pending)} esperando confirmación` : 'Todo confirmado'} subClass={Number(data.pending) > 0 ? 'text-gold-fg' : 'text-muted'} />
      </div>

      <section aria-labelledby="today-t" className="rounded-[22px] bg-night p-[18px] text-[#F2F3F5]">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="today-t" className="text-[17px] font-extrabold">
            Hoy en el login · {shortDay(today)}
          </h2>
          <p className="font-mono text-[12.5px] font-medium text-[#A2A7B0]">rotan cada 4 s en orden de llegada</p>
        </div>
        <ol className="mt-3.5 grid list-none grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5 p-0">
          {Array.from({ length: slots }, (_, index) => {
            const item = live[index];
            if (!item) {
              return (
                <li key={index} className="grid min-h-[120px] place-content-center rounded-2xl border border-dashed border-[#3B3F46] p-2.5 text-center text-[13px] text-[#A2A7B0]">
                  Cupo libre
                  <span className="block text-xs">se vende en Destacar</span>
                </li>
              );
            }
            return (
              <li key={item.boostId}>
                <Link href={`/vehiculos/${item.vehicle.slug}`} aria-label={`Ver anuncio: ${item.vehicle.title} ${item.vehicle.year}, turno ${item.turn}`} className="block overflow-hidden rounded-2xl border border-[#272A2F] bg-night-2">
                  <span className="relative block h-[72px] bg-[#1C1F23]">
                    {item.vehicle.coverUrl ? (
                      <MediaImage src={item.vehicle.coverUrl} alt="" fill sizes="200px" className="object-cover opacity-90" />
                    ) : (
                      <CarSilhouette category={item.vehicle.category} className="absolute top-[56%] left-1/2 w-[90%] -translate-x-1/2 -translate-y-1/2" />
                    )}
                    <span className="absolute top-2 left-2 inline-flex h-5 items-center rounded-full bg-[rgb(10_11_11/0.72)] px-[7px] font-mono text-[11px] font-medium text-mint">#{item.turn}</span>
                  </span>
                  <span className="block px-2.5 pt-2 pb-2.5">
                    <span className="block truncate text-[13px] font-bold">{item.vehicle.title}</span>
                    <span className={cn('mt-0.5 block text-xs', item.endDate === today ? 'text-[#F5C06B]' : 'text-[#A2A7B0]')}>{item.endDate === today ? 'Vence hoy, 11:59 p. m.' : `Hasta ${shortDay(item.endDate!)}`}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Vista" className="inline-flex rounded-full bg-sunken p-1">
          {(
            [
              ['list', 'Por orden de llegada'],
              ['days', 'Por día'],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)} className={cn('h-10 rounded-full px-[18px] text-sm font-bold', view === key ? 'bg-surface text-ink shadow-[0_1px_3px_rgb(17_19_18/0.12)]' : 'text-muted')}>
              {label}
            </button>
          ))}
        </div>
        {view === 'list' && (
          <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap gap-1.5">
            {FILTERS.map(([key, label]) => (
              <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className={cn('inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold', filter === key ? 'border-mine bg-mine text-on-mine' : 'border-edge bg-surface text-ink')}>
                {label} <span className="font-mono text-[11px] font-medium opacity-80">{counts[key]}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {view === 'list' ? (
        <section aria-label="Lista por orden de llegada" className="am-step-in overflow-x-auto rounded-[22px] border border-line bg-surface">
          <div role="table" aria-label="Turnos de la pantalla de entrada" className="min-w-[960px]">
            <div role="row" className={cn(COLS, 'border-b border-line font-mono text-[11.5px] font-medium tracking-[0.04em] text-muted uppercase')}>
              <span role="columnheader">Turno</span>
              <span role="columnheader">Anuncio</span>
              <span role="columnheader">Vendedor</span>
              <span role="columnheader">Pagado</span>
              <span role="columnheader">Sale y vence</span>
              <span role="columnheader">Estado</span>
              <span role="columnheader" className="sr-only">
                Acciones
              </span>
            </div>
            {rows.map(item => (
              <Row key={item.boostId} item={item} today={today} highlight={confirmed === item.boostId} busy={review.isPending && review.variables?.spot.boostId === item.boostId} onReview={decision => review.mutate({ spot: item, decision })} />
            ))}
            {rows.length === 0 && (
              <p className="px-[18px] py-7 text-sm text-muted">
                {data.items.length === 0 ? 'Aún no hay compras de la pantalla de entrada. ' : 'No hay anuncios con este estado. '}
                {filter !== 'ALL' && (
                  <button type="button" onClick={() => setFilter('ALL')} className="font-bold text-brand-fg underline">
                    Ver todos
                  </button>
                )}
              </p>
            )}
          </div>
        </section>
      ) : (
        <section aria-label="Qué sale cada día" className="am-step-in grid grid-cols-[repeat(7,minmax(140px,1fr))] gap-2.5 overflow-x-auto pb-1">
          {data.days.map((day, index) => (
            <DayCard key={day.date} date={day.date} isToday={index === 0} slots={slots} items={data.items.filter(item => (item.state === 'LIVE' || item.state === 'SCHEDULED') && item.startDate! <= day.date && item.endDate! >= day.date)} />
          ))}
        </section>
      )}

      <p className="flex flex-wrap items-center gap-x-6 gap-y-2.5 rounded-[20px] border border-line bg-surface px-[18px] py-4 text-sm text-ink">
        <b>Reglas</b>
        <span>
          1 día <b className="font-mono">{usd(data.prices[0])}</b> · 2 días <b className="font-mono">{usd(data.prices[1])}</b> · 3 días <b className="font-mono">{usd(data.prices[2])}</b>
        </span>
        <span>{slots} cupos por día</span>
        <span>Máximo {LOGIN_MAX_DAYS} días seguidos por anuncio</span>
        <span>Si el día está lleno, pasa al siguiente libre</span>
        <Link href="/admin/planes" className="ml-auto font-bold text-brand-fg underline underline-offset-[3px]">
          Cambiar en Planes y ajustes
        </Link>
      </p>
    </div>
  );
}

function Kpi({ label, value, sub, subClass = 'text-muted' }: { label: string; value: string; sub: string; subClass?: string }) {
  return (
    <div className="rounded-[20px] border border-line bg-surface px-[18px] py-4">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-1.5 text-[28px] leading-none font-extrabold tracking-[-0.02em] text-ink">{value}</p>
      <p className={cn('mt-0.5 truncate text-[13px]', subClass)}>{sub}</p>
    </div>
  );
}

function Row({ item, today, highlight, busy, onReview }: { item: LoginSpotDTO; today: string; highlight: boolean; busy: boolean; onReview: (decision: 'APPROVE' | 'REJECT') => void }) {
  const pill = PILL[item.state];
  const range = item.startDate && item.endDate ? (item.startDate === item.endDate ? shortDay(item.startDate) : `${shortDay(item.startDate)} → ${shortDay(item.endDate)}`) : item.wantDate ? `Pidió ${shortDay(item.wantDate)}` : '—';
  const sub =
    item.state === 'PENDING'
      ? 'Sin turno hasta confirmar el pago'
      : item.state === 'EXPIRED'
        ? `Venció ${shortDay(item.endDate!)}`
        : item.endDate === today
          ? 'Vence hoy · 11:59 p. m.'
          : `Vence ${shortDay(item.endDate!)} · 11:59 p. m.`;
  return (
    <div role="row" className={cn(COLS, 'border-b border-line transition-colors duration-300 last:border-b-0', highlight ? 'bg-soft' : 'bg-surface', item.state === 'EXPIRED' && 'opacity-65')}>
      <span role="cell" className="font-mono text-[15px] font-semibold text-ink">
        {item.turn ? `#${item.turn}` : '—'}
      </span>
      <span role="cell" className="flex min-w-0 items-center gap-3">
        <span className="relative block h-10 w-14 shrink-0 overflow-hidden rounded-[10px] bg-card-tile">
          {item.vehicle.coverUrl ? <MediaImage src={item.vehicle.coverUrl} alt="" fill sizes="56px" className="object-cover" /> : <CarSilhouette category={item.vehicle.category} className="absolute top-1/2 left-1/2 w-[90%] -translate-x-1/2 -translate-y-1/2" />}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[14.5px] font-bold text-ink">
            {item.vehicle.title} {item.vehicle.year}
          </span>
          <span className="block text-[12.5px] text-muted">
            {usd(item.vehicle.price)} · {item.vehicle.city}
          </span>
          {item.reference && <span className="block font-mono text-[11.5px] font-medium text-muted">{item.reference}</span>}
        </span>
      </span>
      <span role="cell" className="min-w-0">
        <span className="block truncate text-sm font-semibold text-ink">{item.seller.name}</span>
        <span className="block text-[12.5px] text-muted">{item.seller.dealer ? 'Concesionario' : 'Persona'}</span>
      </span>
      <span role="cell">
        <span className={cn('block text-[13px]', item.paidAt ? 'text-ink' : 'text-gold-fg')}>{item.paidAt ? time(item.paidAt) : item.paymentStatus === 'SUBMITTED' ? 'Comprobante enviado' : 'Esperando pago'}</span>
        <span className="block font-mono text-xs font-medium text-muted">
          {usd(item.amount)} · {item.days === 1 ? '1 día' : `${item.days} días`}
        </span>
      </span>
      <span role="cell">
        <span className="block text-[13.5px] font-bold text-ink">{range}</span>
        <span className={cn('block text-[12.5px]', item.endDate === today && item.state === 'LIVE' ? 'text-gold-fg' : 'text-muted')}>{sub}</span>
        {item.moved && item.wantDate && <span className="block text-xs text-gold-fg">Pidió {shortDay(item.wantDate)}, estaba lleno</span>}
      </span>
      <span role="cell">
        <span className={cn('inline-flex h-[26px] items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-bold whitespace-nowrap', pill.className)}>
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          {pill.label}
        </span>
      </span>
      <span role="cell" className="flex justify-end gap-1.5">
        {item.state === 'PENDING' && item.paymentStatus === 'SUBMITTED' ? (
          <>
            <button type="button" disabled={busy} onClick={() => onReview('APPROVE')} title={item.txId ? `Transacción ${item.txId}` : undefined} className="h-9 rounded-full bg-brand px-3 text-[13px] font-bold text-on-brand hover:bg-brand-600 disabled:opacity-60">
              Confirmar pago
            </button>
            <ConfirmButton size="sm" variant="ghost" disabled={busy} confirmLabel="¿Rechazar?" onConfirm={() => onReview('REJECT')}>
              Rechazar
            </ConfirmButton>
          </>
        ) : item.state === 'PENDING' ? (
          <span className="text-[12.5px] text-muted">Sin comprobante</span>
        ) : (
          <Link href={`/vehiculos/${item.vehicle.slug}`} aria-label={`Ver anuncio: ${item.vehicle.title} ${item.vehicle.year}`} className="inline-flex h-9 items-center rounded-full border border-edge px-3 text-[13px] font-bold text-ink hover:border-ink">
            Ver anuncio
          </Link>
        )}
      </span>
    </div>
  );
}

function DayCard({ date, isToday, slots, items }: { date: string; isToday: boolean; slots: number; items: LoginSpotDTO[] }) {
  const full = items.length >= slots;
  const segments = Math.min(slots, 12);
  return (
    <div className={cn('flex min-w-0 flex-col gap-2 rounded-[20px] border-[1.5px] bg-surface p-3', isToday ? 'border-ink' : full ? 'border-[#E5C27A]' : 'border-line')}>
      <div className="flex items-baseline justify-between">
        <p>
          <span className="block text-[12.5px] font-bold text-muted">{isToday ? 'hoy' : weekdayShort(date)}</span>
          <span className="text-xl font-extrabold text-ink">{dayMonth(date)}</span>
        </p>
        <span className={cn('font-mono text-xs font-semibold', full ? 'text-gold-fg' : 'text-muted')}>{full ? 'lleno' : `${items.length}/${slots}`}</span>
      </div>
      <span aria-hidden className="grid h-[5px] gap-0.5" style={{ gridTemplateColumns: `repeat(${segments}, minmax(0, 1fr))` }}>
        {Array.from({ length: segments }, (_, index) => (
          <span key={index} className={cn('rounded-[2px]', index < Math.round((Math.min(items.length, slots) / slots) * segments) ? 'bg-brand' : 'bg-edge')} />
        ))}
      </span>
      <ol aria-label={`Anuncios del ${fullDay(date)}`} className="grid list-none grid-cols-[minmax(0,1fr)] gap-1.5 p-0">
        {items.map(item => (
          <li key={item.boostId} className="rounded-xl border border-canvas bg-canvas p-2">
            <span className="flex items-baseline gap-1.5">
              <span className="font-mono text-[11px] font-semibold text-muted">#{item.turn}</span>
              <span className="truncate text-[12.5px] font-bold text-ink">{item.vehicle.title}</span>
            </span>
            <span className={cn('mt-0.5 block text-[11.5px]', item.endDate === date ? 'text-gold-fg' : 'text-muted')}>{item.endDate === date ? 'último día' : `hasta ${shortDay(item.endDate!)}`}</span>
          </li>
        ))}
        {Array.from({ length: Math.max(0, slots - items.length) }, (_, index) => (
          <li key={`free-${index}`} className="rounded-xl border border-dashed border-edge p-2 text-[12.5px] text-muted">
            Cupo libre
            <span className="block text-[11.5px]">a la venta</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

