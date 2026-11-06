import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPayments } from '@/features/admin/components/AdminPayments';
import { PageHeader } from '@/shared/ui/card';
import { PageSpinner } from '@/shared/ui/spinner';

export const metadata: Metadata = { title: 'Pagos con Binance' };

export default function Page() {
  return (
    <>
      <PageHeader eyebrow="Administración" title="Pagos con Binance" description="Verifica los pagos al Pay ID (importe y referencia en tu app de Binance) y registra los reembolsos enviados." />
      <Suspense fallback={<PageSpinner />}>
        <AdminPayments />
      </Suspense>
    </>
  );
}
