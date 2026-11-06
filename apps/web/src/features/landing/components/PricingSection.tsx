'use client';

import { ACCOUNT_TYPE_LABELS, type AccountType, type BillingCycle, type PlanDTO } from '@automarket/contracts';
import Link from 'next/link';
import { useState } from 'react';
import { CycleToggle, PlanCards, SegmentedControl, isHighlighted } from '@/features/memberships/components/PlanCards';
import { buttonClasses } from '@/shared/ui/button';

/** Planes por tipo de cuenta: personas naturales (Gratis y Premium) y concesionarios (Básico y Pro). */
export function PricingSection({ plans }: { plans: PlanDTO[] }) {
  const [cycle, setCycle] = useState<BillingCycle>('MONTHLY');
  const [audience, setAudience] = useState<AccountType>('INDIVIDUAL');
  const visible = plans.filter(plan => (audience === 'INDIVIDUAL' ? plan.accountType !== 'DEALER' : plan.accountType === 'DEALER'));
  return (
    <>
      <div className="mb-10 flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <SegmentedControl label="Tipo de cuenta" value={audience} onChange={setAudience} options={[['INDIVIDUAL', 'Personas naturales'], ['DEALER', 'Concesionarios']]} />
        <CycleToggle cycle={cycle} onChange={setCycle} />
      </div>
      <PlanCards
        plans={visible}
        cycle={cycle}
        action={plan => (
          <Link href={plan.code === 'FREE' ? '/registro' : `/cuenta/plan?plan=${plan.code}&ciclo=${cycle}`} className={buttonClasses({ variant: isHighlighted(plan.code) ? 'primary' : 'outline', className: 'w-full' })}>
            {plan.code === 'FREE' ? 'Empezar gratis' : `Elegir ${plan.name}`}
          </Link>
        )}
      />
      <p className="mt-10 max-w-3xl text-[13px] text-muted">
        Registro y publicación básica gratis ({ACCOUNT_TYPE_LABELS[audience].toLowerCase()}). Planes y comisión post-venta se pagan con Binance (Binance Pay o Pay ID, en USDT). Las reservas se pagan directo al vendedor.
      </p>
    </>
  );
}
