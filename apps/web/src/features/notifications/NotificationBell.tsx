'use client';

import type { NotificationDTO } from '@automarket/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { authApi } from '@/features/auth/api';
import { getChatSocket } from '@/features/chat/lib/socket';
import { api } from '@/shared/lib/http';
import { formatShortDate } from '@/shared/lib/format';
import { useToast } from '@/shared/ui/toaster';

const KEY = ['notifications'] as const;

/**
 * Campana de avisos: carga inicial por HTTP y nuevos avisos en tiempo real por Socket.io.
 * `panel`: la del Resumen del panel (círculo blanco con un punto verde si hay avisos sin leer).
 */
export function NotificationBell({ variant = 'header' }: { variant?: 'header' | 'panel' }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const { data } = useQuery({ queryKey: KEY, queryFn: () => api.get<{ items: NotificationDTO[]; unread: number }>('/api/notifications') });
  const markRead = useMutation({
    mutationFn: () => api.post<void>('/api/notifications/read-all'),
    onSuccess: () => queryClient.setQueryData(KEY, (old: typeof data) => old && { unread: 0, items: old.items.map(n => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) }),
  });

  useEffect(() => {
    const socket = getChatSocket();
    const onNotification = (notification: NotificationDTO) => {
      void queryClient.invalidateQueries({ queryKey: KEY });
      toast({ title: notification.title, description: notification.body });
      // Membresía activada o vencida: el plan de la sesión cambia (banner, límites).
      if (notification.type.startsWith('MEMBERSHIP')) void authApi.reloadMe().catch(() => undefined);
    };
    socket.on('notification:new', onNotification);
    return () => {
      socket.off('notification:new', onNotification);
    };
  }, [queryClient, toast]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => !container.current?.contains(event.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const unread = data?.unread ?? 0;
  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-label={variant === 'panel' ? (unread ? `Avisos, ${unread} sin leer` : 'Avisos') : unread ? `${unread} avisos sin leer` : 'Avisos'}
        aria-expanded={open}
        onClick={() => {
          setOpen(value => !value);
          if (!open && unread > 0) markRead.mutate();
        }}
        className={
          variant === 'panel'
            ? 'relative grid size-11 place-items-center rounded-full border border-line bg-surface text-ink transition-colors hover:border-edge focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'
            : 'relative grid size-11 place-items-center rounded-full border border-edge text-ink transition-colors hover:border-ink'
        }
      >
        <Bell className={variant === 'panel' ? 'size-[18px]' : 'size-4'} strokeWidth={variant === 'panel' ? 1.9 : 1.75} />
        {unread > 0 &&
          (variant === 'panel' ? (
            <span aria-hidden="true" className="absolute top-[9px] right-[10px] size-2 rounded-full border-2 border-surface bg-brand" />
          ) : (
            <span className="absolute -top-0.5 -right-0.5 grid min-w-[18px] place-items-center rounded-full bg-brand px-1 font-mono text-[10px] leading-[18px] font-medium text-on-brand">{unread > 9 ? '9+' : unread}</span>
          ))}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-md border border-line bg-surface shadow-pop">
          <p className="border-b border-line px-4 py-3 font-display text-lg">Avisos</p>
          <ul className="max-h-96 divide-y divide-line overflow-y-auto">
            {(data?.items ?? []).length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">No tienes avisos todavía.</li>}
            {data?.items.map(item => {
              const content = (
                <>
                  <p className="flex items-start justify-between gap-2 text-sm font-medium">
                    <span className="flex items-center gap-2">
                      {!item.readAt && <span className="size-1.5 shrink-0 rounded-full bg-brand" aria-label="Sin leer" />}
                      {item.title}
                    </span>
                    <span className="shrink-0 text-xs font-normal text-muted figures">{formatShortDate(item.createdAt)}</span>
                  </p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{item.body}</p>
                </>
              );
              return (
                <li key={item.id}>
                  {item.link ? (
                    <Link href={item.link} onClick={() => setOpen(false)} className="block px-4 py-3 hover:bg-ink/[0.04]">
                      {content}
                    </Link>
                  ) : (
                    <div className="px-4 py-3">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
