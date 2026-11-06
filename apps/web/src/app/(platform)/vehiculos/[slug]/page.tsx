import type { Metadata } from 'next';
import { AuthGate } from '@/features/auth';
import { VehicleDetailView } from '@/features/vehicles';

export const metadata: Metadata = { title: 'Ficha del vehículo' };

/** La ficha completa es privada: la barrera de la landing, ahora con sesión real. */
export default async function VehiclePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <AuthGate>
      <VehicleDetailView slug={slug} />
    </AuthGate>
  );
}
