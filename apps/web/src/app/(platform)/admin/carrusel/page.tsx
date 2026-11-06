import type { Metadata } from 'next';
import { AdminCarousel } from '@/features/admin/components/AdminInventory';
import { PageHeader } from '@/shared/ui/card';

export const metadata: Metadata = { title: 'Carrusel de la landing' };

export default function Page() {
  return (
    <>
      <PageHeader eyebrow="Administración" title="Carrusel de la landing" description="Ordena la selección del equipo; los destacados de los planes Concesionario Básico y Pro aparecen después." />
      <AdminCarousel />
    </>
  );
}
