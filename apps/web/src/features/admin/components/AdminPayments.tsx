'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { initials } from '@/shared/lib/format';
import { PageSpinner } from '@/shared/ui/spinner';
import { useToast } from '@/shared/ui/toaster';
import { adminApi, adminKeys, type AdminPayment } from '../api';
import { usd } from '../copilot-engine';
import { PANEL_ICON, PanelIcon, PaymentPill, paymentConcept, Segmented, stamp, usePanelToast } from './panel-kit';
import { copyText } from '@/shared/lib/browser';

type View = 'review' | 'refunds' | 'all';
const TAB_PARAM: Record<View, string | null> = { review: null, refunds: 'reembolsos', all: 'todos' };

const nameOf = (p: AdminPayment) => (p.user.accountType === 'DEALER' && p.user.businessName ? p.user.businessName : p.user.name);
const when = (p: AdminPayment) => p.submittedAt ?? p.createdAt;

/**
 * Pagos Binance (diseño «admin-pagos»): el equipo comprueba en su app de Binance que llegó la
 * transacción (importe y referencia en la nota) y la confirma aquí; los reembolsos de pagos
 * manuales se envían desde Binance al Pay ID del comprador y aquí se registra el id de la transferencia.
 */
export function AdminPayments() {
  const params = useSearchParams();
  const router = useRouter();
  const view: View = params.get('tab') === 'reembolsos' ? 'refunds' : params.get('tab') === 'todos' ? 'all' : 'review';
  const queryClient = useQueryClient();
  const toast = useToast();
  const panelToast = usePanelToast();
  const payments = useQuery({ queryKey: adminKeys.payments(view), queryFn: () => adminApi.payments(view), refetchInterval: 60_000 });
  const counts = useQuery({ queryKey: adminKeys.paymentCounts, queryFn: adminApi.paymentCounts, refetchInterval: 60_000 });
  /** Decididos en esta visita: siguen en la lista con su estado nuevo hasta cambiar de filtro (como en el diseño). */
  const [decided, setDecided] = useState<Record<string, AdminPayment>>({});
  const [selectedId, setSelectedId] = useState<string | null>(params.get('pago'));
  const [note, setNote] = useState('');
  const [refundTx, setRefundTx] = useState('');
  const detail = useRef<HTMLElement>(null);

  const list = useMemo(() => {
    const rows = (payments.data ?? []).map(p => decided[p.id] ?? p);
    const extra = Object.values(decided).filter(p => !rows.some(row => row.id === p.id) && view !== 'all');
    return [...rows, ...extra].sort((a, b) => when(b).localeCompare(when(a)));
  }, [payments.data, decided, view]);
  const selected = list.find(p => p.id === selectedId) ?? list[0] ?? null;

  useEffect(() => {
    setNote('');
    setRefundTx('');
  }, [selected?.id]);

  const changeView = (next: View) => {
    setDecided({});
    setSelectedId(null);
    const tab = TAB_PARAM[next];
    router.replace(tab ? `/admin/pagos?tab=${tab}` : '/admin/pagos');
  };
  const choose = (id: string) => {
    setSelectedId(id);
    if (window.matchMedia('(max-width: 899px)').matches) requestAnimationFrame(() => detail.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const afterDecision = (payment: AdminPayment, status: AdminPayment['status'], message: string) => {
    setDecided(current => ({ ...current, [payment.id]: { ...payment, status, reviewNote: status === 'REJECTED' ? note.trim() : payment.reviewNote } }));
    void queryClient.invalidateQueries({ queryKey: adminKeys.paymentCounts });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'badge', 'payments'] });
    void queryClient.invalidateQueries({ queryKey: adminKeys.payments('all') });
    panelToast.show(message);
  };
  const review = useMutation({
    mutationFn: ({ payment, decision }: { payment: AdminPayment; decision: 'APPROVE' | 'REJECT' }) => adminApi.reviewPayment(payment.id, decision, note.trim() || undefined),
    onSuccess: (_r, { payment, decision }) =>
      decision === 'APPROVE'
        ? afterDecision(payment, 'PAID', payment.purpose === 'MEMBERSHIP' ? 'Pago aprobado. El plan ya está activo.' : payment.purpose === 'BOOST' ? 'Pago aprobado. El destacado ya tiene su turno.' : 'Pago aprobado.')
        : afterDecision(payment, 'REJECTED', 'Pago rechazado. Le avisamos al usuario.'),
    onError: err => toast({ tone: 'error', title: 'No se pudo completar', description: err.message }),
  });
  const refund = useMutation({
    mutationFn: (payment: AdminPayment) => adminApi.refundSent(payment.id, refundTx.trim()),
    onSuccess: (_r, payment) => afterDecision(payment, 'REFUNDED', 'Reembolso registrado. Le avisamos al usuario.'),
    onError: err => toast({ tone: 'error', title: 'No se pudo registrar', description: err.message }),
  });

  const reviewCount = counts.data?.review ?? 0;
  const refundCount = counts.data?.refunds ?? 0;

  return (
    <div data-own-header className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-[1_1_280px]">
          <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-ink">Pagos Binance</h1>
          <p className="mt-0.5 text-sm text-muted">Confirma en tu Binance que el dinero llegó antes de aprobar.</p>
        </div>
        <Segmented
          label="Filtrar pagos"
          value={view}
          onChange={changeView}
          options={[
            { value: 'review', label: 'Por verificar', count: reviewCount },
            { value: 'refunds', label: 'Reembolsos', count: refundCount },
            { value: 'all', label: 'Todos' },
          ]}
        />
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <section aria-label="Lista de pagos" className="min-w-0 flex-[3_1_460px] overflow-hidden rounded-[20px] border border-line bg-surface">
          <div className="grid grid-cols-[minmax(0,2.2fr)_minmax(0,2fr)_90px_110px] gap-3 border-b border-[#ECEEF1] px-5 py-3 font-mono text-[11px] text-[#666C77] dark:border-line dark:text-muted">
            <span>Usuario</span>
            <span>Concepto</span>
            <span className="text-right">Monto</span>
            <span>Estado</span>
          </div>
          {payments.isPending ? (
            <PageSpinner />
          ) : payments.isError ? (
            <p className="px-5 py-12 text-center text-sm text-danger-fg">{payments.error.message}</p>
          ) : list.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-base font-bold text-ink">No hay pagos aquí</p>
              <p className="mt-1 text-sm text-muted">Cuando llegue uno nuevo aparece arriba de la lista.</p>
            </div>
          ) : (
            list.map(p => {
              const active = p.id === selected?.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => choose(p.id)}
                  className={cn(
                    'grid w-full grid-cols-[minmax(0,2.2fr)_minmax(0,2fr)_90px_110px] items-center gap-3 border-b border-[#ECEEF1] px-5 py-3.5 text-left text-sm transition-colors duration-200 last:border-b-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand dark:border-line',
                    active ? 'bg-soft' : 'bg-surface hover:bg-tile',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span aria-hidden="true" className={cn('grid size-9 shrink-0 place-items-center rounded-full text-xs font-extrabold', active ? 'bg-mine text-on-mine' : 'bg-tile text-ink')}>
                      {initials(nameOf(p))}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-ink">{nameOf(p)}</span>
                      <span className="block font-mono text-[11.5px] text-muted">{stamp(when(p))}</span>
                    </span>
                  </span>
                  <span className="truncate text-[#3E444D] dark:text-ink/80">{paymentConcept(p)}</span>
                  <span className="text-right font-extrabold text-ink">{usd(Number(p.status === 'REFUND_PENDING' && p.refundDue ? p.refundDue : p.amount))}</span>
                  <span>
                    <PaymentPill status={p.status} />
                  </span>
                </button>
              );
            })
          )}
        </section>

        {selected && (
          <section ref={detail} aria-labelledby="pago-detalle" className="flex min-w-0 flex-[2_1_340px] scroll-mt-4 flex-col gap-4 rounded-[20px] border border-line bg-surface p-[22px]">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-mine text-[15px] font-extrabold text-on-mine">
                {initials(nameOf(selected))}
              </span>
              <div className="min-w-0">
                <h2 id="pago-detalle" className="truncate text-lg font-extrabold text-ink">
                  {nameOf(selected)}
                </h2>
                <p className={cn('mt-px text-[13px]', selected.user.isVerified ? 'text-muted' : 'font-semibold text-gold-fg')}>
                  {selected.user.accountType === 'DEALER' ? 'Concesionario' : 'Persona'} · {selected.user.isVerified ? 'identidad verificada' : 'identidad sin verificar'}
                </p>
              </div>
            </div>

            <div className="rounded-2xl bg-tile p-4">
              <p className="text-[13px] text-muted">{paymentConcept(selected)}</p>
              <p className="mt-0.5 flex items-baseline gap-2">
                <span className="text-4xl font-extrabold tracking-[-0.03em] text-ink">{usd(Number(selected.amount))}</span>
                <span className="font-mono text-[13px] font-medium text-muted">{selected.currency}</span>
              </p>
            </div>

            <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-sm">
              <dt className="text-muted">Método</dt>
              <dd className="font-semibold text-ink">{selected.mode === 'MERCHANT' ? 'Binance Pay' : 'Pay ID'}</dd>
              <dt className="text-muted">ID de orden</dt>
              <dd className="font-mono text-[13px] break-all text-ink">{selected.reference}</dd>
              <dt className="text-muted">Recibido</dt>
              <dd className="text-ink">{selected.submittedAt ? stamp(selected.submittedAt) : 'Todavía no envía el pago'}</dd>
              <dt className="text-muted">Correo</dt>
              <dd className="truncate text-ink">{selected.user.email}</dd>
              {selected.payerBinanceId && (
                <>
                  <dt className="text-muted">Pay ID del pagador</dt>
                  <dd className="font-mono text-[13px] break-all text-ink">{selected.payerBinanceId}</dd>
                </>
              )}
            </dl>

            <TransactionBox txId={selected.txId} reference={selected.reference} />

            {selected.status === 'SUBMITTED' && (
              <>
                <div>
                  <label htmlFor="pago-nota" className="block text-[13px] font-bold text-ink">
                    Nota (obligatoria si rechazas)
                  </label>
                  <textarea
                    id="pago-nota"
                    rows={2}
                    maxLength={500}
                    value={note}
                    onChange={event => setNote(event.target.value)}
                    placeholder="Ej.: el monto en Binance no coincide"
                    className="mt-1.5 w-full resize-y rounded-xl border border-edge bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-[#6A707B] focus:outline-2 focus:outline-offset-1 focus:outline-brand dark:placeholder:text-faint"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={review.isPending}
                    onClick={() => review.mutate({ payment: selected, decision: 'APPROVE' })}
                    className="inline-flex h-12 flex-[1_1_200px] items-center justify-center gap-2 rounded-full bg-brand text-[14.5px] font-bold text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    <PanelIcon d={PANEL_ICON.check} stroke={2.4} />
                    {review.isPending && review.variables?.decision === 'APPROVE' ? 'Confirmando…' : 'Confirmar: recibido en Binance'}
                  </button>
                  <button
                    type="button"
                    disabled={review.isPending || note.trim().length === 0}
                    title={note.trim().length === 0 ? 'Escribe la nota para el usuario' : undefined}
                    onClick={() => review.mutate({ payment: selected, decision: 'REJECT' })}
                    className="h-12 flex-[0_1_auto] rounded-full border border-danger bg-surface px-5 text-[14.5px] font-bold text-danger-fg disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {review.isPending && review.variables?.decision === 'REJECT' ? 'Rechazando…' : 'Rechazar'}
                  </button>
                </div>
              </>
            )}

            {selected.status === 'REFUND_PENDING' && selected.mode === 'MANUAL' && (
              <>
                <p className="rounded-[14px] bg-[#EEF2FF] px-3.5 py-3 text-sm text-[#3730A3] dark:bg-[rgb(99_102_241/0.16)] dark:text-[#C7D2FE]">
                  Envía {usd(Number(selected.refundDue ?? selected.amount))} USDT desde tu Binance{selected.payerBinanceId ? ` al Pay ID ${selected.payerBinanceId}` : ''} y anota aquí el ID de esa transferencia.
                  {selected.failureReason ? ` Motivo: ${selected.failureReason}` : ''}
                </p>
                <div>
                  <label htmlFor="pago-reembolso" className="block text-[13px] font-bold text-ink">
                    ID de la transferencia de reembolso
                  </label>
                  <input
                    id="pago-reembolso"
                    value={refundTx}
                    maxLength={100}
                    autoComplete="off"
                    onChange={event => setRefundTx(event.target.value)}
                    className="mt-1.5 h-11 w-full rounded-xl border border-edge bg-surface px-3 font-mono text-sm text-ink focus:outline-2 focus:outline-offset-1 focus:outline-brand"
                  />
                </div>
                <button
                  type="button"
                  disabled={refund.isPending || refundTx.trim().length < 6}
                  onClick={() => refund.mutate(selected)}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand text-[14.5px] font-bold text-white disabled:cursor-not-allowed disabled:bg-[#E7E9ED] disabled:text-[#666C77]"
                >
                  <PanelIcon d={PANEL_ICON.check} stroke={2.4} />
                  {refund.isPending ? 'Guardando…' : 'Marcar reembolso enviado'}
                </button>
              </>
            )}
            {selected.status === 'REFUND_PENDING' && selected.mode === 'MERCHANT' && (
              <p className="rounded-[14px] bg-[#EEF2FF] px-3.5 py-3 text-sm font-bold text-[#3730A3] dark:bg-[rgb(99_102_241/0.16)] dark:text-[#C7D2FE]">Binance Pay devuelve este pago solo; se reintenta cada pocos minutos.</p>
            )}

            <Result payment={selected} />
          </section>
        )}
      </div>
      {panelToast.node}
    </div>
  );
}

/** El servidor no guarda capturas: se muestra el ID de la transacción que mandó el usuario, para buscarlo en Binance. */
function TransactionBox({ txId, reference }: { txId: string | null; reference: string }) {
  const [copied, setCopied] = useState(false);
  const value = txId ?? reference;
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-dashed border-edge p-3">
      <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-tile text-[#3E444D] dark:text-ink/80">
        <PanelIcon d={PANEL_ICON.card} size={20} stroke={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-ink">{txId ? 'ID de transacción del usuario' : 'Referencia para la nota del pago'}</span>
        <span className="block truncate font-mono text-[12.5px] text-muted">{value}</span>
      </span>
      <button
        type="button"
        onClick={() => {
          void copyText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }).catch(() => setCopied(false));
        }}
        className="text-sm font-bold text-brand-fg"
      >
        {copied ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  );
}

function Result({ payment }: { payment: AdminPayment }) {
  const result =
    payment.status === 'PAID'
      ? ['bg-success-soft text-success-fg', payment.purpose === 'MEMBERSHIP' ? 'Aprobado. El usuario ya tiene su plan.' : payment.purpose === 'BOOST' ? 'Aprobado. El destacado ya tiene su turno.' : 'Aprobado. El pago quedó registrado.']
      : payment.status === 'REJECTED'
        ? ['bg-[#F1F2F4] text-muted dark:bg-white/8', `Rechazado. El usuario recibió tu nota.${payment.reviewNote ? ` «${payment.reviewNote}»` : ''}`]
        : payment.status === 'REFUNDED' || payment.status === 'PARTIALLY_REFUNDED'
          ? ['bg-[#EEF2FF] text-[#3730A3] dark:bg-[rgb(99_102_241/0.16)] dark:text-[#C7D2FE]', 'Reembolso enviado y registrado.']
          : payment.status === 'PENDING'
            ? ['bg-tile text-muted', 'El usuario todavía no envía el pago.']
            : payment.status === 'EXPIRED' || payment.status === 'CANCELLED' || payment.status === 'FAILED'
              ? ['bg-tile text-muted', 'Este cobro se cerró sin pago.']
              : null;
  if (!result) return null;
  return <p className={cn('flex gap-2 rounded-[14px] px-3.5 py-3 text-sm font-bold', result[0])}>{result[1]}</p>;
}
