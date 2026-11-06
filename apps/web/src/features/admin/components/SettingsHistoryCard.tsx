'use client';

import { useQuery } from '@tanstack/react-query';
import { formatDate, formatTime } from '@/shared/lib/format';
import { Card } from '@/shared/ui/card';
import { PageSpinner } from '@/shared/ui/spinner';
import { adminApi, adminKeys } from '../api';

/** Quién cambió qué y cuándo: planes, plazos, cuenta de cobro, redes, catálogo y Términos (auditoría). */
export function SettingsHistoryCard() {
  const history = useQuery({ queryKey: adminKeys.history, queryFn: () => adminApi.settingsHistory(40) });
  return (
    <Card id="historial" className="scroll-mt-24 p-5">
      <h2 className="text-lg font-extrabold">Historial de cambios</h2>
      <p className="mt-1 text-sm text-muted">Sale del registro de auditoría: no se puede editar ni borrar desde el panel.</p>
      {history.isPending ? (
        <PageSpinner />
      ) : history.isError ? (
        <p className="mt-4 text-danger-fg">{history.error.message}</p>
      ) : history.data.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Todavía no hay cambios registrados.</p>
      ) : (
        <ol className="mt-4 divide-y divide-line">
          {history.data.map(entry => (
            <li key={entry.id} className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)_12rem] sm:gap-4">
              <time dateTime={entry.createdAt} className="text-[13px] text-muted tabular-nums">
                {formatDate(entry.createdAt)} · {formatTime(entry.createdAt)}
              </time>
              <p className="text-sm text-pretty">{entry.summary}</p>
              <p className="truncate text-[13px] text-muted sm:text-right">{entry.actor ? entry.actor.name : 'Sistema'}</p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
