import type { Metadata } from 'next';
import { AdminModeration } from '@/features/admin/components/AdminModeration';
import { PageHeader } from '@/shared/ui/card';

export const metadata: Metadata = { title: 'Moderación' };

export default function Page() {
  return (
    <>
      <PageHeader eyebrow="Administración" title="Moderación" description="Reseñas por aprobar y mensajes del formulario de contacto." />
      <AdminModeration />
    </>
  );
}
