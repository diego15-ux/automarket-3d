import type { Metadata } from 'next';
import { AdminUsers } from '@/features/admin/components/AdminUsers';
import { PageHeader } from '@/shared/ui/card';

export const metadata: Metadata = { title: 'Usuarios y membresías' };

export default function Page() {
  return (
    <>
      <PageHeader eyebrow="Administración" title="Usuarios y membresías" description="Busca usuarios, suspende cuentas y activa o renueva membresías manualmente." />
      <AdminUsers />
    </>
  );
}
