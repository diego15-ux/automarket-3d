import type { Metadata } from 'next';
import { AdminInventory } from '@/features/admin/components/AdminInventory';
import { PageHeader } from '@/shared/ui/card';

export const metadata: Metadata = { title: 'Inventario' };

export default function Page() {
  return (
    <>
      <PageHeader eyebrow="Administración" title="Inventario" description="Todos los anuncios: filtra por estado, retira contenido y añade vehículos al carrusel." />
      <AdminInventory />
    </>
  );
}
