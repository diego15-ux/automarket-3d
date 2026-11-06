import type { AuthContext } from '../../shared/auth/token.service.js';

/**
 * Contrato tipado de eventos Socket.io: vive en @automarket/contracts y lo
 * importan tanto la API como el frontend.
 */
export type {
  AckResponse,
  ChatMessageDTO as MessageDTO,
  ClientToServerEvents,
  ServerToClientEvents,
} from '@automarket/contracts';

export type InterServerEvents = Record<string, never>;

export interface SocketData {
  user: AuthContext;
}
