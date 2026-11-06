'use client';

import type { AdminCopilotDTO } from '@automarket/contracts';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { isYes } from '@/features/copilot/api';
import { RichText } from '@/shared/ui/rich-text';
import { PageSpinner } from '@/shared/ui/spinner';
import { adminApi, adminKeys } from '../api';
import { createCopilot, type Action, type Bar, type Context, type Download, type Piece, type Tone } from '../copilot-engine';
import { buildViews, download as saveFile, TABS, toCsv } from '../stats-views';

/** Copiloto del admin (diseño «admin-copiloto»): preguntas en lenguaje natural sobre datos reales, solo lectura. */
export function AdminCopilot() {
  const copilot = useQuery({ queryKey: adminKeys.copilot, queryFn: adminApi.copilot, staleTime: 60_000 });
  if (copilot.isPending) return <PageSpinner />;
  if (copilot.isError) {
    return (
      <div className="grid max-w-xl gap-3 rounded-[22px] border border-line bg-surface p-5">
        <h1 className="text-xl font-extrabold text-ink">No pudimos leer los datos del Copiloto</h1>
        <p className="text-sm text-muted">{copilot.error.message} Las demás pantallas del panel siguen funcionando.</p>
        <button type="button" onClick={() => void copilot.refetch()} className="h-10 justify-self-start rounded-full bg-mine px-4 text-sm font-bold text-on-mine">
          Reintentar
        </button>
      </div>
    );
  }
  return <Copilot data={copilot.data} />;
}

type Message = { id: number; from: 'me' | 'bot'; pieces: Piece[] };

const TONE: Record<Tone, string> = { danger: '#B42318', warn: '#8A5A00', good: '#2F7A4F', purple: '#6C5CE7' };
const FILL: Record<Bar['fill'], string> = {
  marked: '#C8102E',
  normal: '#F3A6AE',
  current: 'repeating-linear-gradient(135deg, #C8102E 0 4px, #F3A6AE 4px 8px)',
  projected: 'repeating-linear-gradient(135deg, #6C5CE7 0 4px, #C9C2F7 4px 8px)',
};

function Copilot({ data }: { data: AdminCopilotDTO }) {
  const router = useRouter();
  const bot = useMemo(() => createCopilot(data), [data]);
  const views = useMemo(() => buildViews(data.stats), [data]);
  const [messages, setMessages] = useState<Message[]>(() => [{ id: 0, from: 'bot', pieces: createCopilot(data).welcome() }]);
  const [question, setQuestion] = useState('');
  const context = useRef<Context>({ intent: null, month: null });
  const nextId = useRef(1);
  const log = useRef<HTMLDivElement>(null);
  const year = data.stats.months.at(-1)!.key.slice(0, 4);

  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const push = (from: Message['from'], pieces: Piece[]) => setMessages(list => [...list, { id: nextId.current++, from, pieces }]);

  /** Descarga un CSV (punto y coma, BOM) como en Estadísticas; devuelve si se pudo. */
  const save = (what: Download) => {
    try {
      if (what.kind === 'all') saveFile(`automarket-estadisticas-${year}.csv`, toCsv(TABS.map(([key, label]) => ({ title: label, head: views[key].table.head, rows: views[key].table.rows }))));
      else if (what.kind === 'tab') saveFile(`automarket-${TABS.find(([key]) => key === what.tab)![1].toLowerCase()}-${year}.csv`, toCsv([{ head: views[what.tab].table.head, rows: views[what.tab].table.rows }]));
      else {
        const table = bot.compareCsv(what.a, what.b);
        saveFile(table.name, toCsv([{ head: table.head, rows: table.rows }]));
      }
      return true;
    } catch {
      return false;
    }
  };

  const ask = (raw: string): void => {
    const text = raw.trim();
    if (!text) return;
    // «Sí» / «dale» acepta la pregunta del cierre: la primera acción de la última respuesta.
    const last = messages.at(-1);
    const first = last?.from === 'bot' ? last.pieces.flatMap(piece => (piece.t === 'actions' ? piece.items : [])).at(0) : undefined;
    if (first && isYes(text)) {
      if (first.type === 'ask') {
        setQuestion('');
        push('me', [{ t: 'text', text }]);
        const reply = bot.answer(first.ask, context.current);
        context.current = reply.context;
        const saved = reply.download ? save(reply.download) : true;
        push('bot', saved ? reply.pieces : [...reply.pieces, { t: 'note', text: 'No se pudo descargar aquí. Prueba desde Estadísticas.' }]);
        return;
      }
      setQuestion('');
      push('me', [{ t: 'text', text }]);
      if (first.type === 'go') router.push(first.href);
      else run(first);
      return;
    }
    push('me', [{ t: 'text', text }]);
    setQuestion('');
    // Las cifras ya están en el navegador: la respuesta sale al instante, sin «pensando» de adorno.
    const reply = bot.answer(text, context.current);
    context.current = reply.context;
    const saved = reply.download ? save(reply.download) : true;
    push('bot', saved ? reply.pieces : [...reply.pieces, { t: 'note', text: 'No se pudo descargar aquí. Prueba desde Estadísticas.' }]);
  };

  const run = (action: Action): void => {
    if (action.type === 'ask') return ask(action.ask);
    if (action.type !== 'download') return;
    const ok = save(action.download);
    const what = action.download;
    push('bot', [
      {
        t: 'text',
        text: !ok
          ? 'No se pudo descargar aquí. Prueba desde Estadísticas.'
          : what.kind === 'all'
            ? 'Descargado: todas las estadísticas en Excel (CSV).'
            : what.kind === 'tab'
              ? `Descargado: ${what.label} en Excel (CSV).`
              : 'Descargada la comparación en Excel (CSV).',
      },
    ]);
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-[1_1_320px]">
          <h1 className="flex flex-wrap items-center gap-2.5 text-[28px] font-extrabold tracking-[-0.03em] text-ink">
            Copiloto del admin
            <span className="inline-flex h-6 items-center rounded-full bg-brand px-[9px] text-xs font-extrabold tracking-normal text-on-brand">Lee todos los datos</span>
          </h1>
          <p className="mt-0.5 text-sm text-muted">Pregunta como hablas. Responde con números, gráficos y tablas, y te las descarga en Excel.</p>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-label="Conversación con el Copiloto" className="flex h-[min(760px,78dvh)] flex-col overflow-hidden rounded-[22px] border border-line bg-surface lg:h-[760px]">
          <div ref={log} role="log" aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-5">
            {messages.map(message => (
              <div
                key={message.id}
                className={cn(
                  'am-in grid gap-2.5 rounded-[20px]',
                  message.from === 'me' ? 'max-w-[70%] self-end bg-mine px-4 py-3 text-on-mine' : 'max-w-[92%] self-start text-ink',
                )}
              >
                {message.pieces.map((piece, index) => (
                  <PieceView key={index} piece={piece} onAction={run} />
                ))}
              </div>
            ))}
          </div>
          <div className="grid gap-2.5 border-t border-line px-4 py-3">
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              {bot.chips.map(chip => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => ask(chip)}
                  className="h-[34px] flex-[0_0_auto] whitespace-nowrap rounded-full border border-[#D8DBE0] bg-surface px-3 text-[13px] font-semibold text-ink hover:border-edge focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand dark:border-line"
                >
                  {chip}
                </button>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={event => {
                event.preventDefault();
                ask(question);
              }}
            >
              <label htmlFor="copilot-question" className="sr-only">
                Pregunta al Copiloto
              </label>
              <input
                id="copilot-question"
                autoComplete="off"
                value={question}
                onChange={event => setQuestion(event.target.value)}
                placeholder="Pregunta lo que quieras: «ventas de septiembre por marca»"
                className="h-[50px] min-w-0 flex-1 rounded-full border border-edge bg-surface px-4 text-[15px] font-medium text-ink placeholder:text-faint focus:outline-2 focus:outline-offset-1 focus:outline-brand"
              />
              <button type="submit" aria-label="Enviar" className="grid size-[50px] shrink-0 place-items-center rounded-full bg-brand text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </form>
          </div>
        </section>

        <aside aria-label="Panorama de hoy" className="grid gap-3">
          <div className="grid gap-2.5 rounded-[22px] bg-[#0E0F11] p-4 text-[#F2F3F5] dark:border dark:border-[#272A2F]">
            <p className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-[0.06em] text-[#A2A7B0]">
              Panorama de hoy
            </p>
            {bot.panorama().map(card => (
              <button
                key={card.label}
                type="button"
                onClick={() => ask(card.ask)}
                className="grid grid-cols-[4px_minmax(0,1fr)] gap-2.5 rounded-[14px] border border-[#272A2F] bg-[#17191c] px-3 py-2.5 text-left text-[#F2F3F5] hover:border-[#3a3e45] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint"
              >
                <span aria-hidden="true" className="rounded-full" style={{ background: TONE[card.tone] }} />
                <span>
                  <span className="block text-[12.5px] text-[#A2A7B0]">{card.label}</span>
                  <span className="block text-lg font-extrabold">{card.value}</span>
                  <span className="block text-[12.5px] text-[#C7CBD1]">{card.note}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="grid gap-2 rounded-[22px] border border-line bg-surface p-4 text-[13.5px] leading-[1.45]">
            <p className="text-[14.5px] font-extrabold text-ink">Qué lee</p>
            <p className="text-muted">Ventas, reservas, anuncios, usuarios, planes, pagos, reportes y la pantalla de entrada. Corrige errores al escribir y recuerda de qué venías hablando.</p>
            <p className="text-[14.5px] font-extrabold text-ink">Qué no hace</p>
            <p className="text-muted">No cambia precios, no aprueba pagos y no suspende cuentas. Te lleva a la pantalla donde tú decides. Si un dato no existe, te lo dice en vez de inventarlo.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function PieceView({ piece, onAction }: { piece: Piece; onAction: (action: Action) => void }) {
  if (piece.t === 'note') return <p className="font-mono text-xs font-medium text-muted">{piece.text}</p>;
  if (piece.t === 'text') return <RichText text={piece.text} className="text-[15px] leading-[1.55]" />;
  if (piece.t === 'kpis') {
    return (
      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2">
        {piece.items.map(item => (
          <div key={item.label} className="rounded-[14px] border border-line bg-surface px-3 py-2.5">
            <p className="text-xs text-muted">{item.label}</p>
            <p className="mt-0.5 text-lg font-extrabold text-ink">{item.value}</p>
          </div>
        ))}
      </div>
    );
  }
  if (piece.t === 'bars') {
    const max = Math.max(...piece.items.map(bar => bar.value), 0) * 1.08;
    return (
      <div role="img" aria-label={piece.items.map(bar => `${bar.label}: ${bar.text}`).join(', ')} className="flex h-[150px] items-end gap-2.5 rounded-[14px] border border-line bg-surface px-3 pt-2.5">
        {piece.items.map((bar, index) => (
          <div key={index} className="flex h-full min-w-0 flex-[1_1_0] flex-col items-center justify-end gap-1">
            <span className="font-mono text-[11.5px] font-semibold text-ink">{bar.text}</span>
            <span
              className="block max-h-[100px] w-[22px] origin-bottom rounded-t-[4px] motion-safe:animate-[am-bar_520ms_cubic-bezier(.2,.9,.25,1)_both]"
              style={{ height: max > 0 ? `${(bar.value / max) * 100}%` : '0%', background: FILL[bar.fill] }}
            />
            <span className="whitespace-nowrap pb-1.5 text-[11.5px] text-muted">{bar.label}</span>
          </div>
        ))}
      </div>
    );
  }
  if (piece.t === 'table') {
    return (
      <div role="table" className="grid rounded-[14px] border border-line bg-surface px-3 py-1">
        <div role="row" className="grid gap-2 border-b border-line py-2 font-mono text-[11px] font-medium uppercase text-muted" style={{ gridTemplateColumns: piece.cols }}>
          {piece.head.map((head, index) => (
            <span key={index} role="columnheader">
              {head}
            </span>
          ))}
        </div>
        {piece.rows.map((row, index) => (
          <div key={index} role="row" className="grid gap-2 border-b border-[#F1F2EF] py-2 text-[13.5px] last:border-b-0 dark:border-line" style={{ gridTemplateColumns: piece.cols }}>
            {row.map((cell, i) => (
              <span key={i} role="cell" className="truncate">
                {cell}
              </span>
            ))}
          </div>
        ))}
      </div>
    );
  }
  if (piece.t === 'list') {
    return (
      <ul className="grid gap-2">
        {piece.items.map(item => (
          <li key={item.title} className="grid grid-cols-[4px_minmax(0,1fr)] gap-3 rounded-[14px] border border-line bg-surface p-3">
            <span aria-hidden="true" className="rounded-full" style={{ background: TONE[item.tone] }} />
            <span>
              <span className="block text-[14.5px] font-extrabold text-ink">{item.title}</span>
              <span className="mt-0.5 block text-[13.5px] leading-[1.45] text-[#3D423F] dark:text-muted">{item.text}</span>
              {item.link && (
                <Link href={item.link.href} className="mt-1.5 inline-block text-[13.5px] font-bold text-brand-fg underline underline-offset-[3px]">
                  {item.link.label}
                </Link>
              )}
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {piece.items.map(action =>
        action.type === 'go' ? (
          <Link key={action.label} href={action.href} className="inline-flex min-h-9 items-center rounded-full bg-mine px-3.5 text-[13px] font-bold text-on-mine">
            {action.label} →
          </Link>
        ) : (
          <button key={action.label} type="button" onClick={() => onAction(action)} className="min-h-9 rounded-full border border-edge bg-surface px-3.5 text-[13px] font-semibold text-ink hover:border-ink">
            {action.label}
          </button>
        ),
      )}
    </div>
  );
}
