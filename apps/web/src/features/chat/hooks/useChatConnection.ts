'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSession } from '@/shared/lib/use-session';
import { chatApi, chatKeys } from '../api';
import { disconnectChatSocket, getChatSocket } from '../lib/socket';

/**
 * Mantiene el socket conectado mientras haya sesión y refresca la bandeja cuando
 * llega un mensaje nuevo. Se monta una vez en el layout de la plataforma.
 */
export function useChatConnection() {
  const session = useSession();
  const queryClient = useQueryClient();
  const authenticated = session.status === 'authenticated';

  useEffect(() => {
    if (!authenticated) {
      disconnectChatSocket();
      return;
    }
    const socket = getChatSocket();
    const refreshInbox = () => void queryClient.invalidateQueries({ queryKey: chatKeys.conversations, exact: true });
    // Cambió el trato (reserva, negociación, venta): bandeja, panel «El trato» y reservas.
    const refreshDeal = ({ conversationId }: { conversationId: string }) => {
      refreshInbox();
      void queryClient.invalidateQueries({ queryKey: chatKeys.deal(conversationId) });
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    };
    socket.on('inbox:updated', refreshInbox);
    socket.on('message:new', refreshInbox);
    socket.on('deal:updated', refreshDeal);
    socket.connect();
    return () => {
      socket.off('inbox:updated', refreshInbox);
      socket.off('message:new', refreshInbox);
      socket.off('deal:updated', refreshDeal);
    };
  }, [authenticated, queryClient]);
}

/** Bandeja de entrada (compartida por la cabecera y la vista de mensajes). */
export function useConversations() {
  const session = useSession();
  return useQuery({ queryKey: chatKeys.conversations, queryFn: chatApi.list, enabled: session.status === 'authenticated' });
}

export function useUnreadCount() {
  const { data } = useConversations();
  return data?.filter(conversation => conversation.unread).length ?? 0;
}
