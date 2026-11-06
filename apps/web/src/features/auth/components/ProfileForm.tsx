'use client';

import { ACCOUNT_TYPE_LABELS, COUNTRIES, PLAN_LABELS, ProfileUpdateSchema, ReviewSubmitSchema, type AccountType } from '@automarket/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { alertKeys, alertsApi } from '@/features/alerts/api';
import { useUnreadCount } from '@/features/chat';
import { PublicProfile } from '@/features/users/PublicProfile';
import { usersApi } from '@/features/users/api';
import { vehicleKeys, vehiclesApi } from '@/features/vehicles/api';
import { cn } from '@/shared/lib/cn';
import { ApiError, api } from '@/shared/lib/http';
import type { SessionUser } from '@/shared/lib/session';
import { Avatar } from '@/shared/ui/avatar';
import { PageSpinner } from '@/shared/ui/spinner';
import { useToast } from '@/shared/ui/toaster';
import { authApi } from '../api';
import { fieldErrors, safeNext, type FieldErrors } from '../schemas';
import { FormAlert } from './AuthCard';

type Tab = 'publico' | 'cuenta' | 'opinion';
const TABS: Array<[Tab, string]> = [
  ['publico', 'Perfil público'],
  ['cuenta', 'Mi cuenta'],
  ['opinion', 'Mi opinión'],
];

interface Draft {
  name: string;
  phone: string;
  country: string;
  city: string;
  accountType: AccountType;
  bio: string;
  businessName: string;
  taxId: string;
  fiscalAddress: string;
  businessPhone: string;
  businessHours: string;
}
const draftOf = (user: SessionUser): Draft => ({
  name: user.name,
  phone: user.phone ?? '',
  country: user.country ?? '',
  city: user.city ?? '',
  accountType: user.accountType,
  bio: user.bio ?? '',
  businessName: user.dealer?.businessName ?? '',
  taxId: user.dealer?.taxId ?? '',
  fiscalAddress: user.dealer?.fiscalAddress ?? '',
  businessPhone: user.dealer?.businessPhone ?? '',
  businessHours: user.businessHours ?? '',
});
const card = 'rounded-[22px] border border-line bg-surface';
const input = 'h-12 w-full rounded-[12px] border border-edge bg-field px-3.5 text-[15px] font-medium placeholder:text-faint disabled:bg-tile disabled:text-muted';

/**
 * Perfil (diseño «Perfil PC»): pestañas «Perfil público» (cómo te ven), «Mi cuenta» (editar) y
 * «Mi opinión» (reseña de AutoMarket). El borrador de «Mi cuenta» se conserva al cambiar de pestaña.
 */
export function ProfileForm({ user }: { user: SessionUser }) {
  const params = useSearchParams();
  const startTab: Tab = params.get('tab') === 'opinion' ? 'opinion' : params.get('tab') === 'publico' ? 'publico' : user.needsProfile || params.get('next') || params.get('tab') === 'cuenta' ? 'cuenta' : 'publico';
  const [tab, setTab] = useState<Tab>(startTab);
  const [draft, setDraft] = useState<Draft>(() => draftOf(user));
  useEffect(() => {
    if (window.location.hash === '#opinion') setTab('opinion');
  }, []);

  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const index = TABS.findIndex(([value]) => value === tab);
    const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]![0];
    setTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  }

  return (
    <div data-own-header data-profile-screen className="mx-auto grid w-full max-w-[1180px] gap-[18px]">
      <div role="tablist" aria-label="Secciones del perfil" onKeyDown={onTabKey} className="inline-flex flex-wrap gap-1 justify-self-start rounded-full bg-[#E7E9ED] p-1 dark:bg-sunken max-sm:w-full max-sm:overflow-x-auto">
        {TABS.map(([value, label]) => (
          <button
            key={value}
            id={`tab-${value}`}
            type="button"
            role="tab"
            aria-selected={tab === value}
            aria-controls={`panel-${value}`}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => setTab(value)}
            className={cn('h-10 shrink-0 rounded-full px-4 text-sm font-bold', tab === value ? 'bg-surface text-ink shadow-[0_1px_3px_rgb(17_19_18/0.12)]' : 'text-muted')}
          >
            {label}
          </button>
        ))}
      </div>
      <div key={tab} id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="am-step-in">
        {tab === 'publico' && <OwnPublicProfile user={user} onEdit={() => setTab('cuenta')} />}
        {tab === 'cuenta' && <AccountTab user={user} draft={draft} setDraft={setDraft} />}
        {tab === 'opinion' && <ReviewForm embedded />}
      </div>
    </div>
  );
}

function OwnPublicProfile({ user, onEdit }: { user: SessionUser; onEdit: () => void }) {
  const profile = useQuery({ queryKey: ['seller-profile', user.id], queryFn: () => usersApi.sellerProfile(user.id) });
  if (profile.isPending) return <PageSpinner />;
  if (profile.isError) return <p className="text-sm text-danger-fg">{profile.error.message}</p>;
  return (
    <div className="grid gap-[18px]">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[22px] border border-line bg-surface px-[18px] py-3.5">
        <AvatarUpload user={user} size="size-12 text-base" />
        <p className="min-w-[200px] flex-1 text-[13.5px] text-muted">Así te ven los compradores.</p>
        <button type="button" onClick={onEdit} className="h-[42px] rounded-full border border-edge bg-surface px-4 text-sm font-bold hover:border-ink">
          Editar mis datos
        </button>
      </div>
      <PublicProfile profile={profile.data} preview />
    </div>
  );
}

/** Foto de perfil: se sube directo al almacén de imágenes (en local, el de `npm run dev`). */
function AvatarUpload({ user, size = 'size-[72px] text-2xl' }: { user: SessionUser; size?: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const avatar = useMutation({
    mutationFn: authApi.updateAvatar,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-profile', user.id] });
      toast({ tone: 'success', title: 'Foto de perfil actualizada' });
    },
    onError: err =>
      toast(
        err instanceof ApiError
          ? { tone: 'error', title: 'No se pudo cambiar la foto', description: err.message }
          : { tone: 'error', title: 'No se pudo subir la foto', description: 'Revisa tu conexión e inténtalo de nuevo.' },
      ),
  });
  return (
    <div className="flex items-center gap-4">
      <Avatar name={user.name} src={user.avatarUrl} tinted className={cn('font-extrabold', size)} />
      <div>
        <label className="inline-flex h-[42px] cursor-pointer items-center rounded-full border border-edge bg-surface px-4 text-sm font-bold has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand">
          {avatar.isPending ? 'Subiendo…' : 'Cambiar foto'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            disabled={avatar.isPending}
            onChange={event => {
              const file = event.currentTarget.files?.[0];
              if (!file) return;
              if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) toast({ tone: 'error', title: 'Elige una foto JPG, PNG o WEBP de hasta 5 MB.' });
              else avatar.mutate(file);
              event.currentTarget.value = '';
            }}
          />
        </label>
        <p className="mt-1 text-[12.5px] text-muted">JPG, PNG o WEBP, hasta 5 MB.</p>
      </div>
    </div>
  );
}

function MenuLink({ href, children, badge, current, danger, onClick }: { href?: string; children: ReactNode; badge?: ReactNode; current?: boolean; danger?: boolean; onClick?: () => void }) {
  const className = cn('flex min-h-11 w-full items-center justify-between gap-2 rounded-[12px] px-3 text-left text-sm', current ? 'bg-tile font-extrabold' : 'font-semibold hover:bg-tile/60', danger && 'text-danger-fg');
  const content = (
    <>
      <span>{children}</span>
      {badge !== undefined && badge !== null && badge !== '' && <span className="text-xs font-bold text-muted">{badge}</span>}
    </>
  );
  if (!href) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {content}
      </button>
    );
  }
  return (
    <Link href={href} aria-current={current ? 'page' : undefined} className={className}>
      {content}
    </Link>
  );
}

function AccountMenu({ user }: { user: SessionUser }) {
  const router = useRouter();
  const unread = useUnreadCount();
  const listings = useQuery({ queryKey: vehicleKeys.mine, queryFn: vehiclesApi.mine, staleTime: 60_000 });
  const alerts = useQuery({ queryKey: alertKeys.overview, queryFn: alertsApi.overview, staleTime: 60_000 });
  const fresh = (alerts.data?.alerts.reduce((sum, alert) => sum + (alert.active ? alert.newCount : 0), 0) ?? 0) + (alerts.data?.recent.filter(notice => !notice.readAt).length ?? 0);
  return (
    <nav aria-label="Mi cuenta" className={cn(card, 'grid gap-0.5 p-2.5')}>
      <MenuLink href="/cuenta/anuncios" badge={listings.data?.usage.active || undefined}>
        Mis anuncios
      </MenuLink>
      <MenuLink href="/mensajes" badge={unread || undefined}>
        Mensajes
      </MenuLink>
      <MenuLink href="/cuenta/reservas">Mis reservas</MenuLink>
      <MenuLink href="/alertas" badge={fresh ? `${fresh} ${fresh === 1 ? 'nuevo' : 'nuevos'}` : undefined}>
        Mis alertas
      </MenuLink>
      <MenuLink href="/cuenta/plan" badge={PLAN_LABELS[user.plan.code]}>
        Mi membresía
      </MenuLink>
      <MenuLink current>Perfil</MenuLink>
      <MenuLink href="/cuenta/verificacion" badge={user.isVerified ? <b className="text-success-fg">✓</b> : 'Pendiente'}>
        Verificación de identidad
      </MenuLink>
      <MenuLink href="/terminos">Términos y políticas</MenuLink>
      <MenuLink
        danger
        onClick={async () => {
          await authApi.logout();
          router.push('/login');
        }}
      >
        Cerrar sesión
      </MenuLink>
    </nav>
  );
}

function Field({ id, label, error, locked, className, children }: { id: string; label: string; error?: string; locked?: boolean; className?: string; children: ReactNode }) {
  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {children}
      {error && <p className="text-[12.5px] text-danger-fg">{error}</p>}
      {locked && (
        <p className="flex items-center gap-1.5 text-[12.5px] text-muted">
          <Lock className="size-3.5 shrink-0" aria-hidden /> Se bloquea al verificarte. Para cambiarlo, escribe a soporte.
        </p>
      )}
    </div>
  );
}

function AccountTab({ user, draft, setDraft }: { user: SessionUser; draft: Draft; setDraft: (draft: Draft) => void }) {
  const id = useId();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<FieldErrors>({});
  const saved = draftOf(user);
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
  const locked = user.isVerified;
  const dealer = draft.accountType === 'DEALER';
  const set = (key: keyof Draft) => (value: string) => setDraft({ ...draft, [key]: value });

  const save = useMutation({
    mutationFn: authApi.updateProfile,
    onSuccess: updated => {
      setErrors({});
      void queryClient.invalidateQueries({ queryKey: ['seller-profile', user.id] });
      toast({ tone: 'success', title: 'Cambios guardados. Tu perfil público ya se ve así.', description: updated.isVerified && !user.isVerified ? '¡Tu identidad quedó verificada!' : undefined });
      if (params.get('next') && !updated.needsProfile) router.push(safeNext(params.get('next')));
    },
    onError: err => {
      if (err instanceof ApiError && err.code === 'TAX_ID_TAKEN') return setErrors({ taxId: err.message });
      toast({ tone: 'error', title: 'No se pudo guardar', description: err.message });
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty) return;
    if (draft.name.trim().split(/\s+/).filter(Boolean).length < 2) {
      toast({ tone: 'error', title: 'Escribe tu nombre y apellido.' });
      return;
    }
    const parsed = ProfileUpdateSchema.safeParse({
      ...draft,
      ...(dealer ? {} : { businessName: undefined, taxId: undefined, fiscalAddress: undefined, businessPhone: undefined, businessHours: undefined }),
    });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    save.mutate(parsed.data);
  }

  return (
    <div className="grid items-start gap-[18px] min-[900px]:grid-cols-[260px_minmax(0,1fr)]">
      <AccountMenu user={user} />
      <form aria-label="Mi perfil" noValidate onSubmit={onSubmit} className={cn(card, 'grid gap-4 p-[22px]')}>
        {user.needsProfile && <FormAlert>Completa tu país y ciudad para publicar, reservar y ver primero los autos cercanos.</FormAlert>}
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex h-7 items-center rounded-full bg-tile px-3 text-[13px] font-bold">
            {ACCOUNT_TYPE_LABELS[user.accountType]}
            {user.dealer && ` · ${user.dealer.businessName}`}
          </span>
          {user.isVerified ? (
            <span className="inline-flex h-7 items-center rounded-full bg-success-soft px-3 text-[13px] font-extrabold text-success-fg">✓ Identidad verificada</span>
          ) : (
            <Link href="/cuenta/verificacion" className="inline-flex h-7 items-center rounded-full bg-gold-soft px-3 text-[13px] font-extrabold text-gold-fg">
              Sin verificar: verifícate para publicar y reservar
            </Link>
          )}
        </div>
        <AvatarUpload user={user} />

        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3.5">
          <Field id={`${id}-name`} label={dealer ? 'Nombre del responsable' : 'Nombre completo'} error={errors.name}>
            <input id={`${id}-name`} value={draft.name} onChange={event => set('name')(event.target.value)} autoComplete="name" className={input} />
          </Field>
          <Field id={`${id}-phone`} label="Teléfono" error={errors.phone} locked={locked}>
            <input id={`${id}-phone`} type="tel" value={draft.phone} onChange={event => set('phone')(event.target.value)} disabled={locked} autoComplete="tel" placeholder="+58 414 123 4567" className={input} />
          </Field>
          <Field id={`${id}-country`} label="País" error={errors.country}>
            <select id={`${id}-country`} value={draft.country} onChange={event => set('country')(event.target.value)} autoComplete="country" className={input}>
              <option value="">Selecciona…</option>
              {COUNTRIES.map(country => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${id}-city`} label="Ciudad" error={errors.city}>
            <input id={`${id}-city`} value={draft.city} onChange={event => set('city')(event.target.value)} autoComplete="address-level2" placeholder="Ej. Caracas" className={input} />
          </Field>
          <Field id={`${id}-type`} label="Tipo de cuenta" locked={locked}>
            <select id={`${id}-type`} value={draft.accountType} onChange={event => set('accountType')(event.target.value)} disabled={locked} className={input}>
              {(['INDIVIDUAL', 'DEALER'] as const).map(value => (
                <option key={value} value={value}>
                  {ACCOUNT_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {dealer && (
          <fieldset className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3.5 rounded-[16px] border border-gold/35 bg-gold-soft/50 p-4">
            <legend className="px-1 text-sm font-extrabold">Datos fiscales (visibles en tu perfil e insignia)</legend>
            <Field id={`${id}-business`} label="Razón social" error={errors.businessName}>
              <input id={`${id}-business`} value={draft.businessName} onChange={event => set('businessName')(event.target.value)} autoComplete="organization" className={input} />
            </Field>
            <Field id={`${id}-tax`} label="RIF" error={errors.taxId} locked={locked}>
              <input id={`${id}-tax`} value={draft.taxId} onChange={event => set('taxId')(event.target.value)} disabled={locked} placeholder="J-12345678-9" className={input} />
            </Field>
            <Field id={`${id}-address`} label="Dirección fiscal" error={errors.fiscalAddress}>
              <input id={`${id}-address`} value={draft.fiscalAddress} onChange={event => set('fiscalAddress')(event.target.value)} autoComplete="street-address" className={input} />
            </Field>
            <Field id={`${id}-bphone`} label="Teléfono corporativo" error={errors.businessPhone}>
              <input id={`${id}-bphone`} type="tel" value={draft.businessPhone} onChange={event => set('businessPhone')(event.target.value)} placeholder="+58 212 555 0000" className={input} />
            </Field>
            <Field id={`${id}-hours`} label="Horario de atención" error={errors.businessHours} className="sm:col-span-2">
              <input id={`${id}-hours`} value={draft.businessHours} maxLength={120} onChange={event => set('businessHours')(event.target.value)} placeholder="Lun a vie 8:00–18:00 · Sáb 8:00–13:00" className={input} />
            </Field>
          </fieldset>
        )}

        <div className="grid gap-1.5">
          <label htmlFor={`${id}-bio`} className="text-sm font-semibold">
            Biografía pública
          </label>
          <textarea
            id={`${id}-bio`}
            rows={3}
            maxLength={500}
            value={draft.bio}
            onChange={event => set('bio')(event.target.value)}
            placeholder="Cuéntales a los compradores quién eres y cómo vendes."
            className="resize-y rounded-[12px] border border-edge bg-field px-3.5 py-3 text-[15px] leading-normal placeholder:text-faint"
          />
          <p className="text-right font-mono text-xs font-medium text-muted">{draft.bio.length} / 500</p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p aria-live="polite" className={cn('text-[13.5px]', dirty ? 'text-gold-fg' : 'text-muted')}>
            {dirty ? 'Tienes cambios sin guardar' : 'Todo guardado'}
          </p>
          <button type="submit" disabled={save.isPending} className={cn('h-12 rounded-full px-[22px] text-[14.5px] font-bold text-white disabled:opacity-70', dirty ? 'bg-brand' : 'bg-field-line')}>
            {save.isPending ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  );
}

interface MyReview {
  rating: number;
  comment: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}
const REVIEW_STATUS = {
  PENDING: ['En revisión', 'bg-gold-soft text-gold-fg'],
  APPROVED: ['Publicada', 'bg-success-soft text-success-fg'],
  REJECTED: ['No publicada', 'bg-danger-soft text-danger-fg'],
} as const;

/**
 * «Mi opinión» sobre AutoMarket: tras la revisión del equipo sale en la página de inicio.
 * La página del perfil la monta también fuera de las pestañas: ahí no pinta nada (va dentro).
 */
export function ReviewForm({ embedded = false }: { embedded?: boolean }) {
  if (!embedded) return null;
  return <ReviewFormBody />;
}

function ReviewFormBody() {
  const id = useId();
  const toast = useToast();
  const queryClient = useQueryClient();
  const review = useQuery({ queryKey: ['my-review'], queryFn: () => api.get<MyReview | null>('/api/reviews/mine') });
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stars = rating ?? review.data?.rating ?? 0;
  const text = comment ?? review.data?.comment ?? '';

  const submit = useMutation({
    mutationFn: (input: { rating: number; comment: string }) => api.put<MyReview>('/api/reviews/mine', input),
    onSuccess: data => {
      queryClient.setQueryData(['my-review'], data);
      toast({ tone: 'success', title: 'Gracias. El equipo la revisa antes de publicarla.' });
    },
    onError: err => setError(err instanceof ApiError ? err.message : 'No se pudo enviar.'),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stars) return setError('Elige de 1 a 5 estrellas');
    if (text.trim().length < 10) return setError('Escribe al menos 10 letras');
    const parsed = ReviewSubmitSchema.safeParse({ rating: stars, comment: text });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Revisa tu opinión');
    setError(null);
    submit.mutate(parsed.data);
  }

  const status = review.data ? REVIEW_STATUS[review.data.status] : null;
  if (review.isPending) return <PageSpinner />;
  return (
    <form aria-label="Tu opinión sobre AutoMarket" onSubmit={onSubmit} noValidate className={cn(card, 'grid max-w-[640px] gap-3.5 p-[22px]')}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-extrabold">Tu opinión sobre AutoMarket</h2>
        {status && <span className={cn('inline-flex h-[26px] items-center rounded-full px-2.5 text-[12.5px] font-extrabold', status[1])}>{status[0]}</span>}
      </div>
      <p className="text-sm text-muted">Las mejores salen en la página de inicio después de que el equipo las revise.</p>
      <div role="radiogroup" aria-label="Puntuación" className="flex gap-1">
        {[1, 2, 3, 4, 5].map(value => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={stars === value}
            aria-label={`${value} ${value === 1 ? 'estrella' : 'estrellas'}`}
            onClick={() => {
              setRating(value);
              setError(null);
            }}
            className={cn('grid size-[46px] place-items-center text-[32px] leading-none', value <= stars ? 'text-[#E0A800]' : 'text-edge')}
          >
            ★
          </button>
        ))}
      </div>
      <label htmlFor={`${id}-comment`} className="text-sm font-semibold">
        Comentario
      </label>
      <textarea
        id={`${id}-comment`}
        rows={4}
        maxLength={1000}
        value={text}
        onChange={event => {
          setComment(event.target.value);
          setError(null);
        }}
        placeholder="¿Qué te gustó? ¿Qué mejorarías?"
        className="resize-y rounded-[12px] border border-edge bg-field px-3.5 py-3 text-[15px] leading-normal placeholder:text-faint"
      />
      <div className="flex justify-between gap-3 text-[12.5px] text-muted">
        <span role="alert" className="text-danger-fg">
          {error}
        </span>
        <span className="font-mono">{text.length} / 1000</span>
      </div>
      <button type="submit" disabled={submit.isPending} className="h-12 w-full rounded-full bg-brand text-[14.5px] font-bold text-on-brand disabled:opacity-60">
        {submit.isPending ? 'Enviando…' : 'Enviar opinión'}
      </button>
    </form>
  );
}
