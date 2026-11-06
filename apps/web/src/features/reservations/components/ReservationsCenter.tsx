'use client';

import { COMMISSION_LEGAL_WARNING, PAYMENT_STATUS_LABELS, RESERVE_STATUS_LABELS, type PaymentMethod, type ReservationDTO, type ReserveStatus } from '@automarket/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, MessageCircle, Star } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { formatDate, formatMoney, formatRemaining } from '@/shared/lib/format';
import { Avatar } from '@/shared/ui/avatar';
import { Badge } from '@/shared/ui/badge';
import { Button, buttonClasses } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/card';
import { Input } from '@/shared/ui/field';
import { MediaImage } from '@/shared/ui/media-image';
import { PageSpinner } from '@/shared/ui/spinner';
import { useToast } from '@/shared/ui/toaster';
import { reservationKeys, reservationsApi } from '../api';
import { CommissionCheckoutDialog } from '@/features/payments/components/CommissionCheckoutDialog';
import { ConfirmButton } from './ConfirmButton';
import { ContactCard } from './ContactCard';

const TONE: Record<ReserveStatus, 'neutral' | 'brand' | 'gold' | 'success' | 'danger'> = {
  ACTIVE: 'neutral',
  AWAITING_SELLER: 'gold',
  ACCEPTED: 'success',
  COMPLETED: 'brand',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
};

type Action = 'accept' | 'reject' | 'cancel' | 'complete';

/**
 * Compras (como comprador) y Ventas (como vendedor): un mismo usuario hace ambas cosas.
 * Reservas P2P: el abono se paga directamente al vendedor; la plataforma cobra con Binance
 * solo la comisión post-venta cuando el vendedor marca la venta como concretada.
 */
export function ReservationsCenter() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = params.get('tab') === 'ventas' ? 'seller' : 'buyer';
  const queryClient = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: reservationKeys.list(tab), queryFn: () => reservationsApi.list(tab) });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saleForCheckout, setSaleForCheckout] = useState<ReservationDTO | null>(null);

  const act = useMutation({
    mutationFn: ({ action, id, salePrice }: { action: Action; id: string; salePrice?: string }) =>
      action === 'accept' ? reservationsApi.accept(id, notes[id]) : action === 'reject' ? reservationsApi.reject(id, notes[id]) : action === 'cancel' ? reservationsApi.cancel(id, notes[id]) : reservationsApi.complete(id, salePrice!),
    onSuccess: (reservation, { action }) => {
      void queryClient.invalidateQueries({ queryKey: reservationKeys.all });
      if (action === 'complete') setSaleForCheckout(null);
      const messages: Record<Action, string> = {
        accept: 'Reserva confirmada: el vehículo queda reservado para este comprador.',
        reject: 'Solicitud rechazada.',
        cancel: 'Reserva cancelada: el vehículo vuelve a estar disponible.',
        complete: 'Venta concretada. ¡Enhorabuena! Paga la comisión con Binance en el plazo.',
      };
      toast({ tone: 'success', title: messages[action], description: `${reservation.vehicle.make} ${reservation.vehicle.model}` });
    },
    onError: err => {
      void queryClient.invalidateQueries({ queryKey: reservationKeys.all });
      toast({ tone: 'error', title: 'No se pudo completar la acción', description: err.message });
    },
  });
  const payCommission = useMutation({
    mutationFn: ({ id, input }: { id: string; input: { salePrice: string; method?: PaymentMethod } }) => reservationsApi.payCommission(id, input),
    onSuccess: payment => {
      setSaleForCheckout(null);
      router.push(`/pagos/${payment.id}`);
    },
    onError: err => toast({ tone: 'error', title: 'No se pudo iniciar el pago', description: err.message }),
  });
  const rateSeller = useMutation({
    mutationFn: ({ id, rating }: { id: string; rating: number }) => reservationsApi.rateSeller(id, rating),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: reservationKeys.all });
      toast({ tone: 'success', title: 'Valoración guardada', description: 'Gracias por recomendar al vendedor.' });
    },
    onError: err => toast({ tone: 'error', title: 'No se pudo guardar la valoración', description: err.message }),
  });

  const busy = (id: string, action: Action) => act.isPending && act.variables?.id === id && act.variables.action === action;

  return (
    <div>
      <div role="tablist" className="mb-6 scrollbar-none flex gap-6 overflow-x-auto border-b border-line text-sm">
        {[
          ['buyer', 'Compras', ''],
          ['seller', 'Ventas', '?tab=ventas'],
        ].map(([value, label, href]) => (
          <button key={value} role="tab" aria-selected={tab === value} onClick={() => router.replace(`${pathname}${href}`)} className={cn('-mb-px shrink-0 border-b-2 py-2.5 whitespace-nowrap transition-colors', tab === value ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink')}>
            {label}
          </button>
        ))}
      </div>

      {list.isPending ? (
        <PageSpinner />
      ) : list.isError ? (
        <EmptyState title="No pudimos cargar las reservas" description={list.error.message} />
      ) : list.data.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck className="size-6" />}
          title={tab === 'buyer' ? 'Aún no has reservado ningún vehículo' : 'Aún no tienes solicitudes de reserva'}
          description={tab === 'buyer' ? 'Reserva desde la ficha de cualquier vehículo: el abono se lo pagas directamente al vendedor.' : 'Cuando un comprador verificado solicite una reserva, podrás confirmarla o rechazarla aquí.'}
        />
      ) : (
        <ul className="space-y-4">
          {list.data.map((r: ReservationDTO) => {
            const counterpart = tab === 'buyer' ? r.seller : r.buyer;
            const commissionDue = tab === 'seller' && r.status === 'COMPLETED' && Number(r.commissionAmount ?? 0) > 0 && !r.commissionPaidAt;
            const overdue = commissionDue && r.commissionDueAt !== null && new Date(r.commissionDueAt) < new Date();
            return (
              <li key={r.id} className="flex flex-col gap-4 rounded-md border border-line bg-surface p-4 sm:flex-row">
                <Link href={`/vehiculos/${r.vehicle.slug}`} className="relative aspect-[16/10] w-full shrink-0 overflow-hidden rounded-md bg-sunken sm:w-48">
                  {r.vehicle.coverUrl && <MediaImage src={r.vehicle.coverUrl} alt="" fill sizes="192px" className="object-cover" />}
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/vehiculos/${r.vehicle.slug}`} className="font-display text-lg hover:underline">
                      {r.vehicle.make} {r.vehicle.model} {r.vehicle.year}
                    </Link>
                    <Badge tone={TONE[r.status]}>{RESERVE_STATUS_LABELS[r.status]}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    Precio {formatMoney(r.vehicle.price, r.vehicle.currency)} · Abono (pago directo al vendedor) <strong className="text-ink">{formatMoney(r.depositAmount ?? 0, r.currency)}</strong>
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <Avatar name={counterpart.name} src={counterpart.avatarUrl} className="size-6" />
                    {tab === 'buyer' ? 'Vendedor' : 'Comprador'}: <Link href={`/vendedores/${counterpart.id}`} className="font-medium hover:underline">{counterpart.name}</Link> · {formatDate(r.createdAt)}
                    {r.expiresAt && r.status === 'AWAITING_SELLER' && <> · responder {formatRemaining(r.expiresAt)}</>}
                    {r.expiresAt && r.status === 'ACCEPTED' && <> · reservado hasta el {formatDate(r.expiresAt)}</>}
                  </div>
                  {r.decisionNote && <p className="mt-2 text-xs text-muted">Nota: «{r.decisionNote}»</p>}
                  {r.contact && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,22rem)_auto] sm:items-start">
                      <ContactCard contact={r.contact} />
                      <Link href="/mensajes" className={buttonClasses({ size: 'sm', variant: 'outline' })}>
                        <MessageCircle className="size-4" /> Chat directo
                      </Link>
                    </div>
                  )}

                  {tab === 'buyer' && r.status === 'COMPLETED' && (
                    <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{r.sellerReviewRating ? 'Tu valoración:' : 'Recomienda al vendedor:'}</span>
                      <div className="flex" role="radiogroup" aria-label="Valorar al vendedor">
                        {[1, 2, 3, 4, 5].map(rating => (
                          <button
                            key={rating}
                            type="button"
                            role="radio"
                            aria-checked={r.sellerReviewRating === rating}
                            aria-label={`${rating} estrellas`}
                            disabled={rateSeller.isPending}
                            onClick={() => rateSeller.mutate({ id: r.id, rating })}
                            className="p-0.5 disabled:opacity-50"
                          >
                            <Star className={cn('size-5', rating <= (r.sellerReviewRating ?? 0) ? 'fill-gold text-gold' : 'text-muted')} />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {tab === 'seller' && r.status === 'COMPLETED' && Number(r.commissionAmount ?? 0) > 0 && (
                    <div className={cn('mt-4 rounded-md border p-4 text-sm', r.commissionPaidAt ? 'border-success/30 bg-success/5' : overdue ? 'border-danger/40 bg-danger/5' : 'border-gold/35 bg-gold/[0.07]')}>
                      <p className="font-semibold">
                        Comisión post-venta: {formatMoney(r.commissionAmount ?? 0, r.currency)}{' '}
                        <span className="font-normal text-muted">
                          ({((r.commissionRate ?? 0) * 100).toLocaleString('es', { maximumFractionDigits: 2 })} % de {formatMoney(r.salePrice ?? r.vehicle.price, r.currency)})
                        </span>
                      </p>
                      {r.commissionPaidAt ? (
                        <p className="mt-1 text-success-fg">Pagada el {formatDate(r.commissionPaidAt)}. ¡Gracias!</p>
                      ) : (
                        <>
                          <p className={cn('mt-1', overdue ? 'font-semibold text-danger-fg' : 'text-muted')}>
                            {overdue ? 'Vencida: tu cuenta no puede publicar ni reservar hasta pagarla.' : `Paga con Binance antes del ${r.commissionDueAt ? formatDate(r.commissionDueAt) : '—'}.`}
                          </p>
                          <p className="mt-2 text-xs text-muted">{COMMISSION_LEGAL_WARNING}</p>
                          {r.payment && (
                            <p className="mt-2 text-xs">
                              <Link href={`/pagos/${r.payment.id}`} className="font-semibold text-brand-fg hover:underline">
                                Último pago: {PAYMENT_STATUS_LABELS[r.payment.status]}
                              </Link>
                            </p>
                          )}
                          {r.payment?.status !== 'SUBMITTED' && (
                            <Button size="sm" className="mt-3" onClick={() => setSaleForCheckout(r)}>
                              Pagar comisión con Binance
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {(r.status === 'AWAITING_SELLER' || r.status === 'ACCEPTED') && (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Input value={notes[r.id] ?? ''} onChange={event => setNotes(prev => ({ ...prev, [r.id]: event.target.value }))} placeholder="Mensaje opcional" maxLength={500} className="h-9 max-w-64 text-xs" aria-label="Mensaje opcional" />
                      {tab === 'seller' && r.status === 'AWAITING_SELLER' && (
                        <>
                          <ConfirmButton size="sm" loading={busy(r.id, 'accept')} confirmLabel="Confirmar: reservar para este comprador" onConfirm={() => act.mutate({ action: 'accept', id: r.id })}>
                            Confirmar reserva
                          </ConfirmButton>
                          <ConfirmButton size="sm" variant="outline" loading={busy(r.id, 'reject')} onConfirm={() => act.mutate({ action: 'reject', id: r.id })}>
                            Rechazar
                          </ConfirmButton>
                        </>
                      )}
                      {tab === 'seller' && r.status === 'ACCEPTED' && (
                        <Button size="sm" variant="gold" onClick={() => setSaleForCheckout(r)}>
                          Marcar vendido
                        </Button>
                      )}
                      {(tab === 'buyer' || r.status === 'ACCEPTED') && (
                        <ConfirmButton
                          size="sm"
                          variant="danger"
                          loading={busy(r.id, 'cancel')}
                          confirmLabel={r.status === 'ACCEPTED' ? (tab === 'seller' ? 'Confirmar: devolveré el abono' : 'Confirmar: el vendedor me devuelve el abono') : 'Confirmar: retirar la solicitud'}
                          onConfirm={() => act.mutate({ action: 'cancel', id: r.id })}
                        >
                          {r.status === 'ACCEPTED' ? 'Cancelar reserva' : 'Retirar solicitud'}
                        </ConfirmButton>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {tab === 'seller' && (
        <p className="mt-6 text-xs text-muted">
          Al confirmar una solicitud, el vehículo queda reservado y el resto de solicitudes se rechazan. El abono te lo paga el comprador directamente; si la venta no se concreta, debes devolverlo íntegro. El anuncio solo finaliza cuando Binance confirma la comisión o un administrador aprueba la referencia.
        </p>
      )}
      <CommissionCheckoutDialog
        open={saleForCheckout !== null}
        onClose={() => setSaleForCheckout(null)}
        vehicleTitle={saleForCheckout ? `${saleForCheckout.vehicle.make} ${saleForCheckout.vehicle.model} ${saleForCheckout.vehicle.year}` : ''}
        initialPrice={saleForCheckout?.salePrice ?? saleForCheckout?.vehicle.price ?? ''}
        currency={saleForCheckout?.currency ?? 'USD'}
        commissionRate={saleForCheckout?.commissionRate ?? 0}
        fixedCommission={saleForCheckout?.status === 'COMPLETED' ? saleForCheckout.commissionAmount : null}
        priceEditable={saleForCheckout?.status !== 'COMPLETED'}
        loading={payCommission.isPending || (act.isPending && act.variables?.action === 'complete')}
        onSubmit={input => {
          if (!saleForCheckout) return;
          if (input.method) payCommission.mutate({ id: saleForCheckout.id, input });
          else act.mutate({ action: 'complete', id: saleForCheckout.id, salePrice: input.salePrice });
        }}
      />
      {list.data && <Button variant="ghost" size="sm" className="mt-2" onClick={() => void list.refetch()}>Actualizar</Button>}
    </div>
  );
}
