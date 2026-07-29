import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/ratelimit.js';
import { CODE, CODE2, FakeSocket, connectAndSend, makeHub } from './helpers.js';

function setup() {
  const { hub, rooms } = makeHub();
  const camera = new FakeSocket();
  const cameraConn = connectAndSend(hub, camera, '10.0.0.1', { t: 'host', code: CODE });
  return { hub, rooms, camera, cameraConn };
}

function joinViewer(hub: ReturnType<typeof makeHub>['hub'], ip = '10.0.0.2') {
  const viewer = new FakeSocket();
  const conn = connectAndSend(hub, viewer, ip, { t: 'join', code: CODE });
  return { viewer, conn };
}

describe('hosting', () => {
  it('acks with ice servers and registers the room', () => {
    const { camera, rooms } = setup();
    expect(camera.ofType('hosted')).toHaveLength(1);
    expect(camera.ofType('hosted')[0]!.iceServers[0]!.urls).toEqual(['stun:stun.example.org']);
    expect(rooms.size).toBe(1);
  });

  it('rejects malformed codes', () => {
    const { hub } = makeHub();
    const camera = new FakeSocket();
    connectAndSend(hub, camera, '10.0.0.1', { t: 'host', code: 'shortcode1234' });
    expect(camera.last()).toEqual({ t: 'rejected', reason: 'bad-code' });
  });

  it('rejects malformed JSON with an error message', () => {
    const { hub } = makeHub();
    const socket = new FakeSocket();
    const conn = hub.connect(socket, '10.0.0.1');
    hub.message(conn, 'not json');
    expect(socket.last()).toMatchObject({ t: 'error' });
  });
});

describe('joining', () => {
  it('admits a viewer and notifies the camera', () => {
    const { hub, camera } = setup();
    const { viewer } = joinViewer(hub);
    const joined = viewer.ofType('joined')[0]!;
    expect(joined.peerId).toBeTruthy();
    expect(camera.ofType('viewer-joined')[0]!.peerId).toBe(joined.peerId);
  });

  it('rejects a wrong code without leaking room existence', () => {
    const { hub } = setup();
    const viewer = new FakeSocket();
    connectAndSend(hub, viewer, '10.0.0.2', { t: 'join', code: CODE2 });
    expect(viewer.last()).toEqual({ t: 'rejected', reason: 'bad-code' });
  });

  it('enforces the 2-viewer cap', () => {
    const { hub } = setup();
    joinViewer(hub, '10.0.0.2');
    joinViewer(hub, '10.0.0.3');
    const third = new FakeSocket();
    connectAndSend(hub, third, '10.0.0.4', { t: 'join', code: CODE });
    expect(third.last()).toEqual({ t: 'rejected', reason: 'full' });
  });

  it('frees the slot when a viewer disconnects', () => {
    const { hub, camera } = setup();
    joinViewer(hub, '10.0.0.2');
    const second = joinViewer(hub, '10.0.0.3');
    hub.close(second.conn);
    expect(camera.ofType('peer-left')).toHaveLength(1);
    const third = new FakeSocket();
    connectAndSend(hub, third, '10.0.0.4', { t: 'join', code: CODE });
    expect(third.ofType('joined')).toHaveLength(1);
  });
});

describe('signal relay', () => {
  it('relays camera → viewer and viewer → camera with correct from fields', () => {
    const { hub, camera, cameraConn } = setup();
    const { viewer, conn: viewerConn } = joinViewer(hub);
    const peerId = viewer.ofType('joined')[0]!.peerId;

    hub.message(cameraConn, JSON.stringify({ t: 'signal', peerId, data: { sdp: 'offer' } }));
    expect(viewer.ofType('signal')[0]).toEqual({ t: 'signal', from: 'camera', data: { sdp: 'offer' } });

    hub.message(viewerConn, JSON.stringify({ t: 'signal-camera', data: { sdp: 'answer' } }));
    expect(camera.ofType('signal')[0]).toEqual({ t: 'signal', from: peerId, data: { sdp: 'answer' } });
  });

  it('viewers cannot address arbitrary peers and cameras cannot signal unknown ids', () => {
    const { hub, cameraConn } = setup();
    const { viewer } = joinViewer(hub);
    const before = viewer.sent.length;
    hub.message(cameraConn, JSON.stringify({ t: 'signal', peerId: 'nope', data: {} }));
    expect(viewer.sent.length).toBe(before);
  });
});

describe('camera lifecycle', () => {
  it('camera disconnect closes the room and informs viewers', () => {
    const { hub, rooms, cameraConn } = setup();
    const { viewer } = joinViewer(hub);
    hub.close(cameraConn);
    expect(viewer.ofType('camera-left')).toHaveLength(1);
    expect(viewer.closed).toBe(true);
    expect(rooms.size).toBe(0);
  });

  it('a new camera socket with the same code replaces the old one and keeps viewers', () => {
    const { hub, camera } = setup();
    const { viewer } = joinViewer(hub);
    const peerId = viewer.ofType('joined')[0]!.peerId;

    const camera2 = new FakeSocket();
    const camera2Conn = connectAndSend(hub, camera2, '10.0.0.1', { t: 'host', code: CODE });

    expect(camera.ofType('kicked')[0]).toEqual({ t: 'kicked', reason: 'replaced' });
    expect(camera.closed).toBe(true);
    expect(viewer.ofType('camera-restarted')).toHaveLength(1);
    // New camera is told about the waiting viewer so it can re-offer.
    expect(camera2.ofType('viewer-joined')[0]!.peerId).toBe(peerId);

    expect(camera2.ofType('hosted')).toHaveLength(1);
    expect(camera2Conn.room).not.toBeNull();
  });

  it('regenerate kicks viewers, invalidates the old code, and accepts the new one', () => {
    const { hub, cameraConn } = setup();
    const { viewer } = joinViewer(hub);
    hub.message(cameraConn, JSON.stringify({ t: 'regenerate', code: CODE2 }));

    expect(viewer.ofType('kicked')[0]).toEqual({ t: 'kicked', reason: 'regenerated' });
    expect(viewer.closed).toBe(true);

    const stale = new FakeSocket();
    connectAndSend(hub, stale, '10.0.0.5', { t: 'join', code: CODE });
    expect(stale.last()).toEqual({ t: 'rejected', reason: 'bad-code' });

    const fresh = new FakeSocket();
    connectAndSend(hub, fresh, '10.0.0.6', { t: 'join', code: CODE2 });
    expect(fresh.ofType('joined')).toHaveLength(1);
  });
});

describe('ghost viewers', () => {
  it('a rejoin with the same viewerId evicts the previous connection', () => {
    const { hub, camera } = setup();
    const ghost = new FakeSocket();
    connectAndSend(hub, ghost, '10.0.0.2', { t: 'join', code: CODE, viewerId: 'phone-abc-123' });
    const ghostPeer = ghost.ofType('joined')[0]!.peerId;

    // Fill the second slot too — the room is now "full".
    joinViewer(hub, '10.0.0.3');

    // Same browser rejoins (page was killed without closing the socket).
    const fresh = new FakeSocket();
    connectAndSend(hub, fresh, '10.0.0.2', { t: 'join', code: CODE, viewerId: 'phone-abc-123' });

    expect(fresh.ofType('joined')).toHaveLength(1); // NOT rejected as full
    expect(ghost.ofType('kicked')[0]).toEqual({ t: 'kicked', reason: 'replaced' });
    expect(ghost.closed).toBe(true);
    expect(camera.ofType('peer-left').map((m) => m.peerId)).toContain(ghostPeer);
  });

  it('different viewerIds still hit the room cap', () => {
    const { hub } = setup();
    connectAndSend(hub, new FakeSocket(), '10.0.0.2', { t: 'join', code: CODE, viewerId: 'aaaa-1111' });
    connectAndSend(hub, new FakeSocket(), '10.0.0.3', { t: 'join', code: CODE, viewerId: 'bbbb-2222' });
    const third = new FakeSocket();
    connectAndSend(hub, third, '10.0.0.4', { t: 'join', code: CODE, viewerId: 'cccc-3333' });
    expect(third.last()).toEqual({ t: 'rejected', reason: 'full' });
  });
});

describe('roster', () => {
  it('broadcasts membership with IPs to everyone on join and leave', () => {
    const { hub, camera } = setup();
    expect(camera.ofType('roster')[0]).toEqual({
      t: 'roster',
      camera: { ip: '10.0.0.1' },
      viewers: [],
    });

    const { viewer, conn } = joinViewer(hub, '10.0.0.2');
    const peerId = viewer.ofType('joined')[0]!.peerId;
    const afterJoin = camera.ofType('roster')[1]!;
    expect(afterJoin.viewers).toEqual([{ peerId, ip: '10.0.0.2' }]);
    expect(viewer.ofType('roster')[0]).toEqual(afterJoin);

    hub.close(conn);
    const afterLeave = camera.ofType('roster')[2]!;
    expect(afterLeave.viewers).toEqual([]);
  });
});

describe('rate limiting', () => {
  it('rejects joins once the per-IP bucket is empty', () => {
    const { hub } = makeHub({ limiter: new RateLimiter(2, 0) });
    const camera = new FakeSocket();
    connectAndSend(hub, camera, '10.0.0.1', { t: 'host', code: CODE });

    // Bucket of 2, no refill: two guesses pass (as bad-code), the third is throttled.
    const first = new FakeSocket();
    connectAndSend(hub, first, '6.6.6.6', { t: 'join', code: CODE2 });
    expect(first.last()).toEqual({ t: 'rejected', reason: 'bad-code' });
    const second = new FakeSocket();
    connectAndSend(hub, second, '6.6.6.6', { t: 'join', code: CODE2 });
    expect(second.last()).toEqual({ t: 'rejected', reason: 'bad-code' });
    const third = new FakeSocket();
    connectAndSend(hub, third, '6.6.6.6', { t: 'join', code: CODE2 });
    expect(third.last()).toEqual({ t: 'rejected', reason: 'rate-limited' });
  });

  it('does not rate-limit other IPs', () => {
    const { hub } = makeHub({ limiter: new RateLimiter(1, 0) });
    const camera = new FakeSocket();
    connectAndSend(hub, camera, '10.0.0.1', { t: 'host', code: CODE });
    const a = new FakeSocket();
    connectAndSend(hub, a, '6.6.6.6', { t: 'join', code: CODE2 });
    connectAndSend(hub, new FakeSocket(), '6.6.6.6', { t: 'join', code: CODE2 });
    const b = new FakeSocket();
    connectAndSend(hub, b, '7.7.7.7', { t: 'join', code: CODE });
    expect(b.ofType('joined')).toHaveLength(1);
  });
});
