import type { Metadata } from 'next';
import { AdminLoginSpots } from '@/features/boosts/components/AdminLoginSpots';

export const metadata: Metadata = { title: 'Pantalla de entrada' };

export default function LoginSpotsPage() {
  return <AdminLoginSpots />;
}
