import type { Metadata } from 'next';
import { AdminStats } from '@/features/admin/components/AdminStats';

export const metadata: Metadata = { title: 'Estadísticas' };

export default function StatsPage() {
  return <AdminStats />;
}
