import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import jwt from 'jsonwebtoken';
import { createClient } from 'redis';
import type { PublicServerToClientEvents } from '@automarket/contracts';
import { Server, type Namespace, type Socket } from 'socket.io';
import { env } from '../config/env.js';
import { registerChatHandlers, userRoom, type ChatServer } from '../modules/chat/chat.gateway.js';
import { ACCESS_TOKEN_COOKIE, verifyAccessToken } from '../shared/auth/token.service.js';
import { readPublicStats, realtime } from '../shared/realtime.js';

/** Token desde `io(url, { auth: { token } })` o, en web, desde la cookie httpOnly. */
function readHandshakeToken(handshake: Socket['handshake']): string | null {
  const fromAuth: unknown = handshake.auth['token'];
  if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;

  for (const part of (handshake.headers.cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === ACCESS_TOKEN_COOKIE) return decodeURIComponent(value.join('='));
  }
  return null;
}

/** El cliente recibe `connect_error` con err.message y err.data.code. */
function handshakeError(code: 'AUTH_REQUIRED' | 'TOKEN_EXPIRED' | 'INVALID_TOKEN') {
  return Object.assign(new Error(code), { data: { code } });
}

export async function createSocketServer(httpServer: HttpServer): Promise<ChatServer> {
  const io: ChatServer = new Server(httpServer, {
    cors: { origin: env.CORS_ORIGINS, credentials: true },
    // Por el socket solo viajan JSON pequeños; los binarios van directo a S3.
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  // Escalado horizontal: con Redis, un emit llega a sockets conectados a otras instancias.
  if (env.REDIS_URL) {
    const pubClient = createClient({ url: env.REDIS_URL });
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
  }

  // Espacio público /public (sin sesión): contadores en vivo de la landing. El middleware
  // de autenticación de abajo solo aplica al namespace principal.
  const publicNs = io.of('/public') as unknown as Namespace<Record<string, never>, PublicServerToClientEvents>;
  publicNs.on('connection', socket => {
    readPublicStats()
      .then(stats => socket.emit('stats', stats))
      .catch(err => console.error('[realtime] stats', err));
  });
  realtime.attach(io as unknown as Server, publicNs as unknown as Namespace);

  // Autenticación en el handshake: ningún socket anónimo llega a los handlers.
  io.use((socket, next) => {
    const token = readHandshakeToken(socket.handshake);
    if (!token) return next(handshakeError('AUTH_REQUIRED'));
    try {
      socket.data.user = verifyAccessToken(token);
      next();
    } catch (err) {
      next(handshakeError(err instanceof jwt.TokenExpiredError ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN'));
    }
  });

  io.on('connection', socket => {
    const { user } = socket.data;
    void socket.join(userRoom(user.id));

    // Cuando el JWT caduca cerramos la conexión: el cliente reconecta con un token renovado.
    const expiryTimer = setTimeout(() => socket.disconnect(true), Math.max(0, user.exp * 1000 - Date.now()));
    socket.on('disconnect', () => clearTimeout(expiryTimer));

    registerChatHandlers(io, socket);
  });

  return io;
}
