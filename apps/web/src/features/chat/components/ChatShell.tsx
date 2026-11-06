'use client';

import { MessageCircle } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { ConversationList } from './ConversationList';
import { ConversationThread } from './ConversationThread';

/**
 * Mensajes (diseños «Chat PC» y «Chat teléfono»): bandeja · conversación · «El trato».
 * PC (≥1100 px): tres columnas. Tableta: bandeja + conversación (el trato en una hoja).
 * Teléfono: la bandeja o la conversación a pantalla completa.
 */
export function ChatShell({ activeId }: { activeId?: string }) {
  return (
    <div data-own-header className="flex flex-col gap-3 sm:-mt-3.5">
      <div className="flex items-center justify-between gap-2.5 max-md:pt-1">
        <h1 className="text-[26px] font-extrabold tracking-[-0.03em] max-sm:font-bold">Mensajes</h1>
      </div>
      <div className="grid gap-3 md:h-[calc(100dvh-200px)] md:min-h-[600px] min-[768px]:grid-cols-[300px_minmax(0,1fr)] min-[768px]:grid-rows-[minmax(0,1fr)] min-[1100px]:grid-cols-[300px_minmax(0,1fr)_330px]">
        <section aria-label="Conversaciones" className={cn('flex min-h-0 flex-col overflow-hidden md:rounded-[22px] md:border md:border-line md:bg-surface max-md:-mx-5', activeId && 'max-md:hidden')}>
          <div className="contents md:hidden">
            <ConversationList activeId={activeId} phone />
          </div>
          <div className="hidden min-h-0 flex-1 flex-col md:flex">
            <ConversationList activeId={activeId} />
          </div>
        </section>
        {activeId ? (
          <ConversationThread key={activeId} conversationId={activeId} />
        ) : (
          <section className="hidden place-items-center rounded-[22px] border border-line bg-surface p-6 md:grid min-[1100px]:col-span-2">
            <div className="max-w-sm text-center">
              <MessageCircle className="mx-auto size-6 text-muted" strokeWidth={1.5} aria-hidden />
              <p className="mt-3 text-xl font-extrabold">Elige una conversación</p>
              <p className="mt-1.5 text-sm text-pretty text-muted">Aquí hablas en tiempo real con compradores y vendedores, y manejas la reserva y la venta.</p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
