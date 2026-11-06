'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useSession } from '@/shared/lib/use-session';
import { PageSpinner } from '@/shared/ui/spinner';

/** Publicar o reservar exige país y ciudad: las cuentas de Google/Apple los completan primero. */
export function RequireProfile({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const needsProfile = session.status === 'authenticated' && session.user.needsProfile;

  useEffect(() => {
    if (needsProfile) router.replace(`/cuenta/perfil?next=${encodeURIComponent(pathname)}`);
  }, [needsProfile, pathname, router]);

  if (session.status !== 'authenticated' || needsProfile) return <PageSpinner label="Comprobando tu perfil…" />;
  return children;
}
