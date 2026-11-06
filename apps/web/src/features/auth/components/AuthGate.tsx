'use client';

import { ShieldAlert } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import type { Role } from '@/shared/lib/session';
import { useSession } from '@/shared/lib/use-session';
import { EmptyState } from '@/shared/ui/card';
import { PageSpinner } from '@/shared/ui/spinner';

/**
 * Protege vistas privadas en el cliente: espera a conocer la sesión y, si no hay,
 * envía al login con `next`. (El proxy ya filtra la primera carga sin cookie.)
 */
export function AuthGate({ children, role, rolePaths }: { children: ReactNode; role?: Role | Role[]; rolePaths?: Partial<Record<Role, string[]>> }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (session.status === 'anonymous') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    if (session.status === 'authenticated' && rolePaths?.[session.user.role]) {
      const allowed = rolePaths[session.user.role]!.some(path => pathname === path || pathname.startsWith(`${path}/`));
      if (!allowed) router.replace(rolePaths[session.user.role]![0]!);
    }
  }, [session.status, pathname, router, rolePaths]);

  if (session.status !== 'authenticated') return <PageSpinner label="Comprobando tu sesión…" />;
  if (role && !(Array.isArray(role) ? role.includes(session.user.role) : session.user.role === role)) {
    return <EmptyState icon={<ShieldAlert className="size-6" />} title="No tienes acceso a esta sección" description="Esta área es exclusiva del equipo de cumplimiento." />;
  }
  if (rolePaths?.[session.user.role] && !rolePaths[session.user.role]!.some(path => pathname === path || pathname.startsWith(`${path}/`))) {
    return <PageSpinner label="Abriendo tu área de trabajo…" />;
  }
  return children;
}
