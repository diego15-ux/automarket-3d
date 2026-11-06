'use client';

import { usdText } from '@automarket/contracts';
import { BlockedTermSchema, type ReportCaseDTO, type ReportCaseKind, type ReportCaseReason, type ReportCaseStatus, type ReportDecision } from '@automarket/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CarSilhouette } from '@/features/boosts/components/CarSilhouette';
import { cn } from '@/shared/lib/cn';
import { useSession } from '@/shared/lib/use-session';
import { PageSpinner } from '@/shared/ui/spinner';
import { useToast } from '@/shared/ui/toaster';
import { adminApi, adminKeys } from '../api';

const TABS: Array<[ReportCaseStatus, string]> = [
  ['OPEN', 'Abiertos'],
  ['RESOLVED', 'Resueltos'],
  ['DISMISSED', 'Descartados'],
];
const KINDS: Array<['ALL' | ReportCaseKind, string]> = [
  ['ALL', 'Todos'],
  ['VEHICLE', 'Anuncios'],
  ['USER', 'Usuarios'],
  ['CHAT', 'Chat'],
];
const KIND_LABEL: Record<ReportCaseKind, string> = { VEHICLE: 'Anuncio', USER: 'Usuario', CHAT: 'Chat' };
const REASON: Record<ReportCaseReason, { label: string; className: string }> = {
  FRAUD: { label: 'Posible fraude', className: 'bg-danger-soft text-danger-fg' },
  OFFENSIVE: { label: 'Ofensivo', className: 'bg-[#F3E8FF] text-[#6B21A8] dark:bg-[rgb(168_85_247/0.16)] dark:text-[#D8B4FE]' },
  WRONG_INFO: { label: 'Datos incorrectos', className: 'bg-gold-soft text-gold-fg' },
  SPAM: { label: 'Spam o duplicado', className: 'bg-reserved-soft text-reserved-fg' },
  OTHER: { label: 'Otro', className: 'bg-sunken text-muted' },
};
const STATUS: Record<ReportCaseStatus, { label: string; className: string }> = {
  OPEN: { label: 'Abierto', className: 'bg-gold-soft text-gold-fg' },
  RESOLVED: { label: 'Resuelto', className: 'bg-success-soft text-success-fg' },
  DISMISSED: { label: 'Descartado', className: 'bg-sunken text-muted' },
};
const DAY_MS = 86_400_000;

/** «hace 25 min», «hace 3 h», «hace 2 d» */
function ago(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `hace ${minutes} min`;
  if (minutes < 1440) return `hace ${Math.round(minutes / 60)} h`;
  return `hace ${Math.round(minutes / 1440)} d`;
}
const money = (value: string | number) => usdText(Number(value));

/** Bandeja «Reportes» (diseño «admin-reportes»): casos reales agrupados y decisiones del equipo. */
export function AdminReports() {
  const [status, setStatus] = useState<ReportCaseStatus>('OPEN');
  const [kind, setKind] = useState<'ALL' | ReportCaseKind>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const board = useQuery({ queryKey: adminKeys.reportsBoard(status), queryFn: () => adminApi.reportsBoard(status), refetchInterval: 60_000 });

  const items = useMemo(() => (board.data?.items ?? []).filter(item => kind === 'ALL' || item.kind === kind), [board.data, kind]);
  const selected = items.find(item => item.id === selectedId) ?? items[0] ?? null;
  const kpis = board.data?.kpis;

  return (
    <div className="grid gap-[18px]">
      <div>
        <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-ink">Reportes</h1>
        <p className="mt-0.5 text-sm text-muted">Lo que denuncian personas y concesionarios: anuncios, usuarios y mensajes del chat. Los de fraude van primero.</p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <Kpi label="Abiertos" value={kpis ? String(kpis.open) : '—'} />
        <Kpi label="Posible fraude" value={kpis ? String(kpis.fraud) : '—'} className="text-danger-fg" />
        <Kpi label="Resueltos esta semana" value={kpis ? String(kpis.resolvedThisWeek) : '—'} className="text-brand-fg" />
        <Kpi label="Respuesta promedio" value={kpis?.avgResponseHours != null ? (kpis.avgResponseHours < 1 ? `${Math.max(1, Math.round(kpis.avgResponseHours * 60))} min` : `${kpis.avgResponseHours.toLocaleString('es')} h`) : '—'} />
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <div role="tablist" aria-label="Estado" className="inline-flex rounded-full bg-sunken p-1">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={status === key}
              onClick={() => {
                setStatus(key);
                setSelectedId(null);
              }}
              className={cn('inline-flex h-[38px] items-center gap-1.5 rounded-full px-4 text-[13.5px] font-bold', status === key ? 'bg-surface text-ink shadow-[0_1px_3px_rgb(17_19_18/0.12)]' : 'text-muted')}
            >
              {label} <span className="font-mono text-[11px] font-medium">{board.data?.counts[key] ?? 0}</span>
            </button>
          ))}
        </div>
        <div role="group" aria-label="Tipo" className="flex flex-wrap gap-1.5">
          {KINDS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={kind === key}
              onClick={() => {
                setKind(key);
                setSelectedId(null);
              }}
              className={cn('h-9 rounded-full border px-3.5 text-[13px] font-semibold', kind === key ? 'border-mine bg-mine text-on-mine' : 'border-edge bg-surface text-ink')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {board.isPending ? (
        <PageSpinner />
      ) : board.isError ? (
        <p className="text-danger-fg">{board.error.message}</p>
      ) : (
        <div className="grid items-start gap-4 min-[900px]:grid-cols-[minmax(300px,420px)_minmax(0,1fr)]">
          <ul aria-label="Lista de reportes" className="grid list-none gap-2 p-0">
            {items.length === 0 && <li className="rounded-[22px] border border-line bg-surface p-6 text-sm text-muted">No hay reportes aquí. Todo al día.</li>}
            {items.map(item => {
              const active = selected?.id === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSelectedId(item.id)}
                    className={cn('grid w-full gap-1.5 rounded-[18px] border-[1.5px] p-3.5 text-left transition-colors duration-200', active ? 'border-ink bg-surface' : 'border-line bg-surface/70 hover:border-edge')}
                  >
                    <span className="flex items-center gap-2">
                      <ReasonPill reason={item.reason} />
                      <span className="font-mono text-[11.5px] font-medium text-muted">{KIND_LABEL[item.kind]}</span>
                      <span className="ml-auto text-[12.5px] text-muted">{ago(item.createdAt)}</span>
                    </span>
                    <span className="text-[15px] font-extrabold text-ink">{item.title}</span>
                    {item.details && <span className="line-clamp-2 text-[13.5px] leading-[1.4] text-ink/80">«{item.details}»</span>}
                    <span className="flex gap-2.5 text-[12.5px] text-muted">
                      {item.count === 1 ? '1 reporte' : `${item.count} reportes`}
                      {item.status !== 'OPEN' && <span className="font-bold text-brand-fg">{STATUS[item.status].label}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {selected && <Detail key={selected.id} item={selected} onDecided={() => setSelectedId(null)} />}
        </div>
      )}

      <BlockedTerms />
    </div>
  );
}

function Kpi({ label, value, className = 'text-ink' }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-[22px] border border-line bg-surface px-4 py-3.5">
      <p className="text-[13px] text-muted">{label}</p>
      <p className={cn('mt-1 text-[26px] leading-none font-extrabold', className)}>{value}</p>
    </div>
  );
}

function ReasonPill({ reason, big = false }: { reason: ReportCaseReason; big?: boolean }) {
  return <span className={cn('inline-flex items-center rounded-full font-extrabold', big ? 'h-[26px] px-2.5 text-[12.5px]' : 'h-6 px-[9px] text-xs', REASON[reason].className)}>{REASON[reason].label}</span>;
}

function Detail({ item, onDecided }: { item: ReportCaseDTO; onDecided: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const session = useSession();
  const [note, setNote] = useState('');
  const [armed, setArmed] = useState<ReportDecision | null>(null);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(null), 8_000);
    return () => clearTimeout(timer);
  }, [armed]);
  const admin = session.status === 'authenticated' && ['ADMIN', 'ADMIN_ONE'].includes(session.user.role);
  const chat = useQuery({ queryKey: adminKeys.reportChat(item.id), queryFn: () => adminApi.reportChat(item.id), enabled: item.kind === 'CHAT' });

  const decide = useMutation({
    mutationFn: (action: ReportDecision) => adminApi.decideReport(item.id, { action, note: note.trim() || undefined }),
    onSuccess: (data, action) => {
      const name = data.name;
      toast({
        tone: 'success',
        title: action === 'ARCHIVE' ? `Anuncio retirado. ${name} recibe un aviso con el motivo.` : action === 'SUSPEND' ? `Cuenta de ${name} suspendida.` : action === 'WARN' ? `Advertencia enviada a ${name}.` : 'Reporte descartado.',
      });
      setArmed(null);
      setNote('');
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
      onDecided();
    },
    onError: (error: Error) => toast({ tone: 'error', title: 'No se pudo completar', description: error.message }),
  });

  const danger = (action: 'ARCHIVE' | 'SUSPEND', label: string, confirm: string) => (
    <button
      type="button"
      disabled={decide.isPending}
      onClick={() => (armed === action ? decide.mutate(action) : setArmed(action))}
      className={cn('h-11 rounded-full border px-4 text-sm font-bold disabled:opacity-60', armed === action ? 'border-danger bg-danger text-white' : 'border-danger bg-surface text-danger-fg')}
    >
      {armed === action ? confirm : label}
    </button>
  );

  const person = item.reported;
  const plan = person ? (person.dealer ? `Concesionario ${person.planCode === 'DEALER_PRO' ? 'Pro' : person.planCode === 'DEALER_BASIC' ? 'Básico' : ''}`.trim() : 'Persona') : null;
  const accountAge = person ? Math.floor((Date.now() - new Date(person.since).getTime()) / DAY_MS) : 0;
  const personSub = person
    ? [
        plan,
        person.status === 'SUSPENDED' ? 'suspendida' : person.verified ? (person.dealer ? 'RIF verificado' : 'verificado') : 'sin verificar',
        accountAge < 30 ? (accountAge === 0 ? 'cuenta creada hoy' : `cuenta de hace ${accountAge === 1 ? '1 día' : `${accountAge} días`}`) : null,
        person.listings === 1 ? '1 anuncio' : `${person.listings} anuncios`,
        person.previousReports > 0 ? `${person.previousReports} ${person.previousReports === 1 ? 'reporte' : 'reportes'} antes` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  const v = item.vehicle;
  const canSuspend = admin && person !== null && (item.kind !== 'VEHICLE' || item.reason === 'FRAUD') && person.status !== 'SUSPENDED';

  return (
    <section aria-label="Detalle del reporte" className="am-step-in grid gap-4 rounded-[22px] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <ReasonPill reason={item.reason} big />
        <span className="font-mono text-xs font-medium text-muted">
          {item.code} · {ago(item.createdAt)}
        </span>
        <span className={cn('ml-auto inline-flex h-[26px] items-center rounded-full px-2.5 text-[12.5px] font-bold', STATUS[item.status].className)}>{STATUS[item.status].label}</span>
      </div>
      <h2 className="text-[22px] font-extrabold tracking-[-0.02em] text-ink">{item.title}</h2>

      {v && item.kind === 'VEHICLE' && (
        <div className="flex flex-wrap items-center gap-3.5 rounded-2xl bg-canvas p-3">
          <span className="relative block h-20 w-[120px] shrink-0 overflow-hidden rounded-xl bg-card-tile">
            <CarSilhouette category={v.category as Parameters<typeof CarSilhouette>[0]['category']} className="absolute top-[56%] left-1/2 w-[88%] -translate-x-1/2 -translate-y-1/2" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-extrabold text-ink">{v.title}</p>
            <p className="text-[13.5px] text-muted">
              {v.city} · {v.mileageKm.toLocaleString('de-DE')} km{v.publishedAt ? ` · publicado ${ago(v.publishedAt)}` : ''}
              {v.status === 'ARCHIVED' ? ' · retirado' : ''}
            </p>
            <p className="text-[13.5px] text-ink">
              <b>{money(v.price)}</b>{' '}
              {v.market ? (
                v.market.diffPct <= -25 ? (
                  <span className="text-danger-fg">· {Math.abs(v.market.diffPct)} % por debajo del mercado ({money(v.market.value)})</span>
                ) : (
                  <span className="text-brand-fg">· precio de mercado normal</span>
                )
              ) : (
                <span className="text-muted">· sin autos parecidos para comparar</span>
              )}
            </p>
          </div>
          <Link href={`/vehiculos/${v.slug}`} className="inline-flex h-10 items-center rounded-full border border-edge px-3.5 text-[13.5px] font-bold text-ink hover:border-ink">
            Ver anuncio
          </Link>
        </div>
      )}

      {item.kind === 'CHAT' && (
        <div className="grid gap-2 rounded-2xl bg-canvas p-3.5">
          <p className="font-mono text-xs font-medium text-muted">Mensajes del chat{chat.data ? ` · ${chat.data.vehicleTitle}` : ''}</p>
          {chat.isPending && <p className="text-sm text-muted">Cargando…</p>}
          {chat.data?.messages.length === 0 && <p className="text-sm text-muted">El chat no tiene mensajes de texto.</p>}
          {chat.data?.messages.map(message => (
            <div
              key={message.id}
              className={cn(
                'max-w-[80%] rounded-[14px] border-[1.5px] px-3 py-2.5 text-sm leading-[1.4]',
                message.role === 'SELLER' ? 'justify-self-end' : 'justify-self-start',
                message.flagged ? 'border-danger bg-danger-soft text-danger-fg' : message.role === 'SELLER' ? 'border-transparent bg-[#15171a] text-white' : 'border-transparent bg-surface text-ink',
              )}
            >
              <span className="block text-[11.5px] font-bold opacity-75">
                {message.role === 'SELLER' ? 'Vendedor' : 'Comprador'}: {message.author}
              </span>
              {message.type === 'TEXT' ? (message.body ?? '') : message.type === 'AUDIO' ? '[nota de voz]' : message.type === 'IMAGE' ? '[foto]' : `[${message.type.toLowerCase()}]`}
              {message.hidden && <span className="mt-0.5 block text-[11.5px] opacity-75">El moderador ocultó datos de este mensaje.</span>}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        <div className="rounded-2xl border border-line px-3.5 py-3">
          <p className="font-mono text-[11.5px] font-medium tracking-[0.05em] text-muted uppercase">Denunciado</p>
          {person ? (
            <>
              <Link href={`/vendedores/${person.id}`} className="mt-1 block text-[15px] font-extrabold text-ink hover:underline">
                {person.name}
              </Link>
              <p className="mt-0.5 text-[13px] text-muted">{personSub}</p>
            </>
          ) : (
            <p className="mt-1 text-[15px] font-extrabold text-ink">—</p>
          )}
        </div>
        <div className="rounded-2xl border border-line px-3.5 py-3">
          <p className="font-mono text-[11.5px] font-medium tracking-[0.05em] text-muted uppercase">Lo reportó</p>
          <p className="mt-1 text-[15px] font-extrabold text-ink">{item.reporter.name}</p>
          <p className="mt-0.5 text-[13px] text-muted">{item.count > 1 ? `${item.count} personas lo reportaron` : '1 reporte'}</p>
        </div>
      </div>

      {item.details && <blockquote className="m-0 rounded-r-xl border-l-[3px] border-ink bg-canvas px-3.5 py-3 text-[14.5px] leading-normal text-ink">«{item.details}»</blockquote>}

      <div className="flex gap-2.5 rounded-2xl bg-night px-3.5 py-3 text-sm leading-normal text-[#F2F3F5]">
        <svg viewBox="0 0 24 24" className="mt-0.5 size-[18px] shrink-0 text-mint" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
        </svg>
        <p className="m-0">
          <b className="text-mint">Copiloto:</b> {item.suggestion}
        </p>
      </div>

      {item.status === 'OPEN' ? (
        <div className="grid gap-2.5">
          <label htmlFor="report-note" className="text-sm font-semibold text-ink">
            Nota para el registro <span className="font-medium text-muted">(la ve solo el equipo)</span>
          </label>
          <textarea
            id="report-note"
            rows={2}
            maxLength={400}
            value={note}
            onChange={event => setNote(event.target.value)}
            placeholder="Qué revisaste y por qué decides esto"
            className="w-full resize-y rounded-xl border border-edge bg-surface px-3 py-2.5 text-sm leading-[1.45] text-ink placeholder:text-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
          />
          <div className="flex flex-wrap gap-2">
            {item.kind === 'VEHICLE' && v?.status !== 'ARCHIVED' && danger('ARCHIVE', 'Retirar anuncio', '¿Confirmar? Se retira el anuncio')}
            {canSuspend && danger('SUSPEND', 'Suspender cuenta', '¿Confirmar? Se suspende la cuenta')}
            {person && (
              <button type="button" disabled={decide.isPending} onClick={() => decide.mutate('WARN')} className="h-11 rounded-full border border-mine bg-mine px-4 text-sm font-bold text-on-mine disabled:opacity-60">
                Enviar advertencia
              </button>
            )}
            <button type="button" disabled={decide.isPending} onClick={() => decide.mutate('DISMISS')} className="h-11 rounded-full border border-edge bg-surface px-4 text-sm font-bold text-ink disabled:opacity-60">
              Descartar
            </button>
          </div>
        </div>
      ) : (
        <p className="m-0 rounded-[14px] bg-canvas px-3.5 py-3 text-sm text-ink">
          <b>{STATUS[item.status].label}.</b> {item.resolution?.note ?? ''}
          {item.resolution?.by && <span className="text-muted"> · {item.resolution.by}</span>}
        </p>
      )}
    </section>
  );
}

function BlockedTerms() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  const terms = useQuery({ queryKey: adminKeys.terms, queryFn: adminApi.blockedTerms });
  const refresh = () => queryClient.invalidateQueries({ queryKey: adminKeys.terms });
  const add = useMutation({
    mutationFn: adminApi.addTerm,
    onSuccess: () => {
      setValue('');
      void refresh();
    },
    onError: (err: Error) => setError(err.message),
  });
  const remove = useMutation({ mutationFn: adminApi.removeTerm, onSuccess: () => void refresh(), onError: (err: Error) => toast({ tone: 'error', title: err.message }) });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = value.trim().toLowerCase();
    if (term.length < 2 || term.length > 80) return setError('Escribe de 2 a 80 letras');
    if (terms.data?.some(item => item.term === term)) return setError('Ya está en la lista');
    const parsed = BlockedTermSchema.safeParse({ term });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setError(undefined);
    add.mutate(parsed.data.term);
  }

  return (
    <section className="grid gap-2.5 rounded-[22px] border border-line bg-surface px-5 py-[18px]">
      <div>
        <h2 className="text-[17px] font-extrabold text-ink">Palabras bloqueadas</h2>
        <p className="mt-0.5 text-[13.5px] text-muted">En el chat se ocultan al instante; en títulos, descripciones y reseñas no se pueden publicar. Detecta acentos, mayúsculas y letras repetidas.</p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-1.5">
        {terms.data?.map(term => (
          <span key={term.id} className="inline-flex h-8 items-center gap-1 rounded-full bg-canvas pr-1 pl-3 text-[13.5px] font-semibold text-ink">
            {term.term}
            <button type="button" aria-label={`Quitar ${term.term}`} onClick={() => remove.mutate(term.id)} className="grid size-[26px] place-items-center rounded-full text-sm font-bold text-muted hover:bg-sunken hover:text-ink">
              ×
            </button>
          </span>
        ))}
        <label htmlFor="blocked-term" className="sr-only">
          Nueva palabra bloqueada
        </label>
        <input
          id="blocked-term"
          value={value}
          onChange={event => {
            setValue(event.target.value);
            setError(undefined);
          }}
          placeholder="+ palabra o frase"
          className="h-[34px] w-[180px] rounded-full border border-dashed border-edge bg-surface px-3 text-[13.5px] font-medium text-ink placeholder:text-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
        />
        <button type="submit" disabled={add.isPending} className="h-[34px] rounded-full bg-mine px-3.5 text-[13px] font-bold text-on-mine disabled:opacity-60">
          Agregar
        </button>
        {error && (
          <span role="alert" className="text-[13px] text-danger-fg">
            {error}
          </span>
        )}
      </form>
    </section>
  );
}

