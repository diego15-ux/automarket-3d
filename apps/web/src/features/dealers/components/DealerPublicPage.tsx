'use client';

import { VEHICLE_CATEGORIES, countryName, type DealerPageDTO, type VehicleCategory } from '@automarket/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { chatApi } from '@/features/chat/api';
import { CATEGORY_PLURALS } from '@/features/landing/categories';
import { RateSeller } from '@/features/users/PublicProfile';
import { cn } from '@/shared/lib/cn';
import { formatDate, formatKm, formatMoney, formatNumber } from '@/shared/lib/format';
import { useSession } from '@/shared/lib/use-session';
import { buttonClasses } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/card';
import { MediaImage } from '@/shared/ui/media-image';
import { PageSpinner } from '@/shared/ui/spinner';
import { useToast } from '@/shared/ui/toaster';
import { dealersApi } from '../api';

type Tab = 'inv' | 'rev' | 'info';
const card = 'rounded-[20px] border border-line bg-surface';

/** «menos de 1 h», «unas 3 h», «unos 2 días»: la mediana real de la primera respuesta. */
function responseLabel(minutes: number | null) {
  if (minutes === null) return 'Sin datos aún';
  if (minutes < 60) return 'menos de 1 h';
  if (minutes < 24 * 60) return `unas ${Math.max(1, Math.round(minutes / 60))} h`;
  const days = Math.round(minutes / (24 * 60));
  return days === 1 ? 'un día' : `unos ${days} días`;
}

/** Dirección + ciudad sin repetir la ciudad cuando ya viene en la dirección. */
function addressLine(address: string | null, city: string | null) {
  if (!address) return city;
  if (!city || address.toLowerCase().includes(city.toLowerCase())) return address;
  return `${address}, ${city}`;
}

const monthYear = (iso: string) => new Date(iso).toLocaleDateString('es', { month: 'short', year: 'numeric' }).replace('.', '');

/** Portada de la agencia: colinas y un auto en blanco, como el diseño (decorativo). */
function Banner() {
  return (
    <div aria-hidden="true" className="relative h-[170px] overflow-hidden bg-[#1D2127]">
      <svg viewBox="0 0 1200 170" preserveAspectRatio="none" className="absolute inset-0 size-full">
        <path d="M0 130 C200 100 380 150 600 115 S1000 80 1200 100 L1200 170 L0 170Z" fill="#1D5240" />
        <path d="M0 150 C260 130 520 165 760 140 S1080 120 1200 135 L1200 170 L0 170Z" fill="#246049" />
      </svg>
      <svg viewBox="0 0 330 140" className="absolute right-[6%] bottom-3.5 w-[260px] opacity-95 max-sm:w-[180px]">
        <path d="M18 98c0-12 6-18 18-20l34-6 28-34c4-5 10-8 18-8h120c10 0 16 4 20 12l16 30 28 5c12 2 18 9 18 21v7c0 4-3 6-7 6h-17a28 28 0 0 0-54 0H107a28 28 0 0 0-54 0H25c-4 0-7-2-7-6z" fill="#F2F3F5" />
        <path d="M84 72l22-27c3-4 7-6 12-6h46v33z" fill="#1D2127" />
        <path d="M172 39h58c6 0 10 3 13 8l14 25h-85z" fill="#1D2127" />
        <circle cx="80" cy="111" r="23" fill="#0E0F11" />
        <circle cx="267" cy="111" r="23" fill="#0E0F11" />
      </svg>
    </div>
  );
}

function Inventory({ page }: { page: DealerPageDTO }) {
  const [category, setCategory] = useState<'ALL' | VehicleCategory>('ALL');
  const present = VEHICLE_CATEGORIES.filter(value => page.vehicles.some(vehicle => vehicle.category === value));
  const shown = category === 'ALL' ? page.vehicles : page.vehicles.filter(vehicle => vehicle.category === category);
  if (page.vehicles.length === 0) return <p className={cn(card, 'mt-4 p-5 text-sm text-muted')}>La agencia no tiene autos publicados ahora.</p>;

  return (
    <section id="dealer-panel-inv" role="tabpanel" aria-label="Inventario" className="mt-4">
      {present.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por categoría">
          {[{ key: 'ALL' as const, label: 'Todos' }, ...present.map(value => ({ key: value, label: CATEGORY_PLURALS[value] }))].map(chip => {
            const on = category === chip.key;
            return (
              <button
                key={chip.key}
                type="button"
                aria-pressed={on}
                onClick={() => setCategory(chip.key)}
                className={cn('h-10 rounded-full border px-4 text-[13.5px] font-bold transition-colors', on ? 'border-ink bg-ink text-canvas' : 'border-edge bg-surface text-ink hover:border-ink')}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      )}
      <ul className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-[18px]">
        {shown.map((vehicle, index) => {
          const tag = vehicle.status === 'RESERVED' ? 'Reservado' : vehicle.isFeatured ? 'Destacado' : null;
          return (
            <li key={vehicle.id}>
              <Link href={`/vehiculos/${vehicle.slug}`} className={cn(card, 'block overflow-hidden transition-colors hover:border-edge')}>
                <div className="relative aspect-[4/3] bg-sunken">
                  {vehicle.coverUrl ? (
                    <MediaImage src={vehicle.coverUrl} alt="" fill priority={index < 4} sizes="(min-width: 1024px) 300px, (min-width: 640px) 50vw, 100vw" className="object-cover" />
                  ) : (
                    <span className="grid h-full place-items-center text-sm text-muted">Sin foto</span>
                  )}
                  {tag && (
                    <span className={cn('absolute top-3 left-3 inline-flex h-7 items-center rounded-full px-3 text-xs font-extrabold', tag === 'Reservado' ? 'bg-gold-soft text-gold-fg' : 'bg-white text-[#15171a]')}>{tag}</span>
                  )}
                </div>
                <div className="px-4 pt-3.5 pb-4">
                  <div className="flex justify-between gap-2.5">
                    <span className="min-w-0 truncate text-[15px] font-bold">
                      {vehicle.make} {vehicle.model} {vehicle.year}
                    </span>
                    <span className="shrink-0 text-[15px] font-extrabold figures">{formatMoney(vehicle.price, vehicle.currency)}</span>
                  </div>
                  <p className="mt-1 text-[13.5px] text-muted">
                    {formatKm(vehicle.mileageKm)}, {vehicle.transmission === 'MANUAL' ? 'sincrónico' : 'automático'}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Reviews({ page }: { page: DealerPageDTO }) {
  return (
    <section id="dealer-panel-rev" role="tabpanel" aria-label="Reseñas" className="mt-4 grid gap-4">
      {page.reviews.length === 0 ? (
        <p className={cn(card, 'p-5 text-sm text-muted')}>Todavía no tiene reseñas. Solo puntúa quien compró con reserva.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
          {page.reviews.map(review => (
            <figure key={review.id} className={cn(card, 'm-0 p-5')}>
              <p className="text-[15px] tracking-[2px] text-brand-fg" role="img" aria-label={`${review.rating} de 5 estrellas`}>
                {'★'.repeat(review.rating)}
                <span className="text-edge">{'★'.repeat(5 - review.rating)}</span>
              </p>
              {review.comment ? <blockquote className="mt-2.5 text-[15.5px] leading-normal">«{review.comment}»</blockquote> : <p className="mt-2.5 text-sm text-muted">Puntuó sin dejar comentario.</p>}
              <figcaption className="mt-3 text-[13px] text-muted">
                <strong className="text-ink">{review.buyer}</strong> · compró {review.vehicleTitle} · {monthYear(review.createdAt)}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      <RateSeller sellerId={page.id} />
    </section>
  );
}

function Information({ page }: { page: DealerPageDTO }) {
  const place = [addressLine(page.address, page.city), page.country ? countryName(page.country) : null].filter(Boolean).join(', ');
  const mapQuery = place;
  return (
    <section id="dealer-panel-info" role="tabpanel" aria-label="Información" className="mt-4 flex flex-wrap gap-4">
      <div className={cn(card, 'flex-[1_1_360px] p-[22px]')}>
        <h2 className="text-lg font-extrabold">Sobre la agencia</h2>
        <p className="mt-2 text-[15px] leading-relaxed whitespace-pre-line text-ink/85">{page.bio || 'La agencia todavía no escribió su descripción.'}</p>
        <dl className="mt-3.5 grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted">Horario</dt>
          <dd>{page.hours || 'No lo indicó'}</dd>
          <dt className="text-muted">Dirección</dt>
          <dd>{place || 'No la indicó'}</dd>
          {page.taxId && (
            <>
              <dt className="text-muted">RIF</dt>
              <dd className="font-mono">{page.taxId}</dd>
            </>
          )}
          <dt className="text-muted">En AutoMarket desde</dt>
          <dd>{formatDate(page.memberSince)}</dd>
        </dl>
      </div>
      {mapQuery && (
        <div className="relative min-h-[240px] flex-[1_1_360px] overflow-hidden rounded-[20px] bg-[#E9EDE6] dark:bg-[#1B201D]">
          <svg aria-hidden="true" viewBox="0 0 600 240" preserveAspectRatio="none" className="absolute inset-0 size-full text-white dark:text-[#2A302C]">
            <path d="M0 160 C150 130 260 180 380 140 S540 100 600 120" stroke="currentColor" strokeWidth="14" fill="none" />
            <path d="M200 0 L240 240M420 0 L390 240M0 60 L600 40" stroke="currentColor" strokeWidth="8" fill="none" />
          </svg>
          <span aria-hidden="true" className="absolute top-[48%] left-1/2 grid size-10 -translate-x-1/2 -translate-y-full -rotate-45 place-items-center rounded-[999px_999px_999px_0] bg-brand">
            <span className="size-3 rounded-full bg-white" />
          </span>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute bottom-3.5 left-3.5 inline-flex h-10 items-center rounded-full bg-white px-3.5 text-[13.5px] font-extrabold text-[#15171a] hover:bg-white/90"
          >
            Cómo llegar
          </a>
        </div>
      )}
    </section>
  );
}

/** Página pública del concesionario (diseño «concesionario-publico-pc»): todo sale de la base. */
export function DealerPublicPage({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const session = useSession();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('inv');
  const page = useQuery({ queryKey: ['dealer-page', id], queryFn: () => dealersApi.page(id) });
  const signedIn = session.status === 'authenticated';
  const loginFirst = () => router.push(`/login?next=${encodeURIComponent(`/vendedores/${id}`)}`);

  const follow = useMutation({
    mutationFn: async (on: boolean) => {
      if (on) await dealersApi.follow(id);
      else await dealersApi.unfollow(id);
    },
    onSuccess: (_result, on) => {
      queryClient.setQueryData<DealerPageDTO>(['dealer-page', id], old => (old ? { ...old, following: on } : old));
      void queryClient.invalidateQueries({ queryKey: ['dealers'] });
      toast({ tone: 'success', title: on ? 'Ahora sigues a la agencia.' : 'Dejaste de seguir a la agencia.' });
    },
    onError: err => toast({ tone: 'error', title: 'No se pudo cambiar', description: err.message }),
  });
  const openChat = useMutation({
    mutationFn: (vehicleId: string) => chatApi.open(vehicleId),
    onSuccess: ({ id: conversationId }) => router.push(`/mensajes/${conversationId}`),
    onError: err => toast({ tone: 'error', title: 'No se pudo abrir el chat', description: err.message }),
  });

  if (page.isPending) return <PageSpinner />;
  if (page.isError) {
    return (
      <EmptyState
        title="No pudimos cargar la agencia"
        description={page.error.message}
        action={
          <Link href="/concesionarios" className={buttonClasses({ variant: 'outline' })}>
            Ver concesionarios
          </Link>
        }
      />
    );
  }

  const data = page.data;
  const average = data.ratingAverage === null ? null : data.ratingAverage.toLocaleString('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const line = [
    average ? `★ ${average}` : null,
    data.ratingCount > 0 ? `${formatNumber(data.ratingCount)} ${data.ratingCount === 1 ? 'reseña' : 'reseñas'}` : 'Sin reseñas aún',
    addressLine(data.address, data.city),
    data.hours,
  ].filter(Boolean);
  const facts = [
    { k: 'Autos publicados', v: formatNumber(data.activeListings) },
    { k: 'Autos vendidos aquí', v: formatNumber(data.soldCount) },
    { k: 'Responde en', v: responseLabel(data.responseMinutes) },
    { k: 'En AutoMarket desde', v: monthYear(data.memberSince) },
  ];
  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'inv', label: `Inventario · ${data.vehicles.length}` },
    { key: 'rev', label: `Reseñas · ${data.ratingCount}` },
    { key: 'info', label: 'Información' },
  ];

  function write() {
    if (!signedIn) return loginFirst();
    if (data.vehicles.length === 1) return openChat.mutate(data.vehicles[0]!.id);
    setTab('inv');
    toast({ tone: 'info', title: 'Elige el auto sobre el que quieres escribirle a la agencia.' });
  }

  return (
    <div data-own-header className="mx-auto max-w-[1320px]">
      <section aria-labelledby="dealer-t" className="overflow-hidden rounded-[28px] border border-line bg-surface">
        <Banner />
        <div className="flex flex-wrap items-end gap-5 px-[clamp(20px,3vw,32px)] pb-6">
          <span className="relative -mt-11 grid size-[104px] shrink-0 place-items-center overflow-hidden rounded-[28px] bg-ink text-[34px] font-extrabold text-canvas shadow-[0_0_0_6px_var(--color-surface)]">
            {data.avatarUrl ? <MediaImage src={data.avatarUrl} alt="" fill sizes="104px" className="object-cover" /> : data.initials}
          </span>
          <div className="min-w-0 flex-[1_1_320px] pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <h1 id="dealer-t" className="text-[clamp(26px,2.8vw,34px)] font-extrabold tracking-[-0.03em]">
                {data.name}
              </h1>
              {(data.ally || data.verified) && (
                <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-success-soft px-2.5 text-[12.5px] font-extrabold text-success-fg">✓ {data.ally ? 'RIF verificado' : 'Identidad verificada'}</span>
              )}
              <span className="inline-flex h-7 items-center rounded-full bg-ink px-2.5 text-[12.5px] font-extrabold text-canvas">Concesionario</span>
            </div>
            <p className="mt-1.5 text-[14.5px] text-muted">{line.join(' · ')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.isOwner ? (
              <Link href="/cuenta/perfil?tab=cuenta" className="inline-flex h-[46px] items-center rounded-full border border-ink px-[18px] text-sm font-extrabold">
                Editar mi página
              </Link>
            ) : (
              <>
                {data.ally && (
                  <button
                    type="button"
                    aria-pressed={data.following}
                    disabled={follow.isPending}
                    onClick={() => (signedIn ? follow.mutate(!data.following) : loginFirst())}
                    className={cn('h-[46px] rounded-full border border-ink px-[18px] text-sm font-extrabold transition-colors disabled:opacity-60', data.following ? 'bg-ink text-canvas' : 'bg-surface text-ink')}
                  >
                    {data.following ? 'Siguiendo ✓' : 'Seguir agencia'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={write}
                  disabled={data.vehicles.length === 0 || openChat.isPending}
                  title={data.vehicles.length === 0 ? 'La agencia no tiene autos publicados' : undefined}
                  className="inline-flex h-[46px] items-center gap-2 rounded-full bg-brand px-5 text-sm font-extrabold text-on-brand disabled:opacity-60"
                >
                  Escribir a la agencia
                </button>
              </>
            )}
          </div>
        </div>
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] border-t border-line">
          {facts.map(fact => (
            <div key={fact.k} className="border-r border-line px-[clamp(20px,3vw,32px)] py-4 last:border-r-0">
              <dt className="text-[12.5px] text-muted">{fact.k}</dt>
              <dd className="mt-1 text-[19px] font-extrabold">{fact.v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div role="tablist" aria-label="Secciones de la agencia" className="mt-5 inline-flex rounded-full bg-ink/[0.06] p-1">
        {tabs.map(item => (
          <button
            key={item.key}
            type="button"
            role="tab"
            id={`dealer-tab-${item.key}`}
            aria-selected={tab === item.key}
            aria-controls={`dealer-panel-${item.key}`}
            onClick={() => setTab(item.key)}
            className={cn('h-10 rounded-full px-[18px] text-sm font-bold transition-colors', tab === item.key ? 'bg-surface text-ink shadow-[0_1px_3px_rgb(17_19_18/0.12)]' : 'text-muted hover:text-ink')}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'inv' && <Inventory page={data} />}
      {tab === 'rev' && <Reviews page={data} />}
      {tab === 'info' && <Information page={data} />}
    </div>
  );
}
