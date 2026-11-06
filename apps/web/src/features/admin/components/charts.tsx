'use client';

import type { AdminMetricsDTO } from '@automarket/contracts';
import { PLAN_LABELS, type PlanCode } from '@automarket/contracts';
import { useState, useSyncExternalStore } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatNumber, formatPrice } from '@/shared/lib/format';

/**
 * Dos series con el sistema editorial: latón para membresías y verde carreras para comisiones.
 * Ambas superan 4,5:1 contra la superficie de su tema (#fafaf6 claro, #181b1f oscuro).
 * Orden fijo, nunca ciclado; leyenda siempre visible + vista de tabla.
 */
const SERIES = {
  light: { membership: '#8a6a22', commission: '#1f5a42', grid: '#d8d9d1', axis: '#5e655f', surface: '#fafaf6' },
  dark: { membership: '#d4b26a', commission: '#7fc2a0', grid: '#27302b', axis: '#9aa39c', surface: '#181b1f' },
};

const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
};
/** El tema elige pasos distintos de las mismas rampas (no se invierte automáticamente). */
function usePalette() {
  const dark = useSyncExternalStore(subscribe, () => document.documentElement.classList.contains('dark'), () => false);
  return dark ? SERIES.dark : SERIES.light;
}

const LABELS = { membership: 'Membresías', commission: 'Comisiones post-venta' } as const;
type SeriesKey = keyof typeof LABELS;
const KEYS: SeriesKey[] = ['membership', 'commission'];

const monthLabel = (month: string) => new Intl.DateTimeFormat('es', { month: 'short', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`)).replace('.', '');
const compactMoney = (value: number) => (value >= 1000 ? `$${(value / 1000).toLocaleString('es', { maximumFractionDigits: 1 })}k` : `$${value.toLocaleString('es')}`);

interface TooltipItem {
  dataKey?: unknown;
  value?: unknown;
  color?: string;
}

function RevenueTooltip({ active, payload, label }: { active?: boolean; payload?: ReadonlyArray<TooltipItem>; label?: unknown }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((sum, item) => sum + Number(item.value ?? 0), 0);
  return (
    <div className="rounded-sm border border-line bg-surface px-3 py-2 text-xs">
      <p className="mb-1 font-semibold">{monthLabel(String(label))}</p>
      {[...payload].reverse().map(item => (
        <p key={String(item.dataKey)} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted">
            <span className="size-2 rounded-full" style={{ background: item.color }} />
            {LABELS[item.dataKey as SeriesKey]}
          </span>
          <span className="font-semibold tabular-nums">{formatPrice(Number(item.value ?? 0))}</span>
        </p>
      ))}
      <p className="mt-1 flex justify-between gap-4 border-t border-line pt-1 font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{formatPrice(total)}</span>
      </p>
    </div>
  );
}

/** Ingresos por mes y origen (barras apiladas: la suma es el ingreso total del mes). */
export function RevenueChart({ data }: { data: AdminMetricsDTO['monthly'] }) {
  const palette = usePalette();
  const [table, setTable] = useState(false);
  const hasData = data.some(row => row.membership + row.commission > 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs" aria-label="Leyenda">
        {KEYS.map(key => (
          <span key={key} className="flex items-center gap-1.5 text-muted">
            <span className="size-2.5 rounded-sm" style={{ background: palette[key] }} aria-hidden />
            {LABELS[key]}
          </span>
        ))}
        <button type="button" onClick={() => setTable(value => !value)} className="ml-auto font-semibold text-brand-fg hover:underline">
          {table ? 'Ver gráfico' : 'Ver tabla'}
        </button>
      </div>
      {table ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-left text-xs">
            <thead className="text-muted">
              <tr>
                <th className="py-2 font-semibold">Mes</th>
                {KEYS.map(key => (
                  <th key={key} className="py-2 text-right font-semibold">
                    {LABELS[key]}
                  </th>
                ))}
                <th className="py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {data.map(row => (
                <tr key={row.month} className="border-t border-line">
                  <td className="py-2">{row.month}</td>
                  {KEYS.map(key => (
                    <td key={key} className="py-2 text-right">
                      {formatPrice(row[key])}
                    </td>
                  ))}
                  <td className="py-2 text-right font-semibold">{formatPrice(row.membership + row.commission)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative h-72" role="img" aria-label="Ingresos mensuales por origen en los últimos 12 meses">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
              <CartesianGrid vertical={false} stroke={palette.grid} strokeWidth={1} />
              <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={{ stroke: palette.grid }} tick={{ fill: palette.axis, fontSize: 11 }} />
              <YAxis tickFormatter={compactMoney} tickLine={false} axisLine={false} tick={{ fill: palette.axis, fontSize: 11 }} width={52} allowDecimals={false} />
              <Tooltip content={props => <RevenueTooltip active={props.active} payload={props.payload as ReadonlyArray<TooltipItem> | undefined} label={props.label} />} cursor={{ fill: palette.grid, fillOpacity: 0.45 }} />
              {KEYS.map((key, index) => (
                <Bar
                  key={key}
                  dataKey={key}
                  stackId="revenue"
                  fill={palette[key]}
                  // 2 px de superficie entre segmentos y extremo superior redondeado (4 px).
                  stroke={palette.surface}
                  strokeWidth={2}
                  radius={index === KEYS.length - 1 ? [4, 4, 0, 0] : 0}
                  maxBarSize={36}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
          {!hasData && <p className="absolute inset-0 grid place-items-center text-sm text-muted">Sin ingresos registrados todavía.</p>}
        </div>
      )}
    </div>
  );
}

/** Usuarios por plan efectivo: una sola serie (magnitud), sin leyenda; el título la nombra. */
export function PlansChart({ data }: { data: AdminMetricsDTO['plans'] }) {
  const palette = usePalette();
  const order: PlanCode[] = ['FREE', 'PREMIUM', 'DEALER_BASIC', 'DEALER_PRO'];
  const rows = order.map(code => ({ code, label: PLAN_LABELS[code], users: data.find(item => item.code === code)?.users ?? 0 }));
  const max = Math.max(1, ...rows.map(row => row.users));

  return (
    <ul className="space-y-3" aria-label="Usuarios por plan">
      {rows.map(row => (
        <li key={row.code} className="grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-3 text-sm" title={`${row.label}: ${formatNumber(row.users)} usuarios`}>
          <span className="text-muted">{row.label}</span>
          <span className="h-3 overflow-hidden rounded-r-sm bg-transparent">
            <span className="block h-full rounded-r-[4px]" style={{ width: `${(row.users / max) * 100}%`, minWidth: row.users ? 4 : 0, background: palette.membership }} />
          </span>
          <span className="text-right font-semibold tabular-nums">{formatNumber(row.users)}</span>
        </li>
      ))}
    </ul>
  );
}
