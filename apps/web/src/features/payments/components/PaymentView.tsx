'use client';

import { BOOST_LABELS, PAYMENT_STATUS_LABELS, PLAN_LABELS, PaymentSubmitSchema, type PaymentDTO } from '@automarket/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, CircleCheck, Clock, Copy, ExternalLink, ShieldCheck, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { authApi } from '@/features/auth/api';
import { reservationKeys } from '@/features/reservations/api';
import { vehicleKeys } from '@/features/vehicles/api';
import { ApiError } from '@/shared/lib/http';
import { formatDate, formatRemaining } from '@/shared/lib/format';
import { Badge } from '@/shared/ui/badge';
import { Button, buttonClasses } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Field, Input } from '@/shared/ui/field';
import { PageSpinner } from '@/shared/ui/spinner';
import { useToast } from '@/shared/ui/toaster';
import { isWaiting, paymentKeys, paymentsApi } from '../api';
import { copyText } from '@/shared/lib/browser';

function CopyValue({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-sunken px-4 py-3">
      <div className="min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <p className={`truncate font-mono font-bold ${big ? 'text-xl' : 'text-sm'}`}>{value}</p>
      </div>
      <button
        type="button"
        aria-label={`Copiar ${label.toLowerCase()}`}
        onClick={() => {
          void copyText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }).catch(() => setCopied(false));
        }}
        className="grid size-9 shrink-0 place-items-center rounded-full border border-line hover:border-ink/30"
      >
        {copied ? <Check className="size-4 text-success-fg" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}

const what = (p: PaymentDTO) =>
  p.plan
    ? `Plan ${PLAN_LABELS[p.plan.code]} (${p.plan.cycle === 'MONTHLY' ? 'mensual' : 'anual'})`
    : p.vehicleSale
      ? `Comisión por venta · ${p.vehicleSale.vehicleTitle}`
      : p.reservation
        ? `Comisión post-venta · ${p.reservation.vehicleTitle}`
        : p.boost
          ? `${BOOST_LABELS[p.boost.kind]} · ${p.boost.vehicleTitle}`
          : 'Pago';

function StatusPanel({ payment }: { payment: PaymentDTO }) {
  const done = (icon: ReactNode, title: string, text: ReactNode, actions?: ReactNode) => (
    <div className="text-center">
      <div className="mx-auto grid place-items-center text-muted">{icon}</div>
      <p className="mt-4 font-display text-xl">{title}</p>
      <div className="mt-2 text-sm text-muted">{text}</div>
      {actions && <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
  const next = payment.plan ? (
    <Link href="/cuenta/plan" className={buttonClasses()}>
      Ver mi plan
    </Link>
  ) : payment.vehicleSale || payment.boost ? (
    <Link href="/cuenta/anuncios" className={buttonClasses()}>
      Ver mis anuncios
    </Link>
  ) : (
    <Link href="/cuenta/reservas?tab=ventas" className={buttonClasses()}>
      Ver mis ventas
    </Link>
  );

  switch (payment.status) {
    case 'PAID':
      return done(
        <CircleCheck className="size-7 text-success-fg" />,
        'Pago confirmado',
        payment.plan
          ? 'Tu plan ya está activo.'
          : payment.boost
            ? `Tu impulso para ${payment.boost.vehicleTitle} ya quedó confirmado. Te avisamos en tus notificaciones cuándo sale.`
            : payment.purpose === 'COMMISSION'
            ? 'La comisión fue aprobada. La venta ya quedó finalizada.'
            : 'El vendedor ya tiene tu solicitud: si la acepta, el vehículo queda bloqueado para ti; si no, te devolvemos el depósito.',
        next,
      );
    case 'SUBMITTED':
      return done(
        <Clock className="size-7 text-gold-fg" />,
        'Pago en verificación',
        payment.purpose === 'COMMISSION'
          ? `Recibimos tu comprobante (transacción ${payment.txId}). Un administrador lo busca en Binance y la venta se cierra cuando lo apruebe. Mientras lo revisamos no aplicamos ninguna sanción.`
          : payment.purpose === 'BOOST' && payment.boost
            ? `Recibimos tu comprobante (transacción ${payment.txId}). ${payment.boost.vehicleTitle} todavía no está destacado: el impulso empieza cuando el equipo confirme el pago en Binance. Te avisamos.`
            : `Recibimos tu comprobante (transacción ${payment.txId}). El equipo lo verifica en Binance y te avisaremos en cuanto se confirme.`,
        next,
      );
    case 'REJECTED':
      return done(
        <CircleAlert className="size-7 text-danger-fg" />,
        'No pudimos verificar el pago',
        payment.reviewNote ?? (
          payment.vehicleSale
            ? 'El comprobante no coincide. La venta no se finalizó; vuelve a registrar la venta y paga la comisión.'
            : payment.purpose === 'COMMISSION'
              ? 'El comprobante no coincide. La comisión sigue pendiente; intenta pagar de nuevo.'
              : 'El comprobante no coincide con un pago recibido.'
        ),
        next,
      );
    case 'REFUND_PENDING':
      return done(<Clock className="size-7 text-gold-fg" />, 'Reembolso en curso', `Te devolveremos ${payment.refundDue} ${payment.currency} por Binance.`, next);
    case 'REFUNDED':
    case 'PARTIALLY_REFUNDED':
      return done(<CircleCheck className="size-7 text-success-fg" />, PAYMENT_STATUS_LABELS[payment.status], `Devolvimos ${payment.refundedAmount} ${payment.currency} por Binance.`, next);
    default:
      return done(<CircleAlert className="size-7 text-muted" />, PAYMENT_STATUS_LABELS[payment.status], 'Este pago ya no está activo; no se realizó ningún cargo.', next);
  }
}

/** Formulario del modo manual: id de la transacción (y Pay ID del pagador en depósitos). */
function SubmitProof({ payment }: { payment: PaymentDTO }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string>();
  const needsPayer = payment.purpose === 'RESERVATION';
  const submit = useMutation({
    mutationFn: (input: { txId: string; payerBinanceId?: string }) => paymentsApi.submit(payment.id, input),
    onSuccess: data => queryClient.setQueryData(paymentKeys.detail(payment.id), data),
    onError: err => setError(err instanceof ApiError ? err.message : 'No se pudo enviar.'),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = PaymentSubmitSchema.safeParse({ txId: data.get('txId'), payerBinanceId: String(data.get('payerBinanceId') ?? '') || undefined });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    if (needsPayer && !parsed.data.payerBinanceId) return setError('Indica tu Pay ID de Binance: ahí te devolveremos el depósito si la reserva no se concreta.');
    setError(undefined);
    submit.mutate(parsed.data);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-sm font-semibold">2. Cuando hayas pagado, envíanos el comprobante</p>
      <Field label="ID de la transacción en Binance" htmlFor="txId" hint="En Binance: Pay → Historial → abre el pago → «ID de orden».">
        <Input id="txId" name="txId" autoComplete="off" inputMode="numeric" placeholder="Ej. 312345678901234567" />
      </Field>
      {needsPayer && (
        <Field label="Tu Pay ID de Binance" htmlFor="payerBinanceId" hint="Para devolverte el depósito si el vendedor no acepta.">
          <Input id="payerBinanceId" name="payerBinanceId" inputMode="numeric" placeholder="Ej. 123456789" />
        </Field>
      )}
      {error && <p className="text-xs text-danger-fg">{error}</p>}
      <Button type="submit" className="w-full" loading={submit.isPending}>
        Ya pagué: enviar comprobante
      </Button>
    </form>
  );
}

/**
 * Página de un pago con Binance. Comercio: QR y enlace de Binance Pay; se confirma por webhook
 * (la página consulta cada 5 s). Manual: Pay ID + importe + referencia y envío del comprobante.
 */
export function PaymentView({ paymentId }: { paymentId: string }) {
  const params = useSearchParams();
  const toast = useToast();
  const queryClient = useQueryClient();
  const payment = useQuery({
    queryKey: paymentKeys.detail(paymentId),
    queryFn: () => paymentsApi.get(paymentId),
    refetchInterval: query => (query.state.data && isWaiting(query.state.data) ? 5_000 : false),
  });
  const cancel = useMutation({
    mutationFn: () => paymentsApi.cancel(paymentId),
    onSuccess: data => {
      queryClient.setQueryData(paymentKeys.detail(paymentId), data);
      toast({ title: 'Pago cancelado', description: 'No se realizó ningún cargo.' });
    },
  });

  // Al confirmarse un plan, la sesión refleja el plan nuevo (límites, banner).
  const wasPaid = useRef(false);
  useEffect(() => {
    if (payment.data?.status === 'PAID' && payment.data.plan && !wasPaid.current) {
      wasPaid.current = true;
      void authApi.reloadMe().catch(() => undefined);
    }
  }, [payment.data]);

  const refreshedSale = useRef<string | null>(null);
  useEffect(() => {
    const p = payment.data;
    if (!p || isWaiting(p) || refreshedSale.current === `${p.id}:${p.status}`) return;
    refreshedSale.current = `${p.id}:${p.status}`;
    if (p.vehicleSale) void queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
    if (p.reservation) void queryClient.invalidateQueries({ queryKey: reservationKeys.all });
  }, [payment.data, queryClient]);

  // Volvió desde Binance Pay con «cancelar».
  const cancelledFromBinance = params.get('cancelado') === '1';
  useEffect(() => {
    if (cancelledFromBinance && payment.data?.status === 'PENDING' && payment.data.mode === 'MERCHANT' && !cancel.isPending && !cancel.isSuccess) cancel.mutate();
  }, [cancelledFromBinance, payment.data, cancel]);

  if (payment.isPending) return <PageSpinner />;
  if (payment.isError) return <p className="text-danger-fg">{payment.error.message}</p>;
  const p = payment.data;

  return (
    <div className="mx-auto grid max-w-4xl gap-6 lg:grid-cols-[1fr_20rem]">
      <Card className="p-6 sm:p-8">
        {p.status !== 'PENDING' ? (
          <StatusPanel payment={p} />
        ) : p.mode === 'MERCHANT' && p.merchant ? (
          <div className="text-center">
            <p className="font-display text-xl">Paga con Binance Pay</p>
            <p className="mt-1 text-sm text-muted">Escanea el código con la app de Binance o abre el enlace. La confirmación es automática.</p>
            {p.merchant.qrcodeLink && <img src={p.merchant.qrcodeLink} alt="Código QR de Binance Pay" className="mx-auto mt-6 size-56 rounded-md bg-white p-2" />}
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {p.merchant.checkoutUrl && (
                <a href={p.merchant.checkoutUrl} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: 'gold' })}>
                  <ExternalLink className="size-4" /> Pagar en Binance Pay
                </a>
              )}
              {p.merchant.deeplink && (
                <a href={p.merchant.deeplink} className={buttonClasses({ variant: 'outline', className: 'sm:hidden' })}>
                  <Smartphone className="size-4" /> Abrir la app
                </a>
              )}
            </div>
            <p className="mt-6 flex items-center justify-center gap-2 text-xs text-muted">
              <Clock className="size-3.5" /> Esperando la confirmación de Binance… {p.expiresAt && `(caduca ${formatRemaining(p.expiresAt)})`}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <p className="font-display text-xl">Paga a nuestro Pay ID de Binance</p>
              <p className="mt-1 text-sm text-muted">En la app de Binance: Pay → Enviar → Pay ID. Envía el importe exacto y escribe la referencia en la nota.</p>
            </div>
            <p className="text-sm font-semibold">1. Envía el pago</p>
            {p.manual?.qrImageUrl && <img src={p.manual.qrImageUrl} alt="Código QR del Pay ID de Binance" className="size-44 rounded-md bg-white p-2" />}
            <div className="grid gap-2">
              <CopyValue label={`Pay ID${p.manual?.payName ? ` · ${p.manual.payName}` : ''}`} value={p.manual?.payId ?? '—'} big />
              <CopyValue label={`Importe exacto (${p.currency})`} value={p.amount} />
              <CopyValue label="Referencia (escríbela en la nota)" value={p.reference} />
            </div>
            <p className="flex items-start gap-2 rounded-sm border border-line bg-sunken/60 p-3 text-[13px] text-muted">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success-fg" aria-hidden />
              <span>
                Esta es la cuenta oficial de AutoMarket y solo la fija el administrador principal. Nadie del equipo te pedirá pagar a otra cuenta ni por chat: si pasa, no pagues y repórtalo.
              </span>
            </p>
            <SubmitProof payment={p} />
            {p.expiresAt && <p className="text-xs text-muted">Envía el comprobante antes del {formatDate(p.expiresAt)} ({formatRemaining(p.expiresAt)}).</p>}
          </div>
        )}
      </Card>

      <aside className="space-y-4">
        <Card className="p-5">
          <p className="text-xs text-muted">Concepto</p>
          <p className="mt-1 font-semibold">{what(p)}</p>
          <p className="mt-4 text-xs text-muted">Importe</p>
          <p className="font-display text-3xl">
            {p.amount} <span className="text-base text-muted">{p.currency}</span>
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge tone={p.status === 'PAID' ? 'success' : p.status === 'REJECTED' ? 'danger' : 'neutral'}>{PAYMENT_STATUS_LABELS[p.status]}</Badge>
            <Badge>{p.mode === 'MERCHANT' ? 'Binance Pay' : 'Pay ID'}</Badge>
          </div>
          <p className="mt-4 text-xs text-muted">Referencia {p.reference}</p>
        </Card>
        {p.status === 'PENDING' && (
          <Button variant="ghost" size="sm" className="w-full" loading={cancel.isPending} onClick={() => cancel.mutate()}>
            Cancelar este pago
          </Button>
        )}
        <p className="px-1 text-xs text-muted">Los pagos van a la cuenta de Binance de AutoMarket. 1 {p.currency} = 1 USD.</p>
      </aside>
    </div>
  );
}
