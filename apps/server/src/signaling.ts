import {
  CAMERA_PEER_ID,
  clientToServer,
  isValidRoomCode,
  type ServerToClient,
} from '@babymon/shared';
import { RateLimiter } from './ratelimit.js';
import { RoomRegistry, type PeerSocket, type Room } from './rooms.js';
import { mintIceServers, type TurnConfig } from './turn.js';

// Mobile browsers kill pages without closing sockets; keep the ghost window
// short so a dead viewer frees its room slot quickly.
const HEARTBEAT_INTERVAL_MS = 10_000;
const STALE_AFTER_MS = 30_000;

interface Connection {
  socket: PeerSocket;
  ip: string;
  role: 'camera' | 'viewer' | null;
  room: Room | null;
  peerId: string | null; // set for viewers
  viewerId: string | null; // stable per-browser id, set for viewers
  lastSeen: number;
}

function send(socket: PeerSocket, msg: ServerToClient): void {
  try {
    socket.send(JSON.stringify(msg));
  } catch {
    // Socket already dying; reaper will clean up.
  }
}

/**
 * Room-scoped signaling relay. Transport-agnostic: the WS adapter hands each
 * connection to `connect()` and forwards raw messages / close events.
 */
export class SignalingHub {
  private connections = new Set<Connection>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly rooms: RoomRegistry,
    private readonly limiter: RateLimiter,
    private readonly turn: TurnConfig,
    private readonly now: () => number = Date.now,
  ) {}

  connect(socket: PeerSocket, ip: string): Connection {
    const conn: Connection = {
      socket,
      ip,
      role: null,
      room: null,
      peerId: null,
      viewerId: null,
      lastSeen: this.now(),
    };
    this.connections.add(conn);
    return conn;
  }

  message(conn: Connection, raw: string): void {
    conn.lastSeen = this.now();

    let msg;
    try {
      msg = clientToServer.parse(JSON.parse(raw));
    } catch {
      send(conn.socket, { t: 'error', message: 'malformed message' });
      return;
    }

    switch (msg.t) {
      case 'pong':
        return;
      case 'host':
        return this.handleHost(conn, msg.code);
      case 'join':
        return this.handleJoin(conn, msg.code, msg.viewerId ?? null);
      case 'signal':
        return this.handleSignalToViewer(conn, msg.peerId, msg.data);
      case 'signal-camera':
        return this.handleSignalToCamera(conn, msg.data);
      case 'regenerate':
        return this.handleRegenerate(conn, msg.code);
    }
  }

  private handleHost(conn: Connection, code: string): void {
    if (conn.role !== null) {
      send(conn.socket, { t: 'error', message: 'already in a room' });
      return;
    }
    if (!this.limiter.allow(conn.ip)) {
      send(conn.socket, { t: 'rejected', reason: 'rate-limited' });
      return;
    }
    if (!isValidRoomCode(code)) {
      send(conn.socket, { t: 'rejected', reason: 'bad-code' });
      return;
    }

    const { room, replacedCamera } = this.rooms.host(code, conn.socket);
    conn.role = 'camera';
    conn.room = room;

    if (replacedCamera) {
      // The old camera connection (refreshed page / rebooted phone) must not
      // tear the room down when its socket closes.
      const old = this.findBySocket(replacedCamera);
      if (old) {
        old.room = null;
        old.role = null;
      }
      send(replacedCamera, { t: 'kicked', reason: 'replaced' });
      replacedCamera.close();
      for (const viewer of room.viewers.values()) {
        send(viewer, { t: 'camera-restarted' });
      }
    }

    send(conn.socket, { t: 'hosted', iceServers: mintIceServers(this.turn, this.now) });
    // Tell the (possibly new) camera about viewers already waiting.
    for (const peerId of room.viewers.keys()) {
      send(conn.socket, { t: 'viewer-joined', peerId });
    }
    this.broadcastRoster(room);
  }

  private handleJoin(conn: Connection, code: string, viewerId: string | null): void {
    if (conn.role !== null) {
      send(conn.socket, { t: 'error', message: 'already in a room' });
      return;
    }
    if (!this.limiter.allow(conn.ip)) {
      send(conn.socket, { t: 'rejected', reason: 'rate-limited' });
      return;
    }
    if (!isValidRoomCode(code)) {
      send(conn.socket, { t: 'rejected', reason: 'bad-code' });
      return;
    }

    // Ghost-busting: the same browser rejoining evicts its previous
    // connection (mobile browsers kill pages without closing sockets, and the
    // corpse would otherwise hold a viewer slot until the reaper runs).
    if (viewerId) {
      for (const other of [...this.connections]) {
        if (other !== conn && other.role === 'viewer' && other.viewerId === viewerId) {
          send(other.socket, { t: 'kicked', reason: 'replaced' });
          this.close(other);
          other.socket.close();
        }
      }
    }
    conn.viewerId = viewerId;

    const result = this.rooms.join(code, conn.socket);
    if (!result.ok) {
      send(conn.socket, { t: 'rejected', reason: result.reason });
      return;
    }

    conn.role = 'viewer';
    conn.room = result.room;
    conn.peerId = result.peerId;
    send(conn.socket, {
      t: 'joined',
      peerId: result.peerId,
      iceServers: mintIceServers(this.turn, this.now),
    });
    send(result.room.camera, { t: 'viewer-joined', peerId: result.peerId });
    this.broadcastRoster(result.room);
  }

  private handleSignalToViewer(conn: Connection, peerId: string, data: unknown): void {
    if (conn.role !== 'camera' || !conn.room) return;
    const viewer = conn.room.viewers.get(peerId);
    if (!viewer) return;
    send(viewer, { t: 'signal', from: CAMERA_PEER_ID, data });
  }

  private handleSignalToCamera(conn: Connection, data: unknown): void {
    if (conn.role !== 'viewer' || !conn.room || !conn.peerId) return;
    send(conn.room.camera, { t: 'signal', from: conn.peerId, data });
  }

  private handleRegenerate(conn: Connection, newCode: string): void {
    if (conn.role !== 'camera' || !conn.room) {
      send(conn.socket, { t: 'error', message: 'not hosting' });
      return;
    }
    if (!isValidRoomCode(newCode)) {
      send(conn.socket, { t: 'error', message: 'invalid code' });
      return;
    }
    for (const viewer of conn.room.viewers.values()) {
      send(viewer, { t: 'kicked', reason: 'regenerated' });
      viewer.close();
    }
    this.rooms.regenerate(conn.room, newCode);
    send(conn.socket, { t: 'hosted', iceServers: mintIceServers(this.turn, this.now) });
    this.broadcastRoster(conn.room);
  }

  close(conn: Connection): void {
    this.connections.delete(conn);
    if (!conn.room) return;

    if (conn.role === 'camera') {
      for (const viewer of conn.room.viewers.values()) {
        send(viewer, { t: 'camera-left' });
        viewer.close();
      }
      this.rooms.close(conn.room);
    } else if (conn.role === 'viewer' && conn.peerId) {
      this.rooms.removeViewer(conn.room, conn.peerId);
      send(conn.room.camera, { t: 'peer-left', peerId: conn.peerId });
      const room = conn.room;
      conn.room = null;
      this.broadcastRoster(room);
    }
    conn.room = null;
  }

  private broadcastRoster(room: Room): void {
    const members = [...this.connections].filter((c) => c.room === room);
    const camera = members.find((c) => c.role === 'camera');
    const msg: ServerToClient = {
      t: 'roster',
      camera: camera ? { ip: camera.ip } : null,
      viewers: members
        .filter((c) => c.role === 'viewer' && c.peerId !== null)
        .map((v) => ({ peerId: v.peerId!, ip: v.ip })),
    };
    for (const member of members) send(member.socket, msg);
  }

  startHeartbeat(): void {
    this.heartbeat = setInterval(() => {
      const now = this.now();
      for (const conn of this.connections) {
        if (now - conn.lastSeen > STALE_AFTER_MS) {
          conn.socket.close();
          this.close(conn);
        } else {
          send(conn.socket, { t: 'ping' });
        }
      }
      this.limiter.sweep();
    }, HEARTBEAT_INTERVAL_MS);
    // Don't hold the process open just for the heartbeat.
    if (typeof this.heartbeat === 'object' && 'unref' in this.heartbeat) this.heartbeat.unref();
  }

  stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private findBySocket(socket: PeerSocket): Connection | undefined {
    for (const conn of this.connections) {
      if (conn.socket === socket) return conn;
    }
    return undefined;
  }
}
