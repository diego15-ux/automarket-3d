import type { Metadata } from 'next';
import { AlertsCenter } from '@/features/alerts/components/AlertsCenter';
import { AuthGate } from '@/features/auth';

export const metadata: Metadata = { title: 'Mis alertas' };

export default function AlertsPage() {
  return (
    <AuthGate>
      <AlertsCenter />
    </AuthGate>
  );
}
