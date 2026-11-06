'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { DealerPublicPage } from '@/features/dealers/components/DealerPublicPage';
import { buttonClasses } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/card';
import { PageSpinner } from '@/shared/ui/spinner';
import { usersApi } from './api';
import { PublicProfile } from './PublicProfile';

/** Página pública del vendedor (/vendedores/[id]); si es concesionario, la página de la agencia. */
export function SellerProfileView({ id }: { id: string }) {
  const profile = useQuery({ queryKey: ['seller-profile', id], queryFn: () => usersApi.sellerProfile(id) });
  if (profile.isPending) return <PageSpinner />;
  if (profile.isError) {
    return (
      <EmptyState
        title="No pudimos cargar el perfil"
        description={profile.error.message}
        action={
          <Link href="/vehiculos" className={buttonClasses({ variant: 'outline' })}>
            Volver al catálogo
          </Link>
        }
      />
    );
  }
  // Los concesionarios tienen su propia página (portada, inventario, reseñas e información).
  if (profile.data.accountType === 'DEALER') return <DealerPublicPage id={id} />;
  return (
    <div data-own-header className="mx-auto max-w-[1180px]">
      <PublicProfile profile={profile.data} />
    </div>
  );
}
