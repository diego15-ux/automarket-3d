import type { Metadata } from 'next';
import { SellerProfileView } from '@/features/users/SellerProfileView';

export const metadata: Metadata = { title: 'Perfil del vendedor' };

export default async function SellerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SellerProfileView id={id} />;
}
