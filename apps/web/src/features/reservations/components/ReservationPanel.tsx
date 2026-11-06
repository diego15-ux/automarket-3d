'use client';

import { RESERVATION_LEGAL_CLAUSES, RESERVED_VEHICLE_NOTICE, type VehicleDetailDTO } from '@automarket/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Clock, Lock, MessageCircle, Scale, ShieldAlert, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { formatDate, formatMoney, formatRemaining } from '@/shared/lib/format';
import { useSession } from '@/shared/lib/use-session';
import { Button, buttonClasses } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Dialog } from '@/shared/ui/dialog';
import { useToast } from '@/shared/ui/toaster';
import { useWatching } from '@/features/vehicles/compare';
import { reservationKeys, reservationsApi } from '../api';
import { ConfirmButton } from './ConfirmButton';
import { ContactCard } from './ContactCard';

/**
 * Reserva P2P: el comprador verificado acepta el aviso legal y solicita la reserva; el vendedor la
 * confirma y el vehículo queda bloqueado. El abono que fijó el vendedor se le paga directamente a
 * él (AutoMarket no lo cobra) y se descuenta del precio; si la venta no se concreta, lo devuelve íntegro.
 */
export function ReservationPanel({ vehicle, isOwner }: { vehicle: VehicleDetailDTO; isOwner: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const session = useSession();
  const [legalOpen, setLegalOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const watching = useWatching();
  const terms = useQuery({ queryKey: reservationKeys.terms, queryFn: reservationsApi.terms, staleTime: 5 * 60_000 });
  const mine = useQuery({ queryKey: reservationKeys.forVehicle(vehicle.id), queryFn: () => reservationsApi.forVehicle(vehicle.id), enabled: !isOwner });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: reservationKeys.all });
  const start = useMutation({
    mutationFn: () => reservationsApi.create(vehicle.id),
    onSuccess: () => {
      setLegalOpen(false);
      refresh();
      toast({ tone: 'success', title: 'Solicitud de reserva enviada', description: 'El vendedor tiene que confirmarla. Te avisaremos.' });
    },
    onError: err => toast({ tone: 'error', title: 'No se pudo reservar', description: err.message }),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => reservationsApi.cancel(id),
    onSuccess: () => {
      refresh();
      toast({ tone: 'success', title: 'Reserva cancelada' });
    },
    onError: err => toast({ tone: 'error', title: 'No se pudo cancelar', description: err.message }),
  });

  if (isOwner) {
    return (
      <Card id="reservar" className="rounded-[24px] p-5">
        <p className="font-semibold">Es tu anuncio</p>
        <p className="mt-1 text-sm text-muted">
          {vehicle.reservationAmount ? `Abono de reserva: ${formatMoney(vehicle.reservationAmount, vehicle.currency)} (te lo pagan directamente a ti).` : 'Fija el abono de reserva en el anuncio para recibir reservas.'} Las solicitudes llegan a tu panel de ventas.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/cuenta/anuncios/${vehicle.id}`} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
            Editar anuncio
          </Link>
          <Link href="/cuenta/reservas?tab=ventas" className={buttonClasses({ size: 'sm' })}>
            Ver solicitudes
          </Link>
        </div>
      </Card>
    );
  }

  const user = session.status === 'authenticated' ? session.user : null;
  const reservation = mine.data;
  const deposit = vehicle.reservationAmount;
  const holdDays = terms.data?.reservationHoldDays ?? 7;
  // Diseño de la ficha: si se puede reservar, tarjeta verde suave sin borde; si no, tarjeta blanca.
  const open = !reservation?.status && vehicle.status === 'PUBLISHED';

  return (
    <Card id="reservar" className={open ? 'scroll-mt-24 rounded-[24px] border-0 bg-soft p-5' : 'scroll-mt-24 rounded-[24px] p-5'}>
      <div className="flex items-center gap-2">
        {!open && <CalendarCheck className="size-5 text-brand-fg" />}
        <h2 className="text-[17px] font-extrabold">{open && deposit ? `Reserva con abono de ${formatMoney(deposit, vehicle.currency)}` : 'Reserva con abono'}</h2>
      </div>

      {reservation?.status === 'ACCEPTED' ? (
        <div className="mt-4 space-y-3">
          <p className="flex items-center gap-2 rounded-md bg-success/10 px-4 py-3 text-sm text-success-fg">
            <Lock className="size-4 shrink-0" /> ¡Reserva confirmada! El vehículo está reservado para ti{reservation.expiresAt ? ` hasta el ${formatDate(reservation.expiresAt)}` : ''}.
          </p>
          <p className="text-sm">
            Paga el abono de <strong>{formatMoney(reservation.depositAmount ?? 0, reservation.currency)}</strong> directamente al vendedor y coordina la visita por el chat directo.
          </p>
          {reservation.contact && <ContactCard contact={reservation.contact} />}
          <div className="flex flex-wrap gap-2">
            <Link href="/mensajes" className={buttonClasses({ size: 'sm' })}>
              <MessageCircle className="size-4" /> Chat directo
            </Link>
            <ConfirmButton variant="danger" size="sm" loading={cancel.isPending} confirmLabel="Confirmar: el vendedor debe devolverte el abono" onConfirm={() => cancel.mutate(reservation.id)}>
              Cancelar reserva
            </ConfirmButton>
          </div>
        </div>
      ) : reservation?.status === 'AWAITING_SELLER' ? (
        <div className="mt-4 space-y-3">
          <p className="flex items-center gap-2 rounded-md bg-brand/[0.07] px-4 py-3 text-sm">
            <Clock className="size-4 shrink-0 text-brand-fg" /> Esperando la confirmación del vendedor{reservation.expiresAt ? ` (responde ${formatRemaining(reservation.expiresAt)})` : ''}.
          </p>
          <p className="text-xs text-muted">Todavía no pagas nada: cuando confirme, verás sus datos verificados para pagarle el abono directamente.</p>
          <ConfirmButton variant="outline" size="sm" loading={cancel.isPending} confirmLabel="Confirmar: retirar la solicitud" onConfirm={() => cancel.mutate(reservation.id)}>
            Retirar solicitud
          </ConfirmButton>
        </div>
      ) : reservation?.status === 'COMPLETED' ? (
        <p className="mt-4 rounded-md bg-success/10 px-4 py-3 text-sm text-success-fg">Compra concretada el {formatDate(reservation.completedAt ?? reservation.createdAt)}. ¡Disfrútalo!</p>
      ) : vehicle.status === 'RESERVED' ? (
        <div className="mt-4 space-y-3">
          <p className="flex items-start gap-2 rounded-[14px] bg-gold-soft px-4 py-3 text-sm text-[#5c3d00] dark:text-gold-fg">
            <Lock className="mt-0.5 size-4 shrink-0" /> {vehicle.inNegotiation ? 'En negociación: el dueño está cerrando la venta.' : 'Reservado: alguien pagó el abono.'} {RESERVED_VEHICLE_NOTICE}
          </p>
          {watching.signedIn && (
            <button
              type="button"
              aria-pressed={watching.isWatching(vehicle.id)}
              disabled={watching.busy}
              onClick={() => watching.toggle(vehicle.id)}
              className="h-12 w-full rounded-full border border-[#c9a35a] bg-surface text-[14.5px] font-bold text-[#5c3d00] disabled:opacity-60 dark:text-gold-fg"
            >
              {watching.isWatching(vehicle.id) ? 'Te avisamos si vuelve' : 'Avísame si vuelve'}
            </button>
          )}
        </div>
      ) : vehicle.status !== 'PUBLISHED' ? (
        <p className="mt-4 rounded-md bg-ink/5 px-4 py-3 text-sm text-muted">Este vehículo no admite reservas ahora mismo.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {deposit ? (
            <p className="text-sm leading-normal text-ink/80">Se lo pagas directo al vendedor cuando confirme. Se descuenta del precio, y si la venta no se da, te lo devuelve.</p>
          ) : (
            <p className="rounded-md bg-gold/[0.07] px-4 py-3 text-xs">El vendedor aún no fijó el abono de reserva. Escríbele por el chat.</p>
          )}
          {user && !user.isVerified && (
            <p className="flex items-start gap-2 rounded-md bg-gold/[0.07] px-4 py-3 text-xs">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-gold-fg" />
              <span>
                Para reservar debes verificar tu identidad (cédula, selfie y teléfono).{' '}
                <Link href="/cuenta/verificacion" className="font-semibold underline">
                  Verificarme
                </Link>
              </span>
            </p>
          )}
          {user && user.overdueCommissions > 0 && <p className="rounded-md bg-danger/10 px-4 py-3 text-xs text-danger-fg">Tienes comisiones vencidas: págalas para volver a reservar.</p>}
          {!vehicle.seller.isVerified && <p className="rounded-md bg-gold/[0.07] px-4 py-3 text-xs">El vendedor aún no verificó su identidad: todavía no puede recibir reservas.</p>}
          <Button
            className="h-[50px] w-full text-[15px] font-extrabold"
            disabled={!deposit || !vehicle.seller.isVerified || !user?.isVerified || (user?.overdueCommissions ?? 0) > 0}
            onClick={() => {
              setAccepted(false);
              setLegalOpen(true);
            }}
          >
            Reservar este auto
          </Button>
          <p className="flex items-start gap-2 text-xs text-muted">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" /> El vendedor confirma en {terms.data?.sellerResponseHours ?? 48} h y la reserva dura {holdDays} {holdDays === 1 ? 'día' : 'días'}. Mientras tanto, nadie más puede reservarlo.
          </p>
        </div>
      )}

      <Dialog open={legalOpen} onClose={() => setLegalOpen(false)} title="Aviso legal antes de reservar">
        <div className="space-y-4 text-sm">
          <p className="flex items-center gap-2 text-muted">
            <Scale className="size-4 shrink-0" /> Lee y acepta estas condiciones (también están en los{' '}
            <a href="/terminos" target="_blank" rel="noreferrer" className="font-semibold text-brand-fg">
              Términos
            </a>
            ):
          </p>
          <ol className="list-decimal space-y-2 pl-5">
            {RESERVATION_LEGAL_CLAUSES.map(clause => (
              <li key={clause}>{clause}</li>
            ))}
          </ol>
          {deposit && (
            <p className="rounded-md bg-sunken px-4 py-3">
              Abono de esta reserva: <strong>{formatMoney(deposit, vehicle.currency)}</strong> · precio total {formatMoney(vehicle.price, vehicle.currency)}.
            </p>
          )}
          <label className="flex cursor-pointer items-start gap-2.5">
            <input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} className="mt-0.5 size-4 accent-brand" />
            <span>He leído el aviso legal y lo acepto.</span>
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setLegalOpen(false)}>
              Volver
            </Button>
            <Button disabled={!accepted} loading={start.isPending} onClick={() => start.mutate()}>
              Solicitar reserva
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}
