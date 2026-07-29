import { z } from 'zod';

/**
 * Signaling protocol. The server is a dumb room-scoped relay: it never
 * inspects `data` payloads (SDP / ICE candidates), it only routes them.
 */

export const signalData = z.unknown();

// ---------- client → server ----------

export const clientToServer = z.discriminatedUnion('t', [
  // Camera claims (or re-claims after restart) a room for its code.
  z.object({ t: z.literal('host'), code: z.string().min(12).max(64) }),
  // Viewer asks to join the room for a code.
  z.object({ t: z.literal('join'), code: z.string().min(12).max(64) }),
  // Camera → a specific viewer.
  z.object({ t: z.literal('signal'), peerId: z.string(), data: signalData }),
  // Viewer → camera (target is implicit).
  z.object({ t: z.literal('signal-camera'), data: signalData }),
  // Camera rotates the room code; all viewers are kicked.
  z.object({ t: z.literal('regenerate'), code: z.string().min(12).max(64) }),
  z.object({ t: z.literal('pong') }),
]);
export type ClientToServer = z.infer<typeof clientToServer>;

// ---------- server → client ----------

export const iceServer = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional(),
});
export type IceServer = z.infer<typeof iceServer>;

export const rejectReason = z.enum(['bad-code', 'full', 'rate-limited', 'code-in-use']);
export type RejectReason = z.infer<typeof rejectReason>;

export const serverToClient = z.discriminatedUnion('t', [
  // Acks. Ice servers are only handed out after a successful host/join.
  z.object({ t: z.literal('hosted'), iceServers: z.array(iceServer) }),
  z.object({ t: z.literal('joined'), peerId: z.string(), iceServers: z.array(iceServer) }),
  z.object({ t: z.literal('rejected'), reason: rejectReason }),
  // Room membership events.
  z.object({ t: z.literal('viewer-joined'), peerId: z.string() }),
  z.object({ t: z.literal('peer-left'), peerId: z.string() }),
  z.object({ t: z.literal('camera-left') }),
  z.object({ t: z.literal('camera-restarted') }),
  z.object({ t: z.literal('kicked'), reason: z.enum(['regenerated', 'replaced']) }),
  // Room roster, broadcast to every member on membership changes. IPs are as
  // seen by the signaling server (all members get the same view).
  z.object({
    t: z.literal('roster'),
    camera: z.object({ ip: z.string() }).nullable(),
    viewers: z.array(z.object({ peerId: z.string(), ip: z.string() })),
  }),
  // Relayed signaling. `from` is a viewer peerId, or 'camera'.
  z.object({ t: z.literal('signal'), from: z.string(), data: signalData }),
  z.object({ t: z.literal('ping') }),
  z.object({ t: z.literal('error'), message: z.string() }),
]);
export type ServerToClient = z.infer<typeof serverToClient>;

export const CAMERA_PEER_ID = 'camera';
export const MAX_VIEWERS = 2;
