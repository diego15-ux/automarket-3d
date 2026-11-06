'use client';

import { countryName, type DealerDirectoryEntryDTO } from '@automarket/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { useSession } from '@/shared/lib/use-session';
import { MediaImage } from '@/shared/ui/media-image';
import { useToast } from '@/shared/ui/toaster';
import { dealerKeys, dealersApi } from '../api';

type Sort = 'sold' | 'rating' | 'listings';

/** Color estable por agencia (paleta del diseño) cuando no subió su logo. */
const AVATAR_COLORS = ['#B30E29', '#2F4A7A', '#6B7F8F', '#7A1F2B', '#C9771A', '#1C1D1F', '#4A505A', '#3730A3', '#8A5A00', '#B4402F'];
const colorOf = (id: string) => AVATAR_COLORS[[...id].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7) % AVATAR_COLORS.length];

/** Iniciales: primeras letras de las 2 primeras palabras de más de 2 letras («Autos del Centro» → «AC»). */
function initials(name: string) {
  const words = name.split(/\s+/).filter(word => word.replace(/[^\p{L}\p{N}]/gu, '').length > 2).slice(0, 2);
  const letters = (words.length > 0 ? words : [name]).map(word => word.replace(/[^\p{L}\p{N}]/gu, '').charAt(0)).join('');
  return (letters || name.slice(0, 2)).toUpperCase();
}

const normalize = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
const decimal = (value: number) => value.toLocaleString('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Directorio público de concesionarios aliados (diseño «concesionarios-pc»), con datos reales. */
export function DealersDirectory() {
  const session = useSession();
  const viewer = session.status === 'authenticated' ? session.user.id : session.status;
  const directory = useQuery({ queryKey: dealerKeys.directory(viewer), queryFn: dealersApi.directory, enabled: session.status !== 'loading' });
  const [country, setCountry] = useState('all');
  const [city, setCity] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('sold');

  const dealers = useMemo(() => directory.data ?? [], [directory.data]);

  // Conteos sobre la lista completa: no cambian con la búsqueda.
  const countries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const dealer of dealers) if (dealer.country) counts.set(dealer.country, (counts.get(dealer.country) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || countryName(a[0]).localeCompare(countryName(b[0]), 'es'));
  }, [dealers]);
  const cities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const dealer of dealers) {
      if (!dealer.city || (country !== 'all' && dealer.country !== country)) continue;
      counts.set(dealer.city, (counts.get(dealer.city) ?? 0) + 1);
    }
    return [...counts];
  }, [dealers, country]);
  const countryTotal = country === 'all' ? dealers.length : (countries.find(([code]) => code === country)?.[1] ?? 0);

  const visible = useMemo(() => {
    const needle = normalize(query);
    const list = dealers.filter(dealer => {
      if (country !== 'all' && dealer.country !== country) return false;
      if (city !== 'all' && dealer.city !== city) return false;
      if (!needle) return true;
      return normalize([dealer.name, dealer.city ?? '', ...dealer.brands].join(' ')).includes(needle);
    });
    const score = (dealer: DealerDirectoryEntryDTO) => (sort === 'sold' ? dealer.soldLast6Months : sort === 'rating' ? (dealer.ratingAverage ?? -1) : dealer.activeListings);
    return list.map((dealer, index) => ({ dealer, index })).sort((a, b) => score(b.dealer) - score(a.dealer) || a.index - b.index).map(row => row.dealer);
  }, [dealers, country, city, query, sort]);

  const counter =
    visible.length === 1
      ? '1 concesionario aliado'
      : `${visible.length} concesionarios aliados${country !== 'all' ? ` en ${countryName(country)}` : ''}`;

  const showAll = () => {
    setCountry('all');
    setCity('all');
    setQuery('');
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[clamp(28px,4vw,36px)] leading-tight font-extrabold tracking-[-0.03em] text-ink">Concesionarios aliados</h1>
          <p className="mt-1 text-[15px] text-muted">Agencias con RIF revisado por AutoMarket.</p>
        </div>
        <Link href="/registro?tipo=concesionario" className="inline-flex h-12 items-center rounded-full bg-mine px-5 text-[14.5px] font-bold text-on-mine hover:opacity-90">
          ¿Tienes una agencia? Hazte aliado
        </Link>
      </div>

      <div className="grid gap-3 rounded-[22px] border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-[1_1_280px]">
            <label htmlFor="dealer-q" className="sr-only">
              Buscar concesionario
            </label>
            <input
              id="dealer-q"
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Nombre, ciudad o marca que venden"
              className="box-border h-12 w-full rounded-full border border-edge bg-surface px-4 text-[15px] font-medium text-ink placeholder:text-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
            />
          </div>
          <label htmlFor="dealer-sort" className="text-sm text-muted">
            Ordenar
          </label>
          <select
            id="dealer-sort"
            value={sort}
            onChange={event => setSort(event.target.value as Sort)}
            className="h-12 rounded-full border border-edge bg-surface px-3.5 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
          >
            <option value="sold">Más ventas</option>
            <option value="rating">Mejor calificados</option>
            <option value="listings">Más autos</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-sm font-bold text-ink">País</span>
          <div role="group" aria-label="Filtrar por país" className="flex flex-wrap gap-1.5">
            <Chip
              label="Todos"
              count={dealers.length}
              selected={country === 'all'}
              onClick={() => {
                setCountry('all');
                setCity('all');
              }}
            />
            {countries.map(([code, count]) => (
              <Chip
                key={code}
                label={countryName(code)}
                count={count}
                selected={country === code}
                onClick={() => {
                  setCountry(code);
                  setCity('all');
                }}
              />
            ))}
          </div>
        </div>

        {cities.length > 1 && (
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-sm font-bold text-ink">Ciudad</span>
            <div role="group" aria-label="Filtrar por ciudad" className="flex flex-wrap gap-1.5">
              <Chip label="Todas" count={countryTotal} selected={city === 'all'} onClick={() => setCity('all')} />
              {cities.map(([name, count]) => (
                <Chip key={name} label={name} count={count} selected={city === name} onClick={() => setCity(name)} />
              ))}
            </div>
          </div>
        )}
      </div>

      {directory.isPending ? (
        <ul aria-hidden className="grid list-none grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3.5 p-0">
          {[0, 1, 2].map(index => (
            <li key={index} className="h-[236px] animate-pulse rounded-[22px] border border-line bg-surface" />
          ))}
        </ul>
      ) : directory.isError ? (
        <div className="rounded-[22px] border border-line bg-surface p-7 text-center">
          <p className="text-base font-bold text-ink">No pudimos cargar los aliados</p>
          <p className="mt-1.5 mb-3.5 text-sm text-muted">Revisa tu conexión e inténtalo otra vez.</p>
          <button type="button" onClick={() => directory.refetch()} className="h-11 rounded-full border border-edge bg-surface px-[18px] text-sm font-bold text-ink hover:border-ink">
            Reintentar
          </button>
        </div>
      ) : (
        <>
          <p aria-live="polite" className="m-0 text-sm text-muted">
            {counter}
          </p>
          {visible.length > 0 && (
            <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3.5 p-0">
              {visible.map(dealer => (
                <DealerCard key={dealer.id} dealer={dealer} mine={session.status === 'authenticated' && session.user.id === dealer.id} />
              ))}
            </ul>
          )}
          {visible.length === 0 && dealers.length === 0 && (
            <div className="rounded-[22px] border border-line bg-surface p-7 text-center">
              <p className="text-base font-bold text-ink">Todavía no hay concesionarios aliados</p>
              <p className="mt-1.5 mb-3.5 text-sm text-muted">Cada agencia aparece aquí cuando revisamos su RIF.</p>
              <Link href="/registro?tipo=concesionario" className="inline-flex h-11 items-center rounded-full border border-edge bg-surface px-[18px] text-sm font-bold text-ink hover:border-ink">
                Registrar mi agencia
              </Link>
            </div>
          )}
          {visible.length === 0 && dealers.length > 0 && (
            <div className="rounded-[22px] border border-line bg-surface p-7 text-center">
              <p className="text-base font-bold text-ink">No hay aliados con esos filtros todavía</p>
              <p className="mt-1.5 mb-3.5 text-sm text-muted">Prueba con otro país o ciudad.</p>
              <button type="button" onClick={showAll} className="h-11 rounded-full border border-edge bg-surface px-[18px] text-sm font-bold text-ink hover:border-ink">
                Ver todos
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Chip({ label, count, selected, onClick }: { label: string; count: number; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold',
        selected ? 'border-mine bg-mine text-on-mine' : 'border-edge bg-surface text-ink hover:border-ink',
      )}
    >
      {label}
      <span className="font-mono text-[11.5px] font-medium opacity-75">{count}</span>
    </button>
  );
}

function DealerCard({ dealer, mine }: { dealer: DealerDirectoryEntryDTO; mine: boolean }) {
  const session = useSession();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const place = [dealer.city, countryName(dealer.country)].filter(Boolean).join(', ');

  const follow = useMutation({
    mutationFn: async () => {
      if (dealer.following) await dealersApi.unfollow(dealer.id);
      else await dealersApi.follow(dealer.id);
    },
    onSuccess: () => {
      toast({ tone: 'success', title: dealer.following ? `Dejaste de seguir a ${dealer.name}` : `Te avisamos cuando ${dealer.name} publique un auto` });
      queryClient.setQueriesData<DealerDirectoryEntryDTO[]>({ queryKey: ['dealers'] }, list => list?.map(item => (item.id === dealer.id ? { ...item, following: !dealer.following } : item)));
    },
    onError: (error: Error) => toast({ tone: 'error', title: 'No se pudo completar', description: error.message }),
  });

  const onFollow = () => {
    if (session.status !== 'authenticated') {
      router.push('/login?next=/concesionarios');
      return;
    }
    follow.mutate();
  };

  return (
    <li className="am-step-in grid content-start gap-3 rounded-[22px] border border-line bg-surface p-[18px]">
      <div className="flex items-center gap-3">
        {dealer.avatarUrl ? (
          <MediaImage src={dealer.avatarUrl} alt="" width={52} height={52} className="size-[52px] shrink-0 rounded-[14px] object-cover" />
        ) : (
          <span aria-hidden className="grid size-[52px] shrink-0 place-items-center rounded-[14px] text-[17px] font-extrabold text-white" style={{ background: colorOf(dealer.id) }}>
            {initials(dealer.name)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-extrabold text-ink">{dealer.name}</p>
          {place && <p className="mt-0.5 truncate text-[13.5px] text-muted">{place}</p>}
        </div>
        {dealer.planCode === 'DEALER_PRO' && <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-[#15171a] px-[9px] text-[11.5px] font-extrabold text-mint">Pro</span>}
      </div>

      <p className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[13.5px] text-ink">
        <span className="font-bold text-success-fg">✓ RIF verificado</span>
        {dealer.ratingAverage !== null ? (
          <span>
            <b className="text-[#B7791F]" aria-hidden>
              ★
            </b>{' '}
            <span className="sr-only">Calificación </span>
            {decimal(dealer.ratingAverage)} <span className="text-muted">({dealer.ratingCount})</span>
          </span>
        ) : (
          <span className="text-muted">Sin reseñas</span>
        )}
        <span>{dealer.activeListings === 1 ? '1 auto' : `${dealer.activeListings} autos`}</span>
        <span className="text-muted">desde {dealer.memberSinceYear}</span>
      </p>

      {dealer.brands.length > 0 && (
        <ul className="flex list-none flex-wrap gap-1.5 p-0" aria-label="Marcas que vende">
          {dealer.brands.map(brand => (
            <li key={brand} className="inline-flex h-7 items-center rounded-full bg-tile px-2.5 text-[12.5px] font-semibold text-ink">
              {brand}
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <Link href={`/vendedores/${dealer.id}`} className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-brand text-sm font-bold text-on-brand hover:bg-brand-600">
          Ver sus autos
        </Link>
        {!mine && (
          <button
            type="button"
            aria-pressed={dealer.following}
            disabled={follow.isPending}
            onClick={onFollow}
            className="h-11 rounded-full border border-edge bg-surface px-4 text-sm font-bold text-ink hover:border-ink disabled:opacity-60"
          >
            {dealer.following ? 'Siguiendo' : 'Seguir'}
          </button>
        )}
      </div>
    </li>
  );
}
