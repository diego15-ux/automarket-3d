import type { Metadata } from 'next';
import { AdminPlans } from '@/features/admin/components/AdminPlans';
import { PageHeader } from '@/shared/ui/card';

export const metadata: Metadata = { title: 'Planes y ajustes' };

export default function Page() {
  return (
    <>
      <PageHeader eyebrow="Administración" title="Planes y ajustes" description="Precios, cupo de anuncios y comisión post-venta por plan; plazos de las reservas P2P y de la comisión." />
      <AdminPlans />
    </>
  );
}
