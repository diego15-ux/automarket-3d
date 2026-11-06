import type { Metadata } from 'next';
import { AdminReports } from '@/features/admin/components/AdminReports';

export const metadata: Metadata = { title: 'Reportes' };

export default function ReportsPage() {
  return <AdminReports />;
}
