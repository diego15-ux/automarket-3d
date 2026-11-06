'use client';

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '@/shared/lib/use-session';
import { uploadToStorage } from '@/shared/lib/upload';
import { chatApi, chatKeys, MESSAGES_PAGE_SIZE } from '../api';
import { getChatSocket } from '../lib/socket';
import type { ChatMessage, MediaType, OutgoingMessage, SendMessagePayload } from '../types';
import { randomId } from '@/shared/lib/browser';

const ACK_TIMEOUT_MS = 15_000;
const TYPING_IDLE_MS = 3_000;
const TYPING_VISIBLE_MS = 4_500;

async function readImageSize(file: File): Promise<{ width: number; height: number } | undefined> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return undefined;
  }
}

/**
 * Estado completo de un hilo: historial paginado (REST) + mensajes en vivo (socket)
 * + bandeja de salida optimista con reintentos idempotentes (mismo clientId).
 * El componente que lo usa debe montarse con `key={conversationId}`.
 */
export function useConversation(conversationId: string) {
  const session = useSession();
  const me = session.status === 'authenticated' ? session.user.id : null;
  const queryClient = useQueryClient();

  const history = useInfiniteQuery({
    queryKey: chatKeys.messages(conversationId),
    queryFn: ({ pageParam }) => chatApi.messages(conversationId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: lastPage => (lastPage.length === MESSAGES_PAGE_SIZE ? lastPage.at(-1)?.createdAt : undefined),
    enabled: Boolean(me),
  });

  const [live, setLive] = useState<ChatMessage[]>([]);
  const [outbox, setOutbox] = useState<OutgoingMessage[]>([]);
  const [counterpartTyping, setCounterpartTyping] = useState(false);
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const outboxRef = useRef(outbox);
  useEffect(() => {
    outboxRef.current = outbox;
  });

  const refreshInbox = useCallback(() => void queryClient.invalidateQueries({ queryKey: chatKeys.conversations, exact: true }), [queryClient]);

  const markRead = useCallback(() => {
    getChatSocket().emit('message:read', { conversationId }, refreshInbox);
  }, [conversationId, refreshInbox]);

  // Socket: entrar al hilo (y volver a entrar tras cada reconexión) y escuchar sus eventos.
  useEffect(() => {
    if (!me) return;
    const socket = getChatSocket();
    let typingTimer: ReturnType<typeof setTimeout> | undefined;

    const join = () =>
      socket.emit('conversation:join', { conversationId }, response => {
        if (response.ok) markRead();
      });
    // Tras una reconexión pudo haber mensajes perdidos: resincronizamos el historial.
    const onConnect = () => {
      join();
      void queryClient.invalidateQueries({ queryKey: chatKeys.messages(conversationId) });
    };
    const onMessage = (message: ChatMessage) => {
      if (message.conversationId !== conversationId) return;
      setLive(previous => (previous.some(item => item.id === message.id) ? previous : [...previous, message]));
      if (message.senderId !== me) {
        setCounterpartTyping(false);
        if (document.visibilityState === 'visible') markRead();
      }
    };
    const onTyping = (event: { conversationId: string; userId: string; isTyping: boolean }) => {
      if (event.conversationId !== conversationId || event.userId === me) return;
      clearTimeout(typingTimer);
      setCounterpartTyping(event.isTyping);
      if (event.isTyping) typingTimer = setTimeout(() => setCounterpartTyping(false), TYPING_VISIBLE_MS);
    };
    const onRead = (event: { conversationId: string; userId: string; readAt: string }) => {
      if (event.conversationId === conversationId && event.userId !== me) setSeenAt(event.readAt);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && socket.connected) markRead();
    };

    socket.on('connect', onConnect);
    socket.on('message:new', onMessage);
    socket.on('typing', onTyping);
    socket.on('message:read', onRead);
    document.addEventListener('visibilitychange', onVisible);
    if (socket.connected) join();
    else socket.connect();

    return () => {
      clearTimeout(typingTimer);
      socket.off('connect', onConnect);
      socket.off('message:new', onMessage);
      socket.off('typing', onTyping);
      socket.off('message:read', onRead);
      document.removeEventListener('visibilitychange', onVisible);
      if (socket.connected) socket.emit('conversation:leave', { conversationId });
    };
  }, [conversationId, me, markRead, queryClient]);

  // Historial (páginas del más nuevo al más viejo) + vivos, sin duplicados y en orden cronológico.
  const messages = useMemo(() => {
    const byId = new Map<string, ChatMessage>();
    for (const page of history.data?.pages ?? []) for (const message of page) byId.set(message.id, message);
    for (const message of live) byId.set(message.id, message);
    return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [history.data, live]);

  const patchOutbox = useCallback((clientId: string, patch: Partial<OutgoingMessage>) => {
    setOutbox(previous => previous.map(item => (item.clientId === clientId ? { ...item, ...patch } : item)));
  }, []);

  const deliver = useCallback(
    async (message: OutgoingMessage) => {
      patchOutbox(message.clientId, { state: 'sending', error: undefined });
      try {
        let payload: SendMessagePayload;
        if (message.type === 'TEXT') {
          payload = { conversationId, clientId: message.clientId, type: 'TEXT', text: message.text ?? '' };
        } else {
          const { file } = message;
          if (!file) throw new Error('Falta el archivo.');
          let key = message.uploadedKey;
          if (!key) {
            // 1) URL prefirmada  2) subida directa a S3 con progreso  3) mensaje con la referencia
            const upload = await chatApi.requestUpload({ conversationId, type: message.type, mimeType: file.type, sizeBytes: file.size });
            await uploadToStorage(upload, file, progress => patchOutbox(message.clientId, { progress }));
            key = upload.key;
            patchOutbox(message.clientId, { uploadedKey: key });
          }
          payload = {
            conversationId,
            clientId: message.clientId,
            type: message.type,
            media: {
              key,
              mimeType: file.type,
              sizeBytes: file.size,
              ...(message.durationMs ? { durationMs: Math.round(message.durationMs) } : {}),
              ...(message.width && message.height ? { width: message.width, height: message.height } : {}),
            },
          };
        }

        const response = await getChatSocket().timeout(ACK_TIMEOUT_MS).emitWithAck('message:send', payload);
        if (!response.ok) throw new Error(response.error.message);

        setOutbox(previous => previous.filter(item => item.clientId !== message.clientId));
        setLive(previous => (previous.some(item => item.id === response.data.id) ? previous : [...previous, response.data]));
        if (message.previewUrl) URL.revokeObjectURL(message.previewUrl);
        refreshInbox();
      } catch (error) {
        const reason = error instanceof Error && error.message !== 'operation has timed out' ? error.message : 'Sin conexión con el servidor.';
        patchOutbox(message.clientId, { state: 'failed', error: reason });
      }
    },
    [conversationId, patchOutbox, refreshInbox],
  );

  const enqueue = useCallback(
    (partial: Omit<OutgoingMessage, 'clientId' | 'state' | 'createdAt'>) => {
      const message: OutgoingMessage = { ...partial, clientId: randomId(), state: 'sending', createdAt: new Date().toISOString() };
      setOutbox(previous => [...previous, message]);
      void deliver(message);
    },
    [deliver],
  );

  // "Escribiendo…": como mucho un aviso cada 2,5 s y un "dejó de escribir" tras 3 s sin teclear.
  const typing = useRef<{ active: boolean; lastSent: number; timer?: ReturnType<typeof setTimeout> }>({ active: false, lastSent: 0 });
  const stopTyping = useCallback(() => {
    clearTimeout(typing.current.timer);
    if (typing.current.active) getChatSocket().emit('typing', { conversationId, isTyping: false });
    typing.current.active = false;
  }, [conversationId]);
  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (!typing.current.active || now - typing.current.lastSent > 2_500) {
      getChatSocket().emit('typing', { conversationId, isTyping: true });
      typing.current = { ...typing.current, active: true, lastSent: now };
    }
    clearTimeout(typing.current.timer);
    typing.current.timer = setTimeout(stopTyping, TYPING_IDLE_MS);
  }, [conversationId, stopTyping]);

  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      stopTyping();
      enqueue({ type: 'TEXT', text: trimmed });
    },
    [enqueue, stopTyping],
  );

  const sendFile = useCallback(
    async (file: File, extra: { durationMs?: number } = {}) => {
      const type: MediaType = file.type.startsWith('image/') ? 'IMAGE' : file.type.startsWith('video/') ? 'VIDEO' : 'AUDIO';
      const size = type === 'IMAGE' ? await readImageSize(file) : undefined;
      enqueue({ type, file, previewUrl: URL.createObjectURL(file), durationMs: extra.durationMs, ...size });
    },
    [enqueue],
  );

  const retry = useCallback(
    (clientId: string) => {
      const message = outboxRef.current.find(item => item.clientId === clientId);
      if (message) void deliver(message);
    },
    [deliver],
  );

  const discard = useCallback((clientId: string) => {
    setOutbox(previous => {
      const message = previous.find(item => item.clientId === clientId);
      if (message?.previewUrl) URL.revokeObjectURL(message.previewUrl);
      return previous.filter(item => item.clientId !== clientId);
    });
  }, []);

  return {
    me,
    messages,
    outbox,
    counterpartTyping,
    seenAt,
    isPending: history.isPending,
    error: history.error,
    hasOlder: history.hasNextPage,
    loadingOlder: history.isFetchingNextPage,
    loadOlder: history.fetchNextPage,
    sendText,
    sendFile,
    retry,
    discard,
    notifyTyping,
  };
}
