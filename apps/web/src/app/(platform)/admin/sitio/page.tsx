import type { Metadata } from 'next';
import { AdminSiteSettings } from '@/features/admin/components/AdminSiteSettings';
import { PageHeader } from '@/shared/ui/card';

export const metadata: Metadata = { title: 'Portada, login y Términos' };

export default function Page() {
  return (
    <>
      <PageHeader eyebrow="Administración" title="Login y Términos" description="Imagen de fondo del login (se guarda en MySQL) y editor de los Términos y Condiciones." />
      <AdminSiteSettings />
    </>
  );
}
