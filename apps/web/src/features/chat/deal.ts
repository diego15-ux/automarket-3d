'use client';

import { usdText } from '@automarket/contracts';
import type { ChatDealDTO, DealEventDTO, DealStatus, PublicDealStatus } from '@automarket/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { reservationsApi } from '@/features/reservations/api';
import { useToast } from '@/shared/ui/toaster';
import { chatApi, chatKeys } from './api';

/** Píldora del estado del trato (privada) y de lo que ve el público. */
export const DEAL_PILL: Record<DealStatus, { label: string; className: string }> = {
  AVAILABLE: { label: 'Disponible', className: 'bg-success-soft text-success-fg' },
  REQUESTED: { label: 'Reserva pedida', className: 'bg-gold-soft text-gold-fg' },
  RESERVED: { label: 'Reservado', className: 'bg-reserved-soft text-reserved-fg' },
  NEGOTIATING: { label: 'En negociación', className: 'bg-gold-soft text-gold-fg' },
  SOLD: { label: 'Vendido', className: 'bg-ink text-surface' },
  UNAVAILABLE: { label: 'No disponible', className: 'bg-tile text-muted' },
};
export const PUBLIC_PILL: Record<PublicDealStatus, { label: string; className: string }> = {
  AVAILABLE: DEAL_PILL.AVAILABLE,
  RESERVED: DEAL_PILL.RESERVED,
  NEGOTIATING: DEAL_PILL.NEGOTIATING,
  SOLD: DEAL_PILL.SOLD,
  UNAVAILABLE: DEAL_PILL.UNAVAILABLE,
};

export const DEAL_STEPS = ['Consulta', 'Reserva', 'Negociación', 'Vendido'] as const;
export const stepOf = (status: DealStatus) => ({ AVAILABLE: 0, REQUESTED: 0, RESERVED: 1, NEGOTIATING: 2, SOLD: 3, UNAVAILABLE: 0 })[status];

/** Chat directo: datos de contacto visibles y notas de voz (reserva confirmada o venta). */
export const isDirectStatus = (status: DealStatus) => status === 'RESERVED' || status === 'NEGOTIATING' || status === 'SOLD';

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
export const money = (value: string | number | null | undefined) => usdText(Number(value ?? 0));
export const vehicleName = (v: { make: string; model: string; version?: string | null; year: number }) => `${v.make} ${v.model}${v.version ? ` ${v.version}` : ''} ${v.year}`;

/** «10:31 a. m.» */
export function clock(iso: string): string {
  return new Intl.DateTimeFormat('es-VE', { hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(iso))
    .replace(/[  ]/g, ' ')
    .replace(/\s*a\.?\s*m\.?/i, ' a. m.')
    .replace(/\s*p\.?\s*m\.?/i, ' p. m.');
}

/** Bandeja: hora de hoy, «ayer», día corto de la semana o fecha. */
export function inboxTime(iso: string): string {
  const date = new Date(iso);
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(new Date()) - start(date)) / 86_400_000);
  if (days <= 0) return clock(iso);
  if (days === 1) return 'ayer';
  if (days < 7) return new Intl.DateTimeFormat('es', { weekday: 'short' }).format(date).replace('.', '');
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(date).replace('.', '');
}

/** «el martes 10 de noviembre» */
export const longDay = (iso: string) => 'el ' + new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso)).replace(',', '');

/** Texto de cada evento del hilo, con los nombres reales. */
export function eventText(event: DealEventDTO, deal: ChatDealDTO): string {
  const buyer = firstName(deal.buyer.name);
  const seller = firstName(deal.seller.name);
  switch (event.kind) {
    case 'ASKED':
      return `${buyer} preguntó por ${vehicleName(deal.vehicle)}`;
    case 'REQUESTED':
      return `${buyer} pidió reservar con un abono de ${money(event.amount)}`;
    case 'ACCEPTED':
      return `${seller} confirmó la reserva. ${buyer} paga el abono de ${money(event.amount)} y el auto queda apartado${event.until ? ` hasta ${longDay(event.until)}` : ''}.`;
    case 'REJECTED':
      return `${seller} rechazó la reserva. El auto sigue disponible.`;
    case 'REJECTED_OTHER':
      return `${seller} confirmó otra solicitud de reserva para este auto.`;
    case 'WITHDRAWN':
      return event.by === 'TEAM' ? 'El equipo de AutoMarket cerró la solicitud de reserva.' : `${buyer} retiró la solicitud de reserva.`;
    case 'REQUEST_EXPIRED':
      return 'Venció el plazo para responder la solicitud de reserva.';
    case 'NEGOTIATING':
      return `${seller} puso el auto en negociación. En el catálogo ahora dice «En negociación».`;
    case 'CANCELLED':
      if (event.by === 'SELLER') return `${seller} canceló la reserva y devuelve el abono completo. El auto vuelve a estar disponible.`;
      if (event.by === 'BUYER') return `${buyer} canceló la reserva. ${seller} debe devolverle el abono completo.`;
      return 'El equipo de AutoMarket canceló la reserva. El vendedor debe devolver el abono completo.';
    case 'NOT_CONCLUDED':
      return 'No se concretó. El auto vuelve a estar disponible y avisamos a quienes pidieron aviso.';
    case 'EXPIRED':
      return 'Terminó el plazo de la reserva sin venta. El auto vuelve a estar disponible.';
    case 'SOLD':
      return `${seller} marcó el auto como vendido por ${money(event.amount)}. ${buyer} ya puede puntuarlo.`;
  }
}

/** Ayuda del estado según quién mira. */
export function dealHelp(deal: ChatDealDTO): string {
  const buyer = firstName(deal.buyer.name);
  const seller = firstName(deal.seller.name);
  const until = deal.reservation?.expiresAt;
  if (deal.status === 'UNAVAILABLE') {
    if (deal.vehicle.status === 'RESERVED') return deal.role === 'SELLER' ? 'El auto está reservado con otro comprador.' : 'Otra persona reservó este auto. Si se libera, puedes pedir que te avisemos.';
    if (deal.vehicle.status === 'SOLD' || deal.vehicle.status === 'PENDING_SALE') return 'Este auto ya se vendió.';
    return 'El anuncio no está publicado ahora.';
  }
  if (deal.role === 'SELLER') {
    return {
      AVAILABLE: `Cuando ${buyer} pida reservar, aquí la confirmas y el chat pasa a directo.`,
      REQUESTED: `${buyer} pidió reservar. Si confirmas, el chat pasa a directo y el auto sale como «Reservado».`,
      RESERVED: 'Cuando acuerden la venta, ponlo en negociación para que los demás sepan que lo estás cerrando.',
      NEGOTIATING: 'Si cierran la venta, márcalo vendido. Si no se concreta, vuelve a mostrarse solo.',
      SOLD: `¡Vendido! ${buyer} puede puntuarte.`,
    }[deal.status];
  }
  return {
    AVAILABLE: `Reservar aparta el auto ${deal.rules.reservationHoldDays} días mientras lo revisas.`,
    REQUESTED: `${seller} tiene ${deal.rules.sellerResponseHours} horas para responder.`,
    RESERVED: `El auto está apartado para ti${until ? ` hasta ${longDay(until)}` : ''}.`,
    NEGOTIATING: `${seller} está cerrando la venta contigo.`,
    SOLD: 'Compra concretada.',
  }[deal.status];
}

/** Lo que ve el público («Así lo ven los demás»). */
export function publicText(deal: ChatDealDTO): string {
  if (deal.status === 'REQUESTED' && deal.publicStatus === 'AVAILABLE') return 'Sigue a la vista mientras el vendedor responde.';
  return {
    AVAILABLE: 'Cualquiera puede escribir o reservar.',
    RESERVED: 'Alguien pagó un abono. Puedes pedir que te avisemos si se libera.',
    NEGOTIATING: 'El dueño está cerrando la venta. Si no se concreta, vuelve a estar disponible y te avisamos.',
    SOLD: 'Ya no está disponible. Mira autos parecidos.',
    UNAVAILABLE: 'El anuncio no está publicado ahora.',
  }[deal.publicStatus];
}

export const watchersText = (n: number) => `${n} ${n === 1 ? 'persona pidió' : 'personas pidieron'} aviso si vuelve a estar disponible.`;

export type DealAction = 'request' | 'withdraw' | 'accept' | 'reject' | 'negotiate' | 'cancel' | 'notConcluded' | 'complete' | 'rate';
/** Acciones que piden dos toques (8 s para el segundo). */
export const ARMED_ACTIONS: DealAction[] = ['accept', 'negotiate', 'cancel', 'notConcluded'];
const ARM_MS = 8_000;

/**
 * Estado y acciones del trato de una conversación. El estado vive en el servidor (reservas reales);
 * cada acción llama a la API de reservas y la otra parte recibe el cambio por socket.
 */
export function useDeal(conversationId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: chatKeys.deal(conversationId), queryFn: () => chatApi.deal(conversationId), refetchOnWindowFocus: true });
  const deal = query.data;
  const [armed, setArmed] = useState<DealAction | null>(null);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(null), ARM_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: chatKeys.deal(conversationId) });
    void queryClient.invalidateQueries({ queryKey: chatKeys.conversations, exact: true });
    void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
  }, [conversationId, queryClient]);

  const mutation = useMutation({
    mutationFn: async ({ action, salePrice, rating }: { action: DealAction; salePrice?: string; rating?: number }) => {
      if (!deal) throw new Error('El trato aún no cargó.');
      const reservationId = deal.reservation?.id;
      if (action === 'request') return reservationsApi.create(deal.vehicle.id);
      if (!reservationId) throw new Error('No hay una reserva para esta acción.');
      switch (action) {
        case 'withdraw':
          return reservationsApi.cancel(reservationId);
        case 'accept':
          return reservationsApi.accept(reservationId);
        case 'reject':
          return reservationsApi.reject(reservationId);
        case 'negotiate':
          return reservationsApi.negotiate(reservationId);
        case 'cancel':
          return reservationsApi.cancel(reservationId);
        case 'notConcluded':
          return reservationsApi.cancel(reservationId, 'No se concretó la venta.');
        case 'complete':
          return reservationsApi.complete(reservationId, salePrice ?? '0');
        case 'rate':
          return reservationsApi.rateSeller(reservationId, rating ?? 5);
      }
    },
    onSuccess: (_data, { action }) => {
      refresh();
      if (!deal) return;
      const seller = firstName(deal.seller.name);
      const messages: Record<DealAction, string> = {
        request: 'Solicitud enviada. Esperando al vendedor.',
        withdraw: 'Solicitud retirada.',
        accept: 'Reserva confirmada. Ya es chat directo.',
        reject: 'Reserva rechazada.',
        negotiate: 'Ahora sale «En negociación» en el catálogo.',
        cancel: deal.role === 'SELLER' ? 'Reserva cancelada. El auto vuelve a mostrarse.' : 'Reserva cancelada. El vendedor te devuelve el abono.',
        notConcluded: deal.watchers > 0 ? `Vuelve a mostrarse. Avisamos a ${deal.watchers} ${deal.watchers === 1 ? 'persona' : 'personas'}.` : 'Vuelve a mostrarse en el catálogo.',
        complete: 'Marcado como vendido.',
        rate: `Gracias. Tu puntuación ya sale en el perfil de ${seller}.`,
      };
      toast({ tone: 'success', title: messages[action] });
    },
    onError: error => {
      refresh();
      toast({ tone: 'error', title: 'No se pudo completar', description: error.message });
    },
  });

  /** Primer toque arma (si la acción lo pide); el segundo, dentro de 8 s, ejecuta. */
  const tap = useCallback(
    (action: DealAction, input: { salePrice?: string; rating?: number } = {}) => {
      if (mutation.isPending) return;
      if (ARMED_ACTIONS.includes(action) && armed !== action) {
        setArmed(action);
        return;
      }
      setArmed(null);
      mutation.mutate({ action, ...input });
    },
    [armed, mutation],
  );

  return { query, deal, armed, disarm: () => setArmed(null), tap, pending: mutation.isPending ? mutation.variables?.action ?? null : null };
}

export type DealController = ReturnType<typeof useDeal>;
