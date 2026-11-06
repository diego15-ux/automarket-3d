'use client';

import { usdText } from '@automarket/contracts';
import type { DealerDashboardDTO, DealerInventoryItemDTO, DealerTipDTO } from '@automarket/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { vehiclesApi } from '@/features/vehicles/api';
import { ago } from '@/features/admin/components/panel-kit';
import { ResultThumb } from '@/features/vehicles/smart-search';
import { ApiError } from '@/shared/lib/http';
import { cn } from '@/shared/lib/cn';
import { initials } from '@/shared/lib/format';
import { PageSpinner } from '@/shared/ui/spinner';
import { ThemeToggle } from '@/shared/ui/theme-toggle';
import { useToast } from '@/shared/ui/toaster';
import { dealerKeys, dealersApi } from '../api';

/**
 * Panel del concesionario (diseños «concesionario-pc» y «concesionario-movil») con datos reales:
 * vistas contadas por día, contactos del chat, reservas, inventario con su precio contra autos
 * parecidos y sugerencias con reglas. «Destacar» usa los destacados que incluye el plan.
 */
const usd = (value: number) => usdText(value);
const int = (value: number) => value.toLocaleString('es-VE');
const CARD = 'rounded-[20px] border border-line bg-surface';
const STATUS: Record<DealerInventoryItemDTO['status'], [string, string]> = {
  ACTIVE: ['Activo', 'bg-success-soft text-success-fg'],
  RESERVED: ['Reservado', 'bg-gold-soft text-gold-fg'],
  PAUSED: ['Pausado', 'bg-[#F1F2F4] text-muted dark:bg-white/8'],
};
const PRICE: Record<'GOOD' | 'FAIR' | 'HIGH', [string, string]> = {
  GOOD: ['Buen precio', 'bg-success-soft text-success-fg'],
  FAIR: ['Precio justo', 'bg-[#F1F2F4] text-[#3E444D] dark:bg-white/8 dark:text-ink/80'],
  HIGH: ['Algo alto', 'bg-gold-soft text-gold-fg'],
};
type Tab = 'ALL' | 'ACTIVE' | 'RESERVED' | 'PAUSED' | 'STALE';
const change = (now: number, before: number) => (before > 0 ? `${now >= before ? '+' : '−'}${Math.abs(Math.round((now / before - 1) * 100))} %` : null);
const dayLabel = (day: string) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`)).replace('.', '');
const todayLong = () => {
  const text = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Caracas' }).format(new Date()).replace(',', '');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export function DealerDashboard() {
  const dashboard = useQuery({ queryKey: dealerKeys.dashboard, queryFn: dealersApi.dashboard, retry: false });
  if (dashboard.isPending) return <PageSpinner />;
  if (dashboard.isError) {
    const dealerOnly = dashboard.error instanceof ApiError && dashboard.error.code === 'DEALER_ONLY';
    return (
      <div className="m-6 grid max-w-xl gap-3 rounded-[22px] border border-line bg-surface p-6">
        <h1 className="text-xl font-extrabold text-ink">{dealerOnly ? 'Este panel es para concesionarios' : 'No pudimos cargar tu panel'}</h1>
        <p className="text-sm text-muted">{dealerOnly ? 'Tus anuncios y reservas están en tu cuenta. Si tienes una agencia, crea una cuenta de concesionario con tu RIF.' : dashboard.error.message}</p>
        <Link href={dealerOnly ? '/cuenta/anuncios' : '/concesionario'} className="h-11 justify-self-start rounded-full bg-mine px-5 text-sm leading-[44px] font-bold text-on-mine">
          {dealerOnly ? 'Ir a mis anuncios' : 'Reintentar'}
        </Link>
      </div>
    );
  }
  return <Dashboard data={dashboard.data} />;
}

function useActions() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: dealerKeys.dashboard });
  const feature = useMutation({
    mutationFn: (id: string) => vehiclesApi.feature(id),
    onSuccess: () => {
      toast({ tone: 'success', title: 'Auto destacado', description: 'Sale primero en el catálogo y en el carrusel.' });
      refresh();
    },
    onError: err => toast({ tone: 'error', title: 'No se pudo destacar', description: err.message }),
  });
  const price = useMutation({
    mutationFn: ({ id, value }: { id: string; value: number }) => vehiclesApi.update(id, { price: value }),
    onSuccess: () => {
      toast({ tone: 'success', title: 'Precio actualizado' });
      refresh();
    },
    onError: err => toast({ tone: 'error', title: 'No se pudo cambiar el precio', description: err.message }),
  });
  return { feature, price };
}

function Dashboard({ data }: { data: DealerDashboardDTO }) {
  const [tab, setTab] = useState<Tab>('ALL');
  const [done, setDone] = useState<Record<string, boolean>>({});
  const { feature, price } = useActions();
  const canFeature = data.plan.featuredSlots - data.plan.featuredInUse > 0 && !data.plan.creditUsedThisMonth;
  const stale = data.inventory.filter(item => item.status === 'ACTIVE' && item.days > 45);
  const runTip = (tip: DealerTipDTO) => {
    setDone(current => ({ ...current, [tip.kind]: true }));
    if (tip.kind === 'STALE') {
      setTab('STALE');
      document.getElementById('inventario')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (tip.kind === 'PRICE') price.mutate({ id: tip.vehicleId, value: tip.suggestedPrice });
    if (tip.kind === 'FEATURE') feature.mutate(tip.vehicleId);
  };
  const tipButton = (tip: DealerTipDTO) =>
    tip.kind === 'STALE' ? 'Ver esos autos' : tip.kind === 'PRICE' ? (done.PRICE ? 'Precio ajustado ✓' : `Ajustar a ${usd(tip.suggestedPrice)}`) : done.FEATURE ? `${tip.title} destacado ✓` : `Destacar el ${tip.title}`;
  const shared = { data, tab, setTab, canFeature, stale, feature, runTip, tipButton, done };
  return (
    <>
      <div className="hidden lg:block">
        <DesktopPanel {...shared} />
      </div>
      <div className="lg:hidden">
        <PhonePanel {...shared} />
      </div>
    </>
  );
}

type Shared = {
  data: DealerDashboardDTO;
  tab: Tab;
  setTab: (tab: Tab) => void;
  canFeature: boolean;
  stale: DealerInventoryItemDTO[];
  feature: ReturnType<typeof useActions>['feature'];
  runTip: (tip: DealerTipDTO) => void;
  tipButton: (tip: DealerTipDTO) => string;
  done: Record<string, boolean>;
};

function viewsNote(data: DealerDashboardDTO) {
  if (!data.viewsSince) return 'Las vistas se cuentan desde hoy: una por persona y día.';
  return data.viewsSince > data.series[0]!.day ? `Vistas contadas desde el ${dayLabel(data.viewsSince)}.` : null;
}

function DesktopPanel({ data, tab, setTab, canFeature, stale, feature, runTip, tipButton, done }: Shared) {
  const { kpis } = data;
  const counts = {
    ALL: data.inventory.length,
    ACTIVE: data.inventory.filter(i => i.status === 'ACTIVE').length,
    RESERVED: data.inventory.filter(i => i.status === 'RESERVED').length,
    PAUSED: data.inventory.filter(i => i.status === 'PAUSED').length,
    STALE: stale.length,
  };
  const rows = tab === 'ALL' ? data.inventory : tab === 'STALE' ? stale : data.inventory.filter(item => item.status === tab);
  const firstActive = data.inventory.find(item => item.status === 'ACTIVE' && item.featuredDaysLeft === null);
  const note = viewsNote(data);
  return (
    <main className="flex flex-col gap-5 px-[clamp(16px,2.4vw,32px)] pt-[26px] pb-10">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-[1_1_260px]">
          <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-ink">Hola, {data.dealer.name.replace(/ C\.?A\.?$/, '')}</h1>
          <p className="mt-0.5 text-sm text-muted">
            {todayLong()}
            {data.dealer.city ? ` · ${data.dealer.city}` : ''}
          </p>
        </div>
        <Link href={`/vendedores/${data.dealer.id}`} className="inline-flex h-11 items-center rounded-full border border-ink px-[18px] text-sm font-bold text-ink">
          Ver mi página
        </Link>
        <Link href="/cuenta/anuncios/nuevo" className="inline-flex h-11 items-center gap-2 rounded-full bg-brand px-[18px] text-sm font-extrabold text-white hover:bg-brand-600">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Publicar auto
        </Link>
      </div>

      <section aria-label="Indicadores" className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        <Kpi dark label="Vistas · 7 días" value={int(kpis.views7)} chip={change(kpis.views7, kpis.viewsPrev7)} />
        <Kpi label="Contactos · 7 días" value={int(kpis.contacts7)} chip={change(kpis.contacts7, kpis.contactsPrev7)} />
        <Kpi label="Reservas activas" value={int(kpis.activeReservations)} chip="Hoy" />
        <Kpi label="Autos activos" value={int(kpis.activeListings)} chip={kpis.maxListings === null ? 'Sin límite' : `de ${kpis.maxListings}`} />
      </section>

      <div className="flex flex-wrap gap-5">
        <ViewsChart data={data} note={note} />
        <section className="min-w-0 flex-[1_1_300px] rounded-[20px] bg-[#15171a] p-5 text-[#F2F3F5] dark:ring-1 dark:ring-white/10">
          <h2 className="flex items-center gap-2.5 text-[17px] font-extrabold">
            <span aria-hidden="true" className="grid size-[30px] place-items-center rounded-full bg-brand text-on-brand">
              <SteeringIcon size={17} />
            </span>
            El Copiloto te sugiere
          </h2>
          {data.tips.length === 0 ? (
            <p className="mt-3.5 rounded-2xl bg-[#1D2024] px-3.5 py-3 text-sm leading-[1.45]">Todo en orden por ahora.</p>
          ) : (
            <ul className="mt-3.5 flex flex-col gap-2.5">
              {data.tips.map(tip => (
                <li key={tip.kind} className={cn('rounded-2xl bg-[#1D2024] px-3.5 py-3 transition-opacity duration-300', done[tip.kind] && 'opacity-60')}>
                  <p className="text-sm leading-[1.45]">{tip.text}</p>
                  <button
                    type="button"
                    disabled={done[tip.kind] && tip.kind !== 'STALE'}
                    onClick={() => runTip(tip)}
                    className={cn('mt-2 h-9 rounded-full px-3 text-[13px] font-extrabold', done[tip.kind] ? 'bg-[#272A2F] text-[#C7CBD1]' : 'bg-brand text-on-brand')}
                  >
                    {tipButton(tip)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Link href="/concesionario/copiloto" className="mt-3.5 inline-flex h-9 items-center rounded-full border border-[#3b3f46] px-3.5 text-[13px] font-bold text-[#F2F3F5] hover:border-[#F2F3F5]">
            Preguntarle al Copiloto
          </Link>
        </section>
      </div>

      <section id="inventario" aria-labelledby="inv-title" className={cn(CARD, 'scroll-mt-4 overflow-hidden')}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-[18px]">
          <h2 id="inv-title" className="text-[17px] font-extrabold text-ink">
            Inventario
          </h2>
          <div role="group" aria-label="Filtrar inventario" className="inline-flex flex-wrap rounded-full bg-[#E7E9ED] p-1 dark:bg-sunken">
            {(
              [
                ['ALL', 'Todos'],
                ['ACTIVE', 'Activos'],
                ['RESERVED', 'Reservados'],
                ['PAUSED', 'Pausados'],
                ...(stale.length ? ([['STALE', 'Más de 45 días']] as const) : []),
              ] as Array<[Tab, string]>
            ).map(([key, label]) => (
              <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)} className={cn('h-9 rounded-full px-3.5 text-[13px] font-bold', tab === key ? 'bg-surface text-ink shadow-[0_1px_3px_rgb(17_19_18/0.12)]' : 'text-muted')}>
                {label} · {counts[key]}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            <div className="grid grid-cols-[minmax(0,2.4fr)_1.3fr_0.9fr_0.7fr_0.8fr_0.6fr_1.2fr] gap-3 border-y border-[#ECEEF1] px-5 py-2.5 font-mono text-[11px] text-[#666C77] dark:border-line dark:text-muted">
              <span>Auto</span>
              <span>Precio · Copiloto</span>
              <span>Estado</span>
              <span>Vistas</span>
              <span>Contactos</span>
              <span>Días</span>
              <span />
            </div>
            {rows.length === 0 ? (
              <p className="px-5 py-8 text-sm text-muted">{data.inventory.length === 0 ? 'Todavía no tienes autos publicados.' : 'No hay autos en esta pestaña.'}</p>
            ) : (
              rows.map((item, i) => (
                <div key={item.id} className={cn('am-in grid grid-cols-[minmax(0,2.4fr)_1.3fr_0.9fr_0.7fr_0.8fr_0.6fr_1.2fr] items-center gap-3 border-b border-[#ECEEF1] px-5 py-2.5 transition-colors duration-[400ms] last:border-b-0 dark:border-line', item.featuredDaysLeft !== null ? 'bg-[#F3FAF6] dark:bg-soft' : 'bg-surface')}>
                  <Link href={`/vehiculos/${item.slug}`} className="flex min-w-0 items-center gap-2.5">
                    <ResultThumb vehicle={{ ...cardLike(item) }} index={i} className="h-[46px] flex-[0_0_64px] rounded-[10px] bg-card-tile" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-ink">{item.title}</span>
                      <span className="block text-[12.5px] text-muted">
                        {int(item.mileageKm)} km · {item.manual ? 'Sincrónico' : 'Automático'}
                      </span>
                    </span>
                  </Link>
                  <span>
                    <span className="block text-[14.5px] font-extrabold text-ink">{usd(item.price)}</span>
                    {item.priceCheck ? (
                      <span title={`Contra ${item.priceCheck.sample} autos parecidos en AutoMarket (${usd(item.priceCheck.market)})`} className={cn('mt-[3px] inline-flex h-[22px] items-center rounded-full px-2 text-[11.5px] font-extrabold', PRICE[item.priceCheck.level][1])}>
                        {PRICE[item.priceCheck.level][0]}
                      </span>
                    ) : (
                      <span className="mt-[3px] block text-[11.5px] text-muted">Sin parecidos aún</span>
                    )}
                  </span>
                  <span>
                    <span className={cn('inline-flex h-[26px] items-center rounded-full px-2.5 text-xs font-bold', STATUS[item.status][1])}>{STATUS[item.status][0]}</span>
                  </span>
                  <span className="text-sm font-bold text-ink">{int(item.views)}</span>
                  <span className="text-sm font-bold text-ink">{int(item.contacts)}</span>
                  <span className={cn('font-mono text-[12.5px]', item.days > 45 ? 'text-gold-fg' : 'text-muted')}>{item.days} d</span>
                  <span className="text-right">
                    <FeatureAction item={item} canFeature={canFeature} feature={feature} />
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-5">
        <section className={cn(CARD, 'min-w-0 flex-[3_1_420px] p-5')}>
          <div className="flex items-center justify-between">
            <h2 className="text-[17px] font-extrabold text-ink">Contactos nuevos</h2>
            <Link href="/mensajes" className="text-sm font-bold text-brand-fg">
              Ver mensajes →
            </Link>
          </div>
          <ContactList data={data} />
        </section>
        <section className={cn(CARD, 'min-w-0 flex-[2_1_300px] p-5')}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[17px] font-extrabold text-ink">Tu plan {data.dealer.planName.replace('Concesionario ', '')}</h2>
            {data.dealer.planExpiresAt && <span className="text-[13px] text-muted">Vence el {dayLabel(data.dealer.planExpiresAt.slice(0, 10))}</span>}
          </div>
          <ul className="mt-3.5 flex flex-col gap-3.5">
            <Usage label="Anuncios activos" value={kpis.maxListings === null ? `${kpis.activeListings} · sin límite` : `${kpis.activeListings} de ${kpis.maxListings}`} pct={kpis.maxListings === null ? 100 : (kpis.activeListings / Math.max(1, kpis.maxListings)) * 100} color="#F3A6AE" />
            {data.plan.featuredSlots > 0 && data.plan.monthlyCredits === 0 && (
              <Usage label="Destacados a la vez" value={`${data.plan.featuredInUse} de ${data.plan.featuredSlots}`} pct={(data.plan.featuredInUse / data.plan.featuredSlots) * 100} color="#C8102E" />
            )}
            {data.plan.monthlyCredits > 0 && <Usage label="Destacado del mes" value={data.plan.creditUsedThisMonth ? '1 de 1' : '0 de 1'} pct={data.plan.creditUsedThisMonth ? 100 : 0} color="#C8102E" />}
          </ul>
          <Link href={firstActive ? `/destacar?anuncio=${firstActive.id}` : '/cuenta/anuncios'} className="mt-4 flex h-[46px] items-center justify-center rounded-full bg-mine text-sm font-extrabold text-on-mine">
            Comprar más destacados
          </Link>
          <p className="mt-2.5 text-[12.5px] text-muted">
            {data.dealer.commissionRate === 0 ? 'Sin comisión por venta en tu plan. Pagas el plan y los destacados extra que quieras.' : `Comisión por venta: ${(data.dealer.commissionRate * 100).toLocaleString('es-VE')} % del precio, después de vender.`}
          </p>
        </section>
      </div>
    </main>
  );
}

function PhonePanel({ data, canFeature, feature, runTip, tipButton, done }: Shared) {
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => setSlide(value => (value + 1) % 3), 3400);
    return () => clearInterval(timer);
  }, []);
  const { kpis } = data;
  const tip = data.tips.find(t => t.kind === 'PRICE') ?? data.tips[0];
  const cars = useMemo(() => [...data.inventory].sort((a, b) => Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE')).slice(0, 3), [data.inventory]);
  const note = viewsNote(data);
  const cards = [
    { label: 'Vistas · 7 días', value: int(kpis.views7), chip: change(kpis.views7, kpis.viewsPrev7), dark: true },
    { label: 'Contactos · 7 días', value: int(kpis.contacts7), chip: change(kpis.contacts7, kpis.contactsPrev7) },
    { label: 'Reservas activas', value: int(kpis.activeReservations), chip: 'Hoy' },
  ];
  return (
    <main className="px-5 pt-5 pb-6">
      <div className="flex items-center gap-2.5">
        <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-mine text-[15px] font-bold text-on-mine">{initials(data.dealer.name)}</span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-[-0.02em] text-ink">{data.dealer.name.replace(/ C\.?A\.?$/, '')}</h1>
          <p className="mt-px flex items-center gap-1.5 font-mono text-[11px] text-faint">
            <span aria-hidden="true" className="size-[7px] rounded-full bg-brand dark:bg-brand" />
            {data.dealer.planName.replace('Concesionario ', 'Plan ')}
            {data.dealer.city ? ` · ${data.dealer.city}` : ''}
          </p>
        </div>
        <ThemeToggle />
      </div>

      <div className="-mx-5 mt-4 overflow-hidden px-5">
        <div className="flex gap-3 transition-transform duration-[600ms] ease-[cubic-bezier(.2,.9,.25,1)] motion-reduce:transition-none" style={{ transform: `translateX(-${slide * 312}px)` }}>
          {cards.map(card => (
            <div key={card.label} className={cn('flex h-[118px] flex-[0_0_300px] flex-col justify-between rounded-[22px] border p-4', card.dark ? 'border-mine bg-mine text-on-mine' : 'border-line bg-surface text-ink')}>
              <div className="flex items-center justify-between">
                <span className={cn('text-[13px]', card.dark ? 'text-[#C7CBD1] dark:text-[#3E444D]' : 'text-muted')}>{card.label}</span>
                {card.chip && <span className={cn('inline-flex h-[22px] items-center rounded-full px-2 font-mono text-[11px]', card.dark ? 'bg-[#202328] text-mint dark:bg-[#0E0F11]' : 'bg-card-tile text-ink')}>{card.chip}</span>}
              </div>
              <p className="text-[34px] leading-none font-semibold tracking-[-0.04em]">{card.value}</p>
            </div>
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="mt-2 flex justify-center gap-[5px]">
        {cards.map((card, i) => (
          <span key={card.label} className={cn('h-[5px] rounded-full transition-[width] duration-300', i === slide ? 'w-[18px] bg-ink' : 'w-[5px] bg-edge')} />
        ))}
      </div>
      {note && <p className="mt-2 text-center text-xs text-muted">{note}</p>}

      <Link href="/concesionario/copiloto" className="mt-3.5 flex h-11 items-center justify-center gap-2 rounded-full border border-ink text-sm font-bold text-ink">
        <SteeringIcon size={17} /> Abrir el Copiloto
      </Link>
      {tip && (
        <div className="mt-3.5 flex items-start gap-3 rounded-[20px] border border-line bg-surface p-3.5">
          <span aria-hidden="true" className="grid size-[34px] flex-[0_0_34px] place-items-center rounded-full bg-brand text-white dark:bg-brand dark:text-on-brand">
            <SteeringIcon size={18} />
          </span>
          <div>
            <p className="text-sm leading-[1.45] text-ink">{tip.text}</p>
            <button type="button" disabled={done[tip.kind] && tip.kind !== 'STALE'} onClick={() => (tip.kind === 'STALE' ? (window.location.href = '/cuenta/anuncios') : runTip(tip))} className={cn('mt-2 h-9 rounded-full px-3 text-[13px] font-semibold', done[tip.kind] ? 'bg-card-tile text-muted' : 'bg-brand text-white dark:bg-brand dark:text-on-brand')}>
              {tipButton(tip)}
            </button>
          </div>
        </div>
      )}

      <h2 className="mt-[18px] text-base font-semibold text-ink">Contactos nuevos</h2>
      <div className="mt-2 flex flex-col gap-2">
        {data.contacts.length === 0 ? (
          <p className="text-sm text-muted">Todavía nadie te escribió por el chat.</p>
        ) : (
          data.contacts.slice(0, 3).map(contact => (
            <Link key={contact.conversationId} href={`/mensajes/${contact.conversationId}`} className="flex items-center gap-2.5 rounded-[18px] border border-line bg-surface px-3 py-2.5">
              <Avatar name={contact.buyerName} unread={contact.unread} size="size-[38px] text-[12.5px]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">
                  {contact.buyerName.split(' ')[0]} <span className="font-normal text-muted">· {contact.vehicleTitle.split(' ').slice(1, 3).join(' ')}</span>
                </span>
                <span className="block truncate text-[13px] text-muted">{contact.lastMessage ?? 'Abrió una conversación'}</span>
              </span>
              <span className="font-mono text-[11px] text-faint">{ago(contact.at).replace('hace ', '')}</span>
            </Link>
          ))
        )}
      </div>

      <h2 className="mt-[18px] text-base font-semibold text-ink">Tu inventario</h2>
      <div className="mt-2 flex flex-col gap-2">
        {cars.length === 0 ? (
          <p className="text-sm text-muted">Todavía no tienes autos publicados.</p>
        ) : (
          cars.map((item, i) => (
            <div key={item.id} className="flex items-center gap-2.5 rounded-[18px] border border-line bg-surface p-2">
              <Link href={`/vehiculos/${item.slug}`} className="flex min-w-0 flex-1 items-center gap-2.5">
                <ResultThumb vehicle={cardLike(item)} index={i} className="h-[52px] flex-[0_0_72px] rounded-xl bg-card-tile" wheel="#0C0D0F" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{item.title}</span>
                  <span className="block truncate font-mono text-[11px] text-faint">
                    {usd(item.price)} · {int(item.views)} {item.views === 1 ? 'vista' : 'vistas'} · {int(item.contacts)} {item.contacts === 1 ? 'contacto' : 'contactos'}
                  </span>
                </span>
              </Link>
              <FeatureAction item={item} canFeature={canFeature} feature={feature} phone />
            </div>
          ))
        )}
      </div>
    </main>
  );
}

/** Tarjeta mínima para la miniatura (foto real o silueta). */
const cardLike = (item: DealerInventoryItemDTO) =>
  ({ coverUrl: item.coverUrl, category: item.category }) as Parameters<typeof ResultThumb>[0]['vehicle'];

function FeatureAction({ item, canFeature, feature, phone = false }: { item: DealerInventoryItemDTO; canFeature: boolean; feature: Shared['feature']; phone?: boolean }) {
  if (item.featuredDaysLeft !== null) {
    return (
      <span className={cn('am-pop inline-flex items-center gap-1.5 rounded-full font-extrabold', phone ? 'h-7 bg-brand px-2.5 text-xs text-white dark:bg-brand dark:text-on-brand' : 'h-[30px] bg-brand px-3 text-[12.5px] text-on-brand')}>
        ★ {phone ? `${item.featuredDaysLeft} días` : `Destacado · ${item.featuredDaysLeft} d`}
      </span>
    );
  }
  if (item.status !== 'ACTIVE') return null;
  if (!canFeature) {
    return (
      <Link href={`/destacar?anuncio=${item.id}`} className={cn('inline-flex items-center rounded-full border font-extrabold', phone ? 'h-9 border-edge px-3 text-[12.5px] font-semibold text-ink' : 'h-9 border-ink px-3.5 text-[13px] text-ink')} title="Tu plan no tiene destacados libres: destácalo con Binance">
        Destacar
      </Link>
    );
  }
  return (
    <button
      type="button"
      disabled={feature.isPending}
      onClick={() => feature.mutate(item.id)}
      className={cn('rounded-full border font-extrabold disabled:cursor-wait disabled:opacity-45', phone ? 'h-9 border-edge px-3 text-[12.5px] font-semibold text-ink' : 'h-9 border-ink bg-surface px-3.5 text-[13px] text-ink')}
    >
      {feature.isPending && feature.variables === item.id ? 'Destacando…' : 'Destacar'}
    </button>
  );
}

function Kpi({ label, value, chip, dark = false }: { label: string; value: string; chip: string | null; dark?: boolean }) {
  return (
    <div className={cn('flex flex-col gap-2.5 rounded-[20px] border p-[18px]', dark ? 'border-[#15171a] bg-[#15171a] text-white dark:ring-1 dark:ring-white/10' : 'border-line bg-surface text-ink')}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn('text-[13.5px]', dark ? 'text-[#C7CBD1]' : 'text-muted')}>{label}</span>
        {chip && <span className={cn('inline-flex h-6 items-center rounded-full px-[9px] font-mono text-[11px]', dark ? 'bg-[#202328] text-mint' : 'bg-canvas text-ink')}>{chip}</span>}
      </div>
      <p className="text-[32px] font-extrabold tracking-[-0.03em]">{value}</p>
    </div>
  );
}

function ViewsChart({ data, note }: { data: DealerDashboardDTO; note: string | null }) {
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setGrown(true), 200);
    return () => clearTimeout(timer);
  }, []);
  const maxViews = Math.max(...data.series.map(d => d.views), 1);
  const maxContacts = Math.max(...data.series.map(d => d.contacts), 1);
  const last = data.series.length - 1;
  return (
    <section className={cn(CARD, 'min-w-0 flex-[2_1_440px] p-[22px]')}>
      <div className="flex flex-wrap justify-between gap-2.5">
        <div>
          <h2 className="text-[17px] font-extrabold text-ink">Vistas y contactos</h2>
          <p className="mt-0.5 text-[13px] text-muted">Últimos 14 días{note ? ` · ${note}` : ''}</p>
        </div>
        <div className="flex gap-3.5 text-[13px] text-[#3E444D] dark:text-ink/80">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-[3px] bg-[#F3A6AE]" />
            Vistas
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-full bg-ink" />
            Contactos
          </span>
        </div>
      </div>
      <div role="img" aria-label={data.series.map(d => `${dayLabel(d.day)}: ${d.views} vistas, ${d.contacts} contactos`).join('; ')} className="mt-4 flex h-[200px] items-end gap-2 border-b border-[#ECEEF1] dark:border-line">
        {data.series.map((d, i) => (
          <div key={d.day} title={`${d.views} vistas, ${d.contacts} contactos`} className="relative flex h-full flex-1 items-end justify-center">
            <span
              className={cn('block w-[70%] max-w-[26px] rounded-t-md transition-[height] duration-[900ms] ease-[cubic-bezier(.2,.9,.25,1)] motion-reduce:transition-none', i === last ? 'bg-brand' : 'bg-[#F3A6AE]')}
              style={{ height: grown ? (d.views / maxViews) * 180 : 0, transitionDelay: `${i * 35}ms` }}
            />
            {d.contacts > 0 && (
              <span
                className="absolute left-1/2 -ml-[4.5px] size-[9px] rounded-full bg-ink shadow-[0_0_0_2px_var(--am-surface)] transition-[bottom] duration-[900ms] ease-[cubic-bezier(.2,.9,.25,1)] motion-reduce:transition-none"
                style={{ bottom: grown ? (d.contacts / maxContacts) * 180 : 0, transitionDelay: `${i * 35}ms` }}
              />
            )}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[11px] text-[#666C77] dark:text-muted">
        <span>{dayLabel(data.series[0]!.day)}</span>
        <span>{dayLabel(data.series[6]!.day)}</span>
        <span>Hoy</span>
      </div>
    </section>
  );
}

function ContactList({ data }: { data: DealerDashboardDTO }) {
  if (data.contacts.length === 0) return <p className="mt-3 text-sm text-muted">Todavía nadie te escribió por el chat.</p>;
  return (
    <ul className="mt-2.5">
      {data.contacts.map((contact, i) => (
        <li key={contact.conversationId} className={cn('border-t', i === 0 ? 'border-transparent' : 'border-[#ECEEF1] dark:border-line')}>
          <Link href={`/mensajes/${contact.conversationId}`} className="flex items-center gap-3 py-3">
            <Avatar name={contact.buyerName} unread={contact.unread} size="size-10 text-[13px]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-ink">
                {contact.buyerName} <span className="font-medium text-muted">· {contact.vehicleTitle}</span>
              </span>
              <span className="block truncate text-[13.5px] text-[#3E444D] dark:text-ink/80">{contact.lastMessage ?? 'Abrió una conversación'}</span>
            </span>
            <span className="font-mono text-[11.5px] text-[#666C77] dark:text-muted">{ago(contact.at).replace('hace ', '')}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Avatar({ name, unread, size }: { name: string; unread: boolean; size: string }) {
  return (
    <span className={cn('relative grid shrink-0 place-items-center rounded-full bg-canvas font-extrabold text-ink dark:bg-[#202328]', size)}>
      {initials(name)}
      {unread && <span aria-label="Sin leer" className="absolute -top-px -right-px size-2.5 rounded-full border-2 border-surface bg-brand" />}
    </span>
  );
}

function Usage({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }) {
  return (
    <li>
      <div className="flex justify-between text-sm">
        <span className="font-semibold text-ink">{label}</span>
        <span className="font-mono text-[12.5px] text-ink">{value}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#EFF0F3] dark:bg-sunken">
        <span className="block h-full rounded-full transition-[width] duration-[600ms]" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
      </div>
    </li>
  );
}

function SteeringIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 14v7M10 12H3M14 12h7" />
    </svg>
  );
}
