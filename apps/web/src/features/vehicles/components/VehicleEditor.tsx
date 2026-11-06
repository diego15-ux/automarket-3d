'use client';

import {
  COUNTRIES,
  VEHICLE_STATUS_LABELS,
  VehicleDraftSchema,
  VehicleUpdateSchema,
  type CatalogBrandDTO,
  type VehicleDetailDTO,
  type VehicleDraftInput,
  type VehicleInsightsDTO,
  type VehicleInsightsQuery,
} from '@automarket/contracts';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, CircleAlert, Gauge, Info, Loader2, MapPin, Megaphone, PenLine, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getCurrentLocation } from '@/shared/lib/geolocation';
import { ApiError } from '@/shared/lib/http';
import { useSession } from '@/shared/lib/use-session';
import { PageSpinner } from '@/shared/ui/spinner';
import { ThemeToggle } from '@/shared/ui/theme-toggle';
import { useToast } from '@/shared/ui/toaster';
import { vehicleKeys, vehiclesApi, type MyListings } from '../api';
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  COLOR_SWATCHES,
  DRIVETRAIN_LABELS,
  DRIVETRAIN_ORDER,
  FUEL_LABELS,
  FUEL_ORDER,
  OWNER_OPTIONS,
  PUBLISH_STEPS,
  RESERVE_PRESETS,
  TRANSMISSION_LABELS,
  TRANSMISSION_ORDER,
  badFields,
  completion,
  digits,
  emptyForm,
  errorOf,
  formFromVehicle,
  kilometers,
  money,
  toNumber,
  toPayload,
  writeDescription,
  type Coordinates,
  type FormField,
  type PublishForm,
  type PublishStep,
} from '../publish-form';
import { PlanLimitNotice } from './PlanLimitNotice';
import { PublishPhotos, usePublishMedia } from './PublishPhotos';
import { PublishPreviewCard, PublishProgressCard, type PriceVerdict } from './PublishPreview';
import { copyText } from '@/shared/lib/browser';

type Usage = MyListings['usage'];
const LOCKED = ['RESERVED', 'PENDING_SALE', 'SOLD', 'ARCHIVED'];
const PUBLISHABLE = ['DRAFT', 'PAUSED', 'EXPIRED'];
const MAX_CHIPS = 12;
const localKey = (userId: string) => `automarket.publicar.borrador.v1.${userId}`;

function loadLocalDraft(userId: string): PublishForm | null {
  try {
    const raw = window.localStorage.getItem(localKey(userId));
    if (!raw) return null;
    const saved = JSON.parse(raw) as { form?: Partial<PublishForm> };
    return saved.form ? { ...emptyForm(), ...saved.form } : null;
  } catch {
    return null;
  }
}

function clearLocalDraft(userId: string) {
  try {
    window.localStorage.removeItem(localKey(userId));
  } catch {
    /* sin almacenamiento local: no hay nada que borrar */
  }
}

/** «Publicar con $X» del Copiloto: marca, modelo, año, km y precio llegan en la dirección. */
function fromCopilot(form: PublishForm): PublishForm {
  const params = new URLSearchParams(window.location.search);
  const word = (key: string, max: number) => (params.get(key) ?? '').trim().slice(0, max);
  const digits = (key: string) => (/^\d{1,9}$/.test(params.get(key) ?? '') ? params.get(key)! : '');
  return { ...form, make: word('marca', 60) || form.make, model: word('modelo', 80) || form.model, year: digits('anio') || form.year, km: digits('km') || form.km, price: digits('precio') || form.price };
}

/**
 * Publicar o editar un anuncio en 5 pasos (diseño «Publicar un auto»): el auto, fotos, precio,
 * ubicación y publicar. Todo sale de la API real: catálogo de marcas del administrador, plan
 * del vendedor, verificación de identidad y el Copiloto con anuncios reales.
 */
export function VehicleEditor({ vehicleId }: { vehicleId?: string }) {
  const session = useSession();
  const vehicle = useQuery({ queryKey: vehicleKeys.edit(vehicleId ?? 'new'), queryFn: () => vehiclesApi.forEdit(vehicleId!), enabled: Boolean(vehicleId) });
  const mine = useQuery({ queryKey: vehicleKeys.mine, queryFn: vehiclesApi.mine });
  const brands = useQuery({ queryKey: vehicleKeys.brands, queryFn: vehiclesApi.brands, staleTime: 5 * 60_000 });

  if (session.status !== 'authenticated' || (vehicleId && vehicle.isPending) || mine.isPending || brands.isPending) return <PageSpinner />;
  if (vehicleId && vehicle.isError) return <p className="text-danger-fg">{vehicle.error.message}</p>;
  const user = session.user;
  const initial = vehicle.data ? formFromVehicle(vehicle.data) : (loadLocalDraft(user.id) ?? fromCopilot(emptyForm(user.country ?? '', user.city ?? '')));
  return (
    <PublishWizard
      key={vehicleId ?? 'new'}
      initialId={vehicleId ?? null}
      initialForm={initial}
      initialVehicle={vehicle.data ?? null}
      userId={user.id}
      verified={user.isVerified}
      usage={mine.data?.usage ?? null}
      catalog={brands.data ?? []}
    />
  );
}

interface WizardProps {
  initialId: string | null;
  initialForm: PublishForm;
  initialVehicle: VehicleDetailDTO | null;
  userId: string;
  verified: boolean;
  usage: Usage | null;
  catalog: CatalogBrandDTO[];
}

type SaveState = 'idle' | 'saving' | 'saved' | 'local' | 'error';
type SyncResult = { ok: true } | { ok: false };

/** Campos que la API valida juntos: si cambia uno, se mandan todos. */
const LINKED: Array<Array<keyof VehicleDraftInput>> = [
  ['condition', 'ownersCount', 'mileageKm'],
  ['price', 'reservationAmount'],
  ['latitude', 'longitude'],
];
const FIELD_OF: Partial<Record<keyof VehicleDraftInput, FormField>> = {
  ownersCount: 'owners', mileageKm: 'km', reservationAmount: 'reserve', exteriorColor: 'color', latitude: 'city', longitude: 'city',
};

function PublishWizard({ initialId, initialForm, initialVehicle, userId, verified, usage, catalog }: WizardProps) {
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  // El cupo se mira al abrir: crear este borrador no debe sacar al vendedor del asistente.
  const [limited, setLimited] = useState(() => !initialId && !!usage && usage.max !== null && usage.slotsUsed >= usage.max);
  const [savedId, setSavedId] = useState(initialId);
  const vehicle = useQuery({
    queryKey: vehicleKeys.edit(savedId ?? 'new'),
    queryFn: () => vehiclesApi.forEdit(savedId!),
    enabled: Boolean(savedId),
    initialData: initialVehicle ?? undefined,
  });
  const current = savedId ? (vehicle.data ?? null) : null;
  const media = current?.media ?? [];
  const gallery = usePublishMedia(savedId, media);

  const [form, setForm] = useState(initialForm);
  const [touched, setTouched] = useState<Set<FormField | 'photos'>>(() => new Set());
  const [step, setStep] = useState<PublishStep>(1);
  const [maxStep, setMaxStep] = useState<PublishStep>(initialId ? 5 : 1);
  const [more, setMore] = useState(false);
  const [autofill, setAutofill] = useState('');
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [gps, setGps] = useState<'off' | 'loading' | 'on'>('off');
  const [gpsError, setGpsError] = useState('');
  const [serverErrors, setServerErrors] = useState<Partial<Record<FormField, string>>>({});
  const [save, setSave] = useState<SaveState>('idle');
  const [moving, setMoving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<{ slug: string; expiresAt: string | null } | null>(null);
  const [shared, setShared] = useState(false);
  const [undoDesc, setUndoDesc] = useState<string | null>(null);

  const status = current?.status ?? null;
  const locked = status !== null && LOCKED.includes(status);
  const isDraft = !status || status === 'DRAFT';
  const canPublish = !status || PUBLISHABLE.includes(status);
  const savedNewKm = current?.condition === 'NEW' ? current.mileageKm : 0;
  const savedPayload = useRef<VehicleDraftInput | null>(initialVehicle ? toPayload(formFromVehicle(initialVehicle), { savedNewKm: initialVehicle.condition === 'NEW' ? initialVehicle.mileageKm : 0 }) : null);
  const syncQueue = useRef<Promise<SyncResult>>(Promise.resolve({ ok: true }));
  const firstForm = useRef(form);
  const scrollBox = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);

  // ── Guardado ─────────────────────────────────────────────────────────────

  const applyServerError = (err: unknown) => {
    if (err instanceof ApiError && err.code === 'BLOCKED_TERMS') {
      const fields = (err.details?.fields as string[] | undefined) ?? [];
      setServerErrors(Object.fromEntries(fields.map(field => [FIELD_OF[field as keyof VehicleDraftInput] ?? field, err.message])));
    }
    if (err instanceof ApiError && err.code === 'PLAN_LIMIT_REACHED') setLimited(true);
  };

  /** Manda a la API solo lo que cambió y es válido. `strict`: si algo no es válido, no guarda. */
  function syncToServer(next: PublishForm, strict: boolean): Promise<SyncResult> {
    const id = savedId;
    if (!id || locked) return Promise.resolve({ ok: true });
    const run = async (): Promise<SyncResult> => {
      const payload = toPayload(next, { savedNewKm, location });
      const previous = savedPayload.current ?? ({} as Partial<VehicleDraftInput>);
      const keys = new Set<keyof VehicleDraftInput>();
      for (const key of Object.keys(payload) as Array<keyof VehicleDraftInput>) {
        if (payload[key] !== undefined && JSON.stringify(payload[key]) !== JSON.stringify(previous[key])) keys.add(key);
      }
      for (const group of LINKED) if (group.some(key => keys.has(key))) group.forEach(key => payload[key] !== undefined && keys.add(key));
      // Una descripción con teléfonos, correos o enlaces no se guarda (los compradores escriben por el chat).
      if (keys.has('description') && errorOf(next, 'description')) {
        if (strict) return { ok: false };
        keys.delete('description');
      }
      let partial = Object.fromEntries([...keys].map(key => [key, payload[key]])) as Partial<VehicleDraftInput>;
      let parsed = VehicleUpdateSchema.safeParse(partial);
      if (!parsed.success) {
        if (strict) return { ok: false };
        const bad = new Set(parsed.error.issues.map(issue => issue.path[0] as keyof VehicleDraftInput));
        for (const group of LINKED) if (group.some(key => bad.has(key))) group.forEach(key => bad.add(key));
        partial = Object.fromEntries(Object.entries(partial).filter(([key]) => !bad.has(key as keyof VehicleDraftInput))) as Partial<VehicleDraftInput>;
        parsed = VehicleUpdateSchema.safeParse(partial);
        if (!parsed.success) return { ok: false };
      }
      if (!Object.keys(parsed.data).length) return { ok: true };
      setSave('saving');
      try {
        await vehiclesApi.update(id, parsed.data);
        savedPayload.current = { ...(savedPayload.current ?? payload), ...parsed.data };
        setSave('saved');
        return { ok: true };
      } catch (err) {
        setSave('error');
        applyServerError(err);
        if (strict) toast({ tone: 'error', title: 'No se pudo guardar', description: err instanceof Error ? err.message : undefined });
        return { ok: false };
      }
    };
    syncQueue.current = syncQueue.current.then(run, run);
    return syncQueue.current;
  }

  // Antes del borrador: se guarda en este equipo mientras escribes.
  useEffect(() => {
    if (savedId || form === firstForm.current) return;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(localKey(userId), JSON.stringify({ form, at: Date.now() }));
        setSave('local');
      } catch {
        setSave('idle');
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [form, savedId, userId]);

  // Con borrador en la API: se guarda solo un momento después de dejar de escribir.
  useEffect(() => {
    if (!savedId || !isDraft || locked || form === firstForm.current) return;
    const timer = window.setTimeout(() => void syncToServer(form, false), 1200);
    return () => window.clearTimeout(timer);
    // syncToServer lee el último estado; solo hace falta reaccionar al formulario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, savedId, isDraft, locked]);

  const update = (patch: Partial<PublishForm>) => {
    setForm(previous => ({ ...previous, ...patch }));
    setServerErrors(previous => {
      const next = { ...previous };
      for (const key of Object.keys(patch) as FormField[]) delete next[key];
      return next;
    });
    if (!locked && (!savedId || isDraft)) setSave('saving');
  };
  const touch = (...fields: Array<FormField | 'photos'>) => setTouched(previous => new Set([...previous, ...fields]));
  const err = (field: FormField) => serverErrors[field] || (touched.has(field) || field === 'description' ? errorOf(form, field) : '');

  async function createDraft(): Promise<string | null> {
    const parsed = VehicleDraftSchema.safeParse(toPayload(form, { location }));
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      toast({ tone: 'error', title: 'Revisa los datos marcados', description: first?.message });
      touch(...(parsed.error.issues.map(issue => FIELD_OF[issue.path[0] as keyof VehicleDraftInput] ?? (issue.path[0] as FormField))));
      return null;
    }
    setSave('saving');
    try {
      const created = await vehiclesApi.create(parsed.data);
      savedPayload.current = parsed.data;
      clearLocalDraft(userId);
      setSavedId(created.id);
      setSave('saved');
      void queryClient.invalidateQueries({ queryKey: vehicleKeys.mine });
      // La dirección pasa a la del anuncio: si recargas, sigues editando este borrador.
      window.history.replaceState(null, '', `/cuenta/anuncios/${created.id}`);
      void gallery.flush(created.id);
      return created.id;
    } catch (error) {
      setSave('error');
      applyServerError(error);
      toast({ tone: 'error', title: 'No se pudo guardar el borrador', description: error instanceof Error ? error.message : undefined });
      return null;
    }
  }

  // ── Navegación ───────────────────────────────────────────────────────────

  const scrollUp = () => {
    scrollBox.current?.scrollTo({ top: 0 });
    const box = top.current?.getBoundingClientRect();
    if (box && box.top < 0) top.current?.scrollIntoView({ block: 'start' });
  };
  const go = (n: PublishStep) => {
    if (n > maxStep || done) return;
    setStep(n);
    scrollUp();
  };
  const stepBad = (n: PublishStep): Array<FormField | 'photos'> => (n === 2 ? (gallery.images > 0 ? [] : ['photos']) : badFields(form, n));

  async function next() {
    const bad = stepBad(step);
    if (bad.length) {
      touch(...bad);
      return;
    }
    setMoving(true);
    try {
      const locationOk = !errorOf(form, 'country') && !errorOf(form, 'city');
      if (!savedId && (step === 4 || (step === 3 && locationOk))) {
        if (!(await createDraft())) return;
      } else if (savedId && !locked) {
        const result = await syncToServer(form, true);
        if (!result.ok) return;
        void queryClient.invalidateQueries({ queryKey: vehicleKeys.edit(savedId) });
      }
      const n = Math.min(5, step + 1) as PublishStep;
      setStep(n);
      setMaxStep(previous => (n > previous ? n : previous));
      scrollUp();
    } finally {
      setMoving(false);
    }
  }

  async function publish() {
    if (!savedId || publishing) return;
    if (!ready && canPublish) {
      touch('photos', 'reserve');
      return;
    }
    setPublishing(true);
    setPublishError(null);
    try {
      const result = await syncToServer(form, true);
      if (!result.ok) return;
      if (canPublish) {
        const published = await vehiclesApi.publish(savedId);
        clearLocalDraft(userId);
        setDone({ slug: published.slug, expiresAt: published.expiresAt });
        scrollUp();
      } else {
        toast({ tone: 'success', title: 'Cambios guardados' });
      }
      void queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
    } catch (error) {
      if (error instanceof ApiError) setPublishError(error);
      else toast({ tone: 'error', title: 'No se pudo publicar', description: error instanceof Error ? error.message : undefined });
    } finally {
      setPublishing(false);
    }
  }

  // ── Copiloto: ficha típica y valor de mercado con anuncios reales ─────────

  const catalogBrand = (name: string) => catalog.find(brand => brand.name.toLocaleLowerCase('es') === name.trim().toLocaleLowerCase('es'));

  async function applyTypical(make: string, model: string) {
    if (make.trim().length < 2 || !model.trim()) return;
    try {
      const query: VehicleInsightsQuery = { make: make.trim(), model: model.trim() };
      const data = await queryClient.fetchQuery({ queryKey: vehicleKeys.insights(query), queryFn: () => vehiclesApi.insights(query), staleTime: 60_000 });
      const typical = data.typical;
      if (!typical) return setAutofill('');
      const patch: Partial<PublishForm> = {};
      const filled: string[] = [];
      if (!form.category && typical.category) (patch.category = typical.category), filled.push('tipo');
      if (!form.fuelType && typical.fuelType) (patch.fuelType = typical.fuelType), filled.push('combustible');
      if (!form.drivetrain && typical.drivetrain) (patch.drivetrain = typical.drivetrain), filled.push('tracción');
      if (!form.doors && typical.doors) (patch.doors = String(typical.doors)), filled.push('puertas');
      if (!form.seats && typical.seats) (patch.seats = String(typical.seats)), filled.push('plazas');
      if (!filled.length) return setAutofill('');
      update(patch);
      const list = filled.length > 1 ? `${filled.slice(0, -1).join(', ')} y ${filled.at(-1)}` : filled[0];
      setAutofill(`Llenamos lo típico de un ${model.trim()} según ${typical.sample} ${typical.sample === 1 ? 'anuncio' : 'anuncios'} en AutoMarket: ${list}. Cámbialo si el tuyo es distinto.`);
    } catch {
      /* Sin ayuda del Copiloto: el vendedor llena la ficha a mano. */
    }
  }

  const marketQuery: VehicleInsightsQuery = {
    make: form.make.trim(),
    model: form.model.trim(),
    year: toNumber(form.year) || undefined,
    mileageKm: form.condition === 'NEW' ? 0 : form.km ? toNumber(form.km) : undefined,
    transmission: form.transmission || undefined,
    excludeId: savedId ?? undefined,
  };
  const marketReady = !errorOf(form, 'make') && !errorOf(form, 'model') && !errorOf(form, 'year');
  const insights = useQuery({
    queryKey: vehicleKeys.insights(marketQuery),
    queryFn: () => vehiclesApi.insights(marketQuery),
    enabled: marketReady && step >= 3,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const price = toNumber(form.price);
  const gauge = buildGauge(marketReady ? (insights.data ?? null) : null, price);

  // ── Datos derivados ──────────────────────────────────────────────────────

  const commissionRate = usage?.commissionRate ?? null;
  const commissionText = commissionRate === null ? null : `${(commissionRate * 100).toLocaleString('es', { maximumFractionDigits: 2 })} %`;
  const serverImages = media.filter(item => item.kind === 'IMAGE').length;
  const uploading = gallery.uploads.length > 0;
  const checklist = [
    { text: 'Identidad verificada (cédula, selfie y teléfono)', ok: verified, fix: 'Verificar identidad', href: '/cuenta/verificacion' },
    { text: 'Al menos una foto real del auto', ok: serverImages > 0, fix: uploading ? '' : 'Agregar fotos', to: 2 as PublishStep },
    { text: 'Abono de reserva fijado', ok: toNumber(form.reserve) > 0, fix: 'Fijar abono', to: 3 as PublishStep },
  ];
  const ready = checklist.every(item => item.ok) && !errorOf(form, 'description') && !uploading;
  const pct = completion(form, gallery.images);
  const verdict: PriceVerdict | null = gauge?.zone && gauge.zone !== 'none' ? { label: gauge.verdict, tone: gauge.zone === 'high' ? 'warn' : 'ok' } : null;
  const title = form.make && form.model ? `${form.make} ${form.model}` : 'auto';
  const stepBadNow = stepBad(step).filter(field => touched.has(field)).length;
  const photoError = touched.has('photos') && gallery.images === 0 ? 'Agrega al menos una foto para seguir' : '';

  const saveLabel = done
    ? 'Publicado'
    : save === 'saving'
      ? 'Guardando…'
      : save === 'error'
        ? 'No se pudo guardar'
        : save === 'local'
          ? 'Borrador guardado en este equipo'
          : save === 'saved'
            ? isDraft ? 'Borrador guardado' : 'Cambios guardados'
            : !status
              ? 'Se guarda solo mientras escribes'
              : isDraft ? 'Borrador guardado' : 'Se guarda al continuar';
  const saveDot = save === 'saving' ? 'bg-gold' : save === 'error' ? 'bg-danger' : save === 'saved' || save === 'local' || status === 'DRAFT' ? 'bg-brand' : 'bg-field-line';
  const nextLabel = ['Continuar a fotos', 'Continuar a precio', 'Continuar a ubicación', 'Revisar anuncio'][step - 1] ?? '';
  // El encabezado no cambia al publicar: «Edita tu anuncio» solo si se abrió uno ya publicado.
  const [editing] = useState(() => Boolean(initialVehicle && initialVehicle.status !== 'DRAFT'));
  const stepLabel = PUBLISH_STEPS[step - 1]?.label ?? '';

  if (limited && !savedId) return <PlanLimitNotice planCode={usage?.planCode ?? 'FREE'} max={usage?.max ?? 1} />;

  const footer = !done && (
    <>
      <div aria-live="polite">{stepBadNow > 0 && <p className="mb-2.5 text-[13px] font-bold text-danger-fg">{stepBadNow === 1 ? 'Falta 1 dato en este paso' : `Faltan ${stepBadNow} datos en este paso`}</p>}</div>
      <div className="flex gap-2.5">
        {step > 1 && (
          <button type="button" onClick={() => go((step - 1) as PublishStep)} className={`${outlineButton} min-h-[52px]`}>
            <ChevronLeft className="size-4" strokeWidth={2.4} aria-hidden />
            Atrás
          </button>
        )}
        {step < 5 && (
          <button type="button" onClick={() => void next()} disabled={moving} aria-busy={moving} className={`${primaryButton} flex-1`}>
            {moving && <Loader2 className="size-[18px] animate-spin" aria-hidden />}
            {moving ? 'Guardando…' : nextLabel}
          </button>
        )}
      </div>
    </>
  );

  const preview = <PublishPreviewCard form={form} coverUrl={gallery.coverUrl} photos={gallery.images} verified={verified} verdict={verdict} />;

  return (
    <div data-vehicle-editor ref={top} className="max-sm:fixed max-sm:inset-0 max-sm:z-40 max-sm:flex max-sm:flex-col max-sm:bg-surface">
      {/* Teléfono: barra propia con cerrar, título, tema y avance por pasos. */}
      <div className="shrink-0 border-b border-line px-4 pt-3.5 pb-3 sm:hidden">
        <div className="flex items-center justify-between gap-2">
          <Link href="/cuenta/anuncios" aria-label={savedId ? 'Cerrar (el borrador queda guardado)' : 'Cerrar y guardar borrador'} className="grid size-11 place-items-center rounded-full text-ink">
            <X className="size-[18px]" strokeWidth={2.6} aria-hidden />
          </Link>
          <p className="text-base font-bold">{editing ? 'Editar anuncio' : 'Publicar auto'}</p>
          <ThemeToggle />
        </div>
        {!done && (
          <div className="mt-2">
            <ol aria-label={`Paso ${step} de 5`} className="grid grid-cols-5 gap-[5px]">
              {PUBLISH_STEPS.map((item, index) => (
                <li key={item.label} aria-current={index + 1 === step ? 'step' : undefined} className={`h-1 rounded-full transition-colors duration-300 ${index + 1 <= step ? 'bg-brand' : 'bg-line'}`} />
              ))}
            </ol>
            <div className="mt-2.5 flex items-baseline justify-between">
              <p className="text-[22px] font-bold tracking-[-0.03em]">{stepLabel}</p>
              <p className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-muted" title={saveLabel}>
                <span aria-hidden className={`size-[7px] rounded-full ${saveDot}`} />
                Paso {step} de 5<span className="sr-only"> · {saveLabel}</span>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* PC: ruta, título y estado del guardado. */}
      <div className="flex flex-wrap items-end justify-between gap-3 max-sm:hidden">
        <div>
          <nav aria-label="Ruta" className="text-[13.5px] text-muted">
            <Link href="/cuenta/anuncios" className="hover:text-ink hover:underline">
              Mis anuncios
            </Link>{' '}
            / {editing ? 'Editar anuncio' : 'Nuevo anuncio'}
          </nav>
          <h1 className="mt-1.5 text-4xl font-extrabold tracking-[-0.03em]">{editing ? 'Edita tu anuncio' : 'Publica tu auto'}</h1>
          <p className="mt-1 text-[15px] text-muted">
            {editing && status ? (
              <>
                Estado: {VEHICLE_STATUS_LABELS[status]}.{' '}
                {current && (
                  <Link href={`/vehiculos/${current.slug}`} className="font-semibold text-brand-fg hover:underline">
                    Ver ficha pública
                  </Link>
                )}
              </>
            ) : commissionRate === 0 ? (
              'Gratis y sin comisión cuando vendes. Toma unos 5 minutos.'
            ) : (
              'Publicar es gratis. Toma unos 5 minutos.'
            )}
          </p>
        </div>
        <p aria-live="polite" className="inline-flex items-center gap-2 text-[13.5px] text-muted">
          <span aria-hidden className={`size-2 rounded-full transition-colors duration-200 ${saveDot}`} />
          {saveLabel}
        </p>
      </div>

      <div ref={scrollBox} className="max-sm:min-h-0 max-sm:flex-1 max-sm:overflow-y-auto max-sm:overscroll-contain max-sm:px-[18px] max-sm:pt-5 max-sm:pb-7 sm:mt-6 sm:flex sm:items-start sm:gap-7">
        <nav aria-label="Pasos" className="sticky top-[104px] hidden shrink-0 basis-[220px] min-[760px]:block">
          <ol className="grid gap-1">
            {PUBLISH_STEPS.map((item, index) => {
              const n = (index + 1) as PublishStep;
              const state = done || n < step ? 'done' : n === step ? 'now' : 'next';
              const disabled = n > maxStep || Boolean(done);
              return (
                <li key={item.label} aria-current={n === step && !done ? 'step' : undefined}>
                  <button type="button" disabled={disabled} onClick={() => go(n)} className="flex w-full items-center gap-3 rounded-[14px] p-2.5 text-left enabled:hover:bg-sunken disabled:cursor-default">
                    <span
                      className={`grid size-[34px] shrink-0 place-items-center rounded-full border-[1.5px] font-mono text-[13px] font-semibold transition-colors duration-200 ${
                        state === 'done' ? 'border-transparent bg-brand text-on-brand' : state === 'now' ? 'border-transparent bg-ink text-surface' : 'border-field-line text-muted'
                      }`}
                    >
                      {state === 'done' ? '✓' : n}
                    </span>
                    <span>
                      <span className={`block text-[15px] font-bold ${state === 'next' ? 'text-muted' : 'text-ink'}`}>{item.label}</span>
                      <span className="block text-[12.5px] text-muted">{item.hint}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <section aria-label={done ? 'Anuncio publicado' : stepLabel} className="min-w-0 flex-[1_1_560px] sm:rounded-[26px] sm:border sm:border-line sm:bg-surface sm:p-[clamp(20px,2.4vw,32px)]">
          {!done && (
            <div className="max-sm:hidden">
              <p className="font-mono text-xs font-semibold tracking-[0.06em] text-muted uppercase">Paso {step} de 5</p>
              <h2 className="mt-1 mb-[22px] text-[26px] font-extrabold tracking-[-0.02em]">{stepLabel}</h2>
            </div>
          )}
          {locked && status && !done && (
            <p className="mb-5 rounded-[14px] bg-tile p-3.5 text-sm">
              Este anuncio está <strong>{VEHICLE_STATUS_LABELS[status].toLowerCase()}</strong>: un auto reservado, vendido o retirado no se puede editar.
            </p>
          )}

          <fieldset disabled={locked} className="min-w-0">
            {!done && step === 1 && (
              <div key="s1" className="am-step-in grid gap-[22px]">
                {catalog.length > 0 ? (
                  <BrandPicker catalog={catalog} value={form.make} error={err('make')} onPick={make => {
                    if (make !== form.make) update({ make, model: '' });
                    setAutofill('');
                  }} />
                ) : (
                  <TextField id="pb-make" label="Marca" value={form.make} placeholder="Toyota" error={err('make')} onChange={value => update({ make: value })} onBlur={() => form.make && touch('make')} />
                )}

                <ModelSuggestions
                  models={catalogBrand(form.make)?.models ?? []}
                  value={form.model}
                  onPick={model => {
                    update({ model });
                    void applyTypical(form.make, model);
                  }}
                />
                {autofill && (
                  <p className="am-step-in -mt-2 flex gap-2.5 rounded-[14px] bg-tile px-3.5 py-3 text-[13.5px] leading-[1.45]">
                    <Info className="mt-0.5 size-4 shrink-0 text-muted" strokeWidth={2} aria-hidden />
                    <span>{autofill}</span>
                  </p>
                )}

                <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] items-start gap-3.5">
                  <TextField
                    id="pb-model"
                    label="Modelo"
                    value={form.model}
                    placeholder="Corolla"
                    error={err('model')}
                    list={catalogBrand(form.make)?.models.length ? 'pb-model-list' : undefined}
                    onChange={value => update({ model: value })}
                    onBlur={() => {
                      if (!form.model) return;
                      touch('model');
                      void applyTypical(form.make, form.model);
                    }}
                  />
                  <TextField id="pb-version" label="Versión (opcional)" value={form.version} placeholder="XEi, SRV, LX…" onChange={value => update({ version: value })} />
                  <TextField id="pb-year" label="Año" value={form.year} placeholder={String(new Date().getFullYear() - 4)} inputMode="numeric" maxLength={4} error={err('year')} onChange={value => update({ year: digits(value) })} onBlur={() => form.year && touch('year')} />
                </div>
                {(catalogBrand(form.make)?.models.length ?? 0) > 0 && (
                  <datalist id="pb-model-list">
                    {catalogBrand(form.make)!.models.map(model => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                )}

                <div className="grid gap-2">
                  <p className="text-sm font-semibold">Condición</p>
                  <div role="group" aria-label="Condición" className="relative grid max-w-[320px] grid-cols-2 rounded-full bg-sunken p-1">
                    <span aria-hidden className={`absolute top-1 left-1 h-[calc(100%-8px)] w-[calc(50%-4px)] rounded-full bg-surface shadow-tab transition-transform duration-300 ease-[cubic-bezier(.2,.9,.25,1)] motion-reduce:transition-none dark:bg-[#2a2e34] dark:shadow-none ${form.condition === 'NEW' ? 'translate-x-full' : ''}`} />
                    {(['USED', 'NEW'] as const).map(value => (
                      <button key={value} type="button" aria-pressed={form.condition === value} onClick={() => update({ condition: value })} className={`relative h-11 rounded-full text-[15px] font-bold ${form.condition === value ? 'text-ink' : 'text-muted'}`}>
                        {value === 'USED' ? 'Usado' : 'Nuevo'}
                      </button>
                    ))}
                  </div>
                </div>
                {form.condition === 'USED' && (
                  <div className="am-step-in grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] items-start gap-3.5">
                    <TextField id="pb-km" label="Kilometraje" value={form.km} placeholder="48200" inputMode="numeric" suffix="km" error={err('km')} hint="El que marca el tablero hoy." onChange={value => update({ km: digits(value) })} onBlur={() => form.km && touch('km')} />
                    <Chips label="Dueños anteriores" options={OWNER_OPTIONS.map(([value, label]) => ({ value, label }))} value={form.owners} onPick={value => update({ owners: value as PublishForm['owners'] })} />
                  </div>
                )}

                <Chips label="Tipo de auto" options={CATEGORY_ORDER.map(value => ({ value, label: CATEGORY_LABELS[value] }))} value={form.category} error={err('category')} onPick={value => update({ category: value as PublishForm['category'] })} />
                <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] items-start gap-[18px]">
                  <Chips label="Combustible" options={FUEL_ORDER.map(value => ({ value, label: FUEL_LABELS[value] }))} value={form.fuelType} error={err('fuelType')} onPick={value => update({ fuelType: value as PublishForm['fuelType'] })} />
                  <Chips label="Caja" options={TRANSMISSION_ORDER.map(value => ({ value, label: TRANSMISSION_LABELS[value] }))} value={form.transmission} error={err('transmission')} onPick={value => update({ transmission: value as PublishForm['transmission'] })} />
                </div>

                <div className="border-t border-line pt-1.5">
                  <button type="button" aria-expanded={more} onClick={() => setMore(open => !open)} className="inline-flex min-h-11 items-center gap-2 text-left text-[14.5px] font-bold text-brand-fg">
                    {more ? 'Ocultar detalles opcionales' : 'Más detalles (opcional): tracción, potencia, color, puertas'}
                  </button>
                  {more && (
                    <div className="am-step-in grid gap-[18px] pt-2.5">
                      <Chips label="Tracción" options={DRIVETRAIN_ORDER.map(value => ({ value, label: DRIVETRAIN_LABELS[value] }))} value={form.drivetrain} toggle onPick={value => update({ drivetrain: (form.drivetrain === value ? '' : value) as PublishForm['drivetrain'] })} />
                      <div className="grid gap-2">
                        <p className="text-sm font-semibold">
                          Color: <span className="font-medium text-muted">{form.color || 'sin elegir'}</span>
                        </p>
                        <div role="group" aria-label="Color" className="flex flex-wrap gap-2.5">
                          {COLOR_SWATCHES.map(([name, hex]) => (
                            <button
                              key={name}
                              type="button"
                              aria-label={`Color ${name.toLowerCase()}`}
                              aria-pressed={form.color.toLocaleLowerCase('es') === name.toLocaleLowerCase('es')}
                              onClick={() => update({ color: form.color === name ? '' : name })}
                              className={`size-11 rounded-full border-2 p-1 ${form.color.toLocaleLowerCase('es') === name.toLocaleLowerCase('es') ? 'border-ink' : 'border-transparent'}`}
                            >
                              <span className="block size-full rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.18)]" style={{ background: hex }} />
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] items-start gap-3.5">
                        <TextField id="pb-hp" label="Potencia" value={form.horsepower} placeholder="139" inputMode="numeric" suffix="hp" error={err('horsepower')} onChange={value => update({ horsepower: digits(value) })} onBlur={() => form.horsepower && touch('horsepower')} />
                        <TextField id="pb-doors" label="Puertas" value={form.doors} placeholder="4" inputMode="numeric" maxLength={1} error={err('doors')} onChange={value => update({ doors: digits(value) })} onBlur={() => form.doors && touch('doors')} />
                        <TextField id="pb-seats" label="Plazas" value={form.seats} placeholder="5" inputMode="numeric" maxLength={2} error={err('seats')} onChange={value => update({ seats: digits(value) })} onBlur={() => form.seats && touch('seats')} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {!done && step === 2 && <PublishPhotos key="s2" gallery={gallery} media={media} error={photoError} disabled={locked} />}

            {!done && step === 3 && (
              <div key="s3" className="am-step-in grid gap-[22px]">
                <div className="grid gap-1.5">
                  <label htmlFor="pb-price" className="text-sm font-semibold">
                    Precio de venta
                  </label>
                  <div className="relative">
                    <span aria-hidden className="absolute top-1/2 left-[18px] -translate-y-1/2 text-[26px] font-bold text-muted">
                      $
                    </span>
                    <input
                      id="pb-price"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="18500"
                      value={form.price}
                      onChange={event => update({ price: digits(event.target.value) })}
                      onBlur={() => form.price && touch('price')}
                      aria-invalid={Boolean(err('price'))}
                      aria-describedby="pb-price-msg"
                      className={`block h-16 w-full rounded-[16px] border bg-field pr-[70px] pl-[42px] font-mono text-[26px] font-bold text-ink placeholder:text-faint focus:outline-2 focus:outline-offset-1 focus:outline-brand ${err('price') ? 'border-danger ring-[3px] ring-danger-soft' : 'border-field-line'}`}
                    />
                    <span aria-hidden className="absolute top-1/2 right-[18px] -translate-y-1/2 font-mono text-[13px] font-semibold text-muted">
                      USD
                    </span>
                  </div>
                  <div id="pb-price-msg" aria-live="polite">
                    {err('price') ? <FieldError message={err('price')} /> : <p className="text-[13px] text-muted">Lo fijas tú. La referencia sale de autos parecidos.</p>}
                  </div>
                </div>

                {gauge?.market ? (
                  <section aria-label="Valor de mercado" className="rounded-[22px] border border-line bg-surface p-[18px]">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="flex items-center gap-1.5 font-mono text-xs font-semibold tracking-[0.06em] text-muted uppercase">
                          <Gauge className="size-4 text-brand-fg" strokeWidth={2} aria-hidden />
                          Valor de mercado
                        </p>
                        <p className="mt-1.5 text-[28px] font-extrabold tracking-[-0.02em]">{money(gauge.market.value)}</p>
                        <p className="mt-0.5 text-[13.5px] text-muted">
                          Rango normal {money(gauge.market.low)} – {money(gauge.market.high)}
                        </p>
                      </div>
                      <button type="button" onClick={() => (update({ price: String(gauge.suggested) }), touch('price'))} className={outlineButton}>
                        Usar {money(gauge.suggested)}
                      </button>
                    </div>
                    <div aria-hidden className="relative mt-[22px] mb-2 h-3 rounded-full bg-line">
                      <span className="absolute inset-y-0 rounded-full bg-success-soft shadow-[inset_0_0_0_1.5px_var(--am-success)]" style={{ left: gauge.lowPos, width: gauge.fairWidth }} />
                      {price > 0 && (
                        <span className="absolute top-1/2 size-[22px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-surface bg-ink shadow-[0_2px_8px_rgb(0_0_0/0.3)] transition-[left] duration-500 ease-[cubic-bezier(.2,.9,.25,1)] motion-reduce:transition-none" style={{ left: gauge.pos }} />
                      )}
                    </div>
                    <div aria-hidden className="flex justify-between text-xs text-muted">
                      <span>Oferta</span>
                      <span>Justo</span>
                      <span>Alto</span>
                    </div>
                    <div aria-live="polite" className="mt-3.5">
                      <p className={`text-base font-extrabold ${gauge.zone === 'high' ? 'text-gold-fg' : gauge.zone === 'none' ? 'text-muted' : 'text-success-fg'}`}>{gauge.verdict}</p>
                      <p className="mt-1 text-sm leading-normal">{gauge.detail}</p>
                      <p className="mt-2 text-[12.5px] text-muted">
                        Comparado con {gauge.market.sample} autos parecidos publicados o vendidos en AutoMarket.
                      </p>
                    </div>
                  </section>
                ) : marketReady && insights.data ? (
                  <p className="rounded-[14px] bg-tile p-3.5 text-sm leading-[1.45]">
                    {insights.data.comparables === 0
                      ? `Todavía no hay ${form.make} ${form.model} parecidos para estimar el precio.`
                      : `Todavía hay solo ${insights.data.comparables} ${form.make} ${form.model} ${insights.data.comparables === 1 ? 'parecido' : 'parecidos'}: hacen falta al menos 2 para estimar el precio.`}{' '}
                    <Link href={`/vehiculos?${new URLSearchParams({ make: form.make, model: form.model })}`} className="font-semibold text-brand-fg underline underline-offset-2">
                      Mira autos similares en el catálogo
                    </Link>
                    .
                  </p>
                ) : marketReady && insights.isPending ? (
                  <p className="flex items-center gap-2 rounded-[14px] bg-tile p-3.5 text-sm text-muted">
                    <Loader2 className="size-4 animate-spin" aria-hidden /> Comparando con autos parecidos…
                  </p>
                ) : !marketReady ? (
                  <p className="rounded-[14px] bg-tile p-3.5 text-sm leading-[1.45]">Llena marca, modelo y año en el paso 1 para ver el precio de mercado.</p>
                ) : null}

                <div className="grid gap-2">
                  <p className="text-sm font-semibold">Abono de reserva</p>
                  <p className="-mt-0.5 mb-0.5 text-[13.5px] leading-[1.45] text-muted">Te lo paga el comprador al reservar y se descuenta del precio. Si no hay venta, lo devuelves completo.</p>
                  <div role="group" aria-label="Abono de reserva" className="flex flex-wrap gap-2">
                    {RESERVE_PRESETS.map(amount => {
                      const pressed = !form.reserveCustom && toNumber(form.reserve) === amount;
                      return (
                        <button key={amount} type="button" aria-pressed={pressed} onClick={() => (update({ reserve: String(amount), reserveCustom: false }), touch('reserve'))} className={`${chipClass(pressed)} px-[18px] font-mono font-bold`}>
                          {money(amount)}
                        </button>
                      );
                    })}
                    <button type="button" aria-pressed={form.reserveCustom} onClick={() => update({ reserveCustom: true, reserve: '' })} className={`${chipClass(form.reserveCustom)} px-[18px]`}>
                      Otro monto
                    </button>
                  </div>
                  {form.reserveCustom && (
                    <div className="am-step-in max-w-[240px]">
                      <TextField id="pb-reserve" label="Monto del abono" value={form.reserve} placeholder="400" inputMode="numeric" suffix="USD" onChange={value => update({ reserve: digits(value) })} onBlur={() => form.reserve && touch('reserve')} />
                    </div>
                  )}
                  <div aria-live="polite">
                    <FieldError message={err('reserve')} />
                  </div>
                  {price > 0 && toNumber(form.reserve) > 0 && !err('reserve') && (
                    <p className="text-[13.5px]">Si alguien reserva, recibes el abono y el resto ({money(Math.max(0, price - toNumber(form.reserve)))}) al cerrar la venta.</p>
                  )}
                </div>
              </div>
            )}

            {!done && step === 4 && (
              <div key="s4" className="am-step-in grid gap-[22px]">
                <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] items-start gap-3.5">
                  <div className="grid gap-1.5">
                    <label htmlFor="pb-country" className="text-sm font-semibold">
                      País
                    </label>
                    <select id="pb-country" value={form.country} onChange={event => update({ country: event.target.value })} aria-invalid={Boolean(err('country'))} className={`${inputClass(Boolean(err('country')))} px-3.5`}>
                      <option value="" disabled>
                        Elige el país
                      </option>
                      {COUNTRIES.map(country => (
                        <option key={country.code} value={country.code}>
                          {country.name}
                        </option>
                      ))}
                    </select>
                    <FieldError message={err('country')} />
                  </div>
                  <TextField id="pb-city" label="Ciudad" value={form.city} placeholder="Caracas" error={err('city')} onChange={value => update({ city: value })} onBlur={() => form.city && touch('city')} />
                </div>

                <div className="grid gap-2.5 rounded-[18px] bg-tile p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      aria-busy={gps === 'loading'}
                      onClick={async () => {
                        if (gps === 'loading') return;
                        setGps('loading');
                        setGpsError('');
                        try {
                          setLocation(await getCurrentLocation());
                          setGps('on');
                          if (!savedId || isDraft) setSave('saving');
                        } catch (error) {
                          setGps(location ? 'on' : 'off');
                          setGpsError(error instanceof Error ? error.message : 'No se pudo obtener la ubicación.');
                        }
                      }}
                      className={outlineButton}
                    >
                      {gps === 'loading' ? <Loader2 className="size-[18px] animate-spin" aria-hidden /> : <MapPin className="size-[18px]" strokeWidth={2} aria-hidden />}
                      {gps === 'loading' ? 'Buscando…' : gps === 'on' ? 'Actualizar ubicación' : 'Usar mi ubicación'}
                    </button>
                    <p aria-live="polite" className="flex-[1_1_200px] text-[13.5px] leading-[1.45] text-muted">
                      {gps === 'on' ? `Zona aproximada en ${form.city.trim() || 'tu ciudad'}. Nunca mostramos la dirección exacta.` : 'Opcional. Sirve para que te encuentren por distancia.'}
                    </p>
                  </div>
                  {gpsError && (
                    <p role="alert" className="text-[13px] text-danger-fg">
                      {gpsError}
                    </p>
                  )}
                  {gps === 'on' && (
                    <svg role="img" aria-label="Zona aproximada guardada" viewBox="0 0 600 180" preserveAspectRatio="xMidYMid slice" className="am-step-in block h-[150px] w-full rounded-[14px] bg-card-tile">
                      <path d="M0 60h600M0 130h600M90 0v180M260 0v180M430 0v180M0 170 600 10" stroke="var(--am-line)" strokeWidth="10" fill="none" />
                      <path d="M0 95h600M180 0v180M350 0v180M520 0v180" stroke="var(--am-line)" strokeWidth="4" fill="none" />
                      <circle cx="300" cy="90" r="70" fill="var(--am-soft)" stroke="var(--am-success)" strokeWidth="2" strokeDasharray="6 6" />
                      <circle cx="300" cy="90" r="7" fill="var(--am-success)" />
                    </svg>
                  )}
                </div>

                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2.5">
                    <label htmlFor="pb-desc" className="text-sm font-semibold">
                      Descripción (opcional)
                    </label>
                    <button type="button" disabled={!form.make || !form.model} onClick={writeWithCopilot} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-edge px-3.5 text-[13.5px] font-bold text-ink hover:border-ink disabled:opacity-60">
                      <PenLine className="size-4" strokeWidth={2} aria-hidden />
                      {form.description ? 'Armar otro texto con la ficha' : 'Armar texto con la ficha'}
                    </button>
                  </div>
                  <textarea
                    id="pb-desc"
                    rows={6}
                    maxLength={5000}
                    placeholder="Estado, mantenimiento, extras, motivo de venta…"
                    value={form.description}
                    onChange={event => {
                      setUndoDesc(null);
                      update({ description: event.target.value });
                    }}
                    aria-invalid={Boolean(err('description'))}
                    aria-describedby="pb-desc-msg"
                    className={`block w-full resize-y rounded-[14px] border bg-field px-4 py-3.5 text-[15px] leading-[1.55] text-ink placeholder:text-faint focus:outline-2 focus:outline-offset-1 focus:outline-brand ${err('description') ? 'border-danger ring-[3px] ring-danger-soft' : 'border-field-line'}`}
                  />
                  <div id="pb-desc-msg" aria-live="polite" className="grid gap-1.5">
                    <FieldError message={err('description')} />
                    <div className="flex justify-between gap-3 text-[13px] text-muted">
                      <span>
                        Agrega lo que solo tú sabes: mantenimiento, cauchos, detalles y por qué lo vendes.
                        {undoDesc !== null && (
                          <>
                            {' '}
                            <button type="button" onClick={() => (update({ description: undoDesc }), setUndoDesc(null))} className="font-semibold text-brand-fg underline underline-offset-2">
                              Deshacer
                            </button>
                          </>
                        )}
                      </span>
                      <span className="shrink-0 font-mono">{form.description.length} / 5000</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!done && step === 5 && (
              <div key="s5" className="am-step-in grid gap-5">
                <dl className="grid rounded-[22px] border border-line bg-surface">
                  {[
                    { k: 'Ficha', v: [form.make && form.model ? `${form.make} ${form.model}` : '', form.year, form.transmission && TRANSMISSION_LABELS[form.transmission], form.fuelType && FUEL_LABELS[form.fuelType]].filter(Boolean).join(' · ') || 'Sin llenar', to: 1 },
                    { k: 'Fotos', v: `${gallery.total} de 10${gallery.hasVideo ? ' (con video)' : ''}`, to: 2 },
                    { k: 'Precio', v: price ? `${money(price)} · abono ${toNumber(form.reserve) ? money(toNumber(form.reserve)) : 'sin fijar'}` : 'Sin precio', to: 3 },
                    { k: 'Ubicación', v: `${form.city.trim() || 'Sin ciudad'}, ${COUNTRIES.find(country => country.code === form.country)?.name ?? 'sin país'}${gps === 'on' ? ' · con GPS' : ''}`, to: 4 },
                  ].map(row => (
                    <div key={row.k} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                      <dt className="w-[84px] shrink-0 text-[13px] text-muted">{row.k}</dt>
                      <dd className="min-w-0 flex-1 text-[14.5px] font-semibold">{row.v}</dd>
                      <button type="button" aria-label={`Editar ${row.k.toLowerCase()}`} onClick={() => go(row.to as PublishStep)} className="min-h-10 rounded-full px-3 text-[13.5px] font-bold text-brand-fg hover:bg-soft">
                        Editar
                      </button>
                    </div>
                  ))}
                </dl>

                <div className="grid gap-2.5">
                  <p className="text-[15px] font-extrabold">Antes de publicar</p>
                  <ul className="grid gap-2">
                    {checklist.map(item => (
                      <li key={item.text} className="flex items-center gap-3 text-sm">
                        <span aria-hidden className={`grid size-[26px] shrink-0 place-items-center rounded-full border-[1.5px] text-[13px] font-extrabold ${item.ok ? 'border-success-fg text-success-fg' : 'border-gold-fg text-gold-fg'}`}>
                          {item.ok ? '✓' : '!'}
                        </span>
                        <span className="flex-1">
                          {item.text}
                          <span className="sr-only">{item.ok ? ': listo' : ': falta'}</span>
                        </span>
                        {!item.ok && item.fix && (item.href ? (
                          <Link href={item.href} className="min-h-10 content-center rounded-full px-3 text-[13.5px] font-bold text-brand-fg underline underline-offset-[3px]">
                            {item.fix}
                          </Link>
                        ) : (
                          <button type="button" onClick={() => go(item.to!)} className="min-h-10 rounded-full px-3 text-[13.5px] font-bold text-brand-fg underline underline-offset-[3px]">
                            {item.fix}
                          </button>
                        ))}
                        {!item.ok && !item.fix && <span className="text-[13px] text-muted">Subiendo…</span>}
                      </li>
                    ))}
                  </ul>
                </div>

                {usage && (
                  <div className="flex flex-wrap justify-between gap-x-5 gap-y-2.5 rounded-[16px] bg-tile px-4 py-3.5 text-sm">
                    <span>
                      <strong>Plan {planName(usage.planCode)}</strong> · {usage.max === null ? 'anuncios sin límite' : `${usage.max} ${usage.max === 1 ? 'anuncio' : 'anuncios'} a la vez · ${usage.slotsUsed} en uso`}
                    </span>
                    <span className="font-mono text-[13px]">Publicar $0 · Comisión {commissionText} al vender</span>
                  </div>
                )}

                {publishError && (
                  <div role="alert" className="rounded-[16px] border border-danger/25 bg-danger-soft p-4 text-sm text-danger-fg">
                    {publishError.message}
                    {publishError.code === 'PLAN_LIMIT_REACHED' && (
                      <Link href="/cuenta/plan" className="ml-2 font-bold underline underline-offset-2">
                        Mejorar mi plan
                      </Link>
                    )}
                    {publishError.code === 'IDENTITY_NOT_VERIFIED' && (
                      <Link href="/cuenta/verificacion" className="ml-2 font-bold underline underline-offset-2">
                        Verificar identidad
                      </Link>
                    )}
                  </div>
                )}

                <div className="grid gap-2">
                  <button type="button" onClick={() => void publish()} disabled={publishing || !savedId} aria-busy={publishing} className={`${primaryButton} min-h-[58px] text-[17px]`}>
                    {publishing && <Loader2 className="size-[18px] animate-spin" aria-hidden />}
                    {publishing ? (canPublish ? 'Publicando…' : 'Guardando…') : status === 'PAUSED' ? 'Reanudar publicación' : status === 'EXPIRED' ? 'Renovar publicación' : canPublish ? 'Publicar gratis' : 'Guardar cambios'}
                  </button>
                  <p aria-live="polite" className={`text-center text-[13.5px] ${ready || !canPublish ? 'text-muted' : 'text-gold-fg'}`}>
                    {!canPublish
                      ? 'Los cambios se ven en tu anuncio en cuanto los guardas.'
                      : uploading
                        ? 'Esperando que terminen de subir las fotos…'
                        : !ready
                          ? 'Completa lo marcado arriba para publicar.'
                          : commissionRate === 0
                            ? 'Publicar es gratis y no cobramos comisión cuando vendes.'
                            : `Publicar es gratis. Al vender, la comisión de tu plan es ${commissionText}.`}
                  </p>
                </div>
              </div>
            )}
          </fieldset>

          {done && (
            <div role="status" className="am-step-in grid gap-5">
              <span className="am-pop grid size-[60px] place-items-center rounded-full bg-brand text-on-brand">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </span>
              <div>
                <h2 className="text-[26px] leading-[1.1] font-extrabold tracking-[-0.03em] sm:text-[32px]">¡Tu {title} ya está publicado!</h2>
                <p className="mt-2 text-[15px] leading-normal text-muted">
                  Ya aparece en el catálogo y en las búsquedas.{commissionRate === 0 ? ' Gratis y sin comisión.' : ''}
                </p>
              </div>
              <div className="min-[1100px]:hidden">{preview}</div>
              <div className="flex flex-wrap gap-2.5">
                <Link href={`/vehiculos/${done.slug}`} className={primaryButton}>
                  Ver mi anuncio
                </Link>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await copyText(`Mira mi ${title} ${form.year} en AutoMarket: ${window.location.origin}/vehiculos/${done.slug}`);
                      setShared(true);
                      window.setTimeout(() => setShared(false), 2200);
                    } catch {
                      toast({ tone: 'error', title: 'No se pudo copiar', description: 'Tu navegador no dejó usar el portapapeles.' });
                    }
                  }}
                  className={`${outlineButton} min-h-[52px]`}
                >
                  <span aria-live="polite">{shared ? 'Texto copiado' : 'Copiar para compartir'}</span>
                </button>
              </div>
              <Link href={usage && usage.featuredSlots > 0 ? '/cuenta/anuncios' : '/cuenta/plan'} className="flex items-center gap-3.5 rounded-[18px] bg-ink p-4 text-surface">
                <span className="grid size-[42px] shrink-0 place-items-center rounded-[12px] bg-brand text-on-brand">
                  <Megaphone className="size-4" strokeWidth={2} aria-hidden />
                </span>
                <span className="flex-1">
                  <span className="block text-[15px] font-extrabold">¿Quieres más visitas?</span>
                  <span className="mt-0.5 block text-[13.5px] opacity-80">
                    {usage && usage.featuredSlots > 0
                      ? `Destácalo desde Mis anuncios: tu plan ${planName(usage.planCode)} incluye ${usage.featuredSlots} ${usage.featuredSlots === 1 ? 'destacado' : 'destacados'}.`
                      : 'Con un plan de pago tus anuncios salen destacados y primero en las búsquedas.'}
                  </span>
                </span>
                <span aria-hidden className="text-xl">
                  →
                </span>
              </Link>
              <ol className="grid gap-2.5">
                {[
                  ['Te avisamos al instante', 'Cuando alguien escriba o haga una reserva, te llega una notificación.'],
                  ['Los compradores te escriben por el chat', 'Así queda registro de todo y evitas estafas. No compartas tu teléfono en la descripción.'],
                  done.expiresAt
                    ? [`Vence el ${new Date(done.expiresAt).toLocaleDateString('es', { day: 'numeric', month: 'long' })}`, `Según tu plan ${planName(usage?.planCode ?? 'FREE')}. Lo renuevas desde Mis anuncios con un toque.`]
                    : ['No vence', `Con tu plan ${planName(usage?.planCode ?? 'FREE')} el anuncio sigue publicado hasta que lo pauses o lo vendas.`],
                ].map(([a, b], index) => (
                  <li key={a} className="flex items-start gap-3">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-tile font-mono text-xs font-semibold">{index + 1}</span>
                    <span>
                      <span className="block text-[14.5px] font-bold">{a}</span>
                      <span className="mt-0.5 block text-[13.5px] leading-[1.45] text-muted">{b}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <button type="button" onClick={() => router.push('/cuenta/anuncios/nuevo')} className="min-h-11 justify-self-start text-sm font-bold text-brand-fg underline underline-offset-[3px]">
                Publicar otro auto
              </button>
            </div>
          )}

          {!done && <div className="mt-7 border-t border-line pt-5 max-sm:hidden">{footer}</div>}
        </section>

        <aside aria-label="Vista previa" className="sticky top-[104px] hidden shrink-0 basis-[320px] gap-3.5 min-[1100px]:grid">
          <p className="font-mono text-xs font-semibold tracking-[0.06em] text-muted uppercase">Así se verá en el catálogo</p>
          {preview}
          <PublishProgressCard pct={pct} />
        </aside>
      </div>

      {!done && <div className="shrink-0 border-t border-line bg-surface px-4 pt-3 pb-[18px] sm:hidden">{footer}</div>}
    </div>
  );

  /** Arma la descripción con los datos de la ficha (plantilla, al instante; se puede deshacer). */
  function writeWithCopilot() {
    if (!form.make || !form.model) return;
    const before = form.description;
    update({ description: writeDescription(form) });
    if (before) setUndoDesc(before);
  }
}

// ── Piezas del formulario ────────────────────────────────────────────────────

const primaryButton =
  'inline-flex min-h-[52px] items-center justify-center gap-2.5 rounded-full bg-brand px-[22px] text-base font-bold text-on-brand transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60';
const outlineButton =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-field-line bg-field px-[18px] text-[14.5px] font-bold text-ink transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-60';
const chipClass = (pressed: boolean) =>
  `min-h-11 rounded-full border px-4 text-[14.5px] font-semibold transition-colors duration-200 ${pressed ? 'border-ink bg-ink text-surface' : 'border-field-line bg-field text-ink hover:border-ink'}`;
const inputClass = (invalid: boolean) =>
  `block h-[50px] w-full rounded-[14px] border bg-field px-4 text-[15px] font-medium text-ink transition-[border-color,box-shadow] duration-150 placeholder:text-faint focus:outline-2 focus:outline-offset-1 focus:outline-brand ${invalid ? 'border-danger ring-[3px] ring-danger-soft' : 'border-field-line'}`;

const PLAN_NAMES: Record<string, string> = { FREE: 'Gratis', PREMIUM: 'Premium', DEALER_BASIC: 'Concesionario Básico', DEALER_PRO: 'Concesionario Pro' };
const planName = (code: string) => PLAN_NAMES[code] ?? code;

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex gap-1.5 text-[13px] leading-snug text-danger-fg">
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={2.2} aria-hidden />
      <span>{message}</span>
    </p>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  error,
  hint,
  suffix,
  inputMode,
  maxLength,
  list,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  error?: string;
  hint?: string;
  suffix?: string;
  inputMode?: 'numeric' | 'text';
  maxLength?: number;
  list?: string;
}) {
  return (
    <div className="grid content-start gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode={inputMode}
          maxLength={maxLength}
          autoComplete="off"
          list={list}
          placeholder={placeholder}
          value={value}
          onChange={event => onChange(event.target.value)}
          onBlur={onBlur}
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-msg`}
          className={`${inputClass(Boolean(error))} ${suffix ? 'pr-12' : ''}`}
        />
        {suffix && (
          <span aria-hidden className="absolute top-1/2 right-4 -translate-y-1/2 text-sm text-muted">
            {suffix}
          </span>
        )}
      </div>
      <div id={`${id}-msg`} aria-live="polite">
        {error ? <FieldError message={error} /> : hint ? <p className="text-[13px] text-muted">{hint}</p> : null}
      </div>
    </div>
  );
}

function Chips({ label, options, value, onPick, error, toggle }: { label: string; options: Array<{ value: string; label: string }>; value: string; onPick: (value: string) => void; error?: string; toggle?: boolean }) {
  return (
    <div className="grid gap-2">
      <p className="text-sm font-semibold">{label}</p>
      <div role="group" aria-label={label} className="flex flex-wrap gap-2">
        {options.map(option => (
          <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onPick(option.value)} className={chipClass(value === option.value)} title={toggle && value === option.value ? 'Toca otra vez para quitarla' : undefined}>
            {option.label}
          </button>
        ))}
      </div>
      <FieldError message={error} />
    </div>
  );
}

/** Marcas del catálogo del administrador: las primeras como botones y el resto en una lista. */
function BrandPicker({ catalog, value, error, onPick }: { catalog: CatalogBrandDTO[]; value: string; error?: string; onPick: (make: string) => void }) {
  const names = catalog.map(brand => brand.name);
  const chips = names.slice(0, MAX_CHIPS);
  const selected = value.trim();
  if (selected && !chips.some(name => name.toLocaleLowerCase('es') === selected.toLocaleLowerCase('es'))) chips.push(selected);
  const rest = names.slice(MAX_CHIPS).filter(name => !chips.includes(name));
  return (
    <div className="grid gap-2">
      <p className="text-sm font-semibold">Marca</p>
      <div role="group" aria-label="Marca" className="flex flex-wrap gap-2">
        {chips.map(name => {
          const pressed = name.toLocaleLowerCase('es') === selected.toLocaleLowerCase('es');
          return (
            <button key={name} type="button" aria-pressed={pressed} onClick={() => onPick(name)} className={chipClass(pressed)}>
              {name}
            </button>
          );
        })}
        {rest.length > 0 && (
          <select aria-label="Otra marca" value="" onChange={event => event.target.value && onPick(event.target.value)} className="min-h-11 rounded-full border border-field-line bg-field px-4 text-[14.5px] font-semibold text-ink">
            <option value="">Otra marca…</option>
            {rest.map(name => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
      </div>
      <FieldError message={error} />
    </div>
  );
}

function ModelSuggestions({ models, value, onPick }: { models: string[]; value: string; onPick: (model: string) => void }): ReactNode {
  if (!models.length) return null;
  return (
    <div className="grid gap-2">
      <p className="text-sm font-semibold">Modelos de esta marca</p>
      <div role="group" aria-label="Modelos de esta marca" className="flex flex-wrap gap-2">
        {models.slice(0, MAX_CHIPS).map(model => {
          const pressed = model.toLocaleLowerCase('es') === value.trim().toLocaleLowerCase('es');
          return (
            <button key={model} type="button" aria-pressed={pressed} onClick={() => onPick(model)} className={chipClass(pressed)}>
              {model}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Medidor de precio ───────────────────────────────────────────────────────

function buildGauge(data: VehicleInsightsDTO | null, price: number) {
  const market = data?.market;
  if (!market) return null;
  const min = market.low * 0.85;
  const max = market.high * 1.15;
  const span = max - min || 1;
  const at = (value: number) => `${((value - min) / span) * 100}%`;
  const zone: 'none' | 'deal' | 'fair' | 'high' = !price ? 'none' : price < market.low ? 'deal' : price > market.high ? 'high' : 'fair';
  const diff = price ? Math.round(((price - market.value) / market.value) * 100) : 0;
  const verdict = { none: 'Escribe tu precio y te digo cómo queda', deal: 'Precio de oferta', fair: 'Precio justo', high: 'Por encima del mercado' }[zone];
  const detail = {
    none: `Autos parecidos se publican entre ${money(market.low)} y ${money(market.high)}.`,
    deal: `${Math.abs(diff)} % por debajo del valor de mercado. Atrae más compradores, pero quizá dejas dinero en la mesa.`,
    fair: diff === 0 ? 'Justo en el valor de mercado.' : `${Math.abs(diff)} % ${diff > 0 ? 'por encima' : 'por debajo'} del valor de mercado.`,
    high: `${diff} % por encima del valor de mercado. Con fotos muy buenas y pocos km se puede justificar.`,
  }[zone];
  return {
    market,
    zone,
    verdict,
    detail,
    pos: `${price ? Math.max(2, Math.min(98, ((price - min) / span) * 100)) : 50}%`,
    lowPos: at(market.low),
    fairWidth: `${((market.high - market.low) / span) * 100}%`,
    suggested: Math.round(market.value / 100) * 100,
  };
}
