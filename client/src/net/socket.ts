import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@kh/shared';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function connectSocket(token: string): GameSocket {
  return io({
    auth: { token },
    transports: ['websocket'],
    reconnectionDelay: 500,
    reconnectionDelayMax: 3000,
  });
}
