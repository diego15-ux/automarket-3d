'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useId, useState, type ReactNode } from 'react';
import { useWatching } from '@/features/vehicles/compare';
import { cn } from '@/shared/lib/cn';
import { MediaImage } from '@/shared/ui/media-image';
import { useToast } from '@/shared/ui/toaster';
import { DEAL_PILL, DEAL_STEPS, PUBLIC_PILL, dealHelp, firstName, money, publicText, stepOf, vehicleName, watchersText, type DealAction, type DealController } from '../deal';

const MIN_SALE_PRICE = 300;

/** Botón del trato: primaria, fantasma o peligro; las de dos toques cambian el texto al armarse. */
export function DealButton({ controller, action, variant, children, small, onClick }: { controller: DealController; action: DealAction; variant: 'primary' | 'ghost' | 'danger'; children: ReactNode; small?: boolean; onClick?: () => void }) {
  const armed = controller.armed === action;
  const busy = controller.pending === action;
  return (
    <button
      type="button"
      disabled={controller.pending !== null}
      onClick={onClick ?? (() => controller.tap(action))}
      aria-live={armed ? 'polite' : undefined}
      className={cn(
        'rounded-full border font-bold transition-[background-color,color] duration-200 disabled:opacity-60',
        small ? 'min-h-[38px] px-3.5 text-[13px]' : 'min-h-[46px] w-full px-4 text-sm',
        variant === 'primary' && 'border-brand bg-brand text-on-brand',
        variant === 'ghost' && 'border-field-line bg-field text-ink',
        variant === 'danger' && (armed ? 'border-danger bg-danger text-white dark:text-[#06140d]' : 'border-danger bg-field text-danger-fg'),
      )}
    >
      {busy ? 'Un momento…' : armed ? (variant === 'danger' ? '¿Seguro? Toca otra vez' : '¿Confirmar? Toca otra vez') : children}
    </button>
  );
}

/** «El trato»: el auto, el estado y los pasos, las acciones de cada parte y lo que ve el público. */
export function DealPanel({ controller, sheet = false }: { controller: DealController; sheet?: boolean }) {
  const deal = controller.deal;
  const toast = useToast();
  const legalId = useId();
  const [legal, setLegal] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [price, setPrice] = useState('');
  const watching = useWatching();
  if (!deal) return null;

  const pill = DEAL_PILL[deal.status];
  const step = stepOf(deal.status);
  const seller = deal.role === 'SELLER';
  const deposit = deal.reservation?.status === 'AWAITING_SELLER' ? deal.reservation.depositAmount : deal.vehicle.reservationAmount;
  const priceNumber = Number(price || 0);
  const priceError = priceOpen && priceNumber < MIN_SALE_PRICE;
  const rate = deal.commissionRate ?? 0;
  const commission = Math.round(priceNumber * rate * 100) / 100;
  const meta = [`${deal.vehicle.mileageKm.toLocaleString('de-DE')} km`, deal.vehicle.transmission === 'MANUAL' ? 'Manual' : 'Automática', deal.vehicle.city].join(' · ');
  const reviewRating = deal.reservation?.sellerReviewRating ?? 0;
  const commissionInReview = deal.reservation?.payment?.status === 'SUBMITTED';
  // El botón «Avísame» es para terceros: solo lo ve quien no es parte de la reserva y el auto está reservado.
  const canWatch = !seller && deal.status === 'UNAVAILABLE' && deal.vehicle.status === 'RESERVED';
  const isWatching = watching.isWatching(deal.vehicle.id);

  return (
    <div className={cn('grid gap-3.5', sheet && 'gap-3.5')}>
      {!sheet && <p className="font-mono text-xs font-semibold tracking-[0.06em] text-muted uppercase">El trato</p>}

      <div className="flex items-center gap-3">
        <div className="relative h-[66px] w-24 shrink-0 overflow-hidden rounded-[12px] bg-card-tile">
          {deal.vehicle.coverUrl && <MediaImage src={deal.vehicle.coverUrl} alt="" fill sizes="96px" className="object-cover" />}
        </div>
        <div className="min-w-0">
          <p className="text-[15px] leading-tight font-extrabold">{vehicleName(deal.vehicle)}</p>
          <p className="mt-0.5 text-[12.5px] text-muted">{meta}</p>
          <p className="mt-[3px] text-base font-extrabold">{money(deal.vehicle.price)}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className={cn('inline-flex h-7 items-center rounded-full px-3 text-[13px] font-extrabold', pill.className)}>{pill.label}</span>
        <Link href={`/vehiculos/${deal.vehicle.slug}`} className="text-[13.5px] font-bold text-brand-fg underline underline-offset-[3px]">
          Ver anuncio
        </Link>
      </div>

      <ol aria-label="Estado del trato" className="grid grid-cols-4">
        {DEAL_STEPS.map((label, index) => (
          <li key={label} aria-current={index === step ? 'step' : undefined} className="grid justify-items-start gap-1.5">
            <span className="flex w-full items-center">
              <span className={cn('size-3 shrink-0 rounded-full transition-colors duration-300', index <= step ? 'bg-brand' : 'bg-line')} />
              {index < DEAL_STEPS.length - 1 && <span className={cn('h-0.5 flex-1 transition-colors duration-300', index < step ? 'bg-brand' : 'bg-line')} />}
            </span>
            <span className={cn('text-xs font-bold tracking-[-0.01em] whitespace-nowrap', index <= step ? 'text-ink' : 'text-muted')}>{label}</span>
          </li>
        ))}
      </ol>

      <p aria-live="polite" className="text-[13.5px] leading-[1.45]">
        {dealHelp(deal)}
        {seller && commissionInReview && ' Tu pago de la comisión está en revisión: al aprobarse queda vendido.'}
      </p>

      {/* Compradora en «Disponible»: aviso legal y reservar. */}
      {!seller && deal.status === 'AVAILABLE' && (
        <>
          {deal.vehicle.reservationAmount ? (
            <label htmlFor={legalId} className="flex cursor-pointer gap-2.5 rounded-[12px] bg-tile px-3 py-2.5 text-[13px] leading-[1.45]">
              <input id={legalId} type="checkbox" checked={legal} onChange={event => setLegal(event.target.checked)} className="mt-px size-[18px] shrink-0 accent-brand" />
              <span>He leído el aviso legal y lo acepto: el abono se paga directo al vendedor, se descuenta del precio y, si no hay venta, me lo devuelve completo.</span>
            </label>
          ) : (
            <p className="rounded-[12px] bg-tile px-3 py-2.5 text-[13px] leading-[1.45]">{firstName(deal.seller.name)} aún no fijó el abono de reserva. Pídeselo por el chat.</p>
          )}
          {deal.vehicle.reservationAmount && (
            <DealButton
              controller={controller}
              action="request"
              variant="primary"
              onClick={() => {
                if (!legal) {
                  toast({ tone: 'error', title: 'Primero acepta el aviso legal.' });
                  return;
                }
                controller.tap('request');
                setLegal(false);
              }}
            >
              Reservar con abono de {money(deposit)}
            </DealButton>
          )}
        </>
      )}

      <div className="grid gap-2">
        {seller && deal.status === 'REQUESTED' && (
          <>
            <DealButton controller={controller} action="accept" variant="primary">
              Confirmar reserva
            </DealButton>
            <DealButton controller={controller} action="reject" variant="ghost">
              Rechazar
            </DealButton>
          </>
        )}
        {seller && deal.status === 'RESERVED' && (
          <>
            <DealButton controller={controller} action="negotiate" variant="primary">
              Poner en negociación
            </DealButton>
            <DealButton controller={controller} action="cancel" variant="danger">
              Cancelar reserva
            </DealButton>
          </>
        )}
        {seller && deal.status === 'NEGOTIATING' && (
          <>
            <DealButton
              controller={controller}
              action="complete"
              variant="primary"
              onClick={() => {
                controller.disarm();
                if (!price) setPrice(String(Math.round(Number(deal.reservation?.salePrice ?? deal.vehicle.price))));
                setPriceOpen(true);
              }}
            >
              Marcar vendido
            </DealButton>
            <DealButton controller={controller} action="notConcluded" variant="danger">
              No se concretó
            </DealButton>
          </>
        )}
        {!seller && deal.status === 'REQUESTED' && (
          <DealButton controller={controller} action="withdraw" variant="ghost">
            Retirar solicitud
          </DealButton>
        )}
        {!seller && (deal.status === 'RESERVED' || deal.status === 'NEGOTIATING') && (
          <DealButton controller={controller} action="cancel" variant="danger">
            Cancelar reserva
          </DealButton>
        )}
      </div>

      {seller && priceOpen && deal.status === 'NEGOTIATING' && (
        <div role="dialog" aria-label="Marcar vehículo como vendido" className="am-step-in grid gap-2 rounded-[14px] border border-field-line p-3">
          <label htmlFor={`${legalId}-price`} className="text-sm font-bold">
            Precio final de venta (USD)
          </label>
          <input
            id={`${legalId}-price`}
            inputMode="numeric"
            value={price}
            onChange={event => setPrice(event.target.value.replace(/\D/g, '').slice(0, 9))}
            aria-invalid={priceError || undefined}
            className="h-11 rounded-[12px] border border-field-line bg-field px-3 font-mono text-base font-semibold"
          />
          {priceError && <p className="text-[12.5px] text-danger-fg">Escribe el precio final en dólares</p>}
          <p className="text-[12.5px] text-muted">
            {rate > 0
              ? `Con tu plan, AutoMarket cobra ${(rate * 100).toLocaleString('es', { maximumFractionDigits: 2 })} % de comisión (${money(commission)}). La pagas con Binance y, al aprobarse, queda vendido.`
              : 'Solo para tus estadísticas. Con tu plan, AutoMarket no cobra comisión.'}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPriceOpen(false)} className="h-[42px] flex-1 rounded-full border border-field-line text-[13.5px] font-bold">
              Volver
            </button>
            {rate > 0 ? (
              <Link href="/cuenta/reservas?tab=ventas" className={cn('grid h-[42px] flex-1 place-items-center rounded-full bg-brand text-[13.5px] font-bold text-on-brand', priceError && 'pointer-events-none opacity-60')}>
                Pagar comisión
              </Link>
            ) : (
              <button
                type="button"
                disabled={priceError || controller.pending !== null}
                onClick={() => {
                  controller.tap('complete', { salePrice: String(priceNumber) });
                  setPriceOpen(false);
                }}
                className="h-[42px] flex-1 rounded-full bg-brand text-[13.5px] font-bold text-on-brand disabled:opacity-60"
              >
                Marcar vendido
              </button>
            )}
          </div>
        </div>
      )}

      {!seller && deal.status === 'SOLD' && (
        <div className="grid gap-1.5">
          <p className="text-sm font-bold">Puntúa a {firstName(deal.seller.name)}</p>
          <div role="radiogroup" aria-label="Puntuación" className="flex gap-1">
            {[1, 2, 3, 4, 5].map(star => (
              <button
                key={star}
                type="button"
                role="radio"
                aria-checked={reviewRating === star}
                aria-label={`${star} ${star === 1 ? 'estrella' : 'estrellas'}`}
                disabled={controller.pending !== null}
                onClick={() => controller.tap('rate', { rating: star })}
                className={cn('grid size-10 place-items-center text-[26px] leading-none', star <= reviewRating ? 'text-[#E0A800]' : 'text-field-line')}
              >
                ★
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-2 rounded-[16px] border border-dashed border-field-line p-3">
        <p className="font-mono text-[11.5px] font-semibold tracking-[0.05em] text-muted uppercase">Así lo ven los demás</p>
        <div className="flex items-center gap-2">
          <span className={cn('inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-extrabold', PUBLIC_PILL[deal.publicStatus].className)}>{PUBLIC_PILL[deal.publicStatus].label}</span>
          <span className="truncate text-[13px] font-bold">{vehicleName(deal.vehicle)}</span>
        </div>
        <p className="text-[13px] leading-[1.45] text-muted">{publicText(deal)}</p>
        {canWatch && watching.signedIn && (
          <button
            type="button"
            aria-pressed={isWatching}
            disabled={watching.busy}
            onClick={() => watching.toggle(deal.vehicle.id)}
            className="inline-flex min-h-10 items-center gap-2 rounded-full border border-field-line bg-field px-3.5 text-[13px] font-bold"
          >
            <Bell aria-hidden className="size-4" strokeWidth={2.2} /> {isWatching ? 'Te avisaremos si vuelve' : 'Avísame si vuelve a estar disponible'}
          </button>
        )}
        <p className="text-[12.5px] text-muted">{watchersText(deal.watchers)}</p>
      </div>
    </div>
  );
}
