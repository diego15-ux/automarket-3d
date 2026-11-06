import type { Metadata } from 'next';
import { DealersDirectory } from '@/features/dealers/components/DealersDirectory';

export const metadata: Metadata = {
  title: 'Concesionarios aliados',
  description: 'Agencias con RIF revisado por AutoMarket: su inventario, sus calificaciones y su chat.',
};

export default function DealersPage() {
  return <DealersDirectory />;
}
