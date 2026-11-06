'use client';

import { PAYMENT_STATUS_LABELS, type PaymentStatus } from '@automarket/contracts';
import { useQuery } from '@tanstack/react-query';
import { Phone } from 'lucide-react';
import { formatDate, formatMoney } from '@/shared/lib/format';
import { Badge } from '@/shared/ui/badge';
import { Card, EmptyState } from '@/shared/ui/card';
import { PageSpinner } from '@/shared/ui/spinner';
import { adminApi } from '../api';

/**
 * Comisiones post-venta sin pagar. Los pagos con Pay ID se aprueban en «Pagos Binance»; una
 * comisión vencida bloquea al vendedor para publicar y reservar.
 */
export function AdminCommissions() {
  const commissions = useQuery({ queryKey: ['admin', 'commissions'], queryFn: adminApi.commissions, refetchInterval: 60_000 });
  if (commissions.isPending) return <PageSpinner />;
  if (commissions.isError) return <p className="text-danger-fg">{commissions.error.message}</p>;
  if (commissions.data.length === 0) return <EmptyState title="No hay comisiones pendientes" description="Cuando un vendedor marque una venta como concretada, su comisión aparecerá aquí hasta que la pague." />;

  const overdue = commissions.data.filter(item => item.overdue);
  const total = (items: typeof commissions.data) => items.reduce((acc, item) => acc + Number(item.commissionAmount), 0);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <p className="text-xs text-muted">Pendientes de cobro</p>
          <p className="mt-2 font-display text-2xl">{formatMoney(total(commissions.data))}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-muted">Vencidas ({overdue.length})</p>
          <p className="mt-2 font-display text-2xl text-danger-fg">{formatMoney(total(overdue))}</p>
        </Card>
      </div>
      <ul className="space-y-3">
        {commissions.data.map(item => (
        <li key={`${item.recordType}-${item.recordId}`}>
            <Card className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{item.vehicleTitle}</p>
                  <p className="text-xs text-muted">
                    {item.seller.businessName ? `${item.seller.businessName} · ` : ''}
                    {item.seller.name} · {item.seller.email}
                    {item.seller.phone && (
                      <>
                        {' · '}
                        <Phone className="inline size-3" /> {item.seller.phone}
                      </>
                    )}
                  </p>
                </div>
                <Badge tone={item.overdue ? 'danger' : 'gold'}>
                  {item.overdue ? 'Vencida' : item.payment?.status === 'SUBMITTED' ? 'En revisión' : item.recordType === 'VEHICLE_SALE' ? 'Pago antes de finalizar' : 'Pendiente'}
                </Badge>
              </div>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted">Comisión</dt>
                  <dd className="font-mono font-semibold">{formatMoney(item.commissionAmount, item.currency)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Precio de venta</dt>
                  <dd>{formatMoney(item.salePrice, item.currency)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">{item.recordType === 'VEHICLE_SALE' ? 'Venta reportada' : 'Venta / vence'}</dt>
                  <dd>
                    {item.recordType === 'VEHICLE_SALE' ? formatDate(item.completedAt) : `${formatDate(item.completedAt)} → ${formatDate(item.commissionDueAt)}`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Último pago</dt>
                  <dd>{item.payment ? `${PAYMENT_STATUS_LABELS[item.payment.status as PaymentStatus] ?? item.payment.status} · ${item.payment.reference}` : 'Sin intentos'}</dd>
                </div>
              </dl>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
