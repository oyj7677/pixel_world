import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@pixel-world/shared';

export type PixelSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface PixelSocketOptions {
  roomPublicId?: string;
  dailyCanvasId?: string;
  date?: 'today';
  inviteToken?: string;
}

export function createPixelSocket(options: PixelSocketOptions = {}) {
  return io(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000', {
    withCredentials: true,
    transports: ['websocket', 'polling'],
    query: options
  }) as PixelSocket;
}
