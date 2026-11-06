'use client';

import { PLAN_LABELS, type PlanCode } from '@automarket/contracts';
import Link from 'next/link';
import { buttonClasses } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';

/** Cupo del plan lleno: publicar es gratis con 1 anuncio; para más hay que mejorar el plan (pago con Binance). */
export function PlanLimitNotice({ planCode, max }: { planCode: string; max: number }) {
  return (
    <Card className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
      <div className="flex-1">
        <p className="font-display text-xl">Llegaste al límite de tu plan {PLAN_LABELS[planCode as PlanCode] ?? planCode}</p>
        <p className="mt-1 text-sm text-muted">
          Tu plan incluye {max} {max === 1 ? 'anuncio' : 'anuncios'}. Mejóralo (pago con Binance) para publicar más, o retira o pausa uno de tus anuncios.
        </p>
      </div>
      <div className="flex gap-2">
        <Link href="/cuenta/anuncios" className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
          Mis anuncios
        </Link>
        <Link href="/cuenta/plan" className={buttonClasses({ variant: 'gold', size: 'sm' })}>
          Mejorar mi plan
        </Link>
      </div>
    </Card>
  );
}
