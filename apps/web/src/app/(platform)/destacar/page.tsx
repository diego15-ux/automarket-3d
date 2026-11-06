import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthGate } from '@/features/auth';
import { BoostWizard } from '@/features/boosts/components/BoostWizard';

export const metadata: Metadata = { title: 'Destacar anuncio' };

export default function BoostPage() {
  return (
    <AuthGate>
      <Suspense>
        <BoostWizard />
      </Suspense>
    </AuthGate>
  );
}
