'use client';

import type { AdminStatsDTO } from '@automarket/contracts';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { PageSpinner } from '@/shared/ui/spinner';
import { useToast } from '@/shared/ui/toaster';
import { adminApi, adminKeys } from '../api';
import { buildViews, cap, compact, download, int, type Kpi, money, monthLong, monthShort, niceMax, TABS, type TabKey, toCsv } from '../stats-views';

const EASE = 'cubic-bezier(.2,.9,.25,1)';

/** Estadísticas del panel (diseño «admin-estadisticas») con series reales de la base. */
export function AdminStats() {
  const stats = useQuery({ queryKey: adminKeys.stats, queryFn: adminApi.stats });
  if (stats.isPending) return <PageSpinner />;
  if (stats.isError) return <p className="text-danger-fg">{stats.error.message}</p>;
  return <Stats data={stats.data} />;
}

function Stats({ data }: { data: AdminStatsDTO }) {
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>('sales');
  const [range, setRange] = useState<3 | 6>(6);
  const [asTable, setAsTable] = useState(false);
  const [marked, setMarked] = useState<number | null>(null);
  const views = useMemo(() => buildViews(data), [data]);
  const view = views[tab];
  const keys = data.months.map(month => month.key);
  const year = keys.at(-1)!.slice(0, 4);
  const offset = keys.length - range;
  const visible = keys.slice(offset);
  const values = view.chart.values.slice(offset);
  const lastComplete = visible.length - 2;
  const focus = marked ?? lastComplete;
  const max = niceMax(Math.max(...values, 0));
  const top = values.indexOf(Math.max(...values));
  const fullIndex = (i: number) => i + offset;
  const monthTitle = (i: number) => `${cap(monthLong(visible[i]!))}${data.months[fullIndex(i)]!.current ? ' (en curso)' : ''}`;
  const tabName = TABS.find(([key]) => key === tab)![1];
  const periodText = `${cap(monthLong(visible[0]!))} a ${monthLong(visible.at(-1)!)} de ${year}`;
  const tableRows = tab === 'dealers' ? view.table.rows : view.table.rows.slice(offset);

  const choose = (key: TabKey) => {
    setTab(key);
    setMarked(null);
  };
  const exportTab = () => {
    try {
      download(`automarket-${tabName.toLowerCase()}-${year}.csv`, toCsv([{ head: view.table.head, rows: view.table.rows }]));
      toast({ tone: 'success', title: `Descargado: ${tabName.toLowerCase()} en Excel (CSV)` });
    } catch {
      toast({ tone: 'error', title: 'No se pudo descargar aquí' });
    }
  };
  const exportAll = () => {
    try {
      download(`automarket-estadisticas-${year}.csv`, toCsv(TABS.map(([key, label]) => ({ title: label, head: views[key].table.head, rows: views[key].table.rows }))));
      toast({ tone: 'success', title: 'Descargado: todas las estadísticas en Excel (CSV)' });
    } catch {
      toast({ tone: 'error', title: 'No se pudo descargar aquí' });
    }
  };
  const print = () => {
    try {
      window.print();
    } catch {
      toast({ tone: 'info', title: 'Usa Imprimir → Guardar como PDF' });
    }
  };

  return (
    <div className="grid gap-[18px]">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-[1_1_300px]">
          <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-ink">Estadísticas</h1>
          <p className="mt-0.5 text-sm text-muted">
            {periodText} · {monthLong(keys.at(-1)!)} va en curso ({data.currentDays === 1 ? '1 día' : `${data.currentDays} días`}).
          </p>
        </div>
        <div role="group" aria-label="Periodo" className="inline-flex rounded-full bg-sunken p-1 print:hidden">
          {([3, 6] as const).map(n => (
            <button key={n} type="button" aria-pressed={range === n} onClick={() => { setRange(n); setMarked(null); }} className={cn('h-[38px] rounded-full px-3.5 text-[13.5px] font-bold', range === n ? 'bg-surface text-ink shadow-[0_1px_3px_rgb(17_19_18/0.12)]' : 'text-muted')}>
              {n} meses
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <ExportButton onClick={exportTab}>Excel</ExportButton>
          <ExportButton onClick={print}>PDF</ExportButton>
          <ExportButton onClick={exportAll} dark>
            Todo en Excel
          </ExportButton>
        </div>
      </div>

      <div role="tablist" aria-label="Qué ver" className="flex flex-wrap gap-1 self-start justify-self-start rounded-full bg-sunken p-1 print:hidden">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => choose(key)} className={cn('h-10 rounded-full px-4 text-sm font-bold', tab === key ? 'bg-surface text-ink shadow-[0_1px_3px_rgb(17_19_18/0.12)]' : 'text-muted')}>
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
        {view.kpis.map(kpi => (
          <KpiCard key={kpi.label} kpi={kpi} previousMonth={keys[keys.length - 3]!} />
        ))}
      </div>

      <section className="rounded-[22px] border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-ink">{view.chart.title}</h2>
            <p aria-live="polite" className="mt-1 text-sm text-ink/80">
              <b>{monthTitle(focus)}:</b> {view.chart.label(values[focus] ?? 0, fullIndex(focus))} · <span className="text-muted">{view.chart.sub(fullIndex(focus))}</span>
            </p>
          </div>
          <button type="button" aria-pressed={asTable} onClick={() => setAsTable(value => !value)} className="h-[38px] rounded-full border border-edge bg-surface px-3.5 text-[13px] font-bold text-ink print:hidden">
            {asTable ? 'Ver gráfico' : 'Ver como tabla'}
          </button>
        </div>
        {asTable ? (
          <Table head={view.table.head} rows={tableRows} label={`${view.chart.title} en tabla`} />
        ) : (
          <>
            <div className="mt-[18px] grid h-[240px] grid-cols-[52px_minmax(0,1fr)]">
              <div className="relative">
                {[0, 0.5, 1].map(mark => (
                  <span key={mark} className="absolute right-2.5 translate-y-1/2 font-mono text-[11.5px] font-medium text-muted" style={{ bottom: `${mark * 100}%` }}>
                    {compact(max * mark)}
                  </span>
                ))}
              </div>
              <div className="relative border-b border-edge">
                {[0.5, 1].map(mark => (
                  <span key={mark} aria-hidden className="absolute inset-x-0 border-t border-line" style={{ bottom: `${mark * 100}%` }} />
                ))}
                <div role="list" aria-label={view.chart.title} className="absolute inset-0 flex items-end justify-around gap-0.5">
                  {values.map((value, i) => {
                    const current = data.months[fullIndex(i)]!.current;
                    const show = i === lastComplete || (i === top && value > 0) || i === marked;
                    return (
                      <div
                        key={visible[i]}
                        role="listitem"
                        tabIndex={0}
                        aria-label={`${monthLong(visible[i]!)}${current ? ' en curso' : ''}: ${view.chart.label(value, fullIndex(i))}, ${view.chart.sub(fullIndex(i))}`}
                        onMouseEnter={() => setMarked(i)}
                        onFocus={() => setMarked(i)}
                        className="relative flex h-full flex-[1_1_0] flex-col items-center justify-end outline-none focus-visible:outline-2 focus-visible:outline-brand"
                      >
                        {show && <span className="mb-1.5 font-mono text-[12.5px] font-semibold text-ink">{view.chart.money ? money(value) : compact(value)}</span>}
                        <span
                          className="block w-6 origin-bottom rounded-t motion-safe:animate-[am-bar_520ms_both]"
                          style={{
                            height: `${(value / max) * 100}%`,
                            background: current ? 'repeating-linear-gradient(135deg, var(--am-brand) 0 4px, #F3A6AE 4px 8px)' : 'var(--am-brand)',
                            opacity: marked === null || marked === i ? 1 : 0.55,
                            animationDelay: `${i * 60}ms`,
                            animationTimingFunction: EASE,
                          }}
                        />
                        <span className={cn('absolute -bottom-[26px] text-[12.5px] whitespace-nowrap text-muted', i === focus ? 'font-extrabold text-ink' : 'font-medium')}>
                          {monthShort(visible[i]!)}
                          {current ? '*' : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <p className="mt-[34px] text-[12.5px] text-muted">Rayado: {monthLong(keys.at(-1)!)}, mes en curso. Pasa el ratón o usa Tab sobre una barra para ver el detalle.</p>
          </>
        )}
      </section>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(380px,100%),1fr))] items-start gap-4">
        <section className="rounded-[22px] border border-line bg-surface p-5">
          <h2 className="text-[17px] font-extrabold text-ink">{view.side.title}</h2>
          <p className="mt-0.5 mb-3 text-[13.5px] text-muted">{view.side.sub}</p>
          {view.side.rows.length === 0 ? (
            <p className="text-sm text-muted">Todavía no hay datos.</p>
          ) : (
            <ul className="grid list-none gap-2.5 p-0">
              {view.side.rows.map(row => {
                const biggest = Math.max(...view.side.rows.map(r => r.value), 1);
                return (
                  <li key={row.label} className="grid grid-cols-[130px_minmax(0,1fr)_92px] items-center gap-2.5 text-sm">
                    <span className="truncate font-semibold text-ink">{row.label}</span>
                    <span className="h-3 rounded-r bg-line">
                      <span className="block h-full rounded-r bg-brand transition-[width] duration-500" style={{ width: `${(row.value / biggest) * 100}%`, transitionTimingFunction: EASE }} />
                    </span>
                    <span className="text-right font-mono text-[13px] font-semibold text-ink">{row.text}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="rounded-[22px] border border-line bg-surface p-5">
          <h2 className="text-[17px] font-extrabold text-ink">{view.grid.title}</h2>
          <p className="mt-0.5 mb-3 text-[13.5px] text-muted">{view.grid.sub}</p>
          {view.grid.rows.length === 0 ? (
            <p className="text-sm text-muted">Todavía no hay datos.</p>
          ) : (
            <div role="table" aria-label={view.grid.title}>
              <div role="row" className="grid gap-2.5 border-b border-line py-2 font-mono text-[11.5px] font-medium text-muted uppercase" style={{ gridTemplateColumns: view.grid.cols }}>
                {view.grid.head.map(head => (
                  <span key={head} role="columnheader">
                    {head}
                  </span>
                ))}
              </div>
              {view.grid.rows.map((row, i) => (
                <div key={i} role="row" className="grid gap-2.5 border-b border-line py-[9px] text-sm text-ink last:border-b-0" style={{ gridTemplateColumns: view.grid.cols }}>
                  {row.map((cell, j) => (
                    <span key={j} role="cell" className="truncate">
                      {cell}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <Link href="/admin/copiloto" className="flex items-center gap-3.5 rounded-[20px] bg-night px-[18px] py-4 text-[#F2F3F5] print:hidden">
        <span className="grid size-[42px] shrink-0 place-items-center rounded-xl bg-brand text-on-brand">
          <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-extrabold">Pregúntale al Copiloto del admin</span>
          <span className="mt-0.5 block text-[13.5px] text-[#C7CBD1]">
            «¿Qué concesionario vendió más en {monthLong(keys[keys.length - 2]!)}?» · «Proyecta {monthLong(keys.at(-1)!)}» · «Compara {monthLong(keys[keys.length - 3]!)} y {monthLong(keys[keys.length - 2]!)}»
          </span>
        </span>
        <span aria-hidden className="text-xl">
          →
        </span>
      </Link>
    </div>
  );
}

function ExportButton({ children, onClick, dark = false }: { children: React.ReactNode; onClick: () => void; dark?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn('inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-bold', dark ? 'bg-mine text-on-mine' : 'border border-edge bg-surface text-ink hover:border-ink')}>
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
      </svg>
      {children}
    </button>
  );
}

function KpiCard({ kpi, previousMonth }: { kpi: Kpi; previousMonth: string }) {
  let text = kpi.note ?? '';
  let tone = 'text-muted';
  if (kpi.current !== null && kpi.previous !== null && kpi.note === undefined) {
    if (kpi.current === kpi.previous) text = `igual que ${monthLong(previousMonth)}`;
    else if (kpi.previous === 0) {
      text = `▲ desde 0 en ${monthShort(previousMonth)}`;
      tone = kpi.downIsGood ? 'text-danger-fg' : 'text-success-fg';
    } else {
      const change = Math.round(((kpi.current - kpi.previous) / Math.abs(kpi.previous)) * 100);
      const up = kpi.current > kpi.previous;
      text = change === 0 ? `igual que ${monthLong(previousMonth)}` : `${up ? '▲' : '▼'} ${Math.abs(change)} % vs ${monthShort(previousMonth)}`;
      tone = change === 0 ? 'text-muted' : up !== Boolean(kpi.downIsGood) ? 'text-success-fg' : 'text-danger-fg';
    }
  } else if (kpi.note && kpi.current !== null && kpi.previous !== null && kpi.previous > 0) {
    const change = Math.round(((kpi.current - kpi.previous) / kpi.previous) * 100);
    text = change === 0 ? `${kpi.note}: igual` : `${change > 0 ? '▲' : '▼'} ${Math.abs(change)} % · ${kpi.note}`;
    tone = change === 0 ? 'text-muted' : change > 0 ? 'text-success-fg' : 'text-danger-fg';
  }
  return (
    <div className="rounded-[22px] border border-line bg-surface px-[18px] py-4">
      <p className="text-[13px] text-muted">{kpi.label}</p>
      <p className="mt-1 text-[28px] leading-tight font-extrabold tracking-[-0.02em] text-ink">{kpi.value}</p>
      <p className={cn('mt-0.5 text-[13px] font-bold', tone)}>{text || ' '}</p>
    </div>
  );
}

function Table({ head, rows, label }: { head: string[]; rows: (string | number)[][]; label: string }) {
  const cols = `repeat(${head.length}, minmax(0, 1fr))`;
  const fmt = (value: string | number) => (typeof value === 'number' ? (Number.isInteger(value) ? int(value) : value.toLocaleString('de-DE', { maximumFractionDigits: 2 })) : value);
  return (
    <div role="table" aria-label={label} className="am-step-in mt-3.5 overflow-x-auto">
      <div className="min-w-[640px]">
        <div role="row" className="grid gap-2.5 border-b border-line py-2 font-mono text-[11.5px] font-medium text-muted uppercase" style={{ gridTemplateColumns: cols }}>
          {head.map(cell => (
            <span key={cell} role="columnheader">
              {cell}
            </span>
          ))}
        </div>
        {rows.map((row, i) => (
          <div key={i} role="row" className="grid gap-2.5 border-b border-line py-[9px] text-sm text-ink last:border-b-0" style={{ gridTemplateColumns: cols }}>
            {row.map((cell, j) => (
              <span key={j} role="cell" className="truncate">
                {fmt(cell)}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
