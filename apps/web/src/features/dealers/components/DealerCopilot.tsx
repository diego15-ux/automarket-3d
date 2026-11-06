'use client';

import { usdText } from '@automarket/contracts';
import type { CopilotBlockDTO, CopilotChipDTO, DealerCopilotBlockDTO, DealerCopilotEventDTO } from '@automarket/contracts';
import { countryName } from '@automarket/contracts';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowUp, Check, Loader2, MessageCircle, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { CopilotBlock } from '@/features/copilot/CopilotBlocks';
import { isYes } from '@/features/copilot/api';
import { cn } from '@/shared/lib/cn';
import { ApiError } from '@/shared/lib/http';
import { dealerKeys, dealersApi } from '../api';
import { copyText } from '@/shared/lib/browser';

/**
 * Copiloto para agencias (diseño «copiloto-agencia-pc»): chat a la izquierda y, al lado, el
 * mercado en vivo (se refresca cada minuto), el precio sugerido de un auto del inventario y lo
 * último que pasó. Todo sale de la API con reglas sobre datos reales; nada se simula.
 */

interface Message {
  id: number;
  from: 'user' | 'bot';
  text?: string;
  blocks?: DealerCopilotBlockDTO[];
}

const money = (value: number) => usdText(value);
const relative = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
function ago(iso: string) {
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return minutes === 0 ? 'ahora' : relative.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, 'hour');
  return relative.format(Math.round(hours / 24), 'day');
}


function CopyButton({ value, label = 'Copiar' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        void copyText(value)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => setCopied(false))
      }
      className="inline-flex h-[34px] items-center gap-1.5 rounded-full border border-ink bg-surface px-3 text-[12.5px] font-extrabold text-ink"
    >
      {copied ? (
        <>
          <Check aria-hidden className="size-3.5" strokeWidth={2.6} /> Copiada
        </>
      ) : (
        label
      )}
    </button>
  );
}

const TAGS = {
  high: ['Se pide más', 'bg-success-soft text-success-fg'],
  normal: ['Normal', 'bg-tile text-ink/80'],
  low: ['Hay de sobra', 'bg-gold-soft text-gold-fg'],
} as const;

function DealerBlock({ block }: { block: DealerCopilotBlockDTO }) {
  if (block.type === 'quote')
    return (
      <div className="w-full max-w-[92%]">
        <blockquote className="rounded-[16px] border border-dashed border-edge bg-tile px-4 py-3.5 text-[14.5px] leading-[1.55]">{block.text}</blockquote>
        <div className="mt-2">
          <CopyButton value={block.text} label="Copiar texto" />
        </div>
      </div>
    );
  if (block.type === 'demand')
    return (
      <div className="w-full overflow-hidden rounded-[16px] border border-line text-[13.5px]">
        <div className="grid grid-cols-[minmax(0,1.8fr)_0.7fr_0.8fr_0.8fr_1fr] gap-2 bg-tile px-3.5 py-2.5 font-mono text-[11px] text-muted">
          <span>{block.title}</span>
          <span>Vistas</span>
          <span>Contactos</span>
          <span>Publicados</span>
          <span />
        </div>
        {block.rows.map(row => (
          <div key={row.segment} className="grid grid-cols-[minmax(0,1.8fr)_0.7fr_0.8fr_0.8fr_1fr] items-center gap-2 border-t border-line px-3.5 py-2.5">
            <span className="font-bold">{row.segment}</span>
            <span className="figures">{row.views}</span>
            <span className="figures">{row.contacts}</span>
            <span className="figures">{row.listings}</span>
            <span className={cn('inline-flex h-6 items-center justify-self-start rounded-full px-[9px] text-[11.5px] font-extrabold whitespace-nowrap', TAGS[row.tag][1])}>{TAGS[row.tag][0]}</span>
          </div>
        ))}
      </div>
    );
  if (block.type === 'replies')
    return (
      <div className="grid w-full gap-2">
        {block.items.map(item => (
          <div key={item.tone} className="rounded-[16px] border border-line bg-surface px-3.5 py-3">
            <p className="text-xs font-extrabold text-brand-fg">{item.tone}</p>
            <p className="mt-1 text-sm leading-[1.45]">{item.text}</p>
            <div className="mt-2">
              <CopyButton value={item.text} label="Copiar respuesta" />
            </div>
          </div>
        ))}
        <Link href={`/mensajes/${block.conversationId}`} className="inline-flex h-9 items-center gap-1.5 justify-self-start rounded-full bg-ink px-3.5 text-[13px] font-bold text-surface">
          <MessageCircle aria-hidden className="size-4" strokeWidth={2} /> Abrir el chat con {block.to}
        </Link>
      </div>
    );
  return <CopilotBlock block={block as CopilotBlockDTO} onNavigate={() => undefined} />;
}

const FEED_ICON: Record<DealerCopilotEventDTO['type'], { className: string; icon: React.ReactNode }> = {
  sale: { className: 'bg-success-soft text-success-fg', icon: <Check className="size-[15px]" strokeWidth={2.4} /> },
  listing: { className: 'bg-tile text-ink', icon: <Plus className="size-[15px]" strokeWidth={2.4} /> },
  contact: { className: 'bg-reserved-soft text-reserved-fg', icon: <MessageCircle className="size-[15px]" strokeWidth={2.2} /> },
};

export function DealerCopilot() {
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const overview = useQuery({
    queryKey: dealerKeys.copilot(vehicleId ?? 'primero'),
    queryFn: () => dealersApi.copilotOverview(vehicleId ?? undefined),
    refetchInterval: live ? 60_000 : false,
    retry: false,
  });
  const data = overview.data;
  const suggestion = data?.suggestion ?? null;
  // «Subió / Bajó desde que abriste»: el primer precio que se vio de cada auto.
  const firstSeen = useRef(new Map<string, number>());
  if (suggestion?.vehicleId && !firstSeen.current.has(suggestion.vehicleId)) firstSeen.current.set(suggestion.vehicleId, suggestion.price);
  const baseline = suggestion?.vehicleId ? firstSeen.current.get(suggestion.vehicleId) : undefined;
  const moved = suggestion && baseline !== undefined ? suggestion.price - baseline : 0;

  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [chips, setChips] = useState<CopilotChipDTO[]>([]);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState('');
  const context = useRef<string | null>(null);
  const request = useRef(0);
  const nextId = useRef(1);
  const listRef = useRef<HTMLDivElement>(null);

  const ask = useCallback(async (input: { text?: string; action?: 'start' }, label?: string) => {
    const id = ++request.current;
    if (input.text) setMessages(list => [...list, { id: nextId.current++, from: 'user', text: label ?? input.text }]);
    setChips([]);
    setPending(true);
    try {
      const reply = await dealersApi.copilotAsk({ text: input.text ?? '', ...(input.action && { action: input.action }), vehicleId: context.current });
      if (id !== request.current) return;
      setMessages(list => [...list, { id: nextId.current++, from: 'bot', blocks: reply.blocks }]);
      setChips(reply.chips);
      context.current = reply.vehicleId;
      // El costado sigue al auto del que se habla.
      if (reply.vehicleId) setVehicleId(reply.vehicleId);
    } catch (error) {
      if (id !== request.current) return;
      const text = error instanceof ApiError && error.code === 'RATE_LIMITED' ? 'Vas muy rápido. Espera unos segundos y vuelve a escribirme.' : error instanceof ApiError && error.code === 'DEALER_ONLY' ? error.message : 'No pude responder ahora. Intenta de nuevo en un momento.';
      setMessages(list => [...list, { id: nextId.current++, from: 'bot', blocks: [{ type: 'text', text }] }]);
    } finally {
      if (id === request.current) setPending(false);
    }
  }, []);

  useEffect(() => {
    void ask({ action: 'start' });
  }, [ask]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const last = [...list.querySelectorAll<HTMLElement>('[data-message]')].at(-1);
    if (last && last.dataset.message === 'bot' && last.offsetHeight > list.clientHeight * 0.7) list.scrollTo({ top: last.offsetTop - 12 });
    else list.scrollTo({ top: list.scrollHeight });
  }, [messages, pending]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || pending) return;
    setDraft('');
    // «Sí» / «dale» acepta la pregunta del cierre, que siempre es la primera opción.
    const first = chips[0];
    if (first && isYes(text)) {
      if (first.href) {
        setMessages(list => [...list, { id: nextId.current++, from: 'user', text }]);
        router.push(first.href);
      } else if (first.text) void ask({ text: first.text }, text);
      return;
    }
    void ask({ text });
  };
  const place = data?.dealer.country ? countryName(data.dealer.country) : 'AutoMarket';

  return (
    <main className="flex flex-col gap-5 px-[clamp(16px,2.4vw,32px)] pt-[26px] pb-10">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/concesionario" aria-label="Volver al panel" className="grid size-10 place-items-center rounded-full border border-edge text-ink hover:border-ink">
          <ArrowLeft className="size-[18px]" strokeWidth={2.2} />
        </Link>
        <div className="min-w-0 flex-[1_1_260px]">
          <h1 className="text-[26px] font-extrabold tracking-[-0.03em] text-ink">Copiloto para agencias</h1>
          <p className="mt-0.5 text-sm text-muted">{data ? `${data.dealer.name} · ` : ''}las cifras se recalculan con cada anuncio, venta y contacto</p>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <section aria-label="Conversación con el Copiloto" className="flex h-[min(760px,calc(100dvh-170px))] min-w-0 flex-[3_1_520px] flex-col overflow-hidden rounded-[22px] border border-line bg-surface max-lg:h-[70dvh]">
          <div ref={listRef} aria-live="polite" className="relative flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-[18px] py-[18px]">
            {messages.map(message =>
              message.from === 'user' ? (
                <p key={message.id} data-message="user" className="max-w-[84%] self-end rounded-[16px] rounded-tr-[6px] bg-mine px-3.5 py-2.5 text-[14.5px] leading-[1.45] text-on-mine">
                  {message.text}
                </p>
              ) : (
                <div key={message.id} data-message="bot" className="flex flex-col items-start gap-2">
                  {message.blocks?.map((block, i) => <DealerBlock key={i} block={block} />)}
                </div>
              ),
            )}
            {pending && (
              <p className="flex items-center gap-2 text-[13px] text-muted">
                <Loader2 aria-hidden className="size-4 animate-spin" />
                Revisando anuncios y ventas…
              </p>
            )}
          </div>
          {chips.length > 0 && !pending && (
            <div role="group" aria-label="Preguntas rápidas" className="flex flex-wrap gap-1.5 px-4 pb-2.5">
              {chips.map(item =>
                item.href ? (
                  <Link key={item.label} href={item.href} className="inline-flex min-h-9 items-center rounded-full border border-edge bg-surface px-3.5 py-1 text-[13px] font-bold hover:border-ink">
                    {item.label} →
                  </Link>
                ) : (
                  <button key={item.label} type="button" onClick={() => item.text && void ask({ text: item.text }, item.label)} className="min-h-9 rounded-full border border-edge bg-surface px-3.5 py-1 text-left text-[13px] font-bold hover:border-ink">
                    {item.label}
                  </button>
                ),
              )}
            </div>
          )}
          <form onSubmit={submit} className="flex items-center gap-2 border-t border-line px-3 pt-2.5 pb-3">
            <label htmlFor="dealer-copilot-input" className="sr-only">
              Pregúntale al Copiloto
            </label>
            <input
              id="dealer-copilot-input"
              value={draft}
              onChange={event => setDraft(event.target.value)}
              maxLength={240}
              autoComplete="off"
              placeholder="Ej.: ¿a cuánto pongo una Hilux 2022?"
              className="h-[46px] min-w-0 flex-1 rounded-full border border-edge bg-field px-4 text-[14.5px] text-ink placeholder:text-faint focus:border-ink focus:outline-none"
            />
            <button type="submit" aria-label="Enviar" disabled={!draft.trim() || pending} className="grid size-[46px] shrink-0 place-items-center rounded-full bg-brand text-on-brand hover:bg-brand-600 disabled:opacity-45">
              <ArrowUp className="size-5" strokeWidth={2.4} />
            </button>
          </form>
        </section>

        <aside aria-label="Mercado en vivo" className="flex min-w-0 flex-[2_1_340px] flex-col gap-4">
          <section className="rounded-[22px] bg-night p-5 text-[#F2F3F5] dark:ring-1 dark:ring-white/10">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-base font-extrabold">
                <span aria-hidden className={cn('size-2 rounded-full', live ? 'bg-[#7cc79a]' : 'bg-[#6b717b]')} />
                Mercado en vivo
              </h2>
              <button
                type="button"
                role="switch"
                aria-checked={live}
                aria-label="Actualizar solo cada minuto"
                onClick={() => setLive(value => !value)}
                className={cn('relative h-[26px] w-11 rounded-full transition-colors duration-200', live ? 'bg-brand' : 'bg-[#3b3f46]')}
              >
                <span className={cn('absolute top-[3px] left-[3px] size-5 rounded-full bg-white transition-transform duration-200 motion-reduce:transition-none', live && 'translate-x-[18px]')} />
              </button>
            </div>
            <dl className="mt-3.5 grid grid-cols-3 gap-2">
              {[
                ['Anuncios activos', data?.counts.listings],
                ['Ventas · 90 días', data?.counts.sales],
                ['Contactos · 7 días', data?.counts.contacts],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-[14px] bg-[#1d2024] p-2.5">
                  <dt className="truncate text-[11.5px] text-[#a2a7b0]">{label}</dt>
                  <dd className="figures mt-0.5 text-[22px] font-extrabold">{value ?? '—'}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2.5 font-mono text-[11px] text-[#a2a7b0]">Anuncios y ventas de {place} · {live ? 'se actualiza cada minuto' : 'en pausa'}</p>
            <div className="mt-3 flex gap-2">
              <Link href="/cuenta/anuncios/nuevo" className="flex h-10 flex-1 items-center justify-center rounded-full border border-[#3b3f46] text-[13px] font-bold">
                + Publicar auto
              </Link>
              <Link href="/cuenta/anuncios" className="flex h-10 flex-1 items-center justify-center rounded-full bg-brand text-[13px] font-extrabold text-on-brand hover:bg-brand-600">
                Marcar una venta
              </Link>
            </div>
          </section>

          <section className="rounded-[22px] border border-line bg-surface p-[18px]">
            {data && data.inventory.length === 0 ? (
              <p className="text-sm text-muted">Publica un auto para ver aquí su precio sugerido.</p>
            ) : (
              <>
                <label htmlFor="dealer-copilot-car" className="text-[13px] text-muted">
                  Precio sugerido para tu
                </label>
                <select
                  id="dealer-copilot-car"
                  value={suggestion?.vehicleId ?? vehicleId ?? ''}
                  onChange={event => {
                    setVehicleId(event.target.value);
                    context.current = event.target.value;
                  }}
                  className="mt-1 block w-full cursor-pointer truncate rounded-sm border border-edge bg-field px-3 py-2 text-sm font-bold text-ink"
                >
                  {data?.inventory.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.title} · {money(item.price)}
                    </option>
                  ))}
                </select>
                {overview.isPending ? (
                  <p className="mt-3 h-[38px] w-40 animate-pulse rounded-lg bg-sunken" aria-hidden />
                ) : suggestion ? (
                  <>
                    <p className="figures mt-3 text-[32px] leading-none font-extrabold tracking-[-0.03em]">{money(suggestion.price)}</p>
                    <p className={cn('mt-1.5 text-[13px] font-bold', moved > 0 ? 'text-success-fg' : moved < 0 ? 'text-gold-fg' : 'text-muted')}>
                      {moved > 0 ? `Subió ${money(moved)} desde que abriste` : moved < 0 ? `Bajó ${money(-moved)} desde que abriste` : 'Sin cambios desde que abriste'}
                    </p>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-card-tile" aria-hidden>
                      <div className="h-full rounded-full bg-brand transition-[width] duration-700 ease-[cubic-bezier(.2,.9,.25,1)] motion-reduce:transition-none" style={{ width: `${suggestion.confidence}%` }} />
                    </div>
                    <p className="mt-1.5 font-mono text-[11.5px] text-muted">
                      Confianza {suggestion.level} · {suggestion.listings.count + suggestion.sales.count === 1 ? '1 dato' : `${suggestion.listings.count + suggestion.sales.count} datos`} ·{' '}
                      {suggestion.days !== null && suggestion.current !== null ? `${suggestion.days} días estimados a tu precio de ${money(suggestion.current)}` : 'sin ventas para estimar días'}
                    </p>
                  </>
                ) : (
                  <p className="mt-3 text-sm text-muted">Todavía no hay autos parecidos ni ventas para calcular su precio.</p>
                )}
              </>
            )}
          </section>

          <section className="rounded-[22px] border border-line bg-surface p-[18px]">
            <h2 className="text-[15px] font-extrabold">Lo último en el mercado</h2>
            {!data?.feed.length ? (
              <p className="mt-2.5 text-[13.5px] text-muted">{overview.isPending ? 'Cargando…' : 'Nada nuevo en los últimos 7 días.'}</p>
            ) : (
              <ul className="mt-2.5 grid gap-2">
                {data.feed.map(event => (
                  <li key={`${event.type}-${event.at}-${event.text}`} className="flex items-start gap-2.5">
                    <span aria-hidden className={cn('grid size-[30px] shrink-0 place-items-center rounded-[10px]', FEED_ICON[event.type].className)}>
                      {FEED_ICON[event.type].icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13.5px] leading-[1.4]">{event.text}</span>
                      <time dateTime={event.at} className="font-mono text-[11px] text-muted">
                        {ago(event.at)}
                      </time>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
