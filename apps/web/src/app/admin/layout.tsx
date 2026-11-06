import type { ReactNode } from 'react';
import { AdminShell } from '@/features/admin/components/AdminShell';
import { AuthGate } from '@/features/auth';

/**
 * Secciones nuevas del panel (misma URL /admin/…, mismo marco que app/(platform)/admin): viven
 * aquí para que sus archivos queden a pocas carpetas de la raíz del proyecto.
 */
export default function AdminExtraLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate role={['ADMIN', 'ADMIN_ONE', 'SUPERVISOR']} rolePaths={{ SUPERVISOR: ['/admin/reportes'] }}>
      <AdminShell>{children}</AdminShell>
    </AuthGate>
  );
}
