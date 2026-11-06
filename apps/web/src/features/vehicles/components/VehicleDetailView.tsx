'use client';

import { usdText } from '@automarket/contracts';
import {
  CATEGORY_LABELS,
  CONDITION_LABELS,
  COUNTRIES,
  DRIVETRAIN_LABELS,
  FUEL_LABELS,
  REPORT_REASONS,
  TRANSMISSION_LABELS,
  countryName,
  ownersLabel,
  type VehicleDetailDTO,
  type VehicleInsightsDTO,
  type VehicleMediaDTO,
} from '@automarket/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, BadgeCheck, Building2, CalendarDays, CarFront, ChevronDown, ChevronLeft, ChevronRight, Flag, Fuel, Gauge, GitCompareArrows, MapPin, Settings2, Share2, Users, Zap } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ContactSellerButton } from '@/features/chat';
import { ReservationPanel } from '@/features/reservations';
import { cn } from '@/shared/lib/cn';
import { formatDate, formatMoney } from '@/shared/lib/format';
import { ApiError } from '@/shared/lib/http';
import { useSession } from '@/shared/lib/use-session';
import { Avatar } from '@/shared/ui/avatar';
import { Button, buttonClasses } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/card';
import { Select, Textarea } from '@/shared/ui/field';
import { MediaImage } from '@/shared/ui/media-image';
import { PageSpinner } from '@/shared/ui/spinner';
import { ThemeToggle } from '@/shared/ui/theme-toggle';
import { useToast } from '@/shared/ui/toaster';
import { openCopilot } from '@/features/copilot/api';
import { vehicleKeys, vehiclesApi } from '../api';
import { pickOf, useCompare } from '../compare';
import { SaveButton } from '../saved';
import { VehicleCard } from './VehicleCard';
import { copyText } from '@/shared/lib/browser';

const REASON_LABELS: Record<(typeof REPORT_REASONS)[number], string> = {
  FRAUD: 'Posible fraude',
  WRONG_INFO: 'Datos incorrectos',
  OFFENSIVE: 'Contenido ofensivo',
  SPAM: 'Spam o duplicado',
  OTHER: 'Otro motivo',
};
const money = (value: number) => usdText(value);
const km = (value: number) => value.toLocaleString('de-DE');
const card = 'rounded-[24px] border border-line bg-surface p-6';
const monthYear = (iso: string) => new Intl.DateTimeFormat('es', { month: 'short', year: 'numeric' }).format(new Date(iso));

/** Ficha completa (diseños «Ficha del auto» PC y teléfono): todo sale del anuncio real y de la API. */
export function VehicleDetailView({ slug }: { slug: string }) {
  const session = useSession();
  const query = useQuery({ queryKey: vehicleKeys.detail(slug), queryFn: () => vehiclesApi.bySlug(slug) });
  const vehicle = query.data;
  const similar = useQuery({ queryKey: vehicleKeys.similar(slug), queryFn: () => vehiclesApi.similar(slug), enabled: query.isSuccess });
  const insightsQuery = vehicle ? { make: vehicle.make, model: vehicle.model, year: vehicle.year, mileageKm: vehicle.mileageKm, transmission: vehicle.transmission, excludeId: vehicle.id } : null;
  const insights = useQuery({
    queryKey: vehicleKeys.insights(insightsQuery ?? { make: '', model: '' }),
    queryFn: () => vehiclesApi.insights(insightsQuery!),
    enabled: Boolean(insightsQuery) && session.status === 'authenticated',
    staleTime: 5 * 60_000,
  });
  const facets = useQuery({ queryKey: vehicleKeys.facets(vehicle?.make ?? '', vehicle?.country ?? ''), queryFn: () => vehiclesApi.facets(vehicle!.make, vehicle!.country), enabled: Boolean(vehicle), staleTime: 60_000 });
  // La pestaña dice qué auto es («Toyota Corolla 2027 · AutoMarket»), no «Ficha del vehículo».
  const tabTitle = vehicle ? [vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' ') : null;
  useEffect(() => {
    if (tabTitle) document.title = `${tabTitle} · AutoMarket`;
  }, [tabTitle]);

  if (query.isPending) return <PageSpinner />;
  if (query.isError || !vehicle) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <EmptyState
        icon={<CarFront className="size-6" />}
        title={notFound ? 'Este auto ya no está disponible' : 'No pudimos cargar la ficha'}
        description={notFound ? 'Puede que se haya vendido o retirado.' : query.error?.message}
        action={
          <Link href="/vehiculos" className={buttonClasses({ variant: 'outline' })}>
            Volver al catálogo
          </Link>
        }
      />
    );
  }

  const isOwner = session.status === 'authenticated' && session.user.id === vehicle.seller.id;
  return <DetailBody vehicle={vehicle} isOwner={isOwner} market={insights.data ?? null} marketLoading={insights.isPending && insights.fetchStatus !== 'idle'} similar={similar.data ?? []} facets={facets.data} />;
}

function DetailBody({
  vehicle,
  isOwner,
  market,
  marketLoading,
  similar,
  facets,
}: {
  vehicle: VehicleDetailDTO;
  isOwner: boolean;
  market: VehicleInsightsDTO | null;
  marketLoading: boolean;
  similar: VehicleDetailDTO[] | Parameters<typeof VehicleCard>[0]['vehicle'][];
  facets: { makes: Array<{ value: string; count: number }>; models: Array<{ value: string; count: number }>; cities: Array<{ value: string; count: number }> } | undefined;
}) {
  const title = `${vehicle.make} ${vehicle.model}`;
  const fullName = `${title}${vehicle.version ? ` ${vehicle.version}` : ''}`;
  const negotiating = vehicle.status === 'RESERVED';
  // El crédito solo lo otorgan los concesionarios: la cuota se muestra solo en sus anuncios.
  const byDealer = vehicle.seller.accountType === 'DEALER';
  const sold = vehicle.status === 'SOLD';
  const owners = vehicle.condition === 'NEW' ? 'Nuevo' : `Usado, ${ownersLabel(vehicle.ownersCount).toLowerCase()}`;
  const keyData: Array<{ label: string; value: string; icon: ReactNode }> = [
    { label: 'Año', value: String(vehicle.year), icon: <CalendarDays className="size-[15px]" strokeWidth={1.9} /> },
    { label: 'Kilómetros', value: km(vehicle.mileageKm), icon: <Gauge className="size-[15px]" strokeWidth={1.9} /> },
    { label: 'Transmisión', value: TRANSMISSION_LABELS[vehicle.transmission], icon: <Settings2 className="size-[15px]" strokeWidth={1.9} /> },
    { label: 'Combustible', value: FUEL_LABELS[vehicle.fuelType], icon: <Fuel className="size-[15px]" strokeWidth={1.9} /> },
    { label: 'Dueños', value: vehicle.condition === 'NEW' ? '0' : vehicle.ownersCount >= 3 ? '3+' : String(vehicle.ownersCount), icon: <Users className="size-[15px]" strokeWidth={1.9} /> },
    ...(vehicle.horsepower ? [{ label: 'Potencia', value: `${vehicle.horsepower} hp`, icon: <Zap className="size-[15px]" strokeWidth={1.9} /> }] : []),
  ];
  const subtitle = [TRANSMISSION_LABELS[vehicle.transmission], `${vehicle.city}, ${countryName(vehicle.country)}`, vehicle.publishedAt ? `publicado el ${formatDate(vehicle.publishedAt)}` : null].filter(Boolean).join(' · ');

  return (
    <div data-own-header data-phone-immersive className="max-sm:-mx-5 max-sm:-mt-6 max-sm:pb-[100px]">
      <nav aria-label="Ruta" className="text-[13px] text-muted max-sm:hidden">
        <Link href="/vehiculos" className="hover:text-ink hover:underline">
          Catálogo
        </Link>{' '}
        /{' '}
        <Link href={`/vehiculos?make=${encodeURIComponent(vehicle.make)}`} className="hover:text-ink hover:underline">
          {vehicle.make}
        </Link>{' '}
        / {vehicle.model}
        {vehicle.version ? ` ${vehicle.version}` : ''} {vehicle.year}
      </nav>

      <div className="flex flex-wrap items-start gap-6 sm:mt-3.5">
        <div className="flex min-w-0 flex-[999_1_600px] flex-col gap-5 max-sm:gap-0">
          <Gallery vehicle={vehicle} canSave={!isOwner && vehicle.status !== 'SOLD'} />

          <section aria-label="Resumen" className={cn(card, 'max-sm:relative max-sm:z-[1] max-sm:-mt-6 max-sm:rounded-b-none max-sm:rounded-t-[28px] max-sm:border-0 max-sm:bg-canvas max-sm:px-5 max-sm:pt-5 max-sm:pb-0 dark:max-sm:bg-canvas')}>
            <div className="flex flex-wrap gap-1.5">
              <Chip className="bg-tile max-sm:border max-sm:border-line max-sm:bg-transparent max-sm:font-mono max-sm:text-[11px] max-sm:font-normal max-sm:text-muted">{owners}</Chip>
              {vehicle.isFeatured && <Chip className="bg-soft text-brand-fg">Destacado</Chip>}
              {negotiating && (vehicle.inNegotiation ? <Chip className="bg-gold-soft text-gold-fg">En negociación</Chip> : <Chip className="bg-reserved-soft text-reserved-fg">Reservado</Chip>)}
              {sold && <Chip className="bg-ink text-surface">Vendido</Chip>}
            </div>
            <div className="mt-3 flex flex-wrap items-end justify-between gap-3 max-sm:mt-2.5 max-sm:flex-nowrap max-sm:items-start">
              <div className="min-w-0">
                <h1 className="text-[clamp(30px,3.4vw,42px)] leading-[1.05] font-extrabold tracking-[-0.035em] max-sm:text-2xl max-sm:font-semibold">
                  {fullName} <span className="max-sm:hidden">{vehicle.year}</span>
                </h1>
                <p className="mt-1.5 text-[15px] text-muted max-sm:mt-1 max-sm:font-mono max-sm:text-xs max-sm:text-faint">
                  <span className="max-sm:hidden">{subtitle}</span>
                  <span className="sm:hidden">
                    {vehicle.year}, {vehicle.city}
                  </span>
                </p>
              </div>
              <p className="text-[clamp(32px,3.6vw,44px)] font-extrabold tracking-[-0.035em] whitespace-nowrap max-sm:text-[26px] max-sm:font-semibold">{formatMoney(vehicle.price, vehicle.currency)}</p>
            </div>
            <dl className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2.5 max-sm:mt-4 max-sm:grid-cols-3 max-sm:gap-2">
              {keyData.map(item => (
                <div key={item.label} className="rounded-[16px] bg-tile p-3.5 max-sm:border max-sm:border-line max-sm:bg-surface max-sm:px-3 max-sm:py-2.5">
                  <dt className="flex items-center gap-1.5 text-[12.5px] text-muted max-sm:text-[11.5px] [&>svg]:max-sm:hidden">
                    {item.icon}
                    {item.label}
                  </dt>
                  <dd className="mt-1.5 text-[17px] font-extrabold max-sm:mt-[3px] max-sm:text-[15px] max-sm:font-semibold">{item.value}</dd>
                </div>
              ))}
            </dl>
            <div className="sm:hidden">
              <SellerRow vehicle={vehicle} />
              {byDealer && <PhoneQuota price={Number(vehicle.price)} />}
            </div>
          </section>

          <div className="flex flex-col gap-5 max-sm:mt-5 max-sm:px-5">
            <MarketCard vehicle={vehicle} market={market} loading={marketLoading} isOwner={isOwner} />
            <SpecsCard vehicle={vehicle} />
            {vehicle.description && (
              <section aria-labelledby="desc-title" className={card}>
                <h2 id="desc-title" className="text-[19px] font-extrabold">
                  Lo que cuenta el vendedor
                </h2>
                <p className="mt-3 max-w-[70ch] text-[15px] leading-[1.6] whitespace-pre-line text-ink/85">{vehicle.description}</p>
              </section>
            )}
            <section aria-labelledby="where-title" className={card}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 id="where-title" className="text-[19px] font-extrabold">
                  Dónde está
                </h2>
                <p className="text-[13px] text-muted">Zona aproximada. La dirección exacta te la da el vendedor.</p>
              </div>
              <p className="mt-3.5 inline-flex h-11 items-center gap-2 rounded-full bg-tile px-4 text-sm font-bold">
                <MapPin className="size-4 text-brand-fg" aria-hidden />
                {vehicle.city}, {countryName(vehicle.country)}
              </p>
            </section>
          </div>
        </div>

        <aside aria-label="Comprar este auto" className="flex min-w-0 flex-[1_1_340px] flex-col gap-4 max-sm:mt-5 max-sm:px-5">
          <div className="max-sm:hidden">
            <SellerCard vehicle={vehicle} isOwner={isOwner} />
          </div>
          <ReservationPanel vehicle={vehicle} isOwner={isOwner} />
          {byDealer && (
            <div className="max-sm:hidden">
              <QuotaCard price={Number(vehicle.price)} />
            </div>
          )}
          <Actions vehicle={vehicle} isOwner={isOwner} />
        </aside>
      </div>

      {similar.length > 0 && (
        <section aria-labelledby="similar-title" className="mt-8 max-sm:px-5">
          <h2 id="similar-title" className="text-2xl font-extrabold tracking-[-0.025em]">
            Parecidos a este
          </h2>
          <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-[18px]">
            {similar.map(item => (
              <VehicleCard key={item.id} vehicle={item} />
            ))}
          </div>
        </section>
      )}

      <ExploreMore vehicle={vehicle} facets={facets} />

      {/* Teléfono: barra fija con «Escribir» y «Reservar con abono». */}
      {!isOwner && !sold && (
        <div data-vehicle-phone-bar className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-line bg-surface/95 px-4 pt-3 pb-[calc(22px+env(safe-area-inset-bottom))] backdrop-blur-md sm:hidden">
          <ContactSellerButton vehicleId={vehicle.id} label="Escribir" className="h-[52px] shrink-0 px-[18px] text-[14.5px]" />
          {vehicle.status === 'PUBLISHED' && vehicle.reservationAmount ? (
            <a href="#reservar" className="flex h-[52px] flex-1 flex-col items-center justify-center rounded-full bg-brand text-on-brand">
              <span className="text-[15px] font-bold">Reservar con abono</span>
              <span className="font-mono text-[11px] opacity-85">{formatMoney(vehicle.reservationAmount, vehicle.currency)} al vendedor</span>
            </a>
          ) : (
            <a href="#reservar" className="flex h-[52px] flex-1 items-center justify-center rounded-full bg-sunken text-[15px] font-bold text-muted">
              {negotiating ? (vehicle.inNegotiation ? 'En negociación' : 'Reservado') : 'Ver reserva'}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn('inline-flex h-7 items-center rounded-full px-3 text-[12.5px] font-bold max-sm:h-[26px] max-sm:px-2.5', className)}>{children}</span>;
}

// ── Galería ─────────────────────────────────────────────────────────────────

function Gallery({ vehicle, canSave }: { vehicle: VehicleDetailDTO; canSave: boolean }) {
  const media = vehicle.media;
  const [index, setIndex] = useState(0);
  const current: VehicleMediaDTO | undefined = media[index];
  const count = media.length;
  const go = (delta: number) => count && setIndex(value => (value + delta + count) % count);
  const label = current?.kind === 'VIDEO' ? 'Video' : `Foto ${index + 1}`;
  const title = `${vehicle.make} ${vehicle.model}`;

  // Teléfono: avanza sola cada 3,8 s (como el diseño), salvo que se pida menos movimiento.
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto || count < 2 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !window.matchMedia?.('(max-width: 639px)').matches) return;
    const timer = window.setInterval(() => setIndex(value => (value + 1) % count), 3_800);
    return () => window.clearInterval(timer);
  }, [auto, count]);

  const stop = () => setAuto(false);

  return (
    <section aria-label="Galería" className="rounded-[24px] border border-line bg-surface p-3 max-sm:rounded-none max-sm:border-0 max-sm:p-0">
      <div className="relative aspect-[16/9] overflow-hidden rounded-[16px] bg-card-tile max-sm:aspect-auto max-sm:h-[330px] max-sm:rounded-none">
        {current ? (
          current.kind === 'VIDEO' ? (
            <video key={current.id} src={current.url} controls playsInline preload="metadata" className="absolute inset-0 size-full bg-black object-contain" />
          ) : (
            <MediaImage key={current.id} src={current.url} alt={`Foto ${index + 1} del ${title}`} fill priority={index === 0} sizes="(min-width: 1024px) 800px, 100vw" className="object-cover" />
          )
        ) : (
          <div className="grid h-full place-items-center text-sm text-muted">Sin fotos</div>
        )}

        {/* PC: rótulo, flechas y contador. */}
        <span className="absolute top-3.5 left-3.5 inline-flex h-7 items-center rounded-full bg-white px-3 text-[12.5px] font-bold text-[#15171a] max-sm:hidden">{label}</span>
        {count > 1 && (
          <>
            {(
              [
                ['left-3.5', 'Foto anterior', ChevronLeft, -1],
                ['right-3.5', 'Foto siguiente', ChevronRight, 1],
              ] as const
            ).map(([side, text, Icon, delta]) => (
              <button key={text} type="button" aria-label={text} onClick={() => (stop(), go(delta))} className={cn('absolute top-1/2 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-white text-[#15171a] shadow-[0_6px_16px_-8px_rgb(0_0_0/0.4)] max-sm:hidden', side)}>
                <Icon className="size-[18px]" strokeWidth={2.4} aria-hidden />
              </button>
            ))}
            <span className="absolute right-3.5 bottom-3.5 inline-flex h-7 items-center rounded-full bg-[rgb(17_19_18/0.72)] px-2.5 font-mono text-xs text-white max-sm:hidden">
              {index + 1} / {count}
            </span>
            {/* Teléfono: zonas de toque a los lados. */}
            <button type="button" aria-label="Foto anterior" onClick={() => (stop(), go(-1))} className="absolute top-[70px] bottom-[60px] left-0 w-[30%] sm:hidden" />
            <button type="button" aria-label="Foto siguiente" onClick={() => (stop(), go(1))} className="absolute top-[70px] right-0 bottom-[60px] w-[30%] sm:hidden" />
          </>
        )}

        {/* Teléfono: volver y tema arriba; puntos abajo. */}
        <div className="absolute inset-x-4 top-4 flex justify-between sm:hidden">
          <Link href="/vehiculos" aria-label="Volver al catálogo" className="grid size-11 place-items-center rounded-full border border-line bg-surface text-ink shadow-sm">
            <ArrowLeft className="size-[18px]" strokeWidth={2.2} aria-hidden />
          </Link>
          <span className="flex gap-2">
            <ThemeToggle className="bg-surface shadow-sm" />
            {canSave && <SaveButton vehicleId={vehicle.id} variant="round" />}
          </span>
        </div>
        <div className="absolute inset-x-4 bottom-[38px] flex items-center justify-end sm:hidden">
          {count > 1 && (
            <span aria-hidden className="flex gap-[5px]">
              {media.map((item, i) => (
                <span key={item.id} className={cn('h-1.5 rounded-full transition-[width] duration-300', i === index ? 'w-[18px] bg-white' : 'w-1.5 bg-white/55')} />
              ))}
            </span>
          )}
        </div>
      </div>

      {count > 1 && (
        <div className="mt-2.5 grid grid-cols-5 gap-2 max-sm:hidden">
          {media.slice(0, 10).map((item, i) => (
            <button
              key={item.id}
              type="button"
              aria-label={`Ver ${item.kind === 'VIDEO' ? 'el video' : `foto ${i + 1}`}`}
              onClick={() => setIndex(i)}
              className={cn('relative h-[72px] overflow-hidden rounded-[12px] border-2 bg-card-tile transition-[opacity,border-color] duration-200', i === index ? 'border-ink opacity-100' : 'border-transparent opacity-75 hover:opacity-100')}
            >
              {item.kind === 'VIDEO' ? (
                <span className="grid h-full place-items-center bg-[#23272b] text-xs font-bold text-white">Video</span>
              ) : (
                <MediaImage src={item.url} alt="" fill sizes="160px" className="object-cover" />
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Valoración de mercado + dudas comunes ───────────────────────────────────

function MarketCard({ vehicle, market: data, loading, isOwner }: { vehicle: VehicleDetailDTO; market: VehicleInsightsDTO | null; loading: boolean; isOwner: boolean }) {
  const [question, setQuestion] = useState<string | null>(null);
  const [placed, setPlaced] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setPlaced(true), 300);
    return () => window.clearTimeout(timer);
  }, []);
  const price = Number(vehicle.price);
  const market = data?.market ?? null;
  const diff = market ? Math.round(((price - market.value) / market.value) * 100) : 0;
  const badge = !market
    ? null
    : price < market.low
      ? { text: 'Buen precio', className: 'bg-success-soft text-success-fg' }
      : price <= market.value
        ? { text: 'Precio justo', className: 'bg-success-soft text-success-fg' }
        : price <= market.high
          ? { text: `Algo alto (+${diff} %)`, className: 'bg-gold-soft text-gold-fg' }
          : { text: `Alto (+${diff} %)`, className: 'bg-gold-soft text-gold-fg' };
  const position = market ? Math.max(0, Math.min(100, 30 + ((price - market.low) / Math.max(1, market.high - market.low)) * 40)) : 50;
  const answers = useMemo(() => {
    const list: Array<{ q: string; a: string }> = [];
    if (market) {
      list.push({
        q: isOwner ? '¿Mi precio está bien?' : '¿Cuánto puedo ofrecer?',
        a: isOwner
          ? `Los parecidos rondan ${money(market.value)}. Tu precio está ${diff === 0 ? 'justo ahí' : `${Math.abs(diff)} % ${diff > 0 ? 'por encima' : 'por debajo'}`}.`
          : price <= market.low
            ? `Ya está por debajo de lo normal (${money(market.low)} – ${money(market.high)}).`
            : `Entre ${money(market.low)} y ${money(Math.min(price, market.value))} es una oferta razonable.`,
      });
    }
    list.push({
      q: '¿Qué reviso antes de pagar?',
      a: 'Que los seriales coincidan con el título, y verlo y probarlo en persona. Paga el resto al cerrar la venta.',
    });
    list.push({
      q: '¿Cómo funciona la reserva?',
      a: vehicle.reservationAmount
        ? `Le pagas ${formatMoney(vehicle.reservationAmount, vehicle.currency)} al vendedor y se descuenta del precio. Mientras dure, nadie más lo reserva.`
        : 'El vendedor todavía no fijó el abono de reserva. Escríbele por el chat para pedírselo.',
    });
    return list;
  }, [diff, isOwner, market, price, vehicle.currency, vehicle.model, vehicle.reservationAmount]);
  const answer = answers.find(item => item.q === question);

  return (
    <section aria-labelledby="market-title" className={card}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="market-title" className="text-[19px] font-extrabold">
            Valoración de mercado
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">
            {market
              ? `Según ${market.sample} ${vehicle.model} parecidos de ${vehicle.year - 2} a ${vehicle.year + 2}.`
              : loading
                ? 'Comparando con autos parecidos…'
                : data
                  ? `Todavía no hay suficientes ${vehicle.model} parecidos para estimarlo.`
                  : 'Inicia sesión para ver la valoración de mercado.'}
          </p>
        </div>
        {badge && <span className={cn('inline-flex h-[30px] items-center rounded-full px-3 text-[13px] font-extrabold', badge.className)}>{badge.text}</span>}
      </div>

      {market && (
        <>
          <div className="mx-1.5 mt-11">
            <div className="relative">
              <div aria-hidden className="flex h-3 overflow-hidden rounded-full">
                <span className="w-[30%] bg-[#bfe3cd] dark:bg-[#2c5a40]" />
                <span className="w-[40%] bg-[#e7e9ed] dark:bg-[#2a2e34]" />
                <span className="flex-1 bg-[#fbe7b5] dark:bg-[#5a4519]" />
              </div>
              <span
                aria-hidden
                className="absolute top-1/2 size-[22px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink shadow-[0_0_0_4px_var(--color-surface)] transition-[left] duration-[900ms] ease-[cubic-bezier(.2,.9,.25,1)] motion-reduce:transition-none"
                style={{ left: `${placed ? position : 50}%` }}
              />
              <span className="absolute bottom-[calc(100%+14px)] -translate-x-1/2 rounded-[8px] bg-ink px-2.5 py-[3px] text-[12.5px] font-extrabold whitespace-nowrap text-surface transition-[left] duration-[900ms] ease-[cubic-bezier(.2,.9,.25,1)] motion-reduce:transition-none" style={{ left: `clamp(70px, ${placed ? position : 50}%, calc(100% - 70px))` }}>
                {money(price)} · este auto
              </span>
            </div>
            <div aria-hidden className="mt-2.5 grid grid-cols-[30%_40%_30%] text-[12.5px] font-bold">
              <span className="text-brand-fg">Oferta</span>
              <span className="text-center text-ink/75">Mercado</span>
              <span className="text-right text-gold-fg">Alto</span>
            </div>
          </div>
          <dl className="mt-[18px] grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5">
            {[
              ['Valor estimado', money(market.value)],
              ['Rango normal', `${money(market.low)} – ${money(market.high)}`],
              ['Precio de este auto', money(price)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[16px] bg-tile px-3.5 py-3">
                <dt className="text-[12.5px] text-muted">{label}</dt>
                <dd className="mt-1 text-xl font-extrabold">{value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      <div className="mt-[18px] border-t border-line/70 pt-4">
        <p className="text-sm font-extrabold">Dudas comunes sobre este auto</p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {answers.map(item => (
            <button
              key={item.q}
              type="button"
              aria-pressed={question === item.q}
              onClick={() => setQuestion(question === item.q ? null : item.q)}
              className={cn('min-h-10 rounded-full border px-3.5 py-1.5 text-[13.5px] font-bold transition-colors duration-200', question === item.q ? 'border-ink bg-ink text-surface' : 'border-edge/70 bg-surface text-ink hover:border-ink')}
            >
              {item.q}
            </button>
          ))}
        </div>
        {answer && (
          <p key={answer.q} className="am-step-in mt-3 rounded-[14px] border-l-[3px] border-brand bg-tile px-4 py-3.5 text-[14.5px] leading-normal">
            {answer.a}
          </p>
        )}
        {!isOwner && (
          <button type="button" onClick={() => openCopilot('¿Este auto tiene buen precio?')} className="mt-3 text-[13.5px] font-bold text-brand-fg underline underline-offset-[3px]">
            Compararlo con autos parecidos en el Copiloto
          </button>
        )}
      </div>
    </section>
  );
}

// ── Ficha técnica ───────────────────────────────────────────────────────────

function SpecsCard({ vehicle }: { vehicle: VehicleDetailDTO }) {
  const rows: Array<[string, string]> = [
    ['Marca', vehicle.make],
    ['Modelo', vehicle.model],
    ...(vehicle.version ? ([['Versión', vehicle.version]] as Array<[string, string]>) : []),
    ['Año', String(vehicle.year)],
    ['Condición', CONDITION_LABELS[vehicle.condition]],
    ['Dueños anteriores', vehicle.condition === 'NEW' ? 'Ninguno' : ownersLabel(vehicle.ownersCount)],
    ['Kilómetros', `${km(vehicle.mileageKm)} km`],
    ['Transmisión', TRANSMISSION_LABELS[vehicle.transmission]],
    ['Combustible', FUEL_LABELS[vehicle.fuelType]],
    ...(vehicle.drivetrain ? ([['Tracción', DRIVETRAIN_LABELS[vehicle.drivetrain]]] as Array<[string, string]>) : []),
    ...(vehicle.horsepower ? ([['Potencia', `${vehicle.horsepower} hp`]] as Array<[string, string]>) : []),
    ...(vehicle.doors ? ([['Puertas', String(vehicle.doors)]] as Array<[string, string]>) : []),
    ...(vehicle.seats ? ([['Plazas', String(vehicle.seats)]] as Array<[string, string]>) : []),
    ...(vehicle.exteriorColor ? ([['Color', vehicle.exteriorColor]] as Array<[string, string]>) : []),
    ['Categoría', CATEGORY_LABELS[vehicle.category]],
  ];
  return (
    <section aria-labelledby="specs-title" className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 id="specs-title" className="text-[19px] font-extrabold">
          Ficha técnica
        </h2>
        <span className="text-[12.5px] text-muted">Datos que dio el vendedor</span>
      </div>
      <dl className="mt-3.5 grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-x-8">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 border-b border-line/70 py-3 text-[14.5px]">
            <dt className="text-muted">{label}</dt>
            <dd className="text-right font-bold">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// ── Vendedor ────────────────────────────────────────────────────────────────

function sellerLine(vehicle: VehicleDetailDTO) {
  const kind = vehicle.seller.accountType === 'DEALER' ? (vehicle.seller.dealer ? vehicle.seller.dealer.businessName : 'Concesionario') : 'Particular';
  return `${kind}, desde ${monthYear(vehicle.seller.memberSince)}`;
}
const ratingText = (vehicle: VehicleDetailDTO) =>
  vehicle.seller.ratingCount ? `${(vehicle.seller.ratingAverage ?? 0).toLocaleString('es', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} · ${vehicle.seller.ratingCount} ${vehicle.seller.ratingCount === 1 ? 'reseña' : 'reseñas'}` : 'Sin reseñas aún';

function SellerCard({ vehicle, isOwner }: { vehicle: VehicleDetailDTO; isOwner: boolean }) {
  const seller = vehicle.seller;
  return (
    <section aria-label="Vendedor" className="rounded-[24px] border border-line bg-surface p-5">
      <Link href={`/vendedores/${seller.id}`} className="flex items-center gap-3 hover:opacity-85">
        <Avatar name={seller.name} src={seller.avatarUrl} className="size-[52px] text-base font-extrabold" />
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-base font-extrabold">
            <span className="truncate">{seller.name}</span>
            {seller.isVerified && <BadgeCheck className="size-4 shrink-0 text-success-fg" role="img" aria-label="Identidad verificada" />}
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">{sellerLine(vehicle)}</p>
        </div>
      </Link>
      <div className="mt-3.5 grid grid-cols-2 gap-2">
        <div className="rounded-[14px] bg-tile px-3 py-2.5">
          <p className="text-xs text-muted">Valoración</p>
          <p className="mt-0.5 text-base font-extrabold">{ratingText(vehicle)}</p>
        </div>
        <div className="rounded-[14px] bg-tile px-3 py-2.5">
          <p className="text-xs text-muted">Autos vendidos</p>
          <p className="mt-0.5 text-base font-extrabold">{seller.soldCount}</p>
        </div>
      </div>
      {seller.dealer && (seller.dealer.taxId || seller.dealer.fiscalAddress || seller.dealer.businessPhone) && (
        <div className="mt-3.5 text-[13px] text-muted">
          <p className="flex items-center gap-1.5 font-semibold text-ink">
            <Building2 className="size-3.5" aria-hidden /> {seller.dealer.businessName}
          </p>
          {seller.dealer.taxId && <p className="mt-1">RIF {seller.dealer.taxId}</p>}
          {seller.dealer.fiscalAddress && <p>{seller.dealer.fiscalAddress}</p>}
          {seller.dealer.businessPhone && <p>Tel. corporativo {seller.dealer.businessPhone}</p>}
        </div>
      )}
      {!isOwner && <ContactSellerButton vehicleId={vehicle.id} label="Escribir al vendedor" variant="gold" className="mt-3.5 h-12 w-full text-[14.5px]" />}
    </section>
  );
}

function SellerRow({ vehicle }: { vehicle: VehicleDetailDTO }) {
  const seller = vehicle.seller;
  return (
    <Link href={`/vendedores/${seller.id}`} className="mt-3 flex items-center gap-3 rounded-[18px] border border-line bg-surface px-3 py-2.5">
      <Avatar name={seller.name} src={seller.avatarUrl} className="size-10 text-[13px]" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-[5px] text-[14.5px] font-semibold">
          <span className="truncate">{seller.name}</span>
          {seller.isVerified && <BadgeCheck className="size-3.5 shrink-0 text-success-fg" role="img" aria-label="Identidad verificada" />}
        </span>
        <span className="block text-[12.5px] text-muted">
          {ratingText(vehicle)} · {seller.soldCount} {seller.soldCount === 1 ? 'auto vendido' : 'autos vendidos'}
        </span>
      </span>
      <ChevronRight className="size-4 text-faint" aria-hidden />
    </Link>
  );
}

// ── Cuota estimada ──────────────────────────────────────────────────────────

const TERMS = [12, 24, 36, 48] as const;
function monthly(price: number, downPct: number, rate: number, months: number) {
  const financed = price * (1 - downPct / 100);
  const r = rate / 100 / 12;
  const fee = r === 0 ? financed / months : (financed * r) / (1 - (1 + r) ** -months);
  return { financed, fee, interest: fee * months - financed };
}

function QuotaCard({ price }: { price: number }) {
  const [down, setDown] = useState(30);
  const [months, setMonths] = useState<(typeof TERMS)[number]>(36);
  const [rateText, setRateText] = useState('14');
  const rate = Math.max(0, Math.min(60, Number(rateText.replace(',', '.')) || 0));
  const result = monthly(price, down, rate, months);
  return (
    <section aria-labelledby="quota-title" className="rounded-[24px] border border-line bg-surface p-5">
      <h2 id="quota-title" className="text-[17px] font-extrabold">
        Calcula tu cuota
      </h2>
      <p className="text-[13px] text-muted">Es un estimado: el crédito lo da el concesionario.</p>
      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <label htmlFor="quota-down" className="text-[13px] font-bold">
            Inicial
          </label>
          <span className="text-sm font-extrabold">
            {down} % · {money((price * down) / 100)}
          </span>
        </div>
        <input id="quota-down" type="range" min={10} max={70} step={5} value={down} onChange={event => setDown(Number(event.target.value))} className="mt-2 w-full accent-brand" />
      </div>
      <div className="mt-3.5">
        <p className="text-[13px] font-bold">Plazo</p>
        <div role="group" aria-label="Plazo en meses" className="mt-2 grid grid-cols-4 gap-1.5">
          {TERMS.map(term => (
            <button key={term} type="button" aria-pressed={months === term} onClick={() => setMonths(term)} className={cn('h-11 rounded-[12px] border text-[13.5px] font-bold transition-colors duration-200', months === term ? 'border-ink bg-ink text-surface' : 'border-edge/70 bg-surface text-ink')}>
              {term} m
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3.5 flex items-center justify-between">
        <label htmlFor="quota-rate" className="text-[13px] font-bold">
          Tasa anual
        </label>
        <span className="flex items-center gap-1.5 text-sm font-bold">
          <input id="quota-rate" inputMode="decimal" value={rateText} onChange={event => setRateText(event.target.value.replace(/[^\d.,]/g, '').slice(0, 5))} className="h-10 w-[72px] rounded-[10px] border border-edge bg-surface px-2.5 text-right text-sm font-bold" />%
        </span>
      </div>
      <div className="mt-4 rounded-[16px] bg-night p-4 text-white">
        <p className="text-[13px] text-[#c7cbd1]">Cuota mensual estimada</p>
        <p aria-live="polite" className="text-[34px] font-extrabold tracking-[-0.03em]">
          {money(result.fee)}
        </p>
        <p className="mt-1 text-[12.5px] text-[#a2a7b0]">
          Financias {money(result.financed)} · intereses {money(result.interest)}
        </p>
      </div>
    </section>
  );
}

function PhoneQuota({ price }: { price: number }) {
  const [open, setOpen] = useState(false);
  const [months, setMonths] = useState<(typeof TERMS)[number]>(36);
  const fee = monthly(price, 30, 14, months).fee;
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="mt-2 flex w-full items-center gap-3 rounded-[18px] border border-line bg-surface p-3 text-left text-sm">
        <span className="flex-1">
          Cuota estimada desde <strong>{money(fee)}/mes</strong>
        </span>
        <ChevronDown className={cn('size-4 text-faint transition-transform duration-[250ms]', open && 'rotate-180')} aria-hidden />
      </button>
      <div className={cn('overflow-hidden transition-[max-height] duration-[350ms] ease-[cubic-bezier(.2,.9,.25,1)] motion-reduce:transition-none', open ? 'max-h-[140px]' : 'max-h-0')}>
        <div className="px-1 pt-3">
          <div role="group" aria-label="Plazo en meses" className="grid grid-cols-4 gap-1.5">
            {TERMS.map(term => (
              <button key={term} type="button" aria-pressed={months === term} onClick={() => setMonths(term)} className={cn('h-10 rounded-[12px] border text-[13px] font-semibold', months === term ? 'border-ink bg-ink text-surface' : 'border-edge text-ink')}>
                {term} m
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] text-faint">30 % de inicial y 14 % anual. El crédito lo da el concesionario.</p>
        </div>
      </div>
    </div>
  );
}

// ── Acciones: guardar, compartir, comparar y denunciar ──────────────────────

function Actions({ vehicle, isOwner }: { vehicle: VehicleDetailDTO; isOwner: boolean }) {
  const toast = useToast();
  const compare = useCompare();
  const [reporting, setReporting] = useState(false);
  const comparing = compare.has(vehicle.id);
  const tile = 'flex flex-col items-center justify-center gap-1 rounded-[16px] border border-line bg-surface py-3 text-[12.5px] font-bold disabled:opacity-50 hover:border-edge';
  return (
    <div>
      <div className={cn('grid gap-2', isOwner ? 'grid-cols-2' : 'grid-cols-3 sm:grid-cols-4')}>
        {/* En el teléfono el corazón va sobre la foto (diseño). */}
        {!isOwner && vehicle.status !== 'SOLD' && <SaveButton vehicleId={vehicle.id} variant="tile" className={cn(tile, 'max-sm:hidden')} />}
        <button
          type="button"
          className={tile}
          onClick={async () => {
            try {
              await copyText(`${window.location.origin}/vehiculos/${vehicle.slug}`);
              toast({ tone: 'success', title: 'Enlace copiado' });
            } catch {
              toast({ tone: 'error', title: 'No se pudo copiar el enlace' });
            }
          }}
        >
          <Share2 className="size-5" strokeWidth={1.9} aria-hidden /> Compartir
        </button>
        <button type="button" aria-pressed={comparing} disabled={!comparing && (compare.full || vehicle.status === 'SOLD')} onClick={() => compare.toggle(pickOf(vehicle))} className={cn(tile, comparing && 'border-ink')}>
          <GitCompareArrows className="size-5" strokeWidth={1.9} aria-hidden /> {comparing ? 'En comparación' : 'Comparar'}
        </button>
        {!isOwner && (
          <button type="button" aria-expanded={reporting} onClick={() => setReporting(value => !value)} className={tile}>
            <Flag className="size-5" strokeWidth={1.9} aria-hidden /> Denunciar
          </button>
        )}
      </div>
      {comparing && (
        <Link href={`/comparar?autos=${compare.picks.map(pick => pick.slug).join(',')}`} className="mt-2 block text-center text-[13px] font-bold text-brand-fg hover:underline">
          Ver la comparación ({compare.picks.length})
        </Link>
      )}
      {reporting && <ReportForm vehicleId={vehicle.id} onDone={() => setReporting(false)} />}
    </div>
  );
}

function ReportForm({ vehicleId, onDone }: { vehicleId: string; onDone: () => void }) {
  const toast = useToast();
  const report = useMutation({
    mutationFn: (input: { reason: string; details?: string }) => vehiclesApi.report(vehicleId, input),
    onSuccess: res => {
      onDone();
      toast({ tone: 'success', title: 'Denuncia enviada', description: res.message });
    },
    onError: err => toast({ tone: 'error', title: 'No se pudo enviar', description: err.message }),
  });
  return (
    <form
      className="mt-2 grid gap-2 rounded-[16px] border border-line bg-surface p-3"
      onSubmit={event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        report.mutate({ reason: String(data.get('reason')), details: String(data.get('details') ?? '') || undefined });
      }}
    >
      <Select name="reason" aria-label="Motivo de la denuncia" className="h-10 text-sm">
        {REPORT_REASONS.map(reason => (
          <option key={reason} value={reason}>
            {REASON_LABELS[reason]}
          </option>
        ))}
      </Select>
      <Textarea name="details" rows={2} maxLength={2000} placeholder="Detalles (opcional)" aria-label="Detalles" className="text-sm" />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="danger" loading={report.isPending}>
          Enviar denuncia
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

// ── Explora más (con los conteos reales del catálogo) ───────────────────────

function ExploreMore({ vehicle, facets }: { vehicle: VehicleDetailDTO; facets: { makes: Array<{ value: string; count: number }>; models: Array<{ value: string; count: number }>; cities: Array<{ value: string; count: number }> } | undefined }) {
  if (!facets) return null;
  const country = COUNTRIES.find(item => item.code === vehicle.country)?.name ?? vehicle.country;
  const makeCount = facets.makes.find(item => item.value.toLocaleLowerCase('es') === vehicle.make.toLocaleLowerCase('es'))?.count;
  const modelCount = facets.models.find(item => item.value.toLocaleLowerCase('es') === vehicle.model.toLocaleLowerCase('es'))?.count;
  const cityCount = facets.cities.find(item => item.value.toLocaleLowerCase('es') === vehicle.city.toLocaleLowerCase('es'))?.count;
  const links = [
    makeCount ? { label: `Todos los ${vehicle.make}`, count: makeCount, href: `/vehiculos?${new URLSearchParams({ make: vehicle.make })}` } : null,
    modelCount ? { label: `${vehicle.make} ${vehicle.model}`, count: modelCount, href: `/vehiculos?${new URLSearchParams({ make: vehicle.make, model: vehicle.model })}` } : null,
    cityCount ? { label: `Autos en ${vehicle.city}, ${country}`, count: cityCount, href: `/vehiculos?${new URLSearchParams({ country: vehicle.country, city: vehicle.city })}` } : null,
  ].filter((item): item is { label: string; count: number; href: string } => item !== null);
  if (!links.length) return null;
  return (
    <section aria-labelledby="explore-title" className="mt-8 max-sm:px-5">
      <h2 id="explore-title" className="text-xl font-extrabold">
        Explora más
      </h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {links.map(link => (
          <Link key={link.href} href={link.href} className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-surface px-3.5 text-sm font-semibold hover:border-edge">
            {link.label}
            <span className="font-mono text-[11.5px] text-faint">{link.count}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
