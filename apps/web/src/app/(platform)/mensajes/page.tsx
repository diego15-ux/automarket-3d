import type { Metadata } from 'next';
import { AuthGate } from '@/features/auth';
import { ChatShell } from '@/features/chat';

export const metadata: Metadata = { title: 'Mensajes' };

export default function MessagesPage() {
  return (
    <AuthGate>
      <ChatShell />
    </AuthGate>
  );
}
