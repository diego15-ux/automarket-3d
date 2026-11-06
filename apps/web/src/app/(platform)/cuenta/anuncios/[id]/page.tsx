import type { Metadata } from 'next';
import { AuthGate } from '@/features/auth';
import { VehicleEditor } from '@/features/vehicles';
import { PageHeader } from '@/shared/ui/card';

export const metadata: Metadata = { title: 'Editar anuncio' };

export default async function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AuthGate>
      <PageHeader eyebrow="Vender" title="Tu anuncio" description="Completa la galería y publícalo cuando esté listo." />
      <VehicleEditor vehicleId={id} />
    </AuthGate>
  );
}
