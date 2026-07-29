import type { ServerToClient } from '@babymon/shared';
import { RateLimiter } from '../src/ratelimit.js';
import { RoomRegistry, type PeerSocket } from '../src/rooms.js';
import { SignalingHub } from '../src/signaling.js';
import type { TurnConfig } from '../src/turn.js';

export class FakeSocket implements PeerSocket {
  sent: ServerToClient[] = [];
  closed = false;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ServerToClient);
  }

  close(): void {
    this.closed = true;
  }

  /** Messages of a given type, for terse assertions. */
  ofType<T extends ServerToClient['t']>(t: T): Extract<ServerToClient, { t: T }>[] {
    return this.sent.filter((m): m is Extract<ServerToClient, { t: T }> => m.t === t);
  }

  last(): ServerToClient | undefined {
    return this.sent[this.sent.length - 1];
  }
}

export const TEST_TURN: TurnConfig = {
  stunUrls: ['stun:stun.example.org'],
  turnUrls: [],
  turnSecret: null,
  ttlSeconds: 3600,
};

export function makeHub(opts: { limiter?: RateLimiter; turn?: TurnConfig } = {}) {
  const rooms = new RoomRegistry();
  const limiter = opts.limiter ?? new RateLimiter(1000, 1000);
  const hub = new SignalingHub(rooms, limiter, opts.turn ?? TEST_TURN);
  return { hub, rooms, limiter };
}

export const CODE = 'aaaa-bbbb-cccc-dddd-eeee';
export const CODE2 = '1111-2222-3333-4444-5555';

type Hub = ReturnType<typeof makeHub>['hub'];

export function connectAndSend(hub: Hub, socket: FakeSocket, ip: string, msg: unknown) {
  const conn = hub.connect(socket, ip);
  hub.message(conn, JSON.stringify(msg));
  return conn;
}
