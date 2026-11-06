import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthGate } from '@/features/auth';
import { MembershipCenter } from '@/features/memberships/components/MembershipCenter';
import { PageHeader } from '@/shared/ui/card';
import { PageSpinner } from '@/shared/ui/spinner';

export const metadata: Metadata = { title: 'Mi membresía' };

export default function MembershipPage() {
  return (
    <AuthGate>
      <PageHeader eyebrow="Membresía" title="Tu plan" description="Publicar es gratis con 1 anuncio. Mejora tu plan para más publicaciones, menos comisión y prioridad en búsquedas. Pago con Binance." />
      <Suspense fallback={<PageSpinner />}>
        <MembershipCenter />
      </Suspense>
    </AuthGate>
  );
}
