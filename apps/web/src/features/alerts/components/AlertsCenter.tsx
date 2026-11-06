'use client';

import { usdText } from '@automarket/contracts';
import { ALERT_FREQUENCIES, ALERT_FREQUENCY_LABELS, SearchAlertCreateSchema, type AlertFrequency, type AlertNoticeDTO, type PriceDropAlertDTO, type SavedVehicleDTO, type SearchAlertDTO, type WatchAlertDTO } from '@automarket/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CircleAlert, Search, TrendingDown } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { vehicleKeys, vehiclesApi } from '@/features/vehicles/api';
import { cn } from '@/shared/lib/cn';
import { useSession } from '@/shared/lib/use-session';
import { MediaImage } from '@/shared/ui/media-image';
import { PageSpinner } from '@/shared/ui/spinner';
import { useToast } from '@/shared/ui/toaster';
import { alertKeys, alertsApi } from '../api';

const money = (value: number) => usdText(value);
const card = 'rounded-[22px] border border-line bg-surface';
const input = 'h-[46px] w-full rounded-[12px] border border-edge bg-field px-3.5 text-[15px] font-medium placeholder:text-faint';

/** «Toyota Corolla · hasta $19,000» */
function titleOf(alert: { make?: string | null; model?: string | null; maxPrice?: number | null }) {
  const name = [alert.make, alert.model].filter(Boolean).join(' ') || 'Cualquier auto';
  return alert.maxPrice ? `${name} · hasta ${money(alert.maxPrice)}` : name;
}
const placeOf = (alert: { city?: string | null; yearFrom?: number | null }) => [alert.city || 'Todo el país', alert.yearFrom ? `desde ${alert.yearFrom}` : null].filter(Boolean).join(' · ');

/** «hace 20 min», «hace 2 h», «ayer» o la fecha. */
function ago(iso: string) {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  if (hours < 48) return 'ayer';
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(iso)).replace('.', '');
}

type Draft = { make: string; model: string; maxPrice: string; city: string; yearFrom: string };
const EMPTY: Draft = { make: '', model: '', maxPrice: '', city: '', yearFrom: '' };
const digits = (value: string) => value.replace(/\D/g, '');

/** Formulario «Nueva alerta» con la vista previa real («hoy hay N autos así»). */
function NewAlertForm({ draft, setDraft, frequency, setFrequency, onClose, onCreated }: { draft: Draft; setDraft: (d: Draft) => void; frequency: AlertFrequency; setFrequency: (f: AlertFrequency) => void; onClose: () => void; onCreated: () => void }) {
  const id = useId();
  const session = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const country = session.status === 'authenticated' ? session.user.country : null;

  // Conteo real en el catálogo (con un pequeño respiro mientras se escribe).
  const params = new URLSearchParams();
  if (draft.make.trim()) params.set('make', draft.make.trim());
  if (draft.model.trim()) params.set('model', draft.model.trim());
  if (draft.maxPrice) params.set('priceMax', draft.maxPrice);
  if (country) params.set('country', country);
  if (draft.city.trim()) params.set('city', draft.city.trim());
  if (draft.yearFrom.length === 4) params.set('yearMin', draft.yearFrom);
  params.set('pageSize', '1');
  const query = params.toString();
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 350);
    return () => window.clearTimeout(timer);
  }, [query]);
  const preview = useQuery({ queryKey: vehicleKeys.search(`alert:${debounced}`), queryFn: ({ signal }) => vehiclesApi.search(debounced, signal), staleTime: 30_000 });
  const total = preview.data?.total;
  const parts = [draft.maxPrice ? `hasta ${money(Number(draft.maxPrice))}` : null, draft.city.trim() || 'todo el país', draft.yearFrom.length === 4 ? `desde ${draft.yearFrom}` : null].filter(Boolean).join(' · ');
  const name = [draft.make.trim(), draft.model.trim()].filter(Boolean).join(' ') || 'Cualquier auto';

  const create = useMutation({
    mutationFn: () =>
      alertsApi.create({
        make: draft.make.trim() || undefined,
        model: draft.model.trim() || undefined,
        maxPrice: draft.maxPrice ? Number(draft.maxPrice) : undefined,
        city: draft.city.trim() || undefined,
        yearFrom: draft.yearFrom ? Number(draft.yearFrom) : undefined,
        frequency,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: alertKeys.overview });
      toast({ tone: 'success', title: 'Alerta creada. Te avisamos apenas aparezca uno.' });
      onCreated();
    },
    onError: err => setError(err.message),
  });

  const field = (key: keyof Draft, label: string, placeholder: string, numeric = false) => (
    <div className="grid gap-1.5">
      <label htmlFor={`${id}-${key}`} className="text-sm font-semibold">
        {label}
      </label>
      <input
        id={`${id}-${key}`}
        value={draft[key]}
        inputMode={numeric ? 'numeric' : undefined}
        placeholder={placeholder}
        onChange={event => {
          setError(null);
          setDraft({ ...draft, [key]: numeric ? digits(event.target.value).slice(0, key === 'yearFrom' ? 4 : 9) : event.target.value });
        }}
        className={input}
      />
    </div>
  );

  return (
    <form
      aria-label="Nueva alerta"
      noValidate
      onSubmit={event => {
        event.preventDefault();
        const parsed = SearchAlertCreateSchema.safeParse({
          make: draft.make,
          model: draft.model,
          maxPrice: draft.maxPrice,
          city: draft.city,
          yearFrom: draft.yearFrom,
          frequency,
        });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? 'Revisa los datos de la alerta');
          return;
        }
        create.mutate();
      }}
      className="am-step-in grid gap-3.5 rounded-[22px] border border-ink bg-surface p-5"
    >
      <p className="text-lg font-extrabold">Nueva alerta</p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
        {field('make', 'Marca', 'Toyota')}
        {field('model', 'Modelo', 'Hilux')}
        {field('maxPrice', 'Precio máximo (USD)', '25000', true)}
        {field('city', 'Ciudad', 'Maracaibo')}
        {field('yearFrom', 'Desde el año', '2018', true)}
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-sm font-semibold">Avisarme</span>
        <div role="group" aria-label="Frecuencia" className="flex flex-wrap gap-1.5">
          {ALERT_FREQUENCIES.map(value => (
            <button
              key={value}
              type="button"
              aria-pressed={frequency === value}
              onClick={() => setFrequency(value)}
              className={cn('inline-flex min-h-10 items-center rounded-full border px-3.5 text-sm font-semibold', frequency === value ? 'border-ink bg-ink text-surface' : 'border-[#D8DBE0] bg-surface text-ink dark:border-line')}
            >
              {ALERT_FREQUENCY_LABELS[value]}
            </button>
          ))}
        </div>
      </div>
      <p aria-live="polite" className="text-[13.5px] font-bold text-brand-fg">
        {name} · {parts}
        {total === undefined ? '…' : `: hoy hay ${total} ${total === 1 ? 'auto' : 'autos'} así.`}
      </p>
      {error && (
        <p role="alert" className="flex gap-1.5 text-[13px] text-danger-fg">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={2.2} aria-hidden /> {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setError(null);
            onClose();
          }}
          className="h-[46px] rounded-full border border-edge bg-surface px-[18px] text-sm font-bold"
        >
          Cancelar
        </button>
        <button type="submit" disabled={create.isPending} className="h-[46px] flex-1 rounded-full bg-brand text-[14.5px] font-bold text-on-brand disabled:opacity-60">
          {create.isPending ? 'Creando…' : 'Crear alerta'}
        </button>
      </div>
    </form>
  );
}

/** Interruptor del diseño (46×28). */
function Switch({ on, label, onToggle, disabled }: { on: boolean; label: string; onToggle: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onToggle} className={cn('relative h-7 w-[46px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-60', on ? 'bg-brand' : 'bg-edge')}>
      <span className={cn('absolute top-[3px] left-[3px] size-[22px] rounded-full bg-white shadow-sm transition-transform duration-200 motion-reduce:transition-none', on && 'translate-x-[18px]')} />
    </button>
  );
}

function AlertShell({ icon, title, description, active, aside, children }: { icon: ReactNode; title: string; description: string; active: boolean; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className={cn(card, 'am-step-in grid gap-2.5 p-[18px] transition-opacity', !active && 'opacity-60')}>
      <div className="flex items-start gap-3">
        <span aria-hidden className={cn('grid size-[42px] shrink-0 place-items-center rounded-[12px] text-ink', active ? 'bg-soft' : 'bg-tile')}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-extrabold">{title}</h2>
          <p className="mt-0.5 text-[13.5px] text-muted">{description}</p>
        </div>
        {aside}
      </div>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-[13.5px]">{children}</div>
    </section>
  );
}

function SearchAlertCard({ alert }: { alert: SearchAlertDTO }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: alertKeys.overview });
  const toggle = useMutation({ mutationFn: () => alertsApi.setActive(alert.id, !alert.active), onSettled: refresh, onError: err => toast({ tone: 'error', title: 'No se pudo cambiar la alerta', description: err.message }) });
  const remove = useMutation({
    mutationFn: () => alertsApi.remove(alert.id),
    onSuccess: () => {
      refresh();
      toast({ tone: 'success', title: 'Alerta borrada.' });
    },
    onError: err => toast({ tone: 'error', title: 'No se pudo borrar', description: err.message }),
  });
  const title = titleOf(alert);
  const active = toggle.isPending ? !alert.active : alert.active;
  return (
    <AlertShell icon={<Search className="size-5" strokeWidth={2.2} />} title={title} description={placeOf(alert)} active={active} aside={<Switch on={active} label={`Alerta ${title}`} onToggle={() => toggle.mutate()} disabled={toggle.isPending} />}>
      {active && alert.newCount > 0 && <span className="inline-flex h-[26px] items-center rounded-full bg-soft px-2.5 font-extrabold text-brand-fg">{alert.newCount === 1 ? '1 nuevo' : `${alert.newCount} nuevos`}</span>}
      <span className="text-muted">{ALERT_FREQUENCY_LABELS[alert.frequency]}</span>
      <Link href={`/vehiculos?${alert.catalogQuery}`} onClick={() => void alertsApi.markSeen(alert.id).then(refresh)} className="ml-auto font-bold text-brand-fg underline underline-offset-[3px]">
        Ver autos
      </Link>
      <button type="button" disabled={remove.isPending} onClick={() => remove.mutate()} className="font-bold text-danger-fg disabled:opacity-60">
        Borrar
      </button>
    </AlertShell>
  );
}

function WatchCard({ watch }: { watch: WatchAlertDTO }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const remove = useMutation({
    mutationFn: () => vehiclesApi.unwatch(watch.vehicleId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: alertKeys.overview });
      void queryClient.invalidateQueries({ queryKey: vehicleKeys.watching });
      toast({ tone: 'success', title: 'Alerta borrada.' });
    },
    onError: err => toast({ tone: 'error', title: 'No se pudo borrar', description: err.message }),
  });
  const description = watch.inNegotiation ? 'Está en negociación. Si no se concreta, te avisamos.' : watch.status === 'RESERVED' ? 'Está reservado. Si se libera, te avisamos.' : 'Te avisamos cuando se pueda reservar.';
  return (
    <AlertShell icon={<Bell className="size-5" strokeWidth={2.2} />} title={`${watch.title} vuelve a estar disponible`} description={description} active>
      <span className="text-muted">{ALERT_FREQUENCY_LABELS.INSTANT}</span>
      <Link href={`/vehiculos/${watch.slug}`} className="ml-auto font-bold text-brand-fg underline underline-offset-[3px]">
        Ver auto
      </Link>
      <button type="button" disabled={remove.isPending} onClick={() => remove.mutate()} className="font-bold text-danger-fg disabled:opacity-60">
        Borrar
      </button>
    </AlertShell>
  );
}

/** «Bajadas de precio en tus guardados»: la alerta fija de los autos guardados. */
function PriceDropCard({ drops }: { drops: PriceDropAlertDTO }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const toggle = useMutation({
    mutationFn: () => alertsApi.setPriceDrops(!drops.active),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: alertKeys.overview }),
    onError: err => toast({ tone: 'error', title: 'No se pudo cambiar la alerta', description: err.message }),
  });
  const active = toggle.isPending ? !drops.active : drops.active;
  const title = 'Bajadas de precio en tus guardados';
  const description = drops.saved === 0 ? 'Toca «Guardar» en la ficha de un auto y te avisamos si baja.' : drops.saved === 1 ? '1 auto guardado' : `${drops.saved} autos guardados`;
  return (
    <AlertShell icon={<TrendingDown className="size-5" strokeWidth={2.2} />} title={title} description={description} active={active} aside={<Switch on={active} label={title} onToggle={() => toggle.mutate()} disabled={toggle.isPending} />}>
      {active && drops.newCount > 0 && <span className="inline-flex h-[26px] items-center rounded-full bg-soft px-2.5 font-extrabold text-brand-fg">{drops.newCount === 1 ? '1 nuevo' : `${drops.newCount} nuevos`}</span>}
      <span className="text-muted">{ALERT_FREQUENCY_LABELS.INSTANT}</span>
      {drops.saved > 0 && (
        <a href="#guardados" className="ml-auto font-bold text-brand-fg underline underline-offset-[3px]">
          Ver guardados
        </a>
      )}
    </AlertShell>
  );
}

/** Estado del auto guardado: bajó de precio, reservado / en negociación o vendido. */
function savedBadge(item: SavedVehicleDTO): { text: string; tone: string } | null {
  if (item.vehicle.status === 'SOLD') return { text: 'Vendido', tone: 'bg-tile text-muted' };
  if (item.vehicle.status === 'RESERVED') return { text: item.vehicle.inNegotiation ? 'En negociación' : 'Reservado', tone: 'bg-gold-soft text-gold-fg' };
  if (item.priceDrop > 0) return { text: `Bajó ${money(item.priceDrop)}`, tone: 'bg-success-soft text-success-fg' };
  return null;
}

function SavedRow({ item }: { item: SavedVehicleDTO }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const v = item.vehicle;
  const name = `${v.make} ${v.model}${v.version ? ` ${v.version}` : ''} ${v.year}`;
  const remove = useMutation({
    mutationFn: () => vehiclesApi.unsave(v.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: vehicleKeys.saved });
      void queryClient.invalidateQueries({ queryKey: vehicleKeys.savedIds });
      void queryClient.invalidateQueries({ queryKey: alertKeys.overview });
      toast({ tone: 'success', title: 'Quitado de tus guardados.' });
    },
    onError: err => toast({ tone: 'error', title: 'No se pudo quitar', description: err.message }),
  });
  const badge = savedBadge(item);
  return (
    <li className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3 border-t border-line py-3 first:border-t-0 first:pt-0">
      <Link href={`/vehiculos/${v.slug}`} tabIndex={-1} aria-hidden className="relative h-[54px] overflow-hidden rounded-[10px] bg-card-tile">
        {v.coverUrl && <MediaImage src={v.coverUrl} alt="" fill sizes="72px" className="object-cover" />}
      </Link>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 basis-[220px]">
          <Link href={`/vehiculos/${v.slug}`} className="block truncate text-[14.5px] font-bold hover:underline">
            {name}
          </Link>
          <p className="text-[13px] text-muted">
            <span className="font-bold text-ink tabular-nums">{money(Number(v.price))}</span> · {v.city} · {v.mileageKm.toLocaleString('de-DE')} km
            {item.priceDrop > 0 && v.status !== 'SOLD' && <> · antes {money(item.savedPrice)}</>}
          </p>
        </div>
        {badge && <span className={cn('inline-flex h-[26px] items-center rounded-full px-2.5 text-[12.5px] font-extrabold', badge.tone)}>{badge.text}</span>}
        <button type="button" disabled={remove.isPending} onClick={() => remove.mutate()} className="text-[13.5px] font-bold text-danger-fg disabled:opacity-60">
          Quitar
        </button>
      </div>
    </li>
  );
}

/** «Tus autos guardados» (los guarda el corazón de la ficha). */
function SavedList() {
  const saved = useQuery({ queryKey: vehicleKeys.saved, queryFn: vehiclesApi.saved });
  const items = saved.data ?? [];
  return (
    <section id="guardados" aria-label="Tus autos guardados" className={cn(card, 'scroll-mt-24 p-[18px]')}>
      <h2 className="text-[17px] font-extrabold">Tus autos guardados{items.length ? ` (${items.length})` : ''}</h2>
      {saved.isPending ? (
        <p className="mt-2 text-[13.5px] text-muted">Cargando…</p>
      ) : saved.isError ? (
        <p className="mt-2 text-[13.5px] text-danger-fg">{saved.error.message}</p>
      ) : items.length ? (
        <ul className="mt-3">
          {items.map(item => (
            <SavedRow key={item.vehicle.id} item={item} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[13.5px] text-muted">
          Aún no guardas autos. Toca «Guardar» en la ficha de un auto para seguirlo aquí;{' '}
          <Link href="/vehiculos" className="font-bold text-brand-fg underline underline-offset-[3px]">
            ver el catálogo
          </Link>
          .
        </p>
      )}
    </section>
  );
}

function Notice({ notice }: { notice: AlertNoticeDTO }) {
  const content = (
    <>
      <span className="relative h-10 overflow-hidden rounded-[10px] bg-card-tile">{notice.coverUrl && <MediaImage src={notice.coverUrl} alt="" fill sizes="56px" className="object-cover" />}</span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-bold">{notice.title}</span>
        <span className="block text-[12.5px] text-muted">
          {notice.body} · {ago(notice.createdAt)}
        </span>
      </span>
    </>
  );
  const className = cn('grid grid-cols-[56px_minmax(0,1fr)] gap-2.5 rounded-[14px] p-2.5', notice.readAt ? 'bg-surface hover:bg-tile/60' : 'bg-soft/70 dark:bg-soft');
  return notice.link ? (
    <Link href={notice.link} className={className}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

/** «Mis alertas» (diseño PC): búsquedas guardadas, autos que esperas y avisos recientes. */
export function AlertsCenter() {
  const overview = useQuery({ queryKey: alertKeys.overview, queryFn: alertsApi.overview });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [frequency, setFrequency] = useState<AlertFrequency>('INSTANT');

  const data = overview.data;
  const empty = data && data.alerts.length === 0 && data.watches.length === 0;
  return (
    <div data-own-header className="mx-auto grid max-w-[1180px] gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[clamp(28px,3vw,36px)] font-extrabold tracking-[-0.03em]">Mis alertas</h1>
          <p className="mt-1 text-[15px] text-muted">Te avisamos cuando aparece el auto que buscas, cuando baja uno que guardaste o cuando vuelve a estar disponible.</p>
        </div>
        <button type="button" onClick={() => setOpen(true)} className="h-12 rounded-full bg-brand px-5 text-[14.5px] font-bold text-on-brand max-sm:w-full">
          + Nueva alerta
        </button>
      </div>

      {overview.isPending ? (
        <PageSpinner />
      ) : overview.isError || !data ? (
        <p className="text-danger-fg">{overview.error?.message ?? 'No pudimos cargar tus alertas.'}</p>
      ) : (
        <div className="grid items-start gap-5 min-[900px]:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-3">
            {open && (
              <NewAlertForm
                draft={draft}
                setDraft={setDraft}
                frequency={frequency}
                setFrequency={setFrequency}
                onClose={() => setOpen(false)}
                onCreated={() => {
                  setOpen(false);
                  setDraft(EMPTY);
                }}
              />
            )}
            {data.alerts.map(alert => (
              <SearchAlertCard key={alert.id} alert={alert} />
            ))}
            {data.watches.map(watch => (
              <WatchCard key={watch.vehicleId} watch={watch} />
            ))}
            <PriceDropCard drops={data.priceDrops} />
            {empty && !open && (
              <div className={cn(card, 'grid justify-items-start gap-2 p-6')}>
                <p className="text-base font-extrabold">Aún no tienes alertas de búsqueda</p>
                <p className="text-sm text-muted">Crea una con la marca, el modelo o el precio que buscas, toca «Avísame si vuelve» en un auto reservado o en negociación, o guarda un auto para saber si baja.</p>
                <button type="button" onClick={() => setOpen(true)} className="mt-1 h-11 rounded-full bg-brand px-5 text-sm font-bold text-on-brand">
                  + Nueva alerta
                </button>
              </div>
            )}
            <SavedList />
          </div>

          <aside aria-label="Avisos recientes" className={cn(card, 'grid gap-2.5 p-[18px]')}>
            <h2 className="text-[17px] font-extrabold">Avisos recientes</h2>
            {data.recent.length ? data.recent.map(notice => <Notice key={notice.id} notice={notice} />) : <p className="text-[13.5px] text-muted">Todavía no hay avisos de tus alertas.</p>}
            <p className="mt-1 text-[12.5px] text-muted">Llegan a la campana de avisos. Puedes pausar una alerta cuando quieras.</p>
          </aside>
        </div>
      )}
    </div>
  );
}
