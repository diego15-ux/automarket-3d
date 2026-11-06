'use client';

import { EXPORT_DATASETS, PLAN_LABELS, type AdminActivityDTO, type ExportDataset, type ExportFormat, type PlanCode } from '@automarket/contracts';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { cn } from '@/shared/lib/cn';
import { initials } from '@/shared/lib/format';
import { PageSpinner } from '@/shared/ui/spinner';
import { useToast } from '@/shared/ui/toaster';
import { adminApi, adminKeys, downloadExport } from '../api';
import { usd } from '../copilot-engine';
import { cap, int } from '../stats-views';
import { ago, PANEL_ICON, PanelIcon, PaymentPill, paymentConcept, stamp } from './panel-kit';

/**
 * Resumen del panel (diseño «admin-resumen»): ingresos del libro contable por periodo, la
 * plataforma hoy, ingresos por mes, vencimientos del mes, últimos pagos, actividad, planes y
 * exportaciones. Todo con datos reales de la base.
 */
const DATASET_LABELS: Record<ExportDataset, string> = {
  sales: 'Ventas concretadas',
  reservations: 'Reservas',
  vehicles: 'Inventario de carros',
  users: 'Usuarios',
  dealers: 'Concesionarios',
  memberships: 'Compras de planes',
  payments: 'Pagos Binance',
  reports: 'Denuncias',
  reviews: 'Opiniones',
};
/** Las cuatro filas del bloque «Reportes» del diseño; «Comisiones» = ventas concretadas con su comisión. */
const EXPORT_ROWS: Array<[string, ExportDataset]> = [
  ['Usuarios', 'users'],
  ['Pagos Binance', 'payments'],
  ['Comisiones', 'sales'],
  ['Reservas', 'reservations'],
];
const PLAN_ORDER: PlanCode[] = ['FREE', 'PREMIUM', 'DEALER_BASIC', 'DEALER_PRO'];
const PLAN_COLOR: Record<PlanCode, string> = { FREE: '#C7CBD1', PREMIUM: '#C8102E', DEALER_BASIC: '#15171a', DEALER_PRO: '#F3A6AE' };
const SERIES = [
  { key: 'membership', label: 'Membresías', color: '#C8102E' },
  { key: 'commission', label: 'Comisiones', color: '#F3A6AE' },
  { key: 'boosts', label: 'Destacados', color: '#C9C2F7' },
] as const;
const ACTIVITY_ICON: Record<AdminActivityDTO['kind'], { d: string; className: string }> = {
  KYC: { d: PANEL_ICON.id, className: 'bg-soft text-brand-fg' },
  REPORT: { d: PANEL_ICON.flag, className: 'bg-gold-soft text-gold-fg' },
  PAYMENT: { d: PANEL_ICON.card, className: 'bg-tile text-ink' },
  LISTING: { d: PANEL_ICON.plus, className: 'bg-tile text-ink' },
  REVIEW: { d: PANEL_ICON.star, className: 'bg-tile text-ink' },
};
const CARD = 'rounded-[20px] border border-line bg-surface';

const caracas = (date = new Date()) => new Date(date.getTime() - 4 * 3_600_000);
const monthKeyNow = () => caracas().toISOString().slice(0, 7);
const monthTitle = (key: string) => cap(new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${key}-15T12:00:00Z`)).replace(' de ', ' '));
const shortMonth = (key: string) => cap(new Intl.DateTimeFormat('es', { month: 'short', timeZone: 'UTC' }).format(new Date(`${key}-15T12:00:00Z`)).replace('.', '').replace('sept', 'sep'));
const shiftMonth = (key: string, delta: number) => {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
};
const todayText = () => cap(new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Caracas' }).format(new Date()).replace(',', ''));
/** Eje del gráfico: «$0», «$400», «$4k». */
const axis = (value: number) => (value >= 1000 ? `$${(value / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })}k` : `$${Math.round(value)}`);
function niceStep(max: number) {
  const raw = Math.max(max, 1) / 3;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

type Period = 'year12' | 'month' | 'year';
const PERIOD_MONTHS = (period: Period) => (period === 'month' ? 1 : period === 'year' ? Number(caracas().toISOString().slice(5, 7)) : 12);
const PERIOD_SUB: Record<Period, string> = { year12: 'Últimos 12 meses, por origen', month: 'Este mes, por origen', year: 'Este año, por origen' };

export function AdminDashboard() {
  const [period, setPeriod] = useState<Period>('year12');
  const months = PERIOD_MONTHS(period);
  const metrics = useQuery({ queryKey: adminKeys.metricsFor(months), queryFn: () => adminApi.metrics(months), placeholderData: previous => previous });
  const payments = useQuery({ queryKey: adminKeys.payments('all'), queryFn: () => adminApi.payments('all') });
  const activity = useQuery({ queryKey: adminKeys.activity, queryFn: adminApi.activity, refetchInterval: 60_000 });

  if (metrics.isPending) return <PageSpinner />;
  if (metrics.isError) return <p className="text-danger-fg">{metrics.error.message}</p>;
  const data = metrics.data;
  const { totals, counts } = data;
  const change = data.period.previousRevenue > 0 ? Math.round((data.period.revenue / data.period.previousRevenue - 1) * 100) : null;

  return (
    <div data-own-header className="grid gap-5">
      {/* Barra superior */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-[1_1_240px]">
          <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-ink">Resumen</h1>
          <p className="mt-0.5 text-sm text-muted">{todayText()}</p>
        </div>
        <PanelSearch />
        <label className="sr-only" htmlFor="resumen-periodo">
          Periodo
        </label>
        <select
          id="resumen-periodo"
          value={period}
          onChange={event => setPeriod(event.target.value as Period)}
          className="h-11 rounded-full border border-line bg-surface px-3.5 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <option value="year12">Últimos 12 meses</option>
          <option value="month">Este mes</option>
          <option value="year">Este año</option>
        </select>
        <NotificationBell variant="panel" />
        <ExportMenu />
      </div>

      {/* Indicadores */}
      <section aria-label="Indicadores" className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        <div className="flex flex-col gap-3.5 rounded-[20px] bg-[#15171a] p-5 text-white dark:ring-1 dark:ring-white/10">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-[#C7CBD1]">Ingresos de la plataforma</span>
            {change !== null && <span className={`inline-flex h-[26px] items-center rounded-full bg-[#202328] px-2.5 font-mono text-[11px] ${change < 0 ? 'text-[#ff8a80]' : 'text-[#7cc79a]'}`}>{`${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change)} %`}</span>}
          </div>
          <p className="text-[34px] font-extrabold tracking-[-0.03em]">{usd(data.period.revenue)}</p>
          <p className="text-[13px] text-[#A2A7B0]">Planes, comisiones y destacados, en Binance</p>
        </div>
        <Indicator label="Membresías" value={usd(data.period.membership)} foot={counts.paidMemberships === 1 ? '1 plan activo' : `${int(counts.paidMemberships)} planes activos`} icon={PANEL_ICON.card} />
        <Indicator label="Comisiones cobradas" value={usd(data.period.commissions)} foot="Post-venta, sobre el precio" icon={PANEL_ICON.pct} />
        <Indicator label="Comisiones por cobrar" value={usd(totals.commissionsPending + totals.commissionsOverdue)} foot={`Vencidas: ${usd(totals.commissionsOverdue)}`} icon={PANEL_ICON.clock} gold />
      </section>

      {/* La plataforma hoy */}
      <section aria-label="La plataforma hoy" className={cn(CARD, 'grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] overflow-hidden')}>
        {[
          ['Usuarios', counts.users],
          ['Anuncios activos', counts.activeListings],
          ['Reservas en curso', counts.acceptedReservations],
          ['Ventas concretadas', counts.completedSales],
          ['Concesionarios', counts.dealers],
        ].map(([label, value]) => (
          <div key={label} className="border-r border-[#ECEEF1] px-5 py-4 dark:border-line">
            <p className="text-[13px] text-muted">{label}</p>
            <p className="mt-1 text-[22px] font-extrabold tracking-[-0.02em] text-ink">{int(Number(value))}</p>
          </div>
        ))}
      </section>

      <div className="flex flex-wrap gap-5">
        <RevenueByMonth monthly={data.monthly} sub={PERIOD_SUB[period]} />
        <DueCalendar />
      </div>

      <div className="flex flex-wrap gap-5">
        <section className={cn(CARD, 'min-w-0 flex-[3_1_520px] p-[22px]')}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[17px] font-extrabold text-ink">Pagos Binance recientes</h2>
            <Link href="/admin/pagos?tab=todos" className="text-sm font-bold text-brand-fg">
              Ver todos →
            </Link>
          </div>
          <div className="mt-3.5 overflow-x-auto">
            {payments.isPending ? (
              <p className="py-6 text-sm text-muted">Cargando…</p>
            ) : !payments.data?.length ? (
              <p className="py-6 text-sm text-muted">Todavía no hay pagos con Binance.</p>
            ) : (
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead>
                  <tr className="text-left font-mono text-[11px] font-medium text-[#666C77] dark:text-muted">
                    <th className="py-2 pr-2 font-medium">Usuario</th>
                    <th className="p-2 font-medium">Concepto</th>
                    <th className="p-2 text-right font-medium">Monto</th>
                    <th className="p-2 font-medium">Fecha</th>
                    <th className="py-2 pl-2 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.data.slice(0, 5).map(p => {
                    const name = p.user.accountType === 'DEALER' && p.user.businessName ? p.user.businessName : p.user.name;
                    return (
                      <tr key={p.id} className="border-t border-[#ECEEF1] dark:border-line">
                        <td className="py-2.5 pr-2">
                          <span className="flex items-center gap-2.5">
                            <span aria-hidden="true" className="grid size-[34px] shrink-0 place-items-center rounded-full bg-tile text-xs font-extrabold text-ink">
                              {initials(name)}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-bold text-ink">{name}</span>
                              <span className="block text-[12.5px] text-muted">{p.user.accountType === 'DEALER' ? 'Concesionario' : 'Persona'}</span>
                            </span>
                          </span>
                        </td>
                        <td className="max-w-56 truncate px-2 py-2.5 text-[#3E444D] dark:text-ink/80">{paymentConcept(p)}</td>
                        <td className="px-2 py-2.5 text-right font-extrabold text-ink">{usd(Number(p.amount))}</td>
                        <td className="px-2 py-2.5 font-mono text-xs whitespace-nowrap text-muted">{stamp(p.submittedAt ?? p.createdAt).split(' · ')[0]}</td>
                        <td className="py-2.5 pl-2">
                          <PaymentPill status={p.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className={cn(CARD, 'min-w-0 flex-[2_1_320px] p-[22px]')}>
          <h2 className="text-[17px] font-extrabold text-ink">Actividad reciente</h2>
          {activity.isPending ? (
            <p className="mt-3.5 text-sm text-muted">Cargando…</p>
          ) : !activity.data?.length ? (
            <p className="mt-3.5 text-sm text-muted">Todavía no hay movimiento en la plataforma.</p>
          ) : (
            <ul className="mt-3.5">
              {activity.data.map((item, index) => (
                <li key={`${item.kind}-${item.at}-${index}`} className={cn('flex gap-3 border-t py-3', index === 0 ? 'border-transparent' : 'border-[#ECEEF1] dark:border-line')}>
                  <span aria-hidden="true" className={cn('grid size-[34px] shrink-0 place-items-center rounded-xl', ACTIVITY_ICON[item.kind].className)}>
                    <PanelIcon d={ACTIVITY_ICON[item.kind].d} stroke={1.9} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm leading-[1.4] text-ink">
                      <strong className="font-bold">{item.who}</strong> {item.what}
                    </span>
                    <span className="mt-[3px] flex gap-2 text-[12.5px] text-muted">
                      {ago(item.at)}
                      {item.action && (
                        <Link href={item.action.href} className="font-bold text-brand-fg">
                          {item.action.label}
                        </Link>
                      )}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="flex flex-wrap gap-5">
        <PlansBlock plans={data.plans} />
        <ExportBlock />
      </div>
    </div>
  );
}

function Indicator({ label, value, foot, icon, gold = false }: { label: string; value: string; foot: string; icon: string; gold?: boolean }) {
  return (
    <div className={cn(CARD, 'flex flex-col gap-3.5 p-5')}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted">{label}</span>
        <span aria-hidden="true" className={cn('grid size-8 place-items-center rounded-[10px]', gold ? 'bg-gold-soft text-gold-fg' : 'bg-soft text-brand-fg')}>
          <PanelIcon d={icon} />
        </span>
      </div>
      <p className="text-[34px] font-extrabold tracking-[-0.03em] text-ink">{value}</p>
      <p className={cn('text-[13px]', gold ? 'font-semibold text-gold-fg' : 'text-muted')}>{foot}</p>
    </div>
  );
}

function RevenueByMonth({ monthly, sub }: { monthly: Array<{ month: string; membership: number; commission: number; boosts: number }>; sub: string }) {
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setGrown(true), 150);
    return () => clearTimeout(timer);
  }, []);
  const max = Math.max(...monthly.map(m => m.membership + m.commission + m.boosts), 0);
  const step = niceStep(max);
  const top = step * 3;
  const px = (value: number) => (top > 0 ? (value / top) * 192 : 0);
  return (
    <section className={cn(CARD, 'min-w-0 flex-[2_1_480px] p-[22px]')}>
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-extrabold text-ink">Ingresos por mes</h2>
          <p className="mt-0.5 text-[13px] text-muted">{sub}</p>
        </div>
        <div className="flex flex-wrap gap-4 text-[13px] text-[#3E444D] dark:text-ink/80">
          {SERIES.map(series => (
            <span key={series.key} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2.5 rounded-[3px]" style={{ background: series.color }} />
              {series.label}
            </span>
          ))}
        </div>
      </div>
      <div className="relative mt-[18px] h-[236px] pl-11" role="img" aria-label={monthly.map(m => `${shortMonth(m.month)}: membresías ${usd(m.membership)}, comisiones ${usd(m.commission)}, destacados ${usd(m.boosts)}`).join('; ')}>
        {[0, 1, 2, 3].map(k => (
          <div key={k} className="absolute right-0 left-0 flex items-center gap-2" style={{ bottom: 22 + k * 64 - 6 }}>
            <span className="w-9 text-right font-mono text-[11px] text-[#666C77] dark:text-muted">{axis(step * k)}</span>
            <span className="h-px flex-1 bg-[#ECEEF1] dark:bg-line" />
          </div>
        ))}
        <div className="absolute top-1.5 right-0 bottom-[22px] left-11 flex items-end gap-2.5">
          {monthly.map((m, i) => (
            <div key={m.month} className="flex h-full flex-1 flex-col items-center justify-end" title={`${cap(new Intl.DateTimeFormat('es', { month: 'long', timeZone: 'UTC' }).format(new Date(`${m.month}-15T12:00:00Z`)))}: membresías ${usd(m.membership)}, comisiones ${usd(m.commission)}, destacados ${usd(m.boosts)}`}>
              <div className="flex w-[70%] max-w-[30px] flex-col overflow-hidden rounded-t-md">
                {[...SERIES].reverse().map(series => (
                  <span
                    key={series.key}
                    className="block w-full transition-[height] duration-[900ms] ease-[cubic-bezier(.2,.9,.25,1)] motion-reduce:transition-none"
                    style={{ height: grown ? px(m[series.key]) : 0, background: series.color, transitionDelay: `${i * 45}ms` }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="absolute right-0 bottom-0 left-11 flex gap-2.5">
          {monthly.map(m => (
            <span key={m.month} className="flex-1 text-center font-mono text-[11px] text-[#666C77] dark:text-muted">
              {shortMonth(m.month)}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function DueCalendar() {
  const [month, setMonth] = useState(monthKeyNow);
  const calendar = useQuery({ queryKey: adminKeys.calendar(month), queryFn: () => adminApi.calendar(month), placeholderData: previous => previous });
  const [y, m] = month.split('-').map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const offset = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const today = calendar.data?.today ?? caracas().toISOString().slice(0, 10);
  const reservations = new Set(calendar.data?.month === month ? calendar.data.reservations : []);
  const commissions = new Set(calendar.data?.month === month ? calendar.data.commissions : []);
  return (
    <section className={cn(CARD, 'flex-[1_1_300px] overflow-hidden')}>
      <div className="flex items-center justify-between bg-brand py-3.5 pr-3.5 pl-[22px] text-white">
        <h2 className="text-[17px] font-extrabold">{monthTitle(month)}</h2>
        <div className="flex gap-1.5">
          {[
            ['Mes anterior', -1, 'M15 6l-6 6 6 6'],
            ['Mes siguiente', 1, 'M9 6l6 6-6 6'],
          ].map(([label, delta, d]) => (
            <button key={String(label)} type="button" aria-label={String(label)} onClick={() => setMonth(key => shiftMonth(key, Number(delta)))} className="grid size-9 place-items-center rounded-full bg-white/14 hover:bg-white/22 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              <PanelIcon d={String(d)} size={16} stroke={2.4} />
            </button>
          ))}
        </div>
      </div>
      <div className="px-[18px] pt-3.5 pb-[18px]">
        <div className="grid grid-cols-7 text-center font-mono text-[11px] text-[#666C77] dark:text-muted">
          {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        <div className="mt-1.5 grid grid-cols-7 gap-y-1">
          {Array.from({ length: offset }, (_, i) => (
            <span key={`e${i}`} />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1;
            const iso = `${month}-${String(day).padStart(2, '0')}`;
            const reserve = reservations.has(day);
            const commission = !reserve && commissions.has(day);
            const isToday = iso === today;
            return (
              <span key={day} className="grid h-[34px] place-items-center">
                <span
                  className={cn(
                    'grid size-[30px] place-items-center rounded-full text-[13px]',
                    reserve ? 'bg-brand font-bold text-white' : commission ? 'bg-[#F0B429] font-bold text-[#15171a]' : 'text-ink',
                    isToday && 'font-bold shadow-[inset_0_0_0_2px_var(--am-ink)]',
                  )}
                  aria-label={`${day}${reserve ? ', vence una reserva' : commission ? ', vence una comisión' : ''}${isToday ? ', hoy' : ''}`}
                >
                  {day}
                </span>
              </span>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2.5 border-t border-[#ECEEF1] pt-3 text-[12.5px] text-[#3E444D] dark:border-line dark:text-ink/80">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-full bg-brand" />
            Vence una reserva
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-full bg-[#F0B429]" />
            Vence una comisión
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-full shadow-[inset_0_0_0_2px_var(--am-ink)]" />
            Hoy
          </span>
        </div>
      </div>
    </section>
  );
}

function PlansBlock({ plans }: { plans: Array<{ code: string; users: number }> }) {
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setGrown(true), 150);
    return () => clearTimeout(timer);
  }, []);
  const rows = PLAN_ORDER.map(code => ({ code, users: plans.find(plan => plan.code === code)?.users ?? 0 }));
  const max = Math.max(...rows.map(row => row.users), 1);
  return (
    <section className={cn(CARD, 'flex-[1_1_340px] p-[22px]')}>
      <h2 className="text-[17px] font-extrabold text-ink">Usuarios por plan</h2>
      <p className="mt-0.5 text-[13px] text-muted">Plan efectivo hoy</p>
      <ul className="mt-4 flex flex-col gap-3.5">
        {rows.map((row, i) => (
          <li key={row.code}>
            <div className="flex justify-between text-sm">
              <span className="font-semibold text-ink">{PLAN_LABELS[row.code]}</span>
              <span className="font-mono text-[12.5px] text-[#3E444D] dark:text-ink/80">{int(row.users)}</span>
            </div>
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-[#EFF0F3] dark:bg-sunken">
              <span
                className="block h-full rounded-full transition-[width] duration-[900ms] ease-[cubic-bezier(.2,.9,.25,1)] motion-reduce:transition-none dark:outline dark:outline-white/10"
                style={{ width: grown ? `${Math.max(2, (row.users / max) * 100)}%` : 0, background: PLAN_COLOR[row.code], transitionDelay: `${200 + i * 80}ms` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function useExport() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (dataset: ExportDataset, format: ExportFormat) => {
    setBusy(`${dataset}.${format}`);
    try {
      await downloadExport(dataset, format);
    } catch (err) {
      toast({ tone: 'error', title: 'No se pudo exportar', description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

function ExportBlock() {
  const { busy, run } = useExport();
  return (
    <section className={cn(CARD, 'flex-[1_1_340px] p-[22px]')}>
      <h2 className="text-[17px] font-extrabold text-ink">Reportes</h2>
      <p className="mt-0.5 text-[13px] text-muted">Se generan al momento, hasta 10.000 filas.</p>
      <ul className="mt-3">
        {EXPORT_ROWS.map(([label, dataset]) => (
          <li key={dataset} className="flex items-center justify-between gap-3 border-t border-[#ECEEF1] py-2.5 dark:border-line">
            <span className="text-sm font-semibold text-ink">{label}</span>
            <span className="flex gap-1.5">
              {(['xlsx', 'pdf'] as const).map(format => (
                <button
                  key={format}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void run(dataset, format)}
                  className="h-9 rounded-full border border-[#D8DBE0] bg-surface px-3 text-[12.5px] font-bold text-ink hover:border-ink disabled:cursor-wait disabled:opacity-60 dark:border-line"
                >
                  {busy === `${dataset}.${format}` ? 'Generando…' : format === 'xlsx' ? 'Excel' : 'PDF'}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** «Exportar»: todas las tablas que el servidor sabe exportar, en Excel o PDF. */
function ExportMenu() {
  const { busy, run } = useExport();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => !box.current?.contains(event.target as Node) && setOpen(false);
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="inline-flex h-11 items-center gap-2 rounded-full bg-mine px-[18px] text-sm font-bold text-on-mine focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <PanelIcon d="M12 4v11M7 10l5 5 5-5M5 20h14" size={16} stroke={2.2} />
        Exportar
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-72 rounded-2xl border border-line bg-surface p-2 shadow-pop">
          {EXPORT_DATASETS.map(dataset => (
            <div key={dataset} className="flex items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 hover:bg-tile">
              <span className="text-sm font-semibold text-ink">{DATASET_LABELS[dataset]}</span>
              <span className="flex gap-1">
                {(['xlsx', 'pdf'] as const).map(format => (
                  <button key={format} type="button" disabled={busy !== null} onClick={() => void run(dataset, format)} className="h-8 rounded-full border border-line px-2.5 text-xs font-bold text-ink hover:border-ink disabled:opacity-60">
                    {busy === `${dataset}.${format}` ? '…' : format === 'xlsx' ? 'Excel' : 'PDF'}
                  </button>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Buscador: personas, anuncios y pagos que coinciden (mínimo 2 letras). */
function PanelSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => !box.current?.contains(event.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const results = useQuery({ queryKey: adminKeys.search(term), queryFn: () => adminApi.search(term), enabled: term.length >= 2 });
  const links = useMemo(() => {
    const r = results.data;
    if (!r) return [];
    return [
      ...r.users.map(u => ({ group: 'Personas', label: u.name, sub: `${u.accountType === 'DEALER' ? 'Concesionario' : 'Persona'} · ${u.email}`, href: `/admin/usuarios?q=${encodeURIComponent(u.email)}` })),
      ...r.vehicles.map(v => ({ group: 'Anuncios', label: v.title, sub: v.seller, href: `/vehiculos/${v.slug}` })),
      ...r.payments.map(p => ({ group: 'Pagos', label: `${p.reference} · ${usd(Number(p.amount))}`, sub: p.user, href: `/admin/pagos?tab=todos&pago=${p.id}` })),
    ];
  }, [results.data]);
  return (
    <form
      ref={box}
      role="search"
      onSubmit={event => {
        event.preventDefault();
        if (links[0]) router.push(links[0].href);
      }}
      className="relative flex h-11 flex-[0_1_260px] items-center gap-2 rounded-full border border-line bg-surface px-4 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-brand"
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="shrink-0 text-muted">
        <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" />
      </svg>
      <label htmlFor="panel-search" className="sr-only">
        Buscar en el panel
      </label>
      <input
        id="panel-search"
        value={q}
        onChange={event => {
          setQ(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
        placeholder="Usuario, anuncio o pago"
        className="min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-[#6A707B] dark:placeholder:text-faint"
      />
      {open && term.length >= 2 && (
        <div className="absolute top-full right-0 left-0 z-40 mt-2 max-h-96 min-w-72 overflow-y-auto rounded-2xl border border-line bg-surface p-2 shadow-pop">
          {results.isPending ? (
            <p className="px-3 py-2 text-sm text-muted">Buscando…</p>
          ) : links.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted">Sin resultados para «{term}».</p>
          ) : (
            links.map((link, i) => (
              <div key={link.href + i}>
                {(i === 0 || links[i - 1]!.group !== link.group) && <p className="px-3 pt-2 pb-1 font-mono text-[11px] text-muted">{link.group}</p>}
                <Link href={link.href} onClick={() => setOpen(false)} className="block rounded-xl px-3 py-2 hover:bg-tile">
                  <span className="block truncate text-sm font-semibold text-ink">{link.label}</span>
                  <span className="block truncate text-xs text-muted">{link.sub}</span>
                </Link>
              </div>
            ))
          )}
        </div>
      )}
    </form>
  );
}
