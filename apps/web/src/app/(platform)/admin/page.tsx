import type { Metadata } from 'next';
import { AdminDashboard } from '@/features/admin/components/AdminDashboard';

export const metadata: Metadata = { title: 'Resumen' };

/** Portada del panel (diseño «admin-resumen»): la pantalla trae su propia cabecera. */
export default function Page() {
  return <AdminDashboard />;
}
