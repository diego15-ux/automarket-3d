import type { ReactNode } from 'react';
import { AdminShell } from '@/features/admin/components/AdminShell';
import { AuthGate } from '@/features/auth';

/** Panel con su propio marco (menú lateral negro de los diseños). El supervisor solo entra a KYC y reportes; la API vuelve a validar cada permiso. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate role={['ADMIN', 'ADMIN_ONE', 'SUPERVISOR']} rolePaths={{ SUPERVISOR: ['/admin/kyc', '/admin/moderacion'] }}>
      <AdminShell>{children}</AdminShell>
    </AuthGate>
  );
}
