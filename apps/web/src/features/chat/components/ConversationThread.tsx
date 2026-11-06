'use client';

import { countryName, type DealEventDTO } from '@automarket/contracts';
import { ChevronLeft, ChevronUp, Flag, Lock } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { Avatar } from '@/shared/ui/avatar';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/card';
import { MediaImage } from '@/shared/ui/media-image';
import { Spinner } from '@/shared/ui/spinner';
import { useToast } from '@/shared/ui/toaster';
import { chatApi } from '../api';
import { DEAL_PILL, clock, eventText, firstName, isDirectStatus, money, useDeal, vehicleName, type DealController } from '../deal';
import { useConversations } from '../hooks/useChatConnection';
import { useConversation } from '../hooks/useConversation';
import type { ChatMessage, OutgoingMessage } from '../types';
import { Composer } from './Composer';
import { DealButton, DealPanel } from './DealPanel';
import { MessageBubble } from './MessageBubble';

const REPORT_REASONS = [
  ['FRAUD', 'Posible fraude'],
  ['OFFENSIVE', 'Lenguaje ofensivo'],
  ['SPAM', 'Spam'],
  ['OTHER', 'Otro'],
] as const;

type Item = { kind: 'event'; at: string; event: DealEventDTO } | { kind: 'message'; at: string; message: ChatMessage } | { kind: 'outgoing'; at: string; message: OutgoingMessage };

/** Reporte anónimo de la otra persona (lo revisa el equipo en Moderación). */
function ReportPopover({ conversationId, name, onClose }: { conversationId: string; name: string; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  async function send() {
    if (!reason) {
      toast({ tone: 'error', title: 'Elige un motivo.' });
      return;
    }
    setSending(true);
    try {
      await chatApi.report(conversationId, { reason });
      onClose();
      toast({ tone: 'success', title: 'Reporte enviado. El equipo de AutoMarket lo revisa.' });
    } catch (error) {
      toast({ tone: 'error', title: 'No se pudo enviar el reporte', description: error instanceof Error ? error.message : undefined });
    } finally {
      setSending(false);
    }
  }
  return (
    <div role="dialog" aria-label="Reportar esta conversación" className="am-step-in absolute top-16 right-3 z-[6] grid w-[280px] gap-2.5 rounded-[18px] border border-line bg-surface p-3.5 shadow-[0_18px_40px_-16px_rgb(0_0_0/0.4)]">
      <p className="text-[15px] font-extrabold">Reportar a {name}</p>
      <div role="radiogroup" aria-label="Motivo" className="flex flex-wrap gap-1.5">
        {REPORT_REASONS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={reason === value}
            onClick={() => setReason(value)}
            className={cn('min-h-9 rounded-full border px-3 text-[13px] font-semibold', reason === value ? 'border-ink bg-ink text-surface' : 'border-field-line bg-field text-ink')}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-[12.5px] text-muted">El equipo ve esta conversación para decidir. {name} no sabe quién lo reportó.</p>
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="h-10 flex-1 rounded-full border border-field-line text-[13px] font-bold">
          Cancelar
        </button>
        <button type="button" disabled={sending} onClick={send} className="h-10 flex-1 rounded-full bg-danger text-[13px] font-bold text-white disabled:opacity-60 dark:text-[#06140d]">
          Enviar reporte
        </button>
      </div>
    </div>
  );
}

/** Evento del trato en el hilo; el de «pidió reservar» va en dorado y, si es lo último, con los botones. */
function EventPill({ item, controller, inline }: { item: Extract<Item, { kind: 'event' }>; controller: DealController; inline: boolean }) {
  const deal = controller.deal!;
  const requested = item.event.kind === 'REQUESTED';
  return (
    <div className="am-step-in my-1.5 grid max-w-[90%] gap-2 self-center justify-items-center text-center">
      <p className={cn('rounded-[12px] px-3 py-2 text-[12.5px] leading-[1.4]', requested ? 'bg-gold-soft' : 'bg-tile')}>
        {eventText(item.event, deal)}
        <span className="text-muted"> · {clock(item.at)}</span>
      </p>
      {inline && (
        <div className="flex gap-1.5">
          <DealButton controller={controller} action="accept" variant="primary" small>
            Confirmar reserva
          </DealButton>
          <DealButton controller={controller} action="reject" variant="ghost" small>
            Rechazar
          </DealButton>
        </div>
      )}
    </div>
  );
}

/**
 * Hilo abierto + panel «El trato». En PC el panel es la tercera columna; en tableta y teléfono,
 * una barra bajo la cabecera que abre una hoja inferior. Montar con `key={conversationId}`.
 */
export function ConversationThread({ conversationId }: { conversationId: string }) {
  const { data: conversations } = useConversations();
  const summary = conversations?.find(conversation => conversation.id === conversationId);
  const chat = useConversation(conversationId);
  const controller = useDeal(conversationId);
  const deal = controller.deal;
  const [reporting, setReporting] = useState(false);
  const [sheet, setSheet] = useState(false);
  const sheetButton = useRef<HTMLButtonElement>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Hilo: mensajes (historial + vivos), los que aún se envían y los eventos reales del trato.
  const items = useMemo<Item[]>(() => {
    const oldest = chat.hasOlder ? chat.messages[0]?.createdAt : undefined;
    const events = (deal?.events ?? []).filter(event => !oldest || event.at >= oldest).map(event => ({ kind: 'event' as const, at: event.at, event }));
    const messages = chat.messages.map(message => ({ kind: 'message' as const, at: message.createdAt, message }));
    const outgoing = chat.outbox.map(message => ({ kind: 'outgoing' as const, at: message.createdAt, message }));
    return [...events, ...messages, ...outgoing].sort((a, b) => a.at.localeCompare(b.at));
  }, [chat.hasOlder, chat.messages, chat.outbox, deal?.events]);

  useEffect(() => {
    const element = scroller.current;
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [items.length, chat.counterpartTyping]);

  useEffect(() => {
    if (!sheet) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSheet(false);
        sheetButton.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheet]);

  async function loadOlder() {
    const element = scroller.current;
    const previousHeight = element?.scrollHeight ?? 0;
    stickToBottom.current = false;
    await chat.loadOlder();
    requestAnimationFrame(() => {
      if (element) element.scrollTop += element.scrollHeight - previousHeight;
    });
  }

  if (chat.error) {
    return (
      <section className="grid place-items-center rounded-[22px] border border-line bg-surface p-6">
        <EmptyState title="No puedes ver esta conversación" description={chat.error.message} />
      </section>
    );
  }

  const name = summary ? firstName(summary.counterpart.name) : '';
  const direct = Boolean(summary?.direct) || (deal ? isDirectStatus(deal.status) : false);
  const pill = deal ? DEAL_PILL[deal.status] : null;
  const vehicleLabel = deal ? vehicleName(deal.vehicle) : summary ? `${summary.vehicle.make} ${summary.vehicle.model} ${summary.vehicle.year}` : '';
  const vehicleSlug = deal?.vehicle.slug ?? summary?.vehicle.slug;

  // «Visto» / «Enviado» solo bajo mi último mensaje (marca de lectura real del servidor).
  const lastMineIndex = items.findLastIndex(item => (item.kind === 'message' && item.message.senderId === chat.me) || item.kind === 'outgoing');
  const lastMine = items[lastMineIndex];
  const seenAt = chat.seenAt ?? summary?.counterpartLastReadAt ?? null;
  const theirsAfter = items.slice(lastMineIndex + 1).some(item => item.kind === 'message' && item.message.senderId !== chat.me);
  const lastStatus = lastMine?.kind === 'message' ? ((seenAt && seenAt >= lastMine.at) || theirsAfter ? 'Visto' : 'Enviado') : null;
  const lastItem = items.at(-1);
  const inlineRequest = deal?.role === 'SELLER' && deal.status === 'REQUESTED' && lastItem?.kind === 'event' && lastItem.event.kind === 'REQUESTED';

  return (
    <>
      <section aria-label="Conversación" data-phone-immersive className="relative flex min-h-0 flex-col overflow-hidden rounded-[22px] border border-line bg-surface max-sm:fixed max-sm:inset-0 max-sm:z-40 max-sm:rounded-none max-sm:border-0">
        <header className="flex items-center gap-2.5 border-b border-line px-3.5 py-2.5">
          <Link href="/mensajes" aria-label="Volver a la lista" className="-ml-1 grid size-10 shrink-0 place-items-center rounded-full hover:bg-tile min-[768px]:hidden">
            <ChevronLeft className="size-4" strokeWidth={2.4} aria-hidden />
          </Link>
          {summary ? (
            <>
              <Avatar name={summary.counterpart.name} src={summary.counterpart.avatarUrl} tinted className="size-10 text-sm font-extrabold" />
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[15px] font-extrabold">{summary.counterpart.name}</span>
                  {summary.counterpart.isVerified && <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-success-soft px-[7px] text-[11px] font-extrabold text-success-fg">✓ Verificado</span>}
                </p>
                <p className="mt-px truncate text-[12.5px] text-muted">
                  {summary.role === 'BUYER' ? 'Vendedor' : 'Comprador'} ·{' '}
                  <Link href={`/vehiculos/${vehicleSlug}`} className="text-ink underline underline-offset-[3px]">
                    {vehicleLabel}
                  </Link>
                </p>
              </div>
              {pill && <span className={cn('hidden h-[26px] shrink-0 items-center rounded-full px-2.5 text-xs font-extrabold sm:inline-flex', pill.className)}>{pill.label}</span>}
              <button type="button" aria-label="Reportar" aria-expanded={reporting} onClick={() => setReporting(value => !value)} className="grid size-10 shrink-0 place-items-center rounded-full border border-line text-muted hover:text-ink">
                <Flag className="size-4" aria-hidden />
              </button>
            </>
          ) : (
            <Spinner className="text-muted" />
          )}
        </header>
        {reporting && summary && <ReportPopover conversationId={conversationId} name={name} onClose={() => setReporting(false)} />}

        {deal && (
          <button ref={sheetButton} type="button" aria-haspopup="dialog" onClick={() => setSheet(true)} className="flex items-center gap-2.5 border-b border-line bg-surface px-3.5 py-2.5 text-left min-[1100px]:hidden">
            <span className="relative h-[38px] w-14 shrink-0 overflow-hidden rounded-[10px] bg-card-tile">{deal.vehicle.coverUrl && <MediaImage src={deal.vehicle.coverUrl} alt="" fill sizes="56px" className="object-cover" />}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-bold">
                {money(deal.vehicle.price)} · {DEAL_PILL[deal.status].label}
              </span>
              <span className="block truncate text-xs text-muted">{deal.role === 'SELLER' ? 'Toca para gestionar la reserva y la venta' : 'Toca para ver tu reserva'}</span>
            </span>
            <ChevronUp className="size-[18px] shrink-0 text-muted" aria-hidden />
          </button>
        )}

        {direct ? (
          <div className="am-step-in grid gap-2 border-b border-line bg-soft px-3.5 py-2.5">
            <p className="text-[13px] leading-[1.45]">
              <b className="text-success-fg">✓</b> Chat directo: la reserva está confirmada. Ya pueden compartir datos de contacto y enviar notas de voz.
            </p>
            {summary?.contact && (
              <p className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]">
                <b>{summary.contact.name}</b>
                {summary.contact.phone && <a href={`tel:${summary.contact.phone.replace(/\s/g, '')}`}>{summary.contact.phone}</a>}
                {summary.contact.email && <a href={`mailto:${summary.contact.email}`}>{summary.contact.email}</a>}
                {(summary.contact.city || summary.contact.country) && <span className="text-muted">{[summary.contact.city, summary.contact.country ? countryName(summary.contact.country) : null].filter(Boolean).join(', ')}</span>}
              </p>
            )}
          </div>
        ) : (
          <p className="flex gap-2.5 border-b border-line bg-tile px-3.5 py-2.5 text-[13px] leading-[1.45]">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
            Por tu seguridad, ocultamos teléfonos, correos y enlaces hasta que el vendedor confirme una reserva. Paga el abono solo al vendedor y nunca por adelantado a terceros.
          </p>
        )}

        <div
          ref={scroller}
          role="log"
          aria-live="polite"
          aria-label="Mensajes"
          onScroll={event => {
            const element = event.currentTarget;
            stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
          }}
          className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3.5 sm:px-[22px] sm:py-[18px]"
        >
          {chat.isPending || !deal ? (
            <div className="grid flex-1 place-items-center text-muted">
              <Spinner className="size-5" />
            </div>
          ) : (
            <>
              {chat.hasOlder && (
                <div className="self-center">
                  <Button variant="ghost" size="sm" onClick={loadOlder} loading={chat.loadingOlder}>
                    Cargar mensajes anteriores
                  </Button>
                </div>
              )}
              {items.map((item, index) =>
                item.kind === 'event' ? (
                  <EventPill key={item.event.id} item={item} controller={controller} inline={Boolean(inlineRequest) && index === items.length - 1} />
                ) : item.kind === 'message' ? (
                  <MessageBubble key={item.message.id} message={item.message} mine={item.message.senderId === chat.me} status={index === lastMineIndex ? lastStatus : null} compact />
                ) : (
                  <MessageBubble key={item.message.clientId} outgoing={item.message} mine compact onRetry={() => chat.retry(item.message.clientId)} onDiscard={() => chat.discard(item.message.clientId)} />
                ),
              )}
              {chat.counterpartTyping && <p className="am-step-in self-start rounded-[14px] bg-tile px-3 py-2 text-[13px] text-muted">{name || 'La otra persona'} está escribiendo…</p>}
            </>
          )}
        </div>

        <div className="relative border-t border-line px-3 pt-2.5 pb-3 max-sm:pb-[calc(12px+env(safe-area-inset-bottom))]">
          <Composer onSendText={chat.sendText} onSendFile={(file, extra) => void chat.sendFile(file, extra)} onTyping={chat.notifyTyping} voiceEnabled={direct} />
        </div>

        {/* Tableta y teléfono: «El trato» en una hoja inferior. */}
        {sheet && deal && (
          <>
            <button
              type="button"
              aria-label="Cerrar el trato"
              tabIndex={-1}
              onClick={() => setSheet(false)}
              className="absolute inset-0 z-[8] bg-black/45 min-[1100px]:hidden"
            />
            <div role="dialog" aria-modal="true" aria-label="El trato" className="am-step-in absolute inset-x-0 bottom-0 z-[9] grid max-h-[78%] gap-3.5 overflow-y-auto rounded-t-[26px] bg-surface px-[18px] pt-2.5 pb-[calc(26px+env(safe-area-inset-bottom))] min-[1100px]:hidden">
              <span aria-hidden className="mx-auto h-[5px] w-10 rounded-full bg-line" />
              <div className="flex items-center justify-between">
                <p className="text-lg font-bold">El trato</p>
                <button
                  type="button"
                  autoFocus
                  onClick={() => {
                    setSheet(false);
                    sheetButton.current?.focus();
                  }}
                  className="h-10 rounded-full border border-line px-3.5 text-[13px] font-semibold"
                >
                  Cerrar
                </button>
              </div>
              <DealPanel controller={controller} sheet />
            </div>
          </>
        )}
      </section>

      <aside aria-label="El trato" className="hidden min-h-0 overflow-y-auto rounded-[22px] border border-line bg-surface p-4 min-[1100px]:block">
        {deal ? (
          <DealPanel controller={controller} />
        ) : controller.query.isError ? (
          <p className="text-sm text-muted">{controller.query.error.message}</p>
        ) : (
          <div className="grid h-full place-items-center text-muted">
            <Spinner className="size-5" />
          </div>
        )}
      </aside>
    </>
  );
}
