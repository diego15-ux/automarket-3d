import type { Metadata } from 'next';
import { DealerCopilot } from '@/features/dealers/components/DealerCopilot';

export const metadata: Metadata = { title: 'Copiloto para agencias' };

export default function DealerCopilotPage() {
  return <DealerCopilot />;
}
