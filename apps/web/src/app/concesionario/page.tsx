import type { Metadata } from 'next';
import { DealerDashboard } from '@/features/dealers/components/DealerDashboard';

export const metadata: Metadata = { title: 'Panel del concesionario' };

export default function DealerPanelPage() {
  return <DealerDashboard />;
}
