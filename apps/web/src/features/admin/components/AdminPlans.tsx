'use client';

import { ACCOUNT_TYPE_LABELS, BoostSettingsSchema, PlanUpdateSchema, PlatformSettingsSchema, type PlanCode, type PlanDTO } from '@automarket/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Info } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { cn } from '@/shared/lib/cn';
import { formatNumber } from '@/shared/lib/format';
import { Button } from '@/shared/ui/button';
import { PageSpinner } from '@/shared/ui/spinner';
import { useToast } from '@/shared/ui/toaster';
import { boostKeys, boostsApi } from '@/features/boosts/api';
import { adminApi, adminKeys } from '../api';
import { BinancePayeeCard } from './BinancePayeeCard';
import { BrandCatalogCard } from './BrandCatalogCard';
import { SettingsHistoryCard } from './SettingsHistoryCard';
import { SocialLinksCard } from './SocialLinksCard';

type Tab = 'planes' | 'destacar' | 'cobro' | 'marcas' | 'redes' | 'plazos' | 'historial';
const TABS: Array<[Tab, string]> = [
  ['planes', 'Planes'],
  ['destacar', 'Destacar'],
  ['cobro', 'Cobro Binance'],
  ['marcas', 'Marcas'],
  ['redes', 'Redes'],
  ['plazos', 'Plazos'],
  ['historial', 'Historial'],
];

/** Campo numérico de los diseños: cifra en Geist Mono alineada a la derecha. */
export const adminNumberField =
  'box-border h-[46px] w-full rounded-[12px] border border-edge bg-surface px-3.5 text-right font-mono text-[15px] font-semibold text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/25 aria-[invalid=true]:border-danger disabled:bg-sunken disabled:text-muted';

/** Tarjeta de sección del panel: blanca, 22 px, título de 18 px. */
export function AdminSection({ title, description, className, children, id }: { title: string; description?: string; className?: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className={cn('rounded-[22px] border border-line bg-surface p-5', className)}>
      <h2 className="text-lg font-extrabold">{title}</h2>
      {description && <p className="mt-0.5 text-[13.5px] leading-[1.45] text-muted">{description}</p>}
      {children}
    </section>
  );
}

// ───────────────────────────────────────────────────────────────── Planes ──

type Draft = Record<'priceMonthly' | 'priceYearly' | 'maxActiveListings' | 'listingDurationDays' | 'featuredSlots' | 'monthlyFeaturedCredits' | 'searchBoost' | 'commission', string>;

const toDraft = (plan: PlanDTO): Draft => ({
  priceMonthly: String(plan.priceMonthly),
  priceYearly: String(plan.priceYearly),
  maxActiveListings: plan.maxActiveListings === null ? '' : String(plan.maxActiveListings),
  listingDurationDays: plan.listingDurationDays === null ? '' : String(plan.listingDurationDays),
  featuredSlots: String(plan.featuredSlots),
  monthlyFeaturedCredits: String(plan.monthlyFeaturedCredits),
  searchBoost: String(plan.searchBoost),
  commission: String(Math.round(plan.commissionRate * 10_000) / 100),
});

const FIELDS: Array<{ key: keyof Draft; label: string; hint: string; placeholder?: string }> = [
  { key: 'priceMonthly', label: 'Precio mensual', hint: 'USD' },
  { key: 'priceYearly', label: 'Precio anual', hint: 'USD' },
  { key: 'maxActiveListings', label: 'Anuncios activos', hint: 'vacío = ilimitados', placeholder: '∞' },
  { key: 'listingDurationDays', label: 'Días que dura un anuncio', hint: 'vacío = no vence', placeholder: '∞' },
  { key: 'featuredSlots', label: 'Destacados a la vez', hint: 'los elige el usuario' },
  { key: 'monthlyFeaturedCredits', label: 'Destacados por mes', hint: 'automáticos' },
  { key: 'searchBoost', label: 'Prioridad en búsquedas', hint: '0 normal · 10 máxima' },
  { key: 'commission', label: 'Comisión post-venta', hint: '% del precio de venta' },
];

const parseDraft = (draft: Draft) =>
  PlanUpdateSchema.safeParse({
    priceMonthly: draft.priceMonthly,
    priceYearly: draft.priceYearly,
    commissionRate: Number(draft.commission.replace(',', '.')) / 100,
    maxActiveListings: draft.maxActiveListings,
    listingDurationDays: draft.listingDurationDays,
    featuredSlots: draft.featuredSlots,
    monthlyFeaturedCredits: draft.monthlyFeaturedCredits,
    searchBoost: draft.searchBoost,
  });

function PlansTab({ plans, onDirty }: { plans: PlanDTO[]; onDirty: (dirty: boolean) => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const metrics = useQuery({ queryKey: adminKeys.metrics, queryFn: () => adminApi.metrics(12) });
  const base = useMemo(() => Object.fromEntries(plans.map(plan => [plan.code, toDraft(plan)])) as Record<PlanCode, Draft>, [plans]);
  const [drafts, setDrafts] = useState(base);
  const [errors, setErrors] = useState<Partial<Record<PlanCode, string>>>({});
  useEffect(() => setDrafts(base), [base]);

  const dirtyPlans = plans.filter(plan => JSON.stringify(drafts[plan.code]) !== JSON.stringify(base[plan.code]));
  useEffect(() => onDirty(dirtyPlans.length > 0), [dirtyPlans.length, onDirty]);

  const save = useMutation({
    mutationFn: async () => {
      const failed: Partial<Record<PlanCode, string>> = {};
      for (const plan of dirtyPlans) {
        const parsed = parseDraft(drafts[plan.code]);
        if (!parsed.success) {
          failed[plan.code] = parsed.error.issues[0]?.message;
          continue;
        }
        try {
          await adminApi.updatePlan(plan.code, parsed.data);
        } catch (err) {
          failed[plan.code] = err instanceof Error ? err.message : 'No se pudo guardar.';
        }
      }
      return failed;
    },
    onSuccess: failed => {
      setErrors(failed);
      void queryClient.invalidateQueries({ queryKey: adminKeys.plans });
      void queryClient.invalidateQueries({ queryKey: adminKeys.history });
      if (Object.keys(failed).length === 0) toast({ tone: 'success', title: 'Planes guardados', description: 'Los precios valen para los próximos pagos; la duración, para lo que se publique desde ahora.' });
    },
  });

  const users = (code: PlanCode) => metrics.data?.plans.find(row => row.code === code)?.users;
  return (
    <div className="grid gap-3.5">
      <p className="flex gap-2 rounded-[14px] border border-line bg-surface px-3.5 py-3 text-sm leading-[1.45]">
        <Info className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
        <span>Los cambios valen para compras y renovaciones nuevas. Quien ya pagó conserva su precio hasta que venza su plan. La prioridad se aplica al momento a sus anuncios.</span>
      </p>
      <div className="grid items-start gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(250px,1fr))]">
        {plans.map(plan => {
          const free = plan.code === 'FREE';
          const dirty = dirtyPlans.includes(plan);
          const count = users(plan.code);
          return (
            <section key={plan.code} aria-label={plan.name} className={cn('grid gap-3 rounded-[22px] border bg-surface p-5', dirty ? 'border-gold' : 'border-line')}>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-lg font-extrabold">{plan.name}</h2>
                {count !== undefined && <span className="shrink-0 font-mono text-xs font-medium text-muted">{formatNumber(count)} {plan.accountType === 'DEALER' ? (count === 1 ? 'activo' : 'activos') : count === 1 ? 'cuenta' : 'cuentas'}</span>}
              </div>
              <p className="-mt-2 text-[13px] text-muted">{plan.accountType ? ACCOUNT_TYPE_LABELS[plan.accountType] : 'Todas las cuentas'}</p>
              {FIELDS.map(field => {
                const locked = free && (field.key === 'priceMonthly' || field.key === 'priceYearly');
                const id = `${plan.code}-${field.key}`;
                return (
                  <div key={field.key} className="grid grid-cols-[minmax(0,1fr)_110px] items-center gap-2.5">
                    <label htmlFor={id} className="text-sm font-semibold">
                      {field.label}
                      <span className="block text-xs font-medium text-muted">{field.hint}</span>
                    </label>
                    <input
                      id={id}
                      inputMode="decimal"
                      value={drafts[plan.code]?.[field.key] ?? ''}
                      placeholder={field.placeholder}
                      disabled={locked}
                      onChange={event => setDrafts(current => ({ ...current, [plan.code]: { ...current[plan.code], [field.key]: event.target.value } }))}
                      className={adminNumberField}
                    />
                  </div>
                );
              })}
              {errors[plan.code] && (
                <p role="alert" className="flex gap-1.5 text-[13px] text-danger-fg">
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {errors[plan.code]}
                </p>
              )}
              {!free && Number(drafts[plan.code]?.priceMonthly) > 0 && (
                <p className="text-[13px] font-bold text-brand-fg">
                  Pagando el año ahorran {Math.max(0, Math.round((1 - Number(drafts[plan.code]?.priceYearly) / (Number(drafts[plan.code]?.priceMonthly) * 12)) * 100))} %
                </p>
              )}
              {free && <p className="text-[13px] font-bold text-brand-fg">Plan de entrada, sin costo</p>}
            </section>
          );
        })}
      </div>

      {dirtyPlans.length > 0 && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-3 rounded-[18px] bg-night px-4 py-3 text-[#f2f3f5] shadow-pop">
          <p className="flex-1 text-sm">
            {dirtyPlans.length === 1 ? '1 cambio sin guardar' : `${dirtyPlans.length} cambios sin guardar`}: {dirtyPlans.map(plan => plan.name).join(', ')}
          </p>
          <button type="button" onClick={() => (setDrafts(base), setErrors({}))} className="h-10 rounded-full border border-[#3b3f46] px-4 text-sm font-bold hover:border-[#6b717b]">
            Descartar
          </button>
          <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className="h-10 rounded-full bg-brand px-5 text-sm font-extrabold text-on-brand disabled:opacity-60">
            {save.isPending ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────── Plazos ──

function DeadlinesTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: adminKeys.settings, queryFn: () => adminApi.settings() });
  const [error, setError] = useState<string>();
  const save = useMutation({
    mutationFn: adminApi.updateSettings,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.history });
      toast({ tone: 'success', title: 'Plazos guardados' });
    },
    onError: err => setError(err.message),
  });
  if (settings.isPending) return <PageSpinner />;
  if (settings.isError) return <p className="text-danger-fg">{settings.error.message}</p>;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = PlatformSettingsSchema.safeParse({ sellerResponseHours: data.get('hours'), reservationHoldDays: data.get('hold'), commissionDueDays: data.get('due') });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setError(undefined);
    save.mutate(parsed.data);
  }

  const rows = [
    { id: 'hours', label: 'Plazo del vendedor', hint: 'Horas para confirmar una solicitud (1 a 72).', value: settings.data.sellerResponseHours, unit: 'h' },
    { id: 'hold', label: 'Duración de la reserva', hint: 'Días; sin venta al terminar, el auto vuelve a estar disponible (1 a 30).', value: settings.data.reservationHoldDays, unit: 'd' },
    { id: 'due', label: 'Plazo para pagar la comisión', hint: 'Días; vencida, bloquea publicar y reservar (1 a 60).', value: settings.data.commissionDueDays, unit: 'd' },
  ];
  return (
    <AdminSection title="Reservas P2P y comisión post-venta" description="El abono lo fija cada vendedor y se le paga directamente a él. La plataforma cobra con Binance la comisión cuando se concreta la venta." className="max-w-3xl">
      <form onSubmit={onSubmit} className="mt-2" noValidate>
        {rows.map(row => (
          <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_150px] items-center gap-3.5 border-b border-line py-3">
            <div>
              <label htmlFor={row.id} className="block text-[15px] font-bold">
                {row.label}
              </label>
              <span className="block text-[13px] text-muted">{row.hint}</span>
            </div>
            <div className="relative">
              <input id={row.id} name={row.id} inputMode="numeric" defaultValue={row.value} className={cn(adminNumberField, 'pr-8')} />
              <span aria-hidden className="absolute top-1/2 right-3.5 -translate-y-1/2 font-mono text-[15px] font-semibold text-muted">
                {row.unit}
              </span>
            </div>
          </div>
        ))}
        {error && <p className="mt-3 text-[13px] text-danger-fg">{error}</p>}
        <Button type="submit" className="mt-4" loading={save.isPending}>
          Guardar plazos
        </Button>
      </form>
    </AdminSection>
  );
}

// ─────────────────────────────────────────────────────────────── Destacar ──

const BOOST_ROWS = [
  { id: 'city3', label: 'Impulso (3 días en su zona)', hint: 'Sale primero en su ciudad y tipo de auto.', unit: '$' },
  { id: 'city7', label: 'Semana destacada (7 días)', hint: 'Comparte cupo con el Impulso; avisa a compradores con alertas.', unit: '$' },
  { id: 'home', label: 'Portada (7 días)', hint: 'Carrusel del inicio, en todo el país.', unit: '$' },
  { id: 'login1', label: 'Pantalla de entrada · 1 día', hint: 'Carrusel de Entrar y Crear cuenta.', unit: '$' },
  { id: 'login2', label: 'Pantalla de entrada · 2 días', hint: 'Días seguidos.', unit: '$' },
  { id: 'login3', label: 'Pantalla de entrada · 3 días', hint: 'Máximo por compra.', unit: '$' },
  { id: 'citySlots', label: 'Cupos por zona', hint: 'Ciudad × tipo de auto (Impulso y Semana).', unit: '#' },
  { id: 'homeSlots', label: 'Cupos de Portada', hint: 'En todo el país a la vez.', unit: '#' },
  { id: 'loginSlots', label: 'Cupos por día en la entrada', hint: 'Se reparten por orden de llegada (hora del pago).', unit: '#' },
] as const;

function BoostSettingsTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: boostKeys.settings, queryFn: boostsApi.settings });
  const [error, setError] = useState<string>();
  const save = useMutation({
    mutationFn: boostsApi.updateSettings,
    onSuccess: data => {
      queryClient.setQueryData(boostKeys.settings, data);
      void queryClient.invalidateQueries({ queryKey: adminKeys.history });
      toast({ tone: 'success', title: 'Precios y cupos de Destacar guardados' });
    },
    onError: err => setError(err.message),
  });
  if (settings.isPending) return <PageSpinner />;
  if (settings.isError) return <p className="text-danger-fg">{settings.error.message}</p>;
  const { prices, slots, loginOnSale } = settings.data;
  const values: Record<(typeof BOOST_ROWS)[number]['id'], string | number> = {
    city3: prices.city3,
    city7: prices.city7,
    home: prices.home,
    login1: prices.login[0],
    login2: prices.login[1],
    login3: prices.login[2],
    citySlots: slots.city,
    homeSlots: slots.home,
    loginSlots: slots.login,
  };

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = BoostSettingsSchema.safeParse({
      ...Object.fromEntries(BOOST_ROWS.map(row => [row.id, String(data.get(row.id) ?? '').replace(',', '.')])),
      loginOnSale: data.get('loginOnSale') === 'on',
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setError(undefined);
    save.mutate(parsed.data);
  }

  return (
    <AdminSection title="Destacados pagados" description="Precios en USDT y cupos de Destacar. Solo el equipo los cambia; aplican a las compras nuevas (las pagadas conservan su precio)." className="max-w-3xl">
      <form onSubmit={onSubmit} className="mt-2" noValidate>
        {BOOST_ROWS.map(row => (
          <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_150px] items-center gap-3.5 border-b border-line py-3">
            <div>
              <label htmlFor={`boost-${row.id}`} className="block text-[15px] font-bold">
                {row.label}
              </label>
              <span className="block text-[13px] text-muted">{row.hint}</span>
            </div>
            <div className="relative">
              {row.unit === '$' && (
                <span aria-hidden className="absolute top-1/2 left-3.5 -translate-y-1/2 font-mono text-[15px] font-semibold text-muted">
                  $
                </span>
              )}
              <input id={`boost-${row.id}`} name={row.id} inputMode={row.unit === '$' ? 'decimal' : 'numeric'} defaultValue={row.unit === '$' ? Number(values[row.id]) : values[row.id]} className={adminNumberField} />
            </div>
          </div>
        ))}
        <label className="flex items-start gap-3 border-b border-line py-3.5">
          <input type="checkbox" name="loginOnSale" defaultChecked={loginOnSale} className="mt-1 size-5 shrink-0 accent-[var(--color-brand)]" />
          <span>
            <span className="block text-[15px] font-bold">Vender la «Pantalla de entrada»</span>
            <span className="block text-[13px] text-muted">Apagado: Destacar no la ofrece, porque Entrar y Crear cuenta ya no muestran autos. Los turnos que ya se pagaron se respetan hasta que terminen.</span>
          </span>
        </label>
        {error && <p className="mt-3 text-[13px] text-danger-fg">{error}</p>}
        <Button type="submit" className="mt-4" loading={save.isPending}>
          Guardar precios y cupos
        </Button>
      </form>
    </AdminSection>
  );
}

// ───────────────────────────────────────────────────────────────── Página ──

/** Planes y ajustes como en los diseños: pestañas en píldora y una sección por pestaña. */
export function AdminPlans() {
  const plans = useQuery({ queryKey: adminKeys.plans, queryFn: adminApi.plans });
  const settings = useQuery({ queryKey: adminKeys.settings, queryFn: () => adminApi.settings() });
  const [tab, setTab] = useState<Tab>('planes');
  const [plansDirty, setPlansDirty] = useState(false);

  // Enlaces directos (p. ej. el aviso «cambió la cuenta de cobro» lleva a #cobro).
  useEffect(() => {
    const fromHash = () => {
      const hash = window.location.hash.slice(1) as Tab;
      if (TABS.some(([key]) => key === hash)) setTab(hash);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

  const pick = (next: Tab) => {
    setTab(next);
    window.history.replaceState(null, '', `#${next}`);
  };

  return (
    <div className="grid gap-5">
      <div role="tablist" aria-label="Secciones de ajustes" className="flex flex-wrap gap-1 self-start justify-self-start rounded-full bg-sunken p-1">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => pick(key)}
            className={cn('inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-bold transition-colors', tab === key ? 'bg-surface text-ink shadow-tab dark:bg-[#2a2e34]' : 'text-muted hover:text-ink')}
          >
            {label}
            {key === 'planes' && plansDirty && <span aria-label="con cambios" className="size-[7px] rounded-full bg-gold" />}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="motion-safe:animate-[am-slide-in_320ms_cubic-bezier(.2,.9,.25,1)]" key={tab}>
        {tab === 'planes' && (plans.isPending ? <PageSpinner /> : plans.isError ? <p className="text-danger-fg">{plans.error.message}</p> : <PlansTab plans={plans.data} onDirty={setPlansDirty} />)}
        {tab === 'cobro' && (settings.data ? <BinancePayeeCard key={`${settings.data.binance.payId}-${settings.data.binance.updatedAt}`} payee={settings.data.binance} /> : settings.isError ? <p className="text-danger-fg">{settings.error.message}</p> : <PageSpinner />)}
        {tab === 'marcas' && <BrandCatalogCard />}
        {tab === 'redes' && (settings.data ? <SocialLinksCard key={settings.data.socialLinks.map(link => link.url).join('|')} links={settings.data.socialLinks} /> : <PageSpinner />)}
        {tab === 'plazos' && <DeadlinesTab />}
        {tab === 'destacar' && <BoostSettingsTab />}
        {tab === 'historial' && <SettingsHistoryCard />}
      </div>
    </div>
  );
}
