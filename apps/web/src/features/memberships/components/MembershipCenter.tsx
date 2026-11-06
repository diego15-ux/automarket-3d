'use client';

import { CYCLE_LABELS, PLAN_LABELS, type BillingCycle, type MembershipStatusDTO, type PaidPlanCode, type PaymentDTO, type PaymentMethod, type PlanDTO } from '@automarket/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlarmClock, Crown } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MethodPicker } from '@/features/payments/components/MethodPicker';
import { useState } from 'react';
import { api } from '@/shared/lib/http';
import { formatDate, formatPrice } from '@/shared/lib/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { PageSpinner } from '@/shared/ui/spinner';
import { useToast } from '@/shared/ui/toaster';
import { useSession } from '@/shared/lib/use-session';
import { CycleToggle, PlanCards, plansFor } from './PlanCards';

const SOURCE_LABELS = { BINANCE: 'Binance', ADMIN: 'Equipo AutoMarket', SYSTEM: 'Automático' } as const;

/**
 * Membresía: estado, días restantes, compra/renovación por periodo con Binance
 * (cobro único por periodo) e historial. Renovar el mismo plan acumula el tiempo.
 */
export function MembershipCenter() {
  const params = useSearchParams();
  const toast = useToast();
  const [cycle, setCycle] = useState<BillingCycle>(params.get('ciclo') === 'YEARLY' ? 'YEARLY' : 'MONTHLY');
  const status = useQuery({ queryKey: ['membership'], queryFn: () => api.get<MembershipStatusDTO>('/api/memberships/me') });
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<PlanDTO[]>('/api/public/plans') });
  const router = useRouter();
  const session = useSession();
  const accountType = session.status === 'authenticated' ? session.user.accountType : 'INDIVIDUAL';
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const checkout = useMutation({
    mutationFn: (planCode: PaidPlanCode) => api.post<PaymentDTO>('/api/memberships/checkout', { planCode, cycle, method }),
    onSuccess: payment => router.push(`/pagos/${payment.id}`),
    onError: err => toast({ tone: 'error', title: 'No se pudo iniciar el pago', description: err.message }),
  });

  if (status.isPending || plans.isPending) return <PageSpinner />;
  if (status.isError || plans.isError) return <p className="text-danger-fg">{(status.error ?? plans.error)?.message}</p>;
  const current = status.data;
  const highlighted = params.get('plan');

  return (
    <div className="space-y-10">
      <Card className="grid gap-6 p-6 sm:grid-cols-[1fr_auto] sm:p-8">
        <div>
          <p className="text-xs font-semibold text-muted">Tu plan</p>
          <p className="mt-2 flex items-center gap-2 font-display text-3xl">
            {current.plan.code === 'DEALER_PRO' && <Crown className="size-7 text-gold" />}
            {PLAN_LABELS[current.plan.code]}
            {current.cycle && <Badge tone="neutral">{CYCLE_LABELS[current.cycle]}</Badge>}
          </p>
          <p className="mt-2 text-sm text-muted">
            {current.expiresAt ? (
              <>
                Vigente hasta el <strong className="text-ink">{formatDate(current.expiresAt)}</strong> · quedan {current.daysRemaining} {current.daysRemaining === 1 ? 'día' : 'días'}
              </>
            ) : (
              'Plan gratuito sin vencimiento.'
            )}
          </p>
          {current.expiringSoon && (
            <p className="mt-3 flex items-center gap-2 rounded-md bg-gold/[0.07] px-4 py-3 text-sm">
              <AlarmClock className="size-4 text-gold-fg" /> Renueva ahora: al pagar el mismo plan, el nuevo periodo se suma al actual.
            </p>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-3 text-center sm:w-72">
          <div className="rounded-md bg-sunken p-4">
            <dt className="text-xs text-muted">Publicaciones activas</dt>
            <dd className="mt-1 font-display text-2xl">
              {current.activeListings}/{current.plan.maxActiveListings ?? '∞'}
            </dd>
          </div>
          <div className="rounded-md bg-sunken p-4">
            <dt className="text-xs text-muted">Destacados en uso</dt>
            <dd className="mt-1 font-display text-2xl">
              {current.featuredInUse}/{current.plan.featuredSlots}
            </dd>
          </div>
        </dl>
      </Card>

      <section>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <h2 className="font-display text-2xl">Cambiar o renovar</h2>
          <CycleToggle cycle={cycle} onChange={setCycle} />
        </div>
        <div className="mb-6 max-w-2xl">
          <MethodPicker value={method} onChange={setMethod} />
        </div>
        <p className="mb-4 text-sm text-muted">
          {accountType === 'DEALER' ? 'Planes para concesionarios: más anuncios, RIF visible y posicionamiento prioritario.' : 'Planes para personas naturales. ¿Eres un concesionario? Cámbialo en tu perfil para ver sus planes.'}
        </p>
        <PlanCards
          plans={plansFor(plans.data, accountType)}
          cycle={cycle}
          current={current.plan.code}
          action={plan =>
            plan.code === 'FREE' ? (
              <p className="text-center text-xs text-muted">{current.plan.code === 'FREE' ? 'Tu plan actual' : 'Al vencer tu plan vuelves al plan Gratis'}</p>
            ) : (
              <Button className="w-full" variant={plan.code === highlighted || plan.code === current.plan.code ? 'primary' : 'outline'} loading={checkout.isPending && checkout.variables === plan.code} disabled={!method} onClick={() => checkout.mutate(plan.code as PaidPlanCode)}>
                {plan.code === current.plan.code ? 'Renovar con Binance' : 'Pagar con Binance'}
              </Button>
            )
          }
        />
        <p className="mt-4 text-xs text-muted">
          Pago único por periodo ({cycle === 'MONTHLY' ? 'un mes' : 'un año'}) con Binance en USDT, sin renovaciones automáticas. Cambiar a otro plan empieza hoy y no acumula el tiempo restante del actual.
        </p>
      </section>

      {current.history.length > 0 && (
        <section>
          <h2 className="font-display text-xl">Historial</h2>
          <div className="mt-4 overflow-x-auto rounded-md border border-line">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="bg-sunken text-xs text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Plan</th>
                  <th className="px-4 py-3 font-semibold">Origen</th>
                  <th className="px-4 py-3 font-semibold">Desde</th>
                  <th className="px-4 py-3 font-semibold">Hasta</th>
                  <th className="px-4 py-3 text-right font-semibold">Importe</th>
                </tr>
              </thead>
              <tbody>
                {current.history.map(period => (
                  <tr key={period.id} className="border-t border-line">
                    <td className="px-4 py-3 font-semibold">
                      {PLAN_LABELS[period.planCode]} {period.cycle && <span className="font-normal text-muted">· {CYCLE_LABELS[period.cycle]}</span>}
                    </td>
                    <td className="px-4 py-3 text-muted">{SOURCE_LABELS[period.source]}</td>
                    <td className="px-4 py-3">{formatDate(period.startsAt)}</td>
                    <td className="px-4 py-3">{period.endsAt ? formatDate(period.endsAt) : '—'}</td>
                    <td className="px-4 py-3 text-right">{period.amount ? formatPrice(period.amount) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
