import type { Metadata } from 'next';
import { AuthGate } from '@/features/auth';
import { MyListings } from '@/features/vehicles';
import { PageHeader } from '@/shared/ui/card';

export const metadata: Metadata = { title: 'Mis anuncios' };

export default function MyListingsPage() {
  return (
    <AuthGate>
      <PageHeader eyebrow="Vender" title="Mis anuncios" description="Publica, pausa, renueva o destaca tus vehículos según los límites de tu plan." />
      <MyListings />
    </AuthGate>
  );
}
