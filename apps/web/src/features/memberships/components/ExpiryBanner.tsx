'use client';

import { PLAN_LABELS } from '@automarket/contracts';
import { AlarmClock } from 'lucide-react';
import Link from 'next/link';
import { useSession } from '@/shared/lib/use-session';
import { buttonClasses } from '@/shared/ui/button';

/** Aviso persistente cuando a la membresía le quedan 10 días o menos (además del correo). */
export function ExpiryBanner() {
  const session = useSession();
  if (session.status !== 'authenticated') return null;
  const { plan } = session.user;
  if (plan.code === 'FREE' || plan.daysRemaining === null || plan.daysRemaining > 10) return null;

  return (
    <div role="status" className="border-t border-line bg-sunken">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2 text-[13px] sm:px-6 sm:text-sm lg:px-8">
        <AlarmClock className="size-4 shrink-0 text-brand-fg" />
        <p className="min-w-0 flex-1">
          Tu plan <strong className="font-medium">{PLAN_LABELS[plan.code]}</strong> vence en <strong className="font-medium">{plan.daysRemaining} {plan.daysRemaining === 1 ? 'día' : 'días'}</strong>
          <span className="max-sm:hidden">. Al vencer pasarás a Free y se pausarán tus anuncios adicionales</span>.
        </p>
        <Link href="/cuenta/plan" className={buttonClasses({ variant: 'outline', size: 'sm', className: 'h-8' })}>
          Renovar plan
        </Link>
      </div>
    </div>
  );
}
