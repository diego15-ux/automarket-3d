import type { Metadata } from 'next';
import { AdminCopilot } from '@/features/admin/components/AdminCopilot';

export const metadata: Metadata = { title: 'Copiloto del admin' };

export default function CopilotPage() {
  return <AdminCopilot />;
}
