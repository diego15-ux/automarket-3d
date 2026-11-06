import type { Metadata } from 'next';
import { AuthGate } from '@/features/auth';
import { KycCenter } from '@/features/kyc';
import { PageHeader } from '@/shared/ui/card';

export const metadata: Metadata = { title: 'Verificación de identidad' };

export default function VerificationPage() {
  return (
    <>
      <PageHeader eyebrow="Seguridad" title="Verificación de identidad" description="Para publicar vehículos verificamos tu identidad una sola vez. Así protegemos a compradores y vendedores." />
      <AuthGate>
        <KycCenter />
      </AuthGate>
    </>
  );
}
