import type { ReactNode } from 'react';
import { DealerShell } from '@/features/dealers/components/DealerShell';
import { AuthGate } from '@/features/auth';

/** Panel del concesionario: su propio marco (menú lateral oscuro en PC, barra inferior en el teléfono). */
export default function DealerLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <DealerShell>{children}</DealerShell>
    </AuthGate>
  );
}
