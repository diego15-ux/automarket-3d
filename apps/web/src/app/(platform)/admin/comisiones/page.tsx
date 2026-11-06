import type { Metadata } from 'next';
import { AdminCommissions } from '@/features/admin/components/AdminCommissions';
import { PageHeader } from '@/shared/ui/card';

export const metadata: Metadata = { title: 'Comisiones post-venta' };

export default function Page() {
  return (
    <>
      <PageHeader eyebrow="Administración" title="Comisiones post-venta" description="Comisiones de ventas concretadas pendientes de pago con Binance. Las vencidas bloquean al vendedor." />
      <AdminCommissions />
    </>
  );
}
