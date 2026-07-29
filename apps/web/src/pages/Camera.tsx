import { generateRoomCode, type IceServer, type ServerToClient } from '@babymon/shared';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getRouteInfo, rtcConfig, type RouteInfo } from '../lib/rtcstats';
import { SignalingClient } from '../lib/signaling';
import { loadOrCreateCameraCode, saveCameraCode } from '../lib/store';
import ConnectionsPanel from '../ui/ConnectionsPanel';

type Roster = Extract<ServerToClient, { t: 'roster' }>;

type Status = 'idle' | 'starting' | 'live' | 'error' | 'replaced';

interface SignalPayload {
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export default function CameraPage() {
  const [code, setCode] = useState(loadOrCreateCameraCode);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [signalingUp, setSignalingUp] = useState(false);
  const [viewerIds, setViewerIds] = useState<string[]>([]);
  const [remoteAudio, setRemoteAudio] = useState<Map<string, MediaStream>>(new Map());
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [dimmed, setDimmed] = useState(false);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [routes, setRoutes] = useState<Map<string, RouteInfo>>(new Map());

  const sigRef = useRef<SignalingClient | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const iceRef = useRef<IceServer[]>([]);
  const codeRef = useRef(code);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const statusRef = useRef<Status>('idle');
  statusRef.current = status;
  codeRef.current = code;

  const watchUrl = `${location.origin}/watch#${code}`;

  function syncViewers() {
    setViewerIds(Array.from(pcsRef.current.keys()));
  }

  function closePeer(peerId: string) {
    pcsRef.current.get(peerId)?.close();
    pcsRef.current.delete(peerId);
    setRemoteAudio((prev) => {
      if (!prev.has(peerId)) return prev;
      const next = new Map(prev);
      next.delete(peerId);
      return next;
    });
    syncViewers();
  }

  function closeAllPeers() {
    for (const pc of pcsRef.current.values()) pc.close();
    pcsRef.current.clear();
    setRemoteAudio(new Map());
    syncViewers();
  }

  async function addViewer(peerId: string) {
    const stream = streamRef.current;
    if (!stream || pcsRef.current.has(peerId)) return;

    const pc = new RTCPeerConnection(rtcConfig(iceRef.current as RTCIceServer[]));
    pcsRef.current.set(peerId, pc);
    syncViewers();

    for (const track of stream.getTracks()) pc.addTrack(track, stream);

    // Return audio for talk-back arrives on the same audio m-line.
    pc.ontrack = (e) => {
      if (e.track.kind !== 'audio') return;
      const remote = e.streams[0] ?? new MediaStream([e.track]);
      setRemoteAudio((prev) => new Map(prev).set(peerId, remote));
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        sigRef.current?.send({ t: 'signal', peerId, data: { candidate: e.candidate.toJSON() } });
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        closePeer(peerId);
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sigRef.current?.send({ t: 'signal', peerId, data: { sdp: pc.localDescription } });
  }

  async function onSignal(from: string, data: unknown) {
    const pc = pcsRef.current.get(from);
    if (!pc) return;
    const payload = data as SignalPayload;
    try {
      if (payload.sdp && payload.sdp.type === 'answer') {
        await pc.setRemoteDescription(payload.sdp);
      } else if (payload.candidate) {
        await pc.addIceCandidate(payload.candidate);
      }
    } catch (err) {
      console.warn('signal handling failed', err);
    }
  }

  function handleMessage(msg: ServerToClient) {
    switch (msg.t) {
      case 'hosted':
        iceRef.current = msg.iceServers;
        break;
      case 'viewer-joined':
        void addViewer(msg.peerId);
        break;
      case 'peer-left':
        closePeer(msg.peerId);
        break;
      case 'signal':
        void onSignal(msg.from, msg.data);
        break;
      case 'roster':
        setRoster(msg);
        break;
      case 'kicked':
        if (msg.reason === 'replaced') {
          stopEverything();
          setStatus('replaced');
        }
        break;
      default:
        break;
    }
  }

  function connectSignaling() {
    const sig = new SignalingClient();
    sigRef.current = sig;
    sig.onstatus = (s) => {
      setSignalingUp(s === 'open');
      if (s === 'open') {
        // Fresh (re)connection: the server has no memory of us — re-run the
        // whole room handshake and let viewers re-join.
        closeAllPeers();
        sig.send({ t: 'host', code: codeRef.current });
      }
    };
    sig.onmessage = handleMessage;
    sig.connect();
  }

  async function acquireWakeLock() {
    try {
      wakeLockRef.current = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {
      // Not supported or denied — the user just has to keep the screen on.
    }
  }

  async function start() {
    setStatus('starting');
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: { noiseSuppression, echoCancellation: true },
      });
      streamRef.current = stream;
      connectSignaling();
      await acquireWakeLock();
      setStatus('live');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function stopEverything() {
    closeAllPeers();
    sigRef.current?.close();
    sigRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }

  function regenerate() {
    const next = generateRoomCode();
    saveCameraCode(next);
    setCode(next);
    closeAllPeers();
    sigRef.current?.send({ t: 'regenerate', code: next });
  }

  useEffect(() => {
    if (!panelOpen) return;
    let live = true;
    const tick = async () => {
      const next = new Map<string, RouteInfo>();
      for (const [peerId, pc] of pcsRef.current) next.set(peerId, await getRouteInfo(pc));
      if (live) setRoutes(next);
    };
    void tick();
    const timer = setInterval(() => void tick(), 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [panelOpen, viewerIds]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && statusRef.current === 'live') {
        // Safari drops both the wake lock and (sometimes) capture when the
        // page hides; reclaim what we can on return.
        void acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stopEverything();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="page">
      <h1>
        <Link to="/">babymon</Link> · camera
      </h1>

      {status === 'idle' && (
        <div className="card">
          <p className="muted">
            This device becomes the nursery camera. Keep it plugged in with this page open — the
            screen must stay on (we keep it awake and let you dim it).
          </p>
          <label className="toggle">
            <input
              type="checkbox"
              checked={noiseSuppression}
              onChange={(e) => setNoiseSuppression(e.target.checked)}
            />
            Reduce steady background noise (white-noise machines stay audible to alerts either way)
          </label>
          <button className="primary" onClick={() => void start()}>
            Start camera
          </button>
        </div>
      )}

      {status === 'starting' && <div className="card">Requesting camera & microphone…</div>}

      {status === 'error' && (
        <div className="card">
          <span style={{ color: 'var(--bad)' }}>Could not start the camera: {error}</span>
          <p className="muted">
            Check that this site has camera/microphone permission, and that you're on HTTPS (or
            localhost).
          </p>
          <button className="primary" onClick={() => void start()}>
            Try again
          </button>
        </div>
      )}

      {status === 'replaced' && (
        <div className="card">
          <span style={{ color: 'var(--warn)' }}>
            Another device took over as the camera for this code.
          </span>
          <button className="primary" onClick={() => void start()}>
            Take back over
          </button>
        </div>
      )}

      {status === 'live' && (
        <>
          <div className="row spread">
            <span className={`badge ${signalingUp ? 'live' : 'warn'}`}>
              <span className="dot" />
              {signalingUp ? 'online' : 'reconnecting…'}
            </span>
            <button className="badge" onClick={() => setPanelOpen((v) => !v)}>
              <span className="dot" style={{ background: viewerIds.length ? 'var(--good)' : undefined }} />
              {viewerIds.length} watching {panelOpen ? '▴' : '▾'}
            </button>
          </div>

          {panelOpen && <ConnectionsPanel roster={roster} perspective="camera" routes={routes} />}

          <div className="videoWrap">
            <video
              ref={(el) => {
                // Callback ref: this element mounts only after status flips to
                // 'live', so the stream must be attached here, not in start().
                previewRef.current = el;
                if (el && el.srcObject !== streamRef.current) {
                  el.srcObject = streamRef.current;
                }
              }}
              autoPlay
              playsInline
              muted
            />
          </div>

          <div className="card">
            <strong>Invite a viewer</strong>
            <div className="qr">
              <QRCodeSVG value={watchUrl} size={168} />
            </div>
            <div className="code">{code}</div>
            <div className="row">
              <button
                style={{ flex: 1 }}
                onClick={() => void navigator.clipboard.writeText(watchUrl)}
              >
                Copy link
              </button>
              <button className="danger" style={{ flex: 1 }} onClick={regenerate}>
                New code (kicks viewers)
              </button>
            </div>
          </div>

          <button onClick={() => setDimmed(true)}>Dim screen</button>
          <p className="muted">
            Keep this page open and the device on a charger. Dimming keeps everything running.
          </p>
        </>
      )}

      {dimmed && (
        <div className="dimOverlay" onClick={() => setDimmed(false)}>
          <span>
            babymon camera running · {viewerIds.length} watching · tap to wake
          </span>
        </div>
      )}

      {Array.from(remoteAudio.entries()).map(([peerId, stream]) => (
        <TalkbackAudio key={peerId} stream={stream} />
      ))}
    </div>
  );
}

function TalkbackAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}
