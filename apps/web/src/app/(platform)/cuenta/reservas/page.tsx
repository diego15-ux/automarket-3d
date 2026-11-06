import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthGate } from '@/features/auth';
import { ReservationsCenter } from '@/features/reservations';
import { PageHeader } from '@/shared/ui/card';
import { PageSpinner } from '@/shared/ui/spinner';

export const metadata: Metadata = { title: 'Reservas' };

export default function ReservationsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Compras y ventas"
        title="Mis reservas"
        description="Pides la reserva y el vendedor la confirma. El abono lo fija el vendedor y se lo pagas directamente a él: AutoMarket no lo cobra ni lo guarda. Si la reserva se cancela, el vendedor devuelve el 100 %."
      />
      <AuthGate>
        <Suspense fallback={<PageSpinner />}>
          <ReservationsCenter />
        </Suspense>
      </AuthGate>
    </>
  );
}
