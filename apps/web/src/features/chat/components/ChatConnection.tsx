'use client';

import { useChatConnection } from '../hooks/useChatConnection';

/** Monta la conexión en tiempo real (una vez, en el layout de la plataforma). */
export function ChatConnection() {
  useChatConnection();
  return null;
}
