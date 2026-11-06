import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthGate } from '@/features/auth';
import { PaymentView } from '@/features/payments/components/PaymentView';
import { PageHeader } from '@/shared/ui/card';
import { PageSpinner } from '@/shared/ui/spinner';

export const metadata: Metadata = { title: 'Pago con Binance' };

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AuthGate>
      <PageHeader eyebrow="Pago con Binance" title="Completa tu pago" />
      <Suspense fallback={<PageSpinner />}>
        <PaymentView paymentId={id} />
      </Suspense>
    </AuthGate>
  );
}
