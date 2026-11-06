'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Star } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ConfirmButton } from '@/features/reservations/components/ConfirmButton';
import { cn } from '@/shared/lib/cn';
import { formatDate } from '@/shared/lib/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { PageSpinner } from '@/shared/ui/spinner';
import { useToast } from '@/shared/ui/toaster';
import { adminApi, adminKeys, downloadExport } from '../api';

const REASONS: Record<string, string> = { FRAUD: 'Fraude', WRONG_INFO: 'Datos incorrectos', OFFENSIVE: 'Ofensivo', SPAM: 'Spam', OTHER: 'Otro' };

/** Informe PDF con todas las opiniones (media, distribución y comentarios completos). */
function ReviewsReport() {
  const toast = useToast();
  const exportPdf = useMutation({
    mutationFn: () => downloadExport('reviews', 'pdf'),
    onError: err => toast({ tone: 'error', title: 'No se pudo generar el PDF', description: err.message }),
  });
  return (
    <Button size="sm" variant="outline" loading={exportPdf.isPending} onClick={() => exportPdf.mutate()}>
      <FileText className="size-3.5" /> Exportar opiniones (PDF)
    </Button>
  );
}

function Reviews() {
  const queryClient = useQueryClient();
  const reviews = useQuery({ queryKey: adminKeys.reviews('PENDING'), queryFn: () => adminApi.reviews('PENDING') });
  const moderate = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'APPROVED' | 'REJECTED' }) => adminApi.moderateReview(id, status),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'reviews'] }),
  });
  if (reviews.isPending) return <PageSpinner />;
  if (reviews.isError) return <p className="text-danger-fg">{reviews.error.message}</p>;
  if (reviews.data.length === 0) {
    return (
      <div className="space-y-3">
        <ReviewsReport />
        <p className="text-sm text-muted">No hay reseñas pendientes de moderación.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      <li>
        <ReviewsReport />
      </li>
      {reviews.data.map(review => (
        <li key={review.id} className="rounded-md border border-line bg-surface p-4">
          <div className="flex items-center gap-2">
            <span className="flex" aria-label={`${review.rating} de 5`}>
              {[1, 2, 3, 4, 5].map(value => (
                <Star key={value} className={`size-4 ${value <= review.rating ? 'fill-gold text-gold' : 'text-line'}`} />
              ))}
            </span>
            <span className="text-xs text-muted">
              {review.user.name} · {review.user.email} · {formatDate(review.createdAt)}
            </span>
          </div>
          <p className="mt-2 text-sm">«{review.comment}»</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => moderate.mutate({ id: review.id, status: 'APPROVED' })}>
              Publicar en la landing
            </Button>
            <Button size="sm" variant="ghost" onClick={() => moderate.mutate({ id: review.id, status: 'REJECTED' })}>
              Rechazar
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ContactInbox() {
  const queryClient = useQueryClient();
  const messages = useQuery({ queryKey: adminKeys.contact, queryFn: adminApi.contact });
  const mark = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'NEW' | 'HANDLED' }) => adminApi.setContactStatus(id, status),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: adminKeys.contact }),
  });
  if (messages.isPending) return <PageSpinner />;
  if (messages.isError) return <p className="text-danger-fg">{messages.error.message}</p>;
  if (messages.data.length === 0) return <p className="text-sm text-muted">Sin mensajes de contacto.</p>;
  return (
    <ul className="space-y-2">
      {messages.data.map(message => (
        <li key={message.id} className={cn('rounded-md border border-line bg-surface p-4', message.status === 'HANDLED' && 'opacity-60')}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{message.subject ?? 'Sin asunto'}</p>
            <Badge tone={message.status === 'NEW' ? 'brand' : 'neutral'}>{message.status === 'NEW' ? 'Nuevo' : 'Atendido'}</Badge>
            <span className="text-xs text-muted">
              {message.name} · <a href={`mailto:${message.email}`} className="hover:underline">{message.email}</a> · {formatDate(message.createdAt)}
            </span>
          </div>
          <p className="mt-2 text-sm whitespace-pre-line">{message.message}</p>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => mark.mutate({ id: message.id, status: message.status === 'NEW' ? 'HANDLED' : 'NEW' })}>
            {message.status === 'NEW' ? 'Marcar como atendido' : 'Marcar como nuevo'}
          </Button>
        </li>
      ))}
    </ul>
  );
}

const TABS = [
  ['reviews', 'Reseñas', Reviews],
  ['contact', 'Contacto', ContactInbox],
] as const;

/** Opiniones de la landing y mensajes de contacto (las denuncias y la lista negra están en «Reportes»). */
export function AdminModeration() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('reviews');
  const Active = TABS.find(([value]) => value === tab)![2];
  return (
    <Card className="p-5 sm:p-6">
      <p className="mb-5 rounded-2xl bg-canvas px-4 py-3 text-sm text-muted">
        Las denuncias de anuncios, chats y perfiles y las palabras bloqueadas ahora están en{' '}
        <Link href="/admin/reportes" className="font-bold text-brand-fg underline underline-offset-2">
          Reportes
        </Link>
        .
      </p>
      <div role="tablist" className="mb-6 scrollbar-none flex gap-6 overflow-x-auto border-b border-line text-sm">
        {TABS.map(([value, label]) => (
          <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={cn('-mb-px shrink-0 border-b-2 py-2.5 whitespace-nowrap transition-colors', tab === value ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink')}>
            {label}
          </button>
        ))}
      </div>
      <Active />
    </Card>
  );
}
