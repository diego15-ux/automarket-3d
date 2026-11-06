'use client';

import type { CopilotBlockDTO, CopilotChipDTO, CopilotContext, CopilotReplyDTO } from '@automarket/contracts';
import { ArrowUp, Loader2, RotateCcw, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { cn } from '@/shared/lib/cn';
import { ApiError } from '@/shared/lib/http';
import { SteeringWheel } from '@/shared/ui/steering-wheel';
import { COPILOT_EVENT, copilotApi, isYes } from './api';
import { CopilotBlock } from './CopilotBlocks';

/**
 * Copiloto del comprador (diseños «copiloto-pc» y «copiloto-movil»): chat flotante en PC y a
 * pantalla completa en el teléfono. Cada mensaje lo responde la API con reglas sobre los anuncios
 * publicados; aquí solo se pinta. Sin animación de «escribiendo»: la respuesta llega cuando llega.
 */

interface Message {
  id: number;
  from: 'user' | 'bot';
  text?: string;
  blocks?: CopilotBlockDTO[];
}
interface Saved {
  messages: Message[];
  chips: CopilotChipDTO[];
  context: CopilotContext | null;
  viewing: CopilotReplyDTO['viewing'];
}

const STORAGE_KEY = 'am-copilot';
const HINT_KEY = 'am-copilot-hint';
const SHOWN_ON = [/^\/$/, /^\/vehiculos(\/|$)/, /^\/concesionarios(\/|$)/, /^\/comparar$/, /^\/vendedores\//, /^\/alertas$/, /^\/cuenta\/reservas/, /^\/vender$/];


function load(): Saved | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

export function CopilotWidget() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chips, setChips] = useState<CopilotChipDTO[]>([]);
  const [context, setContext] = useState<CopilotContext | null>(null);
  const [viewing, setViewing] = useState<CopilotReplyDTO['viewing']>(null);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState('');
  const [hint, setHint] = useState(false);
  const [restored, setRestored] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const request = useRef(0);
  const nextId = useRef(1);
  const state = useRef({ context, messages });
  state.current = { context, messages };

  const slugMatch = /^\/vehiculos\/([^/]+)$/.exec(pathname);
  const slug = slugMatch ? decodeURIComponent(slugMatch[1]!) : undefined;
  const shown = SHOWN_ON.some(re => re.test(pathname));
  // En la portada, el botón aparece al bajar: arriba taparía la tarjeta del auto de portada.
  const [belowHero, setBelowHero] = useState(false);
  useEffect(() => {
    if (pathname !== '/') return;
    const onScroll = () => setBelowHero(window.scrollY > 420);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [pathname]);
  const launcherHidden = pathname === '/' && !belowHero && !open;

  // La conversación sigue al cambiar de página (y al recargar, mientras dure la pestaña).
  useEffect(() => {
    const saved = load();
    if (saved) {
      setMessages(saved.messages);
      setChips(saved.chips);
      setContext(saved.context);
      setViewing(saved.viewing);
      nextId.current = Math.max(0, ...saved.messages.map(m => m.id)) + 1;
    }
    try {
      setHint(window.localStorage.getItem(HINT_KEY) !== 'visto');
    } catch {
      setHint(true);
    }
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored) return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ messages: messages.slice(-40), chips, context, viewing } satisfies Saved));
    } catch {
      /* sin almacenamiento: la conversación vive solo en memoria */
    }
  }, [restored, messages, chips, context, viewing]);

  const ask = useCallback(
    async (input: { text?: string; action?: 'start' | 'reset' }, label?: string) => {
      const id = ++request.current;
      if (input.text) setMessages(list => [...list, { id: nextId.current++, from: 'user', text: label ?? input.text }]);
      setChips([]);
      setPending(true);
      try {
        const reply = await copilotApi.ask({ text: input.text ?? '', ...(input.action && { action: input.action }), context: input.action ? null : state.current.context, ...(slug && { vehicleSlug: slug }) });
        if (id !== request.current) return;
        setMessages(list => [...list, { id: nextId.current++, from: 'bot', blocks: reply.blocks }]);
        setChips(reply.chips);
        setContext(reply.context);
        setViewing(reply.viewing);
      } catch (error) {
        if (id !== request.current) return;
        const message = error instanceof ApiError && error.code === 'RATE_LIMITED' ? 'Vas muy rápido. Espera unos segundos y vuelve a escribirme.' : 'No pude responder ahora. Intenta de nuevo en un momento.';
        setMessages(list => [...list, { id: nextId.current++, from: 'bot', blocks: [{ type: 'text', text: message }] }]);
        setChips([{ label: 'Menú', text: 'menu' }]);
      } finally {
        if (id === request.current) setPending(false);
      }
    },
    [slug],
  );

  const show = useCallback(() => {
    setOpen(true);
    setHint(false);
    try {
      window.localStorage.setItem(HINT_KEY, 'visto');
    } catch {
      /* nada */
    }
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    launcherRef.current?.focus();
  }, []);

  // Al abrir por primera vez: saludo con el número real de autos publicados.
  useEffect(() => {
    if (open && restored && !state.current.messages.length && !pending) void ask({ action: 'start' });
  }, [open, restored, ask, pending]);
  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 60);
  }, [open]);

  // Otras pantallas pueden abrirlo con una pregunta (p. ej. «¿Este auto tiene buen precio?» en la ficha).
  useEffect(() => {
    const onOpen = (event: Event) => {
      const text = (event as CustomEvent<{ text?: string }>).detail?.text;
      show();
      if (text) void ask({ text });
    };
    window.addEventListener(COPILOT_EVENT, onOpen);
    return () => window.removeEventListener(COPILOT_EVENT, onOpen);
  }, [ask, show]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Cada respuesta nueva se muestra desde su comienzo (las tarjetas pueden ser largas).
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const last = [...list.querySelectorAll<HTMLElement>('[data-message]')].at(-1);
    if (last && last.dataset.message === 'bot' && last.offsetHeight > list.clientHeight * 0.7) list.scrollTo({ top: last.offsetTop - 12 });
    else list.scrollTo({ top: list.scrollHeight });
  }, [messages, pending, open]);

  if (!shown) return null;

  const navigate = () => {
    if (window.matchMedia('(max-width: 639px)').matches) setOpen(false);
  };
  const pick = (item: CopilotChipDTO) => {
    if (item.href) {
      navigate();
      router.push(item.href);
      return;
    }
    if (item.text) void ask({ text: item.text }, item.label);
  };
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
        pick(first);
      } else if (first.text) void ask({ text: first.text }, text);
      return;
    }
    void ask({ text });
  };
  const viewingNow = viewing && viewing.slug === slug ? viewing : null;

  return (
    <>
      <section
        role="dialog"
        aria-label="Copiloto"
        aria-hidden={!open}
        data-copilot-open={open || undefined}
        className={cn(
          'fixed z-50 flex flex-col overflow-hidden bg-surface transition-[opacity,transform] duration-300 ease-[cubic-bezier(.2,.9,.25,1)] motion-reduce:transition-none',
          'max-sm:inset-0 sm:right-7 sm:bottom-[100px] sm:h-[min(640px,calc(100dvh-130px))] sm:w-[min(400px,calc(100vw-32px))] sm:origin-bottom-right sm:rounded-[22px] sm:border sm:border-line sm:shadow-pop',
          open ? 'opacity-100' : 'pointer-events-none translate-y-3 opacity-0 sm:scale-[0.97]',
        )}
      >
        <header className="flex items-center gap-3 bg-night px-4 py-3 text-white max-sm:pt-[max(12px,env(safe-area-inset-top))]">
          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-brand">
            <SteeringWheel className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] leading-tight font-extrabold">Copiloto</p>
            <p className="truncate text-xs text-white/65">Autos, precios y dudas de AutoMarket</p>
          </div>
          <button type="button" onClick={() => void ask({ action: 'reset' })} aria-label="Empezar de nuevo" title="Empezar de nuevo" className="grid size-9 place-items-center rounded-full bg-white/10 hover:bg-white/20">
            <RotateCcw className="size-4" strokeWidth={2.2} />
          </button>
          <button type="button" onClick={close} aria-label="Cerrar el Copiloto" title="Cerrar" className="grid size-9 place-items-center rounded-full bg-white/10 hover:bg-white/20">
            <X className="size-4" strokeWidth={2.4} />
          </button>
        </header>

        {viewingNow && (
          <div className="flex items-center gap-2.5 border-b border-line bg-tile px-4 py-2">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10.5px] text-faint">Estás viendo</p>
              <p className="truncate text-[13.5px] font-semibold">{viewingNow.title}</p>
            </div>
            <button type="button" disabled={pending} onClick={() => void ask({ text: '¿Este auto tiene buen precio?' })} className="h-8 shrink-0 rounded-full bg-ink px-3 text-[12.5px] font-bold text-surface disabled:opacity-60">
              ¿Buen precio?
            </button>
          </div>
        )}

        <div ref={listRef} aria-live="polite" className="relative flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain px-4 py-4">
          {messages.map(message =>
            message.from === 'user' ? (
              <p key={message.id} data-message="user" className="max-w-[85%] self-end rounded-[16px] rounded-tr-[6px] bg-mine px-3.5 py-2.5 text-[14.5px] leading-[1.45] text-on-mine">
                {message.text}
              </p>
            ) : (
              <div key={message.id} data-message="bot" className="flex flex-col items-start gap-2">
                {message.blocks?.map((block, i) => <CopilotBlock key={i} block={block} onNavigate={navigate} />)}
              </div>
            ),
          )}
          {pending && (
            <p className="flex items-center gap-2 text-[13px] text-muted">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Revisando los anuncios…
            </p>
          )}
        </div>

        {chips.length > 0 && !pending && (
          <div role="group" aria-label="Respuestas rápidas" className="flex flex-wrap gap-1.5 px-4 pb-2.5">
            {chips.map(item =>
              item.href ? (
                <Link key={item.label} href={item.href} onClick={navigate} className="inline-flex min-h-9 items-center rounded-full border border-edge bg-surface px-3 py-1 text-[13px] font-semibold underline-offset-2 hover:border-ink">
                  {item.label} →
                </Link>
              ) : (
                <button key={item.label} type="button" onClick={() => pick(item)} className="min-h-9 rounded-full border border-edge bg-surface px-3 py-1 text-left text-[13px] font-semibold hover:border-ink">
                  {item.label}
                </button>
              ),
            )}
          </div>
        )}

        <form onSubmit={submit} className="flex items-center gap-2 border-t border-line px-3 py-2.5 max-sm:pb-[max(10px,env(safe-area-inset-bottom))]">
          <label htmlFor="copilot-input" className="sr-only">
            Escríbele al Copiloto
          </label>
          <input
            id="copilot-input"
            ref={inputRef}
            value={draft}
            onChange={event => setDraft(event.target.value)}
            maxLength={240}
            autoComplete="off"
            placeholder="Escribe lo que buscas o tu duda"
            className="h-11 min-w-0 flex-1 rounded-full border border-edge bg-field px-4 text-[14.5px] text-ink placeholder:text-faint focus:border-ink focus:outline-none"
          />
          <button type="submit" aria-label="Enviar" disabled={!draft.trim() || pending} className="grid size-11 shrink-0 place-items-center rounded-full bg-brand text-on-brand hover:bg-brand-600 disabled:opacity-45">
            <ArrowUp className="size-5" strokeWidth={2.4} />
          </button>
        </form>
      </section>

      <div className={cn('am-copilot-launcher fixed right-5 bottom-5 z-40 flex items-center gap-2.5 transition-[opacity,transform] duration-300 motion-reduce:transition-none sm:right-7 sm:bottom-7', open && 'max-sm:hidden', launcherHidden && 'pointer-events-none translate-y-4 opacity-0')}>
        {hint && !open && (
          <button type="button" onClick={show} className="rounded-full border border-line bg-surface px-3.5 py-2 text-[13.5px] font-semibold shadow-card max-sm:hidden">
            ¿Te ayudo a elegir?
          </button>
        )}
        <button
          ref={launcherRef}
          type="button"
          onClick={() => (open ? close() : show())}
          aria-label={open ? 'Cerrar el Copiloto' : 'Abrir el Copiloto'}
          aria-expanded={open}
          className="flex h-14 items-center gap-2 rounded-full bg-brand pr-5 pl-4 text-[15px] font-bold text-on-brand shadow-pop hover:bg-brand-600 max-sm:size-14 max-sm:justify-center max-sm:p-0"
        >
          {open ? <X className="size-5" strokeWidth={2.4} /> : <SteeringWheel className="size-6" />}
          <span className="max-sm:hidden">{open ? 'Cerrar' : 'Copiloto'}</span>
        </button>
      </div>
    </>
  );
}
