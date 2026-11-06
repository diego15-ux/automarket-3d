'use client';

import { BOOST_LABELS, PAYMENT_STATUS_LABELS, PLAN_LABELS, type PaymentDTO, type PaymentStatus } from '@automarket/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Piezas comunes de las pantallas del panel según los diseños (Resumen, Pagos Binance y KYC):
 * concepto de un pago, píldoras de estado, «hace …», filtro segmentado y el aviso abajo a la derecha.
 */

/** «Plan Premium · anual», «Comisión · Toyota Hilux 2022», «Pantalla de entrada · Kia Rio 2020 (3 días)». */
export function paymentConcept(p: Pick<PaymentDTO, 'purpose' | 'plan' | 'vehicleSale' | 'reservation' | 'boost'>): string {
  if (p.plan) return `Plan ${PLAN_LABELS[p.plan.code]} · ${p.plan.cycle === 'MONTHLY' ? 'mensual' : 'anual'}`;
  if (p.vehicleSale) return `Comisión · ${p.vehicleSale.vehicleTitle}`;
  if (p.reservation) return `Comisión · ${p.reservation.vehicleTitle}`;
  if (p.boost) {
    if (p.boost.kind === 'LOGIN') return `${BOOST_LABELS.LOGIN} · ${p.boost.vehicleTitle} (${p.boost.days === 1 ? '1 día' : `${p.boost.days} días`})`;
    return `${BOOST_LABELS[p.boost.kind]} · ${p.boost.vehicleTitle}`;
  }
  return p.purpose === 'COMMISSION' ? 'Comisión por venta' : p.purpose === 'MEMBERSHIP' ? 'Plan' : 'Pago';
}

const PAYMENT_PILL: Partial<Record<PaymentStatus, [string, string]>> = {
  SUBMITTED: ['Por verificar', 'bg-gold-soft text-gold-fg'],
  REFUND_PENDING: ['Por reembolsar', 'bg-[#EEF2FF] text-[#3730A3] dark:bg-[rgb(99_102_241/0.16)] dark:text-[#C7D2FE]'],
  PAID: ['Aprobado', 'bg-success-soft text-success-fg'],
  REJECTED: ['Rechazado', 'bg-[#F1F2F4] text-muted dark:bg-white/8'],
};
export const paymentStatusText = (status: PaymentStatus) => PAYMENT_PILL[status]?.[0] ?? PAYMENT_STATUS_LABELS[status];

export function PaymentPill({ status }: { status: PaymentStatus }) {
  const [label, tone] = PAYMENT_PILL[status] ?? [PAYMENT_STATUS_LABELS[status], 'bg-[#F1F2F4] text-muted dark:bg-white/8'];
  return <span className={cn('inline-flex h-[26px] items-center whitespace-nowrap rounded-full px-2.5 text-xs font-bold transition-colors duration-300', tone)}>{label}</span>;
}

/** «hace 12 min», «hace 3 h», «hace 2 días». */
export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'hace 1 día' : `hace ${days} días`;
}

/** «03 nov · 08:12» en hora de Venezuela. */
export function stamp(iso: string): string {
  const parts = new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Caracas' }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${get('day')} ${get('month').replace('.', '')} · ${get('hour')}:${get('minute')}`;
}

/** Filtro segmentado de los diseños (carril gris, botón elegido blanco con sombra). */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string; count?: number }>; onChange: (value: T) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-full bg-[#E7E9ED] p-1 dark:bg-sunken">
      {options.map(option => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-[38px] shrink-0 items-center gap-2 rounded-full px-4 text-[13.5px] font-bold transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
              active ? 'bg-surface text-ink shadow-[0_1px_3px_rgb(17_19_18/0.12)]' : 'text-muted hover:text-ink',
            )}
          >
            {option.label}
            {!!option.count && (
              <span className={cn('inline-grid h-5 min-w-5 place-items-center rounded-full px-1.5 font-mono text-[11px] font-medium', active ? 'bg-mine text-on-mine' : 'bg-[#D5D8D2] text-ink dark:bg-white/12')}>{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Aviso de los diseños: caja oscura abajo a la derecha con un visto menta; dura 2,6 s. */
export function usePanelToast() {
  const [message, setMessage] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = useCallback((text: string) => {
    clearTimeout(timer.current);
    setMessage(text);
    setVisible(true);
    timer.current = setTimeout(() => setVisible(false), 2600);
  }, []);
  const node = (
    <div role="status" aria-live="polite" className="pointer-events-none fixed right-6 bottom-6 z-50">
      <p
        className={cn(
          'flex items-center gap-2.5 rounded-2xl bg-[#15171a] px-[18px] py-3.5 text-sm font-semibold text-white shadow-[0_20px_40px_-20px_rgba(0,0,0,0.6)] transition-[transform,opacity] duration-[420ms,300ms] ease-[cubic-bezier(.2,.9,.25,1)] motion-reduce:transition-none dark:ring-1 dark:ring-white/10',
          visible ? 'translate-y-0 opacity-100' : 'translate-y-[140%] opacity-0',
        )}
      >
        <span aria-hidden="true" className="grid size-[22px] place-items-center rounded-full bg-brand text-on-brand">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
        {message}
      </p>
    </div>
  );
  return { show, node };
}

/** Iconos del menú del panel (trazos del diseño, viewBox 24). */
export const PANEL_ICON = {
  card: 'M3 6h18v12H3zM3 10h18M7 15h4',
  id: 'M3 5h18v14H3zM7 10a2 2 0 1 0 4 0 2 2 0 0 0-4 0M6 16c.6-1.6 2-2.5 3-2.5s2.4.9 3 2.5M14 9h4M14 13h4',
  flag: 'M5 21V4h11l-1.5 4L16 12H5',
  plus: 'M12 5v14M5 12h14',
  star: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  pct: 'M19 5 5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  image: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
} as const;

export function PanelIcon({ d, size = 17, stroke = 2, className }: { d: string; size?: number; stroke?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={d} />
    </svg>
  );
}
