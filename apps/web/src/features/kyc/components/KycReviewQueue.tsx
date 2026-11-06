'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ago, PANEL_ICON, PanelIcon, Segmented, usePanelToast } from '@/features/admin/components/panel-kit';
import { cn } from '@/shared/lib/cn';
import { formatDate, initials } from '@/shared/lib/format';
import { PageSpinner } from '@/shared/ui/spinner';
import { useToast } from '@/shared/ui/toaster';
import { kycApi, kycKeys, type KycDecision, type KycDocumentStatus, type KycDocumentType, type KycQueueItem } from '../api';

/**
 * Verificación de identidad (diseño «admin-kyc»): cola por orden de llegada, documento y selfie
 * de la misma persona lado a lado (enlaces temporales de 5 min, cada vista queda auditada), lista
 * de comprobaciones y decisión. Nadie publica ni reserva sin pasar por aquí.
 */
const TYPE_LABEL: Record<KycDocumentType, string> = {
  NATIONAL_ID: 'Cédula de identidad',
  PASSPORT: 'Pasaporte',
  DRIVER_LICENSE: 'Licencia de conducir',
  SELFIE: 'Selfie con la cédula',
  PROOF_OF_ADDRESS: 'Comprobante de domicilio',
  BUSINESS_REGISTRATION: 'RIF del concesionario',
};
const TYPE_ICON = (type: KycDocumentType) => (type === 'SELFIE' ? PANEL_ICON.person : type === 'BUSINESS_REGISTRATION' || type === 'PROOF_OF_ADDRESS' ? PANEL_ICON.doc : PANEL_ICON.id);
const STATUS: Record<KycDocumentStatus, [string, string]> = {
  PENDING: ['Pendiente', 'bg-gold-soft text-gold-fg'],
  APPROVED: ['Aprobado', 'bg-success-soft text-success-fg'],
  REJECTED: ['Rechazado', 'bg-[#F1F2F4] text-muted dark:bg-white/8'],
};
const CHECKS: Record<'person' | 'business', string[]> = {
  person: ['La cara de la selfie coincide con la del documento', 'El nombre coincide con el del perfil', 'El documento se lee completo y está vigente'],
  business: ['El documento es de la empresa del perfil', 'Razón social y RIF coinciden con el perfil', 'El documento se lee completo y está vigente'],
};
const nameOf = (item: KycQueueItem) => (item.user.accountType === 'DEALER' && item.user.businessName ? item.user.businessName : item.user.name);
const EMPTY: Record<KycDocumentStatus, [string, string]> = {
  PENDING: ['Cola al día', 'No quedan documentos por revisar.'],
  APPROVED: ['Sin aprobados todavía', 'Aquí salen los documentos que apruebes.'],
  REJECTED: ['Sin rechazados', 'Aquí salen los documentos que rechaces.'],
};

export function KycReviewQueue() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const panelToast = usePanelToast();
  const [status, setStatus] = useState<KycDocumentStatus>('PENDING');
  const queue = useInfiniteQuery({
    queryKey: kycKeys.queue(status),
    queryFn: ({ pageParam }) => kycApi.queue(status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
  });
  const counts = useQuery({ queryKey: kycKeys.counts, queryFn: kycApi.counts, refetchInterval: 60_000 });
  /** Decididos en esta visita (para que salgan de «Pendientes» al instante). */
  const [decided, setDecided] = useState<Record<string, { status: KycDocumentStatus; reason: string | null; userVerified: boolean }>>({});
  const items = useMemo(() => {
    const all = queue.data?.pages.flatMap(page => page.data) ?? [];
    return all.filter(item => !(status === 'PENDING' && decided[item.id]));
  }, [queue.data, decided, status]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find(item => item.id === selectedId) ?? items[0] ?? null;
  const [checks, setChecks] = useState([false, false, false]);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const detail = useRef<HTMLElement>(null);

  const reset = () => {
    setChecks([false, false, false]);
    setRejecting(false);
    setReason('');
  };
  useEffect(reset, [selected?.id]);

  const review = useMutation({
    mutationFn: ({ item, decision }: { item: KycQueueItem; decision: KycDecision }) => kycApi.review(item.id, decision),
    onSuccess: (result, { item, decision }) => {
      setDecided(current => ({ ...current, [item.id]: { status: result.status, reason: decision.decision === 'REJECT' ? decision.reason : null, userVerified: result.userVerified } }));
      // Salta al siguiente pendiente (el primero de la cola que no sea este).
      const next = items.find(other => other.id !== item.id && other.status === 'PENDING');
      setSelectedId(next?.id ?? null);
      reset();
      void queryClient.invalidateQueries({ queryKey: kycKeys.counts });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'badge', 'kyc'] });
      void queryClient.invalidateQueries({ queryKey: kycKeys.queue('APPROVED') });
      void queryClient.invalidateQueries({ queryKey: kycKeys.queue('REJECTED') });
      panelToast.show(result.status === 'APPROVED' ? (next ? 'Documento aprobado. Pasamos al siguiente.' : 'Documento aprobado. Cola al día.') : 'Rechazo enviado. El usuario puede volver a subirlo.');
    },
    onError: error => toast({ tone: 'error', title: 'No se pudo guardar la decisión', description: error.message }),
  });

  const changeStatus = (next: KycDocumentStatus) => {
    setStatus(next);
    setSelectedId(null);
    setDecided({});
    reset();
    void queryClient.invalidateQueries({ queryKey: kycKeys.queue(next) });
  };
  const choose = (id: string) => {
    setSelectedId(id);
    if (window.matchMedia('(max-width: 899px)').matches) requestAnimationFrame(() => detail.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const shown = selected ? { ...selected, ...(decided[selected.id] ? { status: decided[selected.id]!.status, rejectionReason: decided[selected.id]!.reason } : {}) } : null;
  const kind = shown?.type === 'BUSINESS_REGISTRATION' ? 'business' : 'person';

  return (
    <div data-own-header className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-[1_1_280px]">
          <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-ink">Verificación de identidad</h1>
          <p className="mt-0.5 text-sm text-muted">Por orden de llegada. Nadie publica ni reserva sin pasar por aquí.</p>
        </div>
        <Segmented
          label="Estado de los documentos"
          value={status}
          onChange={changeStatus}
          options={[
            { value: 'PENDING', label: 'Pendientes', count: counts.data?.PENDING },
            { value: 'APPROVED', label: 'Aprobados', count: counts.data?.APPROVED },
            { value: 'REJECTED', label: 'Rechazados', count: counts.data?.REJECTED },
          ]}
        />
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <section aria-label="Cola de documentos" className="flex min-w-0 flex-[1_1_300px] flex-col gap-2.5">
          {queue.isPending ? (
            <PageSpinner />
          ) : queue.isError ? (
            <p className="rounded-[18px] border border-line bg-surface p-5 text-sm text-danger-fg">{queue.error.message}</p>
          ) : items.length === 0 ? (
            <div className="rounded-[18px] border border-dashed border-edge bg-surface px-5 py-10 text-center">
              <p className="text-base font-bold text-ink">{EMPTY[status][0]}</p>
              <p className="mt-1 text-sm text-muted">{EMPTY[status][1]}</p>
            </div>
          ) : (
            <>
              {items.map(item => {
                const active = item.id === selected?.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => choose(item.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-[18px] border bg-surface p-3.5 text-left text-sm transition-[border-color,box-shadow,transform] duration-200 ease-[cubic-bezier(.2,.9,.25,1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand motion-reduce:transition-none',
                      active ? 'translate-x-1 border-ink shadow-[0_10px_24px_-16px_rgba(21,23,26,0.45)]' : 'border-line hover:border-edge',
                    )}
                  >
                    <span aria-hidden="true" className={cn('grid size-11 shrink-0 place-items-center rounded-[14px]', active ? 'bg-[#15171a] text-mint' : 'bg-tile text-[#3E444D] dark:text-ink/80')}>
                      <PanelIcon d={TYPE_ICON(item.type)} size={20} stroke={1.8} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold text-ink">{nameOf(item)}</span>
                      <span className="block truncate text-[13px] text-muted">{TYPE_LABEL[item.type]}</span>
                    </span>
                    <span className="font-mono text-[11.5px] whitespace-nowrap text-muted">{ago(item.createdAt).replace('hace ', '')}</span>
                  </button>
                );
              })}
              {queue.hasNextPage && (
                <button type="button" onClick={() => void queue.fetchNextPage()} disabled={queue.isFetchingNextPage} className="h-11 rounded-full border border-line bg-surface text-sm font-bold text-ink hover:border-ink disabled:opacity-60">
                  {queue.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
                </button>
              )}
            </>
          )}
        </section>

        {shown && (
          <section ref={detail} aria-labelledby="kyc-detalle" className="flex min-w-0 flex-[2_1_480px] scroll-mt-4 flex-col gap-[18px] rounded-[20px] border border-line bg-surface p-[22px]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-mine text-[15px] font-extrabold text-on-mine">
                  {initials(nameOf(shown))}
                </span>
                <div className="min-w-0">
                  <h2 id="kyc-detalle" className="truncate text-lg font-extrabold text-ink">
                    {nameOf(shown)}
                  </h2>
                  <p className="text-[13px] text-muted">
                    {TYPE_LABEL[shown.type]} · enviado {ago(shown.createdAt)}
                  </p>
                </div>
              </div>
              <span className={cn('inline-flex h-7 items-center rounded-full px-3 text-[12.5px] font-bold', STATUS[shown.status][1])}>{STATUS[shown.status][0]}</span>
            </div>

            <Previews item={shown} />

            <dl className="grid grid-cols-[150px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-sm max-[460px]:grid-cols-[110px_minmax(0,1fr)]">
              <dt className="text-muted">Correo</dt>
              <dd className="truncate text-ink">{shown.user.email}</dd>
              {shown.user.accountType === 'DEALER' && (
                <>
                  <dt className="text-muted">RIF declarado</dt>
                  <dd className="font-mono text-[13px] text-ink">{shown.user.taxId ?? '—'}</dd>
                </>
              )}
              <dt className="text-muted">Teléfono</dt>
              <dd className="text-ink">{shown.user.phone ?? 'Sin teléfono en el perfil'}</dd>
              {shown.expiresAt && (
                <>
                  <dt className="text-muted">Vence</dt>
                  <dd className={cn('text-ink', new Date(shown.expiresAt) < new Date() && 'font-bold text-danger-fg')}>{formatDate(shown.expiresAt)}</dd>
                </>
              )}
              <dt className="text-muted">Huella del archivo</dt>
              <dd className="truncate font-mono text-xs text-[#3E444D] dark:text-ink/80" title={shown.sha256}>
                {shown.sha256}
              </dd>
              {shown.reviewer && shown.status !== 'PENDING' && (
                <>
                  <dt className="text-muted">Revisó</dt>
                  <dd className="text-ink">
                    {shown.reviewer}
                    {shown.reviewedAt ? ` · ${formatDate(shown.reviewedAt)}` : ''}
                  </dd>
                </>
              )}
            </dl>
            {shown.duplicateElsewhere && <p className="rounded-[14px] bg-danger-soft px-3.5 py-3 text-sm font-bold text-danger-fg">Este mismo archivo lo envió otra cuenta. Revisa con cuidado antes de aprobar.</p>}

            {shown.status === 'PENDING' && !rejecting && (
              <fieldset className="m-0 rounded-2xl border border-line px-4 py-3.5">
                <legend className="px-1.5 text-[13px] font-bold text-ink">Antes de aprobar, comprueba</legend>
                {CHECKS[kind].map((label, i) => (
                  <label key={label} className="flex min-h-10 cursor-pointer items-center gap-2.5 text-sm text-ink">
                    <input type="checkbox" checked={checks[i]} onChange={event => setChecks(current => current.map((value, j) => (j === i ? event.target.checked : value)))} className="size-5 accent-[#C8102E]" />
                    {label}
                  </label>
                ))}
              </fieldset>
            )}

            {shown.status === 'PENDING' && rejecting && (
              <div>
                <label htmlFor="kyc-motivo" className="block text-[13px] font-bold text-ink">
                  Qué debe corregir el usuario
                </label>
                <textarea
                  id="kyc-motivo"
                  rows={3}
                  maxLength={500}
                  value={reason}
                  onChange={event => setReason(event.target.value)}
                  placeholder="Mínimo 10 caracteres. Ej.: la foto de la cédula está borrosa."
                  className="mt-1.5 w-full resize-y rounded-xl border border-edge bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-[#6A707B] focus:outline-2 focus:outline-offset-1 focus:outline-brand dark:placeholder:text-faint"
                />
              </div>
            )}

            {shown.status === 'PENDING' && (
              <div className="flex flex-wrap gap-2">
                {!rejecting ? (
                  <>
                    <button
                      type="button"
                      disabled={!checks.every(Boolean) || review.isPending}
                      onClick={() => review.mutate({ item: shown, decision: { decision: 'APPROVE' } })}
                      className="inline-flex h-12 flex-[1_1_200px] items-center justify-center gap-2 rounded-full bg-brand text-[14.5px] font-bold text-white transition-colors duration-200 disabled:cursor-not-allowed disabled:bg-[#E7E9ED] disabled:text-[#666C77] dark:disabled:bg-sunken dark:disabled:text-muted"
                    >
                      <PanelIcon d={PANEL_ICON.check} stroke={2.4} />
                      {review.isPending ? 'Guardando…' : 'Aprobar documento'}
                    </button>
                    <button type="button" onClick={() => setRejecting(true)} className="h-12 rounded-full border border-danger bg-surface px-5 text-[14.5px] font-bold text-danger-fg">
                      Rechazar
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={reason.trim().length < 10 || review.isPending}
                      onClick={() => review.mutate({ item: shown, decision: { decision: 'REJECT', reason: reason.trim() } })}
                      className="h-12 flex-[1_1_200px] rounded-full bg-danger text-[14.5px] font-bold text-white transition-colors duration-200 disabled:cursor-not-allowed disabled:bg-[#E7E9ED] disabled:text-[#666C77] dark:disabled:bg-sunken dark:disabled:text-muted"
                    >
                      {review.isPending ? 'Enviando…' : 'Enviar rechazo al usuario'}
                    </button>
                    <button type="button" onClick={() => setRejecting(false)} className="h-12 rounded-full border border-[#D8DBE0] bg-surface px-5 text-[14.5px] font-bold text-ink dark:border-line">
                      Cancelar
                    </button>
                  </>
                )}
              </div>
            )}

            {shown.status !== 'PENDING' && (
              <p className={cn('rounded-[14px] px-3.5 py-3 text-sm font-bold', STATUS[shown.status][1])}>
                {shown.status === 'APPROVED'
                  ? (decided[shown.id]?.userVerified ?? shown.user.isVerified)
                    ? 'Aprobado. El usuario ya puede publicar y reservar.'
                    : 'Aprobado. Podrá publicar y reservar cuando tenga todos sus documentos aprobados.'
                  : `Rechazado. Le enviamos tu motivo.${shown.rejectionReason ? ` «${shown.rejectionReason}»` : ''}`}
              </p>
            )}
          </section>
        )}
      </div>
      {panelToast.node}
    </div>
  );
}

/** Documento y selfie de la misma persona (o el documento solo si es un RIF). */
function Previews({ item }: { item: KycQueueItem }) {
  const isSelfie = item.type === 'SELFIE';
  const document = isSelfie ? (item.companion ? { type: item.companion.type, mimeType: item.companion.mimeType, fileUrl: item.companion.fileUrl, status: item.companion.status } : null) : { type: item.type, mimeType: item.mimeType, fileUrl: item.fileUrl, status: item.status };
  const selfie = isSelfie ? { type: item.type, mimeType: item.mimeType, fileUrl: item.fileUrl, status: item.status } : item.companion;
  const business = item.type === 'BUSINESS_REGISTRATION' || item.type === 'PROOF_OF_ADDRESS';
  return (
    <div className="flex flex-wrap gap-3">
      <Preview flex="flex-[3_1_260px]" aria="Vista previa del documento enviado" caption={document ? TYPE_LABEL[document.type].replace(' con la cédula', '') : 'Documento'} file={document} other={isSelfie} empty="Todavía no envió su documento." />
      {!business && <Preview flex="flex-[2_1_180px]" aria="Vista previa de la selfie con el documento" caption="Selfie con el documento" file={selfie} other={!isSelfie} empty="Todavía no envió la selfie." />}
    </div>
  );
}

function Preview({ flex, aria, caption, file, other, empty }: { flex: string; aria: string; caption: string; file: { mimeType: string; fileUrl: string; status: KycDocumentStatus } | null; other: boolean; empty: string }) {
  return (
    <figure className={cn('m-0 min-w-0', flex)}>
      <div aria-label={aria} role="img" className="grid aspect-[16/10] place-items-center overflow-hidden rounded-2xl bg-tile">
        {!file ? (
          <span className="px-4 text-center text-sm text-muted">{empty}</span>
        ) : file.mimeType.startsWith('image/') ? (
          // <img> nativo: URL prefirmada de 5 minutos, no debe pasar por el optimizador ni cachearse.
          <img src={file.fileUrl} alt="" className="h-full w-full object-contain" />
        ) : (
          <span className="flex flex-col items-center gap-2 text-sm text-muted">
            <PanelIcon d={PANEL_ICON.doc} size={28} stroke={1.6} />
            Documento en PDF
          </span>
        )}
      </div>
      <figcaption className="mt-2 flex justify-between gap-2 text-[13px] text-muted">
        <span>
          {caption}
          {file && other ? ` · ${STATUS[file.status][0].toLowerCase()}` : ''}
        </span>
        {file && (
          <a href={file.fileUrl} target="_blank" rel="noreferrer" className="shrink-0 font-bold whitespace-nowrap text-brand-fg">
            Abrir en grande
          </a>
        )}
      </figcaption>
    </figure>
  );
}
