import type { Metadata } from 'next';
import { AuthGate } from '@/features/auth';
import { ChatShell } from '@/features/chat';

export const metadata: Metadata = { title: 'Mensajes' };

export default async function ConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  return (
    <AuthGate>
      <ChatShell activeId={conversationId} />
    </AuthGate>
  );
}
