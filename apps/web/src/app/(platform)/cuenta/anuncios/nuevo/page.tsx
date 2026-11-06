import type { Metadata } from 'next';
import { AuthGate } from '@/features/auth';
import { RequireProfile } from '@/features/auth/components/RequireProfile';
import { VehicleEditor } from '@/features/vehicles';
import { PageHeader } from '@/shared/ui/card';

export const metadata: Metadata = { title: 'Publicar un vehículo' };

export default function NewListingPage() {
  return (
    <AuthGate>
      <RequireProfile>
        <PageHeader eyebrow="Vender" title="Publica tu vehículo" description="Tú fijas el precio y la ficha técnica. Después sube hasta 10 fotos o vídeos y publícalo." />
        <VehicleEditor />
      </RequireProfile>
    </AuthGate>
  );
}
