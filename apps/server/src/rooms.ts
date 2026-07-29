import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { MAX_VIEWERS } from '@babymon/shared';

export interface PeerSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface Room {
  /** sha256 of the room code — the raw code is never stored server-side. */
  codeHash: Buffer;
  camera: PeerSocket;
  viewers: Map<string, PeerSocket>;
}

function hashCode(code: string): Buffer {
  return createHash('sha256').update(code).digest();
}

export type JoinResult =
  | { ok: true; peerId: string; room: Room }
  | { ok: false; reason: 'bad-code' | 'full' };

/**
 * Ephemeral room registry. Rooms exist only while a camera socket holds them;
 * nothing survives a restart. Keyed by sha256(code) so lookups never touch
 * raw codes, and membership checks compare digests in constant time.
 */
export class RoomRegistry {
  private rooms = new Map<string, Room>();

  /**
   * Camera claims a room. If the code is already hosted, the previous camera
   * is replaced (phone rebooted / page refreshed) and existing viewers are
   * kept so the new camera can re-offer to them.
   */
  host(code: string, camera: PeerSocket): { room: Room; replacedCamera: PeerSocket | null } {
    const codeHash = hashCode(code);
    const key = codeHash.toString('hex');
    const existing = this.rooms.get(key);
    if (existing) {
      const replaced = existing.camera;
      existing.camera = camera;
      return { room: existing, replacedCamera: replaced };
    }
    const room: Room = { codeHash, camera, viewers: new Map() };
    this.rooms.set(key, room);
    return { room, replacedCamera: null };
  }

  join(code: string, viewer: PeerSocket): JoinResult {
    const codeHash = hashCode(code);
    const room = this.rooms.get(codeHash.toString('hex'));
    if (!room || !timingSafeEqual(room.codeHash, codeHash)) {
      return { ok: false, reason: 'bad-code' };
    }
    if (room.viewers.size >= MAX_VIEWERS) {
      return { ok: false, reason: 'full' };
    }
    const peerId = randomUUID();
    room.viewers.set(peerId, viewer);
    return { ok: true, peerId, room };
  }

  /** Re-key a room under a fresh code. Caller kicks the viewers. */
  regenerate(room: Room, newCode: string): void {
    this.rooms.delete(room.codeHash.toString('hex'));
    room.codeHash = hashCode(newCode);
    room.viewers.clear();
    this.rooms.set(room.codeHash.toString('hex'), room);
  }

  /** Remove a room entirely (camera gone). */
  close(room: Room): void {
    this.rooms.delete(room.codeHash.toString('hex'));
  }

  removeViewer(room: Room, peerId: string): void {
    room.viewers.delete(peerId);
  }

  get size(): number {
    return this.rooms.size;
  }
}
