import type { AuthContext } from '../shared/auth/token.service.js';

declare global {
  namespace Express {
    interface Request {
      /** Identidad autenticada; la rellena el middleware `authenticate`. */
      auth?: AuthContext;
      /** Cuerpo original sin parsear: solo en webhooks, para verificar la firma de Binance Pay. */
      rawBody?: Buffer;
    }
  }
}

export {};
