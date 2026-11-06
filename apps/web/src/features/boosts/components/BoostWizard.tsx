'use client';

import {
  BOOST_LABELS,
  LOGIN_MAX_DAYS,
  PaymentSubmitSchema,
  type BoostDTO,
  type BoostKind,
  type BoostListingDTO,
  type BoostOptionsDTO,
  type BoostPreviewDTO,
  type PaymentDTO,
} from '@automarket/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { paymentKeys, paymentsApi } from '@/features/payments/api';
import { cn } from '@/shared/lib/cn';
import { ApiError } from '@/shared/lib/http';
import { MediaImage } from '@/shared/ui/media-image';
import { PageSpinner } from '@/shared/ui/spinner';
import { boostKeys, boostsApi } from '../api';
import { addDays, dayNumber, dayOf, fullDay, longDay, placeTurn, shortDay, usd, weekdayShort } from '../calendar';
import { CarSilhouette } from './CarSilhouette';

type Step = 1 | 2 | 3 | 4;
type Done = { mode: 'paid' | 'review' | 'waitlist'; boost: BoostDTO; payment?: PaymentDTO; nextOpenAt?: string | null };

const KINDS: BoostKind[] = ['CITY_3D', 'CITY_7D', 'HOME', 'LOGIN'];
const DURATION: Record<BoostKind, string> = { CITY_3D: '3 días', CITY_7D: '7 días', HOME: '7 días', LOGIN: '1 a 3 días · tú eliges' };
const PERKS: Record<BoostKind, string[]> = {
  CITY_3D: ['Sale primero en tu ciudad', 'Sello «Destacado»'],
  CITY_7D: ['Primero en búsquedas', 'Sello «Destacado»', 'Aviso a compradores con alertas'],
  HOME: ['Todo lo de la semana', 'En el carrusel del inicio', 'En el abanico de destacados'],
  LOGIN: ['En el carrusel de Entrar y Crear cuenta', 'Rota con hasta 5 autos más', 'Un clic lleva a tu anuncio'],
};
const STEPS = ['1. Anuncio', '2. Impulso', '3. Pago', '4. Listo'];
const EASE = 'cubic-bezier(.2,.9,.25,1)';

/** Asistente «Destacar» (diseño «destacar-pc»): cupos, precios y turnos reales; pago con Binance. */
export function BoostWizard() {
  const options = useQuery({ queryKey: boostKeys.options, queryFn: boostsApi.options });
  if (options.isPending) return <PageSpinner />;
  if (options.isError) return <p className="text-danger-fg">{options.error.message}</p>;
  return <Wizard data={options.data} />;
}

function Wizard({ data }: { data: BoostOptionsDTO }) {
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>(1);
  const [listingId, setListingId] = useState(() => data.listings.find(l => l.id === params.get('anuncio'))?.id ?? data.listings[0]?.id ?? '');
  const [kind, setKind] = useState<BoostKind>('CITY_7D');
  const [loginDays, setLoginDays] = useState(LOGIN_MAX_DAYS);
  const [checkout, setCheckout] = useState<{ key: string; boost: BoostDTO; payment: PaymentDTO } | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string>();

  const listing = data.listings.find(l => l.id === listingId);
  const { settings } = data;
  const slots = settings.slots;

  // Pantalla de entrada: propuesta con la ocupación real (desde hoy o tras el descanso del anuncio).
  const occupancy = useMemo(() => new Map(data.loginOccupancy.map(day => [day.date, day.used])), [data.loginOccupancy]);
  const loginFrom = listing?.login.restFrom && listing.login.restFrom > data.today ? listing.login.restFrom : data.today;
  const loginStart = placeTurn(occupancy, loginFrom, loginDays, slots.login);
  const loginEnd = addDays(loginStart, loginDays - 1);

  const priceOf = (k: BoostKind) => (k === 'CITY_3D' ? settings.prices.city3 : k === 'CITY_7D' ? settings.prices.city7 : k === 'HOME' ? settings.prices.home : settings.prices.login[loginDays - 1]!);
  const zone = (k: BoostKind) => (k === 'HOME' ? { label: 'Portada en todo el país', total: data.home.total, used: data.home.used, nextOpenAt: data.home.nextOpenAt } : listing?.zone);
  const full = (k: BoostKind) => {
    if (k === 'LOGIN') return false;
    const z = zone(k);
    return Boolean(z && z.used >= z.total);
  };
  const zoneBlocked = Boolean(listing?.activeBoost) && kind !== 'LOGIN';
  const limitReached = data.limit.active >= data.limit.max && !(listing && (listing.activeBoost || listing.login.currentEnd));
  const payable = Boolean(data.payment.manual || data.payment.merchant);
  const waitlistMode = step === 2 && full(kind) && !zoneBlocked;

  const selectionKey = `${listingId}:${kind}:${kind === 'LOGIN' ? loginDays : ''}`;

  const createCheckout = useMutation({
    mutationFn: () => boostsApi.checkout({ vehicleId: listingId, kind, ...(kind === 'LOGIN' ? { days: loginDays } : {}) }),
    onSuccess: result => {
      setCheckout({ key: selectionKey, ...result });
      setStep(3);
    },
    onError: (err: Error) => setError(err.message),
  });
  const joinWaitlist = useMutation({
    mutationFn: () => boostsApi.waitlist({ vehicleId: listingId, kind: kind as 'CITY_3D' | 'CITY_7D' | 'HOME' }),
    onSuccess: result => {
      setDone({ mode: 'waitlist', boost: result.boost, nextOpenAt: result.nextOpenAt });
      setStep(4);
    },
    onError: (err: Error) => setError(err.message),
  });

  const back = () => {
    setError(undefined);
    setStep(current => (current > 1 ? ((current - 1) as Step) : current));
  };
  const next = () => {
    setError(undefined);
    if (step === 1) return setStep(2);
    if (step === 2) {
      if (waitlistMode) return joinWaitlist.mutate();
      if (checkout && checkout.key === selectionKey && checkout.payment.status === 'PENDING') return setStep(3);
      return createCheckout.mutate();
    }
  };

  const finish = (payment: PaymentDTO) => {
    if (!checkout) return;
    void queryClient.invalidateQueries({ queryKey: boostKeys.options });
    void boostsApi.get(checkout.boost.id).then(boost => {
      setDone({ mode: payment.status === 'PAID' ? 'paid' : 'review', boost, payment });
      setStep(4);
    });
  };

  if (data.listings.length === 0) {
    return (
      <Shell step={1}>
        <section aria-label="Paso actual" className="flex-[3_1_520px] rounded-[24px] border border-line bg-surface p-6">
          <h2 className="text-[19px] font-extrabold text-ink">Aún no tienes anuncios publicados</h2>
          <p className="mt-1 text-[13.5px] text-muted">Publica tu auto y vuelve aquí para destacarlo.</p>
          <Link href="/cuenta/anuncios/nuevo" className="mt-4 inline-flex h-12 items-center rounded-full bg-brand px-6 text-[14.5px] font-extrabold text-on-brand">
            Publicar un auto
          </Link>
        </section>
      </Shell>
    );
  }

  const nextLabel =
    step === 1
      ? 'Continuar'
      : waitlistMode
        ? 'Anotarme en la lista'
        : `Continuar con ${usd(priceOf(kind))}`;
  const nextDisabled = step === 2 && (zoneBlocked || (!waitlistMode && (limitReached || !payable || Boolean(listing?.pendingReview))));
  const busy = createCheckout.isPending || joinWaitlist.isPending;

  return (
    <Shell step={step} review={done?.mode === 'review'}>
      <section aria-label="Paso actual" className="min-w-0 flex-[3_1_520px] rounded-[24px] border border-line bg-surface p-6">
        {step === 1 && (
          <div className="am-step-in">
            <h2 className="text-[19px] font-extrabold text-ink">¿Qué anuncio quieres destacar?</h2>
            <div role="radiogroup" aria-label="Tus anuncios" className="mt-3.5 flex flex-col gap-2.5">
              {data.listings.map(item => {
                const selected = item.id === listingId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setListingId(item.id)}
                    className={cn('flex w-full items-center gap-3.5 rounded-[18px] border-2 p-3 text-left text-sm transition-colors duration-200', selected ? 'border-ink bg-canvas' : 'border-line bg-surface hover:border-edge')}
                  >
                    <Thumb listing={item} className="h-[68px] flex-[0_0_96px] rounded-xl" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-extrabold text-ink">{item.title}</span>
                      <span className="block text-[13px] text-muted">
                        {usd(item.price)} · {item.city} · {item.daysPublished === 1 ? '1 día publicado' : `${item.daysPublished} días publicado`}
                        {item.activeBoost && ` · destacado${item.activeBoost.until ? ` hasta ${shortDay(dayOf(item.activeBoost.until))}` : ''}`}
                      </span>
                    </span>
                    <span aria-hidden className={cn('grid size-[22px] shrink-0 place-items-center rounded-full border-2', selected ? 'border-ink' : 'border-edge')}>
                      <span className={cn('size-2.5 rounded-full', selected ? 'bg-ink' : 'bg-transparent')} />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === 2 && listing && (
          <div className="am-step-in">
            <h2 className="text-[19px] font-extrabold text-ink">Elige el impulso</h2>
            <p className="mt-1 text-[13.5px] text-muted">
              Puedes tener hasta {data.limit.max} autos destacados a la vez. Ahora tienes {data.limit.active} {data.limit.active === 1 ? 'activo' : 'activos'}. Los cupos son pocos por zona para que destacar siga valiendo la pena.
            </p>
            <div role="radiogroup" aria-label="Impulsos" className="mt-3.5 grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2.5">
              {KINDS.filter(k => k !== 'LOGIN' || settings.loginOnSale).map(k => (
                <PackCard
                  key={k}
                  kind={k}
                  selected={k === kind}
                  popular={data.popularKind === k}
                  price={k === 'LOGIN' && kind !== 'LOGIN' ? `desde ${usd(settings.prices.login[0])}` : usd(priceOf(k))}
                  quota={quota(k)}
                  onSelect={() => setKind(k)}
                />
              ))}
            </div>

            {kind === 'LOGIN' && settings.loginOnSale && (
              <LoginPanel
                today={data.today}
                days={loginDays}
                setDays={setLoginDays}
                prices={settings.prices.login}
                slots={slots.login}
                occupancy={occupancy}
                start={loginStart}
                end={loginEnd}
                listing={listing}
              />
            )}

            {zoneBlocked && listing.activeBoost && (
              <Notice>
                {listing.title} ya está destacado{listing.activeBoost.until ? ` hasta ${longDay(dayOf(listing.activeBoost.until))}` : ' (en cola)'}.{settings.loginOnSale ? ' Puedes sumarle la pantalla de entrada.' : ''}
              </Notice>
            )}
            {waitlistMode && (
              <Notice clock>
                No hay cupo en «{zone(kind)?.label}»{zone(kind)?.nextOpenAt ? ` hasta ${longDay(dayOf(zone(kind)!.nextOpenAt!))}` : ''}. Si te anotas, te avisamos y solo pagas cuando entres.
              </Notice>
            )}
            {!waitlistMode && limitReached && <Notice>Ya tienes {data.limit.max} autos destacados. Cuando termine uno, puedes destacar otro.</Notice>}
            {!waitlistMode && listing.pendingReview && <Notice>Ya enviaste un pago para este anuncio: el equipo lo está revisando.</Notice>}
            {!payable && <Notice>El cobro con Binance aún no está configurado. Inténtalo más tarde.</Notice>}
          </div>
        )}

        {step === 3 && checkout && <PaymentStep checkout={checkout} onDone={finish} />}

        {step === 4 && done && <DoneStep done={done} />}

        {error && (
          <p role="alert" className="mt-4 rounded-2xl bg-danger-soft px-4 py-3 text-sm font-semibold text-danger-fg">
            {error}
          </p>
        )}

        {step < 3 && (
          <div className="mt-[22px] flex justify-between gap-2.5 border-t border-line pt-4">
            <button
              type="button"
              onClick={back}
              disabled={step === 1 || busy}
              className="h-12 rounded-full border border-edge bg-surface px-5 text-[14.5px] font-bold text-ink disabled:text-faint"
            >
              Atrás
            </button>
            <button
              type="button"
              onClick={next}
              disabled={nextDisabled || busy}
              className="h-12 rounded-full bg-brand px-6 text-[14.5px] font-extrabold text-on-brand hover:bg-brand-600 disabled:opacity-50"
            >
              {busy ? 'Preparando…' : nextLabel}
            </button>
          </div>
        )}
        {step === 3 && (
          <div className="mt-[22px] flex justify-start border-t border-line pt-4">
            <button type="button" onClick={back} className="h-12 rounded-full border border-edge bg-surface px-5 text-[14.5px] font-bold text-ink">
              Atrás
            </button>
          </div>
        )}
      </section>

      {listing && <PreviewAside listing={listing} kind={kind} step={step} pending={step === 4 && done?.mode === 'review'} />}
    </Shell>
  );

  function quota(k: BoostKind) {
    if (k === 'LOGIN') {
      const used = occupancy.get(data.today) ?? 0;
      const free = Math.max(0, slots.login - used);
      const turn = loginStart !== data.today ? ` · tu turno: ${shortDay(loginStart)}` : '';
      return {
        total: slots.login,
        used,
        full: free === 0,
        text: free === 0 ? `Hoy lleno · tu turno: ${shortDay(loginStart)}` : `${free === 1 ? 'Queda 1' : `Quedan ${free}`} de ${slots.login} hoy · por orden de llegada${kind === 'LOGIN' ? turn : ''}`,
      };
    }
    const z = zone(k)!;
    const free = Math.max(0, z.total - z.used);
    return {
      total: z.total,
      used: Math.min(z.used, z.total),
      full: free === 0,
      text: free === 0 ? `Lleno · se abre ${z.nextOpenAt ? longDay(dayOf(z.nextOpenAt)) : 'pronto'}` : free === 1 ? `Último cupo · ${z.label}` : `Quedan ${free} de ${z.total} · ${z.label}`,
    };
  }
}

function Shell({ step, review = false, children }: { step: Step; review?: boolean; children: React.ReactNode }) {
  // Con el pago en revisión el último paso no es «Listo»: falta que el equipo lo confirme.
  const labels = review ? [...STEPS.slice(0, 3), '4. En revisión'] : STEPS;
  return (
    <div className="mx-auto max-w-[1180px]">
      <p className="text-[13px] text-muted">
        <Link href="/cuenta/anuncios" className="hover:text-ink hover:underline">
          Mis anuncios
        </Link>{' '}
        / Destacar
      </p>
      <h1 className="mt-1 text-[clamp(26px,3.4vw,32px)] font-extrabold tracking-[-0.03em] text-ink">Destaca tu anuncio</h1>
      <p className="mt-1 text-[15px] text-muted">Publicar sigue siendo gratis. Destacar es opcional, para vender más rápido.</p>
      <ol aria-label="Pasos" className="mt-[22px] grid list-none grid-cols-4 gap-2 p-0">
        {labels.map((label, index) => {
          const n = index + 1;
          return (
            <li key={label} aria-current={n === step ? 'step' : undefined} className="flex flex-col gap-2">
              <span className="h-1.5 overflow-hidden rounded-full bg-line">
                <span className="block h-full rounded-full bg-brand motion-safe:transition-[width] motion-safe:duration-500" style={{ width: n < step ? '100%' : n === step ? '50%' : '0%', transitionTimingFunction: EASE }} />
              </span>
              <span className={cn('text-[13px]', n === step ? 'font-extrabold text-ink' : n < step ? 'font-semibold text-ink' : 'font-semibold text-muted')}>{label}</span>
            </li>
          );
        })}
      </ol>
      <div className="mt-[22px] flex flex-wrap items-start gap-6">{children}</div>
    </div>
  );
}

function Thumb({ listing, className }: { listing: { coverUrl: string | null; category: BoostListingDTO['category'] }; className?: string }) {
  return (
    <span className={cn('relative block overflow-hidden bg-card-tile', className)}>
      {listing.coverUrl ? (
        <MediaImage src={listing.coverUrl} alt="" fill sizes="96px" className="object-cover" />
      ) : (
        <CarSilhouette category={listing.category} className="absolute top-[55%] left-1/2 w-[92%] -translate-x-1/2 -translate-y-1/2" />
      )}
    </span>
  );
}

function Notice({ children, clock = false }: { children: React.ReactNode; clock?: boolean }) {
  return (
    <div className="am-step-in mt-3.5 flex items-start gap-3 rounded-2xl bg-gold-soft px-4 py-3.5 text-sm leading-[1.45] text-gold-fg">
      {clock && (
        <svg viewBox="0 0 24 24" className="mt-px size-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      )}
      <p className="m-0">{children}</p>
    </div>
  );
}

function PackCard({ kind, selected, popular, price, quota, onSelect }: { kind: BoostKind; selected: boolean; popular: boolean; price: string; quota: { total: number; used: number; full: boolean; text: string }; onSelect: () => void }) {
  const segments = Math.min(quota.total, 10);
  const used = Math.round((Math.min(quota.used, quota.total) / quota.total) * segments);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'relative flex flex-col items-start gap-1.5 rounded-[20px] border-2 p-[18px] text-left motion-safe:transition-[transform,border-color,background-color] motion-safe:duration-[250ms]',
        selected ? '-translate-y-1 border-[#15171a] bg-[#15171a] text-white' : 'border-line bg-surface text-ink hover:border-edge',
      )}
      style={{ transitionTimingFunction: EASE }}
    >
      {popular && <span className="absolute -top-[11px] right-3.5 inline-flex h-[22px] items-center rounded-full bg-brand px-2.5 text-[11.5px] font-extrabold text-on-brand">El más elegido</span>}
      <span className="text-[15px] font-extrabold">{BOOST_LABELS[kind]}</span>
      <span className="text-[30px] leading-none font-extrabold tracking-[-0.03em]">{price}</span>
      <span className={cn('text-[13px]', selected ? 'text-[#C7CBD1]' : 'text-muted')}>{DURATION[kind]}</span>
      <span aria-hidden className="mt-1 flex gap-[3px]">
        {Array.from({ length: segments }, (_, index) => (
          <span key={index} className={cn('h-1.5 w-3.5 rounded-full', index < used ? (selected ? 'bg-[#4A505A]' : 'bg-edge') : selected ? 'bg-brand' : 'bg-brand')} />
        ))}
      </span>
      <span className={cn('text-[12.5px] font-extrabold', quota.full ? (selected ? 'text-[#F5C451]' : 'text-gold-fg') : selected ? 'text-mint' : 'text-brand-fg')}>{quota.text}</span>
      <ul className="mt-1.5 flex list-none flex-col gap-1 p-0">
        {PERKS[kind].map(perk => (
          <li key={perk} className="flex gap-1.5 text-[13px]">
            <span aria-hidden className={selected ? 'text-mint' : 'text-brand-fg'}>
              ✓
            </span>
            {perk}
          </li>
        ))}
      </ul>
    </button>
  );
}

function LoginPanel({ today, days, setDays, prices, slots, occupancy, start, end, listing }: { today: string; days: number; setDays: (days: number) => void; prices: [string, string, string]; slots: number; occupancy: Map<string, number>; start: string; end: string; listing: BoostListingDTO }) {
  const week = Array.from({ length: 7 }, (_, index) => addDays(today, index));
  const fromRest = listing.login.restFrom && listing.login.restFrom > today ? listing.login.restFrom : null;
  const blockedDay = !fromRest && start > today ? week.find(day => day < start && (occupancy.get(day) ?? 0) >= slots) ?? start : null;
  const segments = Math.min(slots, 10);
  return (
    <div className="am-step-in mt-[18px] grid gap-3.5 rounded-[20px] bg-canvas p-[18px]">
      <div>
        <p id="lg-days" className="text-[15px] font-extrabold text-ink">
          ¿Cuántos días en la pantalla de entrada?
        </p>
        <p className="mt-0.5 text-[13.5px] text-muted">
          Máximo {LOGIN_MAX_DAYS} días por anuncio. Hay {slots} cupos por día y se reparten por orden de llegada.
        </p>
      </div>
      <div role="radiogroup" aria-labelledby="lg-days" className="flex flex-wrap gap-2">
        {[1, 2, 3].map(n => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={days === n}
            onClick={() => setDays(n)}
            className={cn('min-h-12 rounded-full border-[1.5px] px-[18px] text-[14.5px] font-bold transition-colors duration-200', days === n ? 'border-[#15171a] bg-[#15171a] text-white' : 'border-edge bg-surface text-ink')}
          >
            {n === 1 ? '1 día' : `${n} días`} <span className="font-mono font-medium">· {usd(prices[n - 1]!)}</span>
          </button>
        ))}
      </div>
      <ol aria-label="Cupos de los próximos 7 días" className="grid list-none grid-cols-7 gap-1.5 p-0">
        {week.map((day, index) => {
          const used = occupancy.get(day) ?? 0;
          const mine = day >= start && day <= end;
          const isFull = used >= slots;
          return (
            <li
              key={day}
              aria-label={`${fullDay(day)}: ${used} de ${slots} cupos ocupados${mine ? ', aquí sale tu anuncio' : ''}`}
              className={cn('grid min-w-0 justify-items-center gap-[5px] rounded-[14px] border-[1.5px] px-1.5 py-2.5 text-center transition-colors duration-[250ms]', mine ? 'border-[#15171a] bg-[#15171a] text-white' : isFull ? 'border-[#E5C27A] bg-surface' : 'border-line bg-surface')}
            >
              <span className={cn('text-xs font-bold', mine ? 'text-[#C7CBD1]' : isFull ? 'text-gold-fg' : 'text-muted')}>{index === 0 ? 'hoy' : weekdayShort(day)}</span>
              <span className={cn('text-lg leading-none font-extrabold', mine ? 'text-white' : 'text-ink')}>{dayNumber(day)}</span>
              <span aria-hidden className="grid w-full gap-0.5" style={{ gridTemplateColumns: `repeat(${segments}, minmax(0, 1fr))` }}>
                {Array.from({ length: segments }, (_, i) => {
                  const taken = i < Math.round((Math.min(used, slots) / slots) * segments);
                  const yours = mine && i === Math.round((Math.min(used, slots) / slots) * segments);
                  return <span key={i} className={cn('h-1.5 rounded-[2px]', mine ? (taken ? 'bg-[#4A505A]' : yours ? 'bg-brand' : 'bg-[#2A2E34]') : taken ? 'bg-[#7D838D]' : 'bg-edge')} />;
                })}
              </span>
              <span className={cn('font-mono text-[11px] font-medium', mine ? 'text-[#C7CBD1]' : isFull ? 'text-gold-fg' : 'text-muted')}>{isFull ? 'lleno' : `${used}/${slots}`}</span>
            </li>
          );
        })}
      </ol>
      <p aria-live="polite" className="text-sm leading-normal text-ink">
        <b>{start === end ? `Sale ${longDay(start)}.` : `Sale ${longDay(start)} y termina ${longDay(end)}.`}</b> Vence a las 11:59 p. m. del último día y el cupo pasa al siguiente en la lista.
      </p>
      {fromRest && listing.login.currentEnd ? (
        <p className="rounded-xl bg-gold-soft px-3 py-2.5 text-[13.5px] leading-[1.45] text-gold-fg">
          Tu {listing.title} ya sale en la pantalla de entrada hasta {longDay(listing.login.currentEnd)}. Para que todos roten, puede volver desde {longDay(fromRest)}.
        </p>
      ) : (
        blockedDay && (
          <p className="rounded-xl bg-gold-soft px-3 py-2.5 text-[13.5px] leading-[1.45] text-gold-fg">
            {days === 1 ? `Hoy ${longDay(today).replace(/^el /, '')} ya está lleno.` : `Desde hoy no caben ${days} días seguidos: ${longDay(blockedDay)} ya está lleno.`} Por orden de llegada, tu turno empieza {longDay(start)}.
          </p>
        )
      )}
      <p className="text-[12.5px] text-muted">El turno se fija con la hora en que se confirma tu pago: si otros pagan antes, puede correrse al siguiente día libre.</p>
    </div>
  );
}

function PaymentStep({ checkout, onDone }: { checkout: { boost: BoostDTO; payment: PaymentDTO }; onDone: (payment: PaymentDTO) => void }) {
  const queryClient = useQueryClient();
  const [txId, setTxId] = useState('');
  const [error, setError] = useState<string>();
  const merchant = checkout.payment.mode === 'MERCHANT';
  const payment = useQuery({
    queryKey: paymentKeys.detail(checkout.payment.id),
    queryFn: () => paymentsApi.get(checkout.payment.id),
    initialData: checkout.payment,
    refetchInterval: merchant ? 4000 : false,
  });
  const finished = useRef(false);
  const complete = (data: PaymentDTO) => {
    if (finished.current) return;
    finished.current = true;
    onDone(data);
  };
  useEffect(() => {
    if (payment.data.status === 'PAID' && !finished.current) {
      finished.current = true;
      onDone(payment.data);
    }
  }, [payment.data, onDone]);

  const submit = useMutation({
    mutationFn: () => paymentsApi.submit(checkout.payment.id, { txId: txId.trim() }),
    onSuccess: data => {
      queryClient.setQueryData(paymentKeys.detail(checkout.payment.id), data);
      complete(data);
    },
    onError: (err: Error) => setError(err instanceof ApiError ? err.message : 'No pudimos enviar el comprobante.'),
  });
  const send = () => {
    const parsed = PaymentSubmitSchema.safeParse({ txId });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setError(undefined);
    submit.mutate();
  };

  const manual = checkout.payment.manual;
  const qr = merchant ? checkout.payment.merchant?.qrcodeLink : manual?.qrImageUrl;
  return (
    <div className="am-step-in">
      <h2 className="text-[19px] font-extrabold text-ink">Paga con Binance</h2>
      <p className="mt-1 text-sm text-muted">
        {merchant ? 'Escanea el código con tu app de Binance o abre el pago. Se confirma solo en cuanto Binance lo recibe.' : 'Escanea el código con tu app de Binance o paga a nuestro Pay ID. Usa el número de orden como nota.'}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-[18px]">
        {qr && (
          <span className="relative block size-[168px] flex-[0_0_168px] overflow-hidden rounded-[18px] border border-line bg-white p-3.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- QR oficial (Binance Pay o el que subió el administrador) */}
            <img src={qr} alt="Código QR de pago" className="size-full object-contain" />
          </span>
        )}
        <dl className="m-0 grid flex-[1_1_240px] grid-cols-[130px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-sm">
          <dt className="text-muted">Monto</dt>
          <dd className="m-0">
            <span className="text-[22px] font-extrabold text-ink">{usd(checkout.payment.amount)}</span> <span className="font-mono text-xs font-medium text-muted">{checkout.payment.currency}</span>
          </dd>
          {!merchant && (
            <>
              <dt className="text-muted">Pay ID</dt>
              <dd className="m-0 font-mono text-ink">{manual?.payId ?? <span className="font-sans text-gold-fg">Falta configurarlo en el admin</span>}</dd>
              <dt className="text-muted">A nombre de</dt>
              <dd className="m-0 font-bold text-ink">{manual?.payName ?? 'AutoMarket'}</dd>
            </>
          )}
          <dt className="text-muted">Orden</dt>
          <dd className="m-0 font-mono text-ink">{checkout.payment.reference}</dd>
          <dt className="text-muted">Impulso</dt>
          <dd className="m-0 font-bold text-ink">
            {BOOST_LABELS[checkout.boost.kind]} · {checkout.boost.vehicle.title}
          </dd>
        </dl>
      </div>
      <p className="mt-3.5 flex gap-2.5 rounded-[14px] bg-canvas px-3.5 py-3 text-[13.5px] leading-[1.45] text-ink">
        <svg viewBox="0 0 24 24" className="mt-0.5 size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
        Esta cuenta de cobro la fija AutoMarket y nadie más puede cambiarla. Si alguien te pide pagar a otra cuenta, es una estafa: repórtalo.
      </p>
      {merchant ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {checkout.payment.merchant?.checkoutUrl && (
            <a href={checkout.payment.merchant.checkoutUrl} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center rounded-full bg-brand px-6 text-[14.5px] font-extrabold text-on-brand hover:bg-brand-600">
              Abrir Binance Pay
            </a>
          )}
          <p className="flex items-center gap-2.5 text-sm font-bold text-ink" aria-live="polite">
            <span aria-hidden className="size-[18px] rounded-full border-[3px] border-edge border-t-brand motion-safe:animate-spin" />
            Esperando la confirmación de Binance…
          </p>
        </div>
      ) : (
        <div className="mt-4 grid gap-2">
          <label htmlFor="boost-tx" className="text-sm font-bold text-ink">
            ID de la transacción de Binance
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="boost-tx"
              value={txId}
              onChange={event => setTxId(event.target.value)}
              placeholder="Lo ves en el detalle del pago en Binance"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'boost-tx-error' : undefined}
              className="h-12 min-w-0 flex-[1_1_260px] rounded-full border border-edge bg-surface px-4 font-mono text-sm text-ink placeholder:font-sans placeholder:text-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
            />
            <button type="button" onClick={send} disabled={submit.isPending} className="h-12 rounded-full bg-brand px-6 text-[14.5px] font-extrabold text-on-brand hover:bg-brand-600 disabled:opacity-60">
              {submit.isPending ? 'Enviando…' : 'Ya pagué'}
            </button>
          </div>
          <p className="text-[12.5px] text-muted">Tu anuncio se destaca cuando el equipo confirme la transacción en Binance, no antes.</p>
          {error && (
            <p id="boost-tx-error" className="text-[13px] font-semibold text-danger-fg">
              {error}
            </p>
          )}
          {submit.isPending && (
            <p className="flex items-center gap-2.5 text-sm font-bold text-ink">
              <span aria-hidden className="size-[18px] rounded-full border-[3px] border-edge border-t-brand motion-safe:animate-spin" />
              Enviando tu comprobante…
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function DoneStep({ done }: { done: Done }) {
  const { boost } = done;
  const pending = done.mode === 'review';
  const login = boost.kind === 'LOGIN';
  const range = (start: string, end: string) => (start === end ? longDay(start) : `desde ${longDay(start)} hasta ${longDay(end)}`);
  let title: string;
  let text: string;
  if (done.mode === 'waitlist') {
    title = '¡Listo, quedaste en la lista!';
    text = `Te anotamos para «${boost.zoneLabel}». Te avisamos ${done.nextOpenAt ? longDay(dayOf(done.nextOpenAt)) : 'cuando se abra un cupo'} para pagar y activar el impulso.`;
  } else if (pending) {
    const tx = done.payment?.txId ? `la transacción ${done.payment.txId}` : 'tu transacción';
    title = 'Tu pago está en revisión';
    text = login && boost.wantDate
      ? `Todavía no tienes turno. El equipo busca ${tx} en Binance y el turno se asigna con la hora en que la confirme: hoy saldría ${range(boost.wantDate, addDays(boost.wantDate, boost.days - 1))}, y si otros pagan antes puede correrse al siguiente día libre. Te avisamos en los dos casos.`
      : `${boost.vehicle.title} todavía no está destacado. El equipo busca ${tx} en Binance: cuando la confirme, el impulso empieza y te avisamos. Si no aparece o el monto no coincide, también te avisamos.`;
  } else if (login && boost.startDate && boost.endDate) {
    title = '¡Listo, quedaste en la lista!';
    text = `Turno #${boost.turn} por orden de llegada. ${boost.vehicle.title} sale en la pantalla de entrada ${range(boost.startDate, boost.endDate)}, hasta las 11:59 p. m. Un clic lleva a tu anuncio.`;
  } else if (boost.status === 'ACTIVE' && boost.endsAt) {
    title = '¡Tu anuncio ya está destacado!';
    text = `${boost.vehicle.title} sale destacado hasta ${longDay(dayOf(boost.endsAt))}. Te avisamos cuando alguien te escriba.`;
  } else {
    title = '¡Pago confirmado!';
    text = `Estás en la cola de «${boost.zoneLabel}»: el impulso empieza apenas se libere un cupo. Te avisamos.`;
  }
  return (
    <div className="am-step-in py-5 text-center">
      {pending ? (
        <span className="mx-auto grid size-[72px] place-items-center rounded-full bg-gold-soft text-gold-fg">
          <svg viewBox="0 0 24 24" className="size-[34px]" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 7.5V12l3 2" />
          </svg>
        </span>
      ) : (
        <span className="am-pop mx-auto grid size-[72px] place-items-center rounded-full bg-success-soft text-success-fg">
          <svg viewBox="0 0 24 24" className="size-[34px]" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
      )}
      <h2 className="mt-3.5 text-2xl font-extrabold text-ink">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-[420px] text-[15px] text-muted">{text}</p>
      <div className="mt-[18px] flex flex-wrap justify-center gap-2">
        {pending && done.payment ? (
          <Link href={`/pagos/${done.payment.id}`} className="inline-flex h-11 items-center rounded-full border border-ink px-[18px] text-sm font-bold text-ink">
            Ver el estado del pago
          </Link>
        ) : (
          <Link href={`/vehiculos/${boost.vehicle.slug}`} className="inline-flex h-11 items-center rounded-full border border-ink px-[18px] text-sm font-bold text-ink">
            Ver mi anuncio
          </Link>
        )}
        <Link href="/cuenta/anuncios" className="inline-flex h-11 items-center rounded-full bg-[#15171a] px-[18px] text-sm font-bold text-white dark:bg-brand dark:text-on-brand">
          Ver mis anuncios
        </Link>
      </div>
    </div>
  );
}

function PreviewAside({ listing, kind, step, pending = false }: { listing: BoostListingDTO; kind: BoostKind; step: Step; pending?: boolean }) {
  const preview = useQuery({ queryKey: boostKeys.preview(listing.id), queryFn: () => boostsApi.preview(listing.id) });
  const boosted = step >= 2;
  const moves = boosted && kind !== 'LOGIN';
  return (
    <aside aria-label="Vista previa" className="min-w-0 flex-[2_1_340px] rounded-[24px] bg-[#15171a] p-5 text-[#F2F3F5]">
      <p className="text-[13px] text-[#A2A7B0]">{pending ? `Así te verán en el catálogo de ${listing.city} cuando confirmemos el pago` : `Así te ven en el catálogo de ${listing.city}`}</p>
      {preview.data ? <PreviewList preview={preview.data} kind={kind} boosted={boosted} moves={moves} /> : <div className="mt-3 h-[296px] animate-pulse rounded-2xl bg-[#1D2024]" />}
      <div className="mt-4 rounded-2xl bg-[#1D2024] p-3.5">
        <p className="text-[13px] font-extrabold">{headline()}</p>
        <p className="mt-1 text-[13px] leading-normal text-[#C7CBD1]">{explanation()}</p>
      </div>
    </aside>
  );

  function headline() {
    const position = preview.data?.position ?? 1;
    const up = preview.data?.boostedPosition ?? 1;
    if (!boosted) return `Hoy apareces en el puesto ${position}`;
    if (pending) return kind === 'LOGIN' ? 'Cuando confirmemos el pago, sales en el login' : `Cuando confirmemos el pago, subes ${up === 1 ? 'al primer lugar' : `al puesto ${up}`}`;
    if (kind === 'LOGIN') return 'Con «Pantalla de entrada» sales en el login';
    return up === 1 ? `Con «${BOOST_LABELS[kind]}» subes al primer lugar` : `Con «${BOOST_LABELS[kind]}» subes al puesto ${up}`;
  }
  function explanation() {
    if (!boosted) return 'Elige un impulso para ver cómo cambia tu lugar en la lista.';
    if (kind === 'HOME') return 'Además sales en el carrusel y el abanico de la portada, lo primero que ve todo el que entra.';
    if (kind === 'LOGIN') return `Sales en el carrusel de Entrar y Crear cuenta, lo que ve todo el que inicia sesión. Hasta ${LOGIN_MAX_DAYS} días, rotando con los demás. Un clic lleva directo a tu anuncio.`;
    return 'Durante el impulso tu auto sale arriba de los demás en tu ciudad, con el sello verde.';
  }
}

function PreviewList({ preview, kind, boosted, moves }: { preview: BoostPreviewDTO; kind: BoostKind; boosted: boolean; moves: boolean }) {
  const others = preview.rows.filter(row => !row.mine);
  const mine = preview.rows.find(row => row.mine);
  const visible = Math.min(4, others.length + (mine ? 1 : 0));
  const at = Math.min(moves ? preview.boostedPosition : preview.position, visible) - 1;
  const order = [...others.slice(0, visible - (mine ? 1 : 0))];
  if (mine) order.splice(Math.max(0, at), 0, mine);
  const tag = kind === 'HOME' ? 'Portada' : kind === 'LOGIN' ? 'En la entrada' : 'Destacado';
  return (
    <div className="relative mt-3" style={{ height: order.length * 74 }}>
      {order.map((row, index) => {
        const highlight = row.mine && boosted;
        return (
          <div
            key={row.id}
            className={cn(
              'absolute inset-x-0 flex items-center gap-2.5 rounded-2xl border p-2.5 motion-safe:transition-[top,background-color,border-color] motion-safe:duration-700',
              highlight ? 'border-mint bg-[#F2F3F5] text-[#15171a]' : row.mine ? 'border-[#2E3238] bg-[#1D2024]' : 'border-[#25282d] bg-[#1D2024]',
            )}
            style={{ top: index * 74, height: 64, transitionTimingFunction: EASE }}
          >
            <span className={cn('relative block h-[46px] w-16 shrink-0 overflow-hidden rounded-[10px]', highlight ? 'bg-[#E2E5E9]' : 'bg-[#272A2F]')}>
              {row.coverUrl ? (
                <MediaImage src={row.coverUrl} alt="" fill sizes="64px" className="object-cover" />
              ) : (
                <CarSilhouette category={row.category} glass={false} className="absolute top-1/2 left-1/2 w-[90%] -translate-x-1/2 -translate-y-1/2" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold">{row.title}</span>
              <span className="block text-[12.5px] opacity-75">{usd(row.price)}</span>
            </span>
            {highlight && <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-brand px-[9px] text-[11.5px] font-extrabold text-on-brand">{tag}</span>}
          </div>
        );
      })}
    </div>
  );
}

