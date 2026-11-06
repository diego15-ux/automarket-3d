'use client';

import { usdText } from '@automarket/contracts';
import { USER_REPORT_REASONS, countryName, type SellerProfileDTO, type SellerRatingOpportunityDTO, type VehicleCardDTO } from '@automarket/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { chatApi } from '@/features/chat/api';
import { cn } from '@/shared/lib/cn';
import { formatDate } from '@/shared/lib/format';
import { useSession } from '@/shared/lib/use-session';
import { Avatar } from '@/shared/ui/avatar';
import { MediaImage } from '@/shared/ui/media-image';
import { useToast } from '@/shared/ui/toaster';
import { usersApi } from './api';
import { copyText } from '@/shared/lib/browser';

const REASON_LABELS: Record<(typeof USER_REPORT_REASONS)[number], string> = { FRAUD: 'Posible fraude', OFFENSIVE: 'Lenguaje ofensivo', SPAM: 'Spam', OTHER: 'Otro' };
const card = 'rounded-[22px] border border-line bg-surface';
const since = (iso: string) => new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' }).format(new Date(iso));

/** Etiqueta del auto en el perfil (sobre la foto: colores fijos, legibles en ambos temas). */
function tagOf(vehicle: VehicleCardDTO) {
  if (vehicle.status === 'RESERVED') return vehicle.inNegotiation ? { label: 'En negociación', className: 'bg-[#FFF4DB] text-[#8A5A00]' } : { label: 'Reservado', className: 'bg-[#EEF2FF] text-[#3730A3]' };
  if (vehicle.isFeatured) return { label: 'Destacado', className: 'bg-brand text-on-brand' };
  return { label: 'Disponible', className: 'bg-success-soft text-success-fg' };
}

function ProfileVehicle({ vehicle, priority = false }: { vehicle: VehicleCardDTO; priority?: boolean }) {
  const tag = tagOf(vehicle);
  return (
    <li>
      <Link href={`/vehiculos/${vehicle.slug}`} className={cn(card, 'block overflow-hidden transition-[border-color] hover:border-edge')}>
        <span className="relative block h-[130px] bg-card-tile">
          {vehicle.coverUrl && <MediaImage src={vehicle.coverUrl} alt="" fill priority={priority} sizes="260px" className="object-cover" />}
          <span className={cn('absolute top-2.5 left-2.5 inline-flex h-6 items-center rounded-full px-[9px] text-xs font-extrabold', tag.className)}>{tag.label}</span>
        </span>
        <span className="block px-3.5 pt-3 pb-3.5">
          <span className="block truncate text-[15px] font-extrabold">
            {vehicle.make} {vehicle.model}
            {vehicle.version ? ` ${vehicle.version}` : ''} {vehicle.year}
          </span>
          <span className="block text-[13px] text-muted">
            {vehicle.mileageKm.toLocaleString('de-DE')} km · {vehicle.city}
          </span>
          <span className="mt-1.5 block text-[17px] font-extrabold">{usdText(Number(vehicle.price))}</span>
        </span>
      </Link>
    </li>
  );
}

function ReportPopover({ profile, onClose }: { profile: SellerProfileDTO; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState<(typeof USER_REPORT_REASONS)[number] | null>(null);
  const send = useMutation({
    mutationFn: () => usersApi.report(profile.id, { reason: reason! }),
    onSuccess: () => {
      onClose();
      toast({ tone: 'success', title: 'Abrimos el reporte. El equipo revisa cada caso.' });
    },
    onError: err => toast({ tone: 'error', title: 'No se pudo enviar', description: err.message }),
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const name = profile.name.split(' ')[0];
  return (
    <div role="dialog" aria-label="Reportar este perfil" className="am-step-in absolute top-full right-0 z-10 mt-2 grid w-[280px] gap-2.5 rounded-[18px] border border-line bg-surface p-3.5 text-left shadow-[0_18px_40px_-16px_rgb(0_0_0/0.4)]">
      <p className="text-[15px] font-extrabold">Reportar a {name}</p>
      <div role="radiogroup" aria-label="Motivo" className="flex flex-wrap gap-1.5">
        {USER_REPORT_REASONS.map(value => (
          <button key={value} type="button" role="radio" aria-checked={reason === value} onClick={() => setReason(value)} className={cn('min-h-9 rounded-full border px-3 text-[13px] font-semibold', reason === value ? 'border-ink bg-ink text-surface' : 'border-field-line bg-field')}>
            {REASON_LABELS[value]}
          </button>
        ))}
      </div>
      <p className="text-[12.5px] text-muted">El equipo revisa el perfil para decidir. {name} no sabe quién lo reportó.</p>
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="h-10 flex-1 rounded-full border border-field-line text-[13px] font-bold">
          Cancelar
        </button>
        <button
          type="button"
          disabled={send.isPending}
          onClick={() => (reason ? send.mutate() : toast({ tone: 'error', title: 'Elige un motivo.' }))}
          className="h-10 flex-1 rounded-full bg-danger text-[13px] font-bold text-white disabled:opacity-60 dark:text-[#06140D]"
        >
          Enviar reporte
        </button>
      </div>
    </div>
  );
}

/**
 * Perfil público del vendedor (diseño «Perfil público»): datos, reputación con estrellas reales
 * (solo puntúa quien compró con reserva), autos publicados y recomendaciones.
 * `preview`: el dueño viendo cómo lo ven los demás (sin chat ni reporte a sí mismo).
 */
export function PublicProfile({ profile, preview = false }: { profile: SellerProfileDTO; preview?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const session = useSession();
  const [reporting, setReporting] = useState(false);
  const signedIn = session.status === 'authenticated';
  const chatable = profile.vehicles.filter(v => v.status === 'PUBLISHED' || v.status === 'RESERVED');
  const openChat = useMutation({
    mutationFn: (vehicleId: string) => chatApi.open(vehicleId),
    onSuccess: ({ id }) => router.push(`/mensajes/${id}`),
    onError: err => toast({ tone: 'error', title: 'No se pudo abrir el chat', description: err.message }),
  });
  const total = profile.ratingCount;
  const average = profile.ratingAverage === null ? null : profile.ratingAverage.toLocaleString('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const place = [profile.city, profile.country ? countryName(profile.country) : null].filter(Boolean).join(', ');
  const button = 'h-[42px] flex-1 rounded-full border border-edge bg-surface text-[13.5px] font-bold disabled:opacity-50';

  function writeChat() {
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(`/vendedores/${profile.id}`)}`);
      return;
    }
    if (chatable.length === 1) openChat.mutate(chatable[0]!.id);
    else {
      document.getElementById('autos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast({ tone: 'info', title: 'Elige el auto sobre el que quieres escribirle.' });
    }
  }

  return (
    <div className="grid gap-[18px]">
      <section aria-label="Perfil del vendedor" className={cn(card, 'flex flex-wrap items-center gap-[22px] p-6')}>
        <Avatar name={profile.name} src={profile.avatarUrl} tinted className="size-[104px] text-[34px] font-extrabold shadow-[0_0_0_4px_var(--color-surface),0_0_0_6px_var(--color-brand)]" />
        <div className="grid min-w-0 flex-[1_1_320px] gap-1.5">
          <h1 className="text-[clamp(26px,3vw,32px)] font-extrabold tracking-[-0.03em]">{profile.name}</h1>
          <p className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-sm">
            {profile.isVerified && <span className="inline-flex h-[26px] items-center rounded-full bg-success-soft px-2.5 font-extrabold text-success-fg">✓ Verificado</span>}
            {profile.dealerName && <span className="font-bold">{profile.dealerName}</span>}
            {place && <span className="text-muted">{place}</span>}
            <span className="text-muted">Miembro desde {since(profile.memberSince)}</span>
          </p>
          {profile.bio && <p className="mt-1 max-w-[620px] text-[15px] leading-normal whitespace-pre-line">{profile.bio}</p>}
        </div>
        <div className="grid min-w-[220px] gap-2 max-sm:w-full">
          <div className="rounded-[16px] bg-tile px-3.5 py-3">
            <p className="text-[26px] font-extrabold">
              {average ?? '—'} <span className="text-[#B7791F]">★</span>
            </p>
            <p className="text-[13px] text-muted">
              {total === 0 ? 'Sin recomendaciones aún' : `${total} ${total === 1 ? 'recomendación' : 'recomendaciones'}`}
            </p>
          </div>
          <button
            type="button"
            onClick={writeChat}
            disabled={preview || chatable.length === 0 || openChat.isPending}
            title={preview ? 'Así lo ven los compradores' : chatable.length === 0 ? 'No tiene autos publicados' : undefined}
            className="h-[46px] rounded-full bg-brand text-[14.5px] font-bold text-on-brand disabled:opacity-60"
          >
            Escribir por el chat
          </button>
          <div className="relative flex gap-2">
            <button
              type="button"
              className={button}
              onClick={async () => {
                try {
                  await copyText(`${window.location.origin}/vendedores/${profile.id}`);
                  toast({ tone: 'success', title: 'Enlace del perfil copiado.' });
                } catch {
                  toast({ tone: 'error', title: 'No se pudo copiar el enlace' });
                }
              }}
            >
              Compartir
            </button>
            <button type="button" className={cn(button, 'text-danger-fg')} disabled={preview} aria-expanded={reporting} onClick={() => (signedIn ? setReporting(value => !value) : router.push(`/login?next=${encodeURIComponent(`/vendedores/${profile.id}`)}`))}>
              Reportar
            </button>
            {reporting && <ReportPopover profile={profile} onClose={() => setReporting(false)} />}
          </div>
          {preview && <p className="text-center text-[12.5px] text-muted">Vista previa: así te ven los compradores.</p>}
        </div>
      </section>

      <div className="grid items-start gap-[18px] min-[900px]:grid-cols-[minmax(0,1fr)_320px]">
        <section id="autos" aria-labelledby="autos-title" className="grid scroll-mt-28 gap-3">
          <h2 id="autos-title" className="text-xl font-extrabold">
            Vehículos publicados <span className="font-semibold text-muted">({profile.vehicles.length})</span>
          </h2>
          {profile.vehicles.length ? (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
              {profile.vehicles.map((vehicle, index) => (
                <ProfileVehicle key={vehicle.id} vehicle={vehicle} priority={index < 4} />
              ))}
            </ul>
          ) : (
            <p className={cn(card, 'p-5 text-sm text-muted')}>No tiene autos publicados ahora.</p>
          )}
        </section>
        <section aria-labelledby="reco-title" className={cn(card, 'grid gap-2.5 p-[18px]')}>
          <h2 id="reco-title" className="text-[17px] font-extrabold">
            Recomendaciones
          </h2>
          {profile.ratingDistribution.map((count, index) => (
            <div key={5 - index} className="grid grid-cols-[34px_minmax(0,1fr)_24px] items-center gap-2 text-[13px]">
              <span>{5 - index} ★</span>
              <span className="h-2 overflow-hidden rounded-[0_4px_4px_0] bg-[#ECEEF1] dark:bg-tile">
                <span className="block h-full rounded-[0_4px_4px_0] bg-[#B7791F]" style={{ width: total ? `${(count / total) * 100}%` : 0 }} />
              </span>
              <span className="text-right font-mono">{count}</span>
            </div>
          ))}
          <p className="mt-1 text-[12.5px] leading-[1.45] text-muted">Solo puntúa quien compró con reserva.</p>
          {profile.soldCount > 0 && <p className="text-[12.5px] text-muted">{profile.soldCount} {profile.soldCount === 1 ? 'auto vendido' : 'autos vendidos'} con reserva en AutoMarket.</p>}
        </section>
      </div>
      {!preview && <RateSeller sellerId={profile.id} />}
    </div>
  );
}

/** Una compra por puntuar: estrellas y comentario opcional, que salen en la página del vendedor. */
function RatingItem({ item, sellerId }: { item: SellerRatingOpportunityDTO; sellerId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [rating, setRating] = useState(item.rating ?? 0);
  const [comment, setComment] = useState(item.comment ?? '');
  const changed = rating !== (item.rating ?? 0) || comment.trim() !== (item.comment ?? '');
  const save = useMutation({
    mutationFn: () => usersApi.rateSeller(item.reservationId, rating, comment.trim()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-profile', sellerId] });
      void queryClient.invalidateQueries({ queryKey: ['seller-rating-opportunities', sellerId] });
      void queryClient.invalidateQueries({ queryKey: ['dealer-page', sellerId] });
      toast({ tone: 'success', title: 'Gracias. Tu reseña ya sale en el perfil.' });
    },
    onError: err => toast({ tone: 'error', title: 'No se pudo guardar la reseña', description: err.message }),
  });
  const fieldId = `rate-${item.reservationId}`;

  return (
    <form
      className="grid gap-2.5 border-t border-line pt-3 first:border-t-0 first:pt-0"
      onSubmit={event => {
        event.preventDefault();
        if (rating > 0) save.mutate();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm">
          {item.vehicleTitle} · {formatDate(item.completedAt)}
        </span>
        <div role="radiogroup" aria-label={`Puntuar ${item.vehicleTitle}`} className="flex gap-1">
          {[1, 2, 3, 4, 5].map(star => (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={rating === star}
              aria-label={`${star} ${star === 1 ? 'estrella' : 'estrellas'}`}
              onClick={() => setRating(star)}
              className={cn('grid size-10 place-items-center text-[26px] leading-none', star <= rating ? 'text-[#C99A2E]' : 'text-edge')}
            >
              ★
            </button>
          ))}
        </div>
      </div>
      <label htmlFor={fieldId} className="text-[13px] font-semibold">
        Cuenta cómo te fue <span className="font-normal text-muted">(opcional)</span>
      </label>
      <textarea
        id={fieldId}
        rows={2}
        maxLength={400}
        value={comment}
        onChange={event => setComment(event.target.value)}
        placeholder="Por ejemplo: cómo fue la entrega o si el auto estaba como en las fotos."
        className="w-full resize-y rounded-[12px] border border-edge bg-field px-3.5 py-2.5 text-[14.5px] placeholder:text-faint"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted">{comment.length}/400</span>
        <button type="submit" disabled={rating === 0 || !changed || save.isPending} className="h-10 rounded-full bg-brand px-5 text-sm font-bold text-on-brand disabled:opacity-50">
          {item.rating ? 'Guardar cambios' : 'Publicar reseña'}
        </button>
      </div>
    </form>
  );
}

/** Quien compró con reserva puede puntuar al vendedor (una vez por compra, editable). */
export function RateSeller({ sellerId }: { sellerId: string }) {
  const session = useSession();
  const mine = session.status === 'authenticated' && session.user.id === sellerId;
  const opportunities = useQuery({ queryKey: ['seller-rating-opportunities', sellerId], queryFn: () => usersApi.sellerRatingOpportunities(sellerId), enabled: session.status === 'authenticated' && !mine });
  if (!opportunities.data?.length) return null;
  return (
    <section aria-labelledby={`rate-title-${sellerId}`} className={cn(card, 'grid gap-3 p-[18px]')}>
      <h2 id={`rate-title-${sellerId}`} className="text-[17px] font-extrabold">
        Puntúa al vendedor
      </h2>
      {opportunities.data.map(item => (
        <RatingItem key={item.reservationId} item={item} sellerId={sellerId} />
      ))}
    </section>
  );
}
