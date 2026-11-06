import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthGate } from '@/features/auth';
import { VehicleCompare } from '@/features/vehicles/components/VehicleCompare';
import { PageSpinner } from '@/shared/ui/spinner';

export const metadata: Metadata = { title: 'Comparar autos' };

/** Como la ficha completa, el comparador es para personas con sesión. */
export default function ComparePage() {
  return (
    <AuthGate>
      {/* useSearchParams (?autos=…) exige un límite de Suspense. */}
      <Suspense fallback={<PageSpinner />}>
        <VehicleCompare />
      </Suspense>
    </AuthGate>
  );
}
