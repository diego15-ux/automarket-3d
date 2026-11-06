import type { Metadata } from 'next';
import { Suspense } from 'react';
import { VehicleSearch } from '@/features/vehicles';
import { PageHeader } from '@/shared/ui/card';
import { PageSpinner } from '@/shared/ui/spinner';

export const metadata: Metadata = { title: 'Catálogo de vehículos' };

export default function VehiclesPage() {
  return (
    <>
      <PageHeader eyebrow="Catálogo" title="Encuentra tu próximo auto" description="Filtra por marca, modelo, año, precio, condición, dueños y ubicación. Te mostramos primero lo que está cerca de ti." />
      {/* useSearchParams (filtros en la URL) exige un límite de Suspense. */}
      <Suspense fallback={<PageSpinner />}>
        <VehicleSearch />
      </Suspense>
    </>
  );
}
