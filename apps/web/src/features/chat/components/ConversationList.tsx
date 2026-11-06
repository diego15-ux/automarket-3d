'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { Avatar } from '@/shared/ui/avatar';
import { Spinner } from '@/shared/ui/spinner';
import { inboxTime, isDirectStatus } from '../deal';
import { useConversations } from '../hooks/useChatConnection';
import type { ConversationSummary } from '../types';

/** Vista previa del último mensaje (el servidor ya ocultó teléfonos, correos y enlaces). */
function preview(conversation: ConversationSummary): string {
  const last = conversation.lastMessage;
  if (!last) return 'Aún no hay mensajes';
  if (last.type === 'AUDIO') return 'Nota de voz';
  if (last.type === 'IMAGE') return last.body ? `Foto · ${last.body}` : 'Foto';
  if (last.type === 'VIDEO') return last.body ? `Video · ${last.body}` : 'Video';
  return last.body ?? '';
}

/** Bandeja del diseño: buscar por nombre o auto; «Chat directo» cuando hay reserva confirmada. */
export function ConversationList({ activeId, phone = false }: { activeId?: string; phone?: boolean }) {
  const { data, isPending, isError } = useConversations();
  const [term, setTerm] = useState('');
  const list = useMemo(() => {
    const needle = term.trim().toLocaleLowerCase('es');
    if (!needle || !data) return data ?? [];
    return data.filter(c => `${c.counterpart.name} ${c.vehicle.make} ${c.vehicle.model} ${c.vehicle.year}`.toLocaleLowerCase('es').includes(needle));
  }, [data, term]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!phone && (
        <div className="p-3">
          <label htmlFor="chat-search" className="sr-only">
            Buscar conversación
          </label>
          <input
            id="chat-search"
            type="search"
            value={term}
            onChange={event => setTerm(event.target.value)}
            placeholder="Buscar por nombre o auto"
            className="h-[42px] w-full rounded-full border border-[#D8DBE0] bg-surface px-3.5 text-sm font-medium placeholder:text-faint dark:border-line"
          />
        </div>
      )}
      {isPending ? (
        <div className="grid place-items-center py-10 text-muted">
          <Spinner className="size-5" />
        </div>
      ) : isError ? (
        <p className="px-4 py-6 text-sm text-muted">No pudimos cargar tus conversaciones.</p>
      ) : data.length === 0 ? (
        <p className="px-4 py-6 text-sm leading-relaxed text-muted">Aún no tienes conversaciones. Abre la ficha de un auto y toca «Escribir al vendedor».</p>
      ) : list.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">No hay conversaciones con «{term.trim()}».</p>
      ) : (
        <ul className={cn('grid min-h-0 content-start gap-0.5 overflow-y-auto', phone ? 'px-2' : 'px-1.5 pb-1.5')}>
          {list.map(conversation => {
            const active = conversation.id === activeId;
            const direct = conversation.direct || isDirectStatus(conversation.dealStatus);
            const vehicle = `${conversation.vehicle.make} ${conversation.vehicle.model} ${conversation.vehicle.year}`;
            return (
              <li key={conversation.id} className="min-w-0">
                <Link
                  href={`/mensajes/${conversation.id}`}
                  aria-current={active ? 'true' : undefined}
                  className={cn('flex w-full gap-2.5 text-left', phone ? 'items-center gap-3 rounded-[16px] px-2.5 py-3' : 'items-start rounded-[14px] p-2.5', active && !phone ? 'bg-tile' : 'hover:bg-tile/60')}
                >
                  <Avatar name={conversation.counterpart.name} src={conversation.counterpart.avatarUrl} tinted className={cn(phone ? 'size-[46px] text-sm' : 'size-10 text-[13px]', 'font-extrabold')} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-1.5">
                      <span className={cn('truncate', phone ? 'text-[15px] font-bold' : 'text-sm font-extrabold')}>{conversation.counterpart.name}</span>
                      {conversation.lastMessageAt && <span className={cn('shrink-0 text-muted', phone ? 'text-xs' : 'text-[11.5px]')}>{inboxTime(conversation.lastMessageAt)}</span>}
                    </span>
                    <span className={cn('block truncate text-muted', phone ? 'text-[12.5px]' : 'text-xs')}>
                      {direct && <b className="font-bold text-brand-fg">Chat directo · </b>}
                      {phone ? vehicle : `${conversation.role === 'BUYER' ? 'Vendedor' : 'Comprador'} · ${vehicle}`}
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-1.5">
                      <span className={cn('truncate', phone ? 'text-[13.5px] text-ink' : 'text-[13px] text-ink/80', conversation.unreadCount > 0 && 'font-semibold text-ink')}>{preview(conversation)}</span>
                      {conversation.unreadCount > 0 && !active && (
                        <span aria-label={`${conversation.unreadCount} sin leer`} className={cn('grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand px-1.5 font-mono text-[11px] font-semibold text-on-brand', phone && 'h-[22px] min-w-[22px] text-[11.5px]')}>
                          {conversation.unreadCount}
                        </span>
                      )}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
