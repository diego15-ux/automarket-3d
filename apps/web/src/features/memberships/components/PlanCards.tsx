'use client';

import type { AccountType, BillingCycle, PlanCode, PlanDTO } from '@automarket/contracts';
import { Check } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';
import { formatPrice } from '@/shared/lib/format';

/** Beneficios legibles derivados de los datos reales del plan (los edita el administrador). */
export function planFeatures(plan: PlanDTO): string[] {
  const commission = `${(plan.commissionRate * 100).toLocaleString('es', { maximumFractionDigits: 2 })} %`;
  return [
    plan.maxActiveListings === null ? 'Anuncios ilimitados' : `${plan.maxActiveListings} ${plan.maxActiveListings === 1 ? 'anuncio' : 'anuncios'} (límite estricto)`,
    plan.listingDurationDays === null ? 'Sin vencimiento de anuncios' : `Anuncios activos ${plan.listingDurationDays} días`,
    ...(plan.accountType === 'DEALER' ? ['Insignia de concesionario con RIF visible'] : []),
    plan.commissionRate === 0 ? '0 % de comisión post-venta' : `Comisión post-venta ${commission} del precio`,
    // La prioridad en búsquedas va en su propia línea (sale de searchBoost), para no repetirla.
    ...(plan.monthlyFeaturedCredits > 0 ? [`${plan.monthlyFeaturedCredits} ${plan.monthlyFeaturedCredits === 1 ? 'vehículo destacado' : 'vehículos destacados'} al mes`] : []),
    ...(plan.featuredSlots > 0 && plan.monthlyFeaturedCredits === 0 ? [`Hasta ${plan.featuredSlots} ${plan.featuredSlots === 1 ? 'vehículo destacado' : 'vehículos destacados'} a la vez`] : []),
    ...(plan.searchBoost >= 3 ? ['Posicionamiento prioritario en búsquedas'] : plan.searchBoost > 0 ? ['Prioridad en búsquedas'] : []),
    'Galería de 10 fotos o vídeos y chat seguro',
  ];
}

/** Planes que puede contratar un tipo de cuenta (el gratuito vale para todas). */
export const plansFor = (plans: PlanDTO[], accountType: AccountType) => plans.filter(plan => plan.accountType === null || plan.accountType === accountType);

/** Plan recomendado de cada grupo. */
export const isHighlighted = (code: PlanCode) => code === 'PREMIUM' || code === 'DEALER_PRO';

export const planPrice = (plan: PlanDTO, cycle: BillingCycle) => (cycle === 'MONTHLY' ? plan.priceMonthly : plan.priceYearly);

export function CycleToggle({ cycle, onChange }: { cycle: BillingCycle; onChange: (cycle: BillingCycle) => void }) {
  return <SegmentedControl label="Periodo de facturación" value={cycle} onChange={onChange} options={[['MONTHLY', 'Mensual'], ['YEARLY', 'Anual']]} />;
}

/** Selector de dos o más opciones: texto con la opción activa subrayada en tinta. */
export function SegmentedControl<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (value: T) => void; options: Array<readonly [T, string]> }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-5 text-sm">
      {options.map(([option, text]) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={cn('border-b-2 pb-1 transition-colors', value === option ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink')}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/**
 * Rejilla de planes con precios reales. `action` pinta el botón de cada plan
 * (landing: «Empezar»; cuenta: «Pagar con Binance» / «Plan actual»).
 */
export function PlanCards({ plans, cycle, current, action }: { plans: PlanDTO[]; cycle: BillingCycle; current?: PlanCode; action: (plan: PlanDTO) => ReactNode }) {
  return (
    <div className={cn('grid gap-x-8 gap-y-12 md:grid-cols-2', plans.length === 3 && 'xl:grid-cols-3', plans.length >= 4 && 'xl:grid-cols-4')}>
      {plans.map(plan => {
        const highlighted = isHighlighted(plan.code);
        const price = planPrice(plan, cycle);
        const savings = cycle === 'YEARLY' && plan.priceMonthly > 0 ? Math.round((1 - plan.priceYearly / (plan.priceMonthly * 12)) * 100) : 0;
        return (
          <div key={plan.code} className={cn('flex flex-col border-t pt-5', highlighted ? 'border-t-[3px] border-brand-fg' : 'border-edge/60')}>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-display text-2xl">{plan.name}</h3>
              {current === plan.code ? (
                <span className="text-[13px] font-medium text-success-fg">Tu plan actual</span>
              ) : highlighted ? (
                <span className="text-[13px] font-medium text-brand-fg">Recomendado</span>
              ) : null}
            </div>
            <p className="mt-5 flex items-baseline gap-1.5">
              <span className="font-display text-[2.75rem] leading-none tracking-tight figures">{formatPrice(price, plan.currency)}</span>
              <span className="text-sm text-muted">{price > 0 ? `/ ${cycle === 'MONTHLY' ? 'mes' : 'año'}` : 'para siempre'}</span>
            </p>
            <p className="mt-2 h-5 text-[13px] text-success-fg">{savings > 0 ? `${savings} % menos que pagando mes a mes` : ''}</p>
            <ul className="mt-5 divide-y divide-line border-y border-line text-sm">
              {planFeatures(plan).map(feature => (
                <li key={feature} className="flex gap-2.5 py-2.5">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-ink" strokeWidth={2.25} aria-hidden /> {feature}
                </li>
              ))}
            </ul>
            <div className="mt-auto pt-6">{action(plan)}</div>
          </div>
        );
      })}
    </div>
  );
}
