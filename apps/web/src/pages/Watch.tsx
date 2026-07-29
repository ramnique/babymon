import { isValidRoomCode, normalizeRoomCode, type IceServer, type ServerToClient } from '@babymon/shared';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getRouteInfo, rtcConfig, type RouteInfo } from '../lib/rtcstats';
import { SignalingClient } from '../lib/signaling';
import { clearWatchCode, loadOrCreateViewerId, saveWatchCode } from '../lib/store';
import ConnectionsPanel from '../ui/ConnectionsPanel';
import MonitorPanel from '../ui/MonitorPanel';

type Roster = Extract<ServerToClient, { t: 'roster' }>;

type Status =
  | 'connecting'
  | 'waiting-offer'
  | 'live'
  | 'camera-offline'
  | 'room-full'
  | 'rate-limited'
  | 'revoked'
  | 'superseded';

const STATUS_TEXT: Record<Status, string> = {
  connecting: 'Connecting…',
  'waiting-offer': 'Connected — waiting for the camera…',
  live: 'Live',
  'camera-offline': 'Camera is offline. Retrying…',
  'room-full': 'Room is full (2 viewers max). Retrying…',
  'rate-limited': 'Too many attempts — waiting a bit…',
  revoked: 'Access was revoked (the camera generated a new code).',
  superseded: 'Watching moved to another tab or window.',
};

interface SignalPayload {
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export default function WatchPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const code = normalizeRoomCode(location.hash.slice(1));
  const codeOk = isValidRoomCode(code);

  const [status, setStatus] = useState<Status>('connecting');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(true);
  const [talking, setTalking] = useState(false);
  const [talkError, setTalkError] = useState<string | null>(null);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [route, setRoute] = useState<RouteInfo | null>(null);

  const sigRef = useRef<SignalingClient | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const iceRef = useRef<IceServer[]>([]);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micRef = useRef<MediaStreamTrack | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!codeOk) return;
    saveWatchCode(code);

    const sig = new SignalingClient();
    sigRef.current = sig;
    let stopped = false;

    function scheduleRejoin(delayMs: number) {
      if (retryRef.current) clearTimeout(retryRef.current);
      retryRef.current = setTimeout(() => {
        retryRef.current = null;
        if (!stopped) sig.send({ t: 'join', code });
      }, delayMs);
    }

    function closePc() {
      pcRef.current?.close();
      pcRef.current = null;
      micRef.current?.stop();
      micRef.current = null;
      setTalking(false);
      setRemoteStream(null);
      pendingCandidatesRef.current = [];
    }

    async function onOffer(sdp: RTCSessionDescriptionInit) {
      // Every offer starts a fresh peer connection (camera restarts re-offer).
      pcRef.current?.close();
      const pc = new RTCPeerConnection(rtcConfig(iceRef.current as RTCIceServer[]));
      pcRef.current = pc;

      pc.ontrack = (e) => {
        const stream = e.streams[0] ?? new MediaStream([e.track]);
        setRemoteStream(stream);
        setStatus('live');
      };
      pc.onicecandidate = (e) => {
        if (e.candidate) sig.send({ t: 'signal-camera', data: { candidate: e.candidate.toJSON() } });
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') {
          // Media path died but signaling may be fine — re-join for a new offer.
          closePc();
          setStatus('camera-offline');
          scheduleRejoin(2000);
        }
      };

      await pc.setRemoteDescription(sdp);
      for (const candidate of pendingCandidatesRef.current) {
        await pc.addIceCandidate(candidate).catch(() => {});
      }
      pendingCandidatesRef.current = [];

      // Answer the camera's sendrecv audio m-line in kind so push-to-talk can
      // later just replaceTrack() without renegotiating.
      for (const transceiver of pc.getTransceivers()) {
        if (transceiver.receiver.track.kind === 'audio') transceiver.direction = 'sendrecv';
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sig.send({ t: 'signal-camera', data: { sdp: pc.localDescription } });
    }

    async function onSignal(data: unknown) {
      const payload = data as SignalPayload;
      try {
        if (payload.sdp && payload.sdp.type === 'offer') {
          await onOffer(payload.sdp);
        } else if (payload.candidate) {
          const pc = pcRef.current;
          if (pc?.remoteDescription) {
            await pc.addIceCandidate(payload.candidate);
          } else {
            pendingCandidatesRef.current.push(payload.candidate);
          }
        }
      } catch (err) {
        console.warn('signal handling failed', err);
      }
    }

    function handleMessage(msg: ServerToClient) {
      switch (msg.t) {
        case 'joined':
          iceRef.current = msg.iceServers;
          setSelfId(msg.peerId);
          setStatus('waiting-offer');
          break;
        case 'roster':
          setRoster(msg);
          break;
        case 'rejected':
          if (msg.reason === 'bad-code') {
            // Usually just means the camera is offline right now.
            setStatus('camera-offline');
            scheduleRejoin(10_000);
          } else if (msg.reason === 'full') {
            setStatus('room-full');
            scheduleRejoin(30_000);
          } else {
            setStatus('rate-limited');
            scheduleRejoin(30_000);
          }
          break;
        case 'signal':
          void onSignal(msg.data);
          break;
        case 'camera-restarted':
          closePc();
          setStatus('waiting-offer');
          break;
        case 'camera-left':
          closePc();
          setStatus('camera-offline');
          break;
        case 'kicked':
          if (msg.reason === 'regenerated') {
            stopped = true;
            closePc();
            sig.close();
            clearWatchCode();
            setStatus('revoked');
          } else if (msg.reason === 'replaced') {
            // This browser started watching in a newer tab; stand down here.
            stopped = true;
            closePc();
            sig.close();
            setStatus('superseded');
          }
          break;
        default:
          break;
      }
    }

    sig.onstatus = (s) => {
      if (s === 'open') {
        sig.send({ t: 'join', code, viewerId: loadOrCreateViewerId() });
      } else if (s === 'closed' && !stopped) {
        closePc();
        setStatus('connecting');
      }
    };
    sig.onmessage = handleMessage;
    sig.connect();

    // Free our room slot immediately when the page goes away — mobile
    // browsers kill pages without closing sockets otherwise.
    const onPageHide = () => sig.dropConnection();
    window.addEventListener('pagehide', onPageHide);

    return () => {
      stopped = true;
      window.removeEventListener('pagehide', onPageHide);
      if (retryRef.current) clearTimeout(retryRef.current);
      closePc();
      sig.close();
      sigRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, codeOk]);

  useEffect(() => {
    if (videoRef.current && remoteStream) videoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    if (!panelOpen || status !== 'live') return;
    let live = true;
    const tick = async () => {
      const pc = pcRef.current;
      if (!pc) return;
      const info = await getRouteInfo(pc);
      if (live) setRoute(info);
    };
    void tick();
    const timer = setInterval(() => void tick(), 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [panelOpen, status]);

  async function talkStart() {
    setTalkError(null);
    const pc = pcRef.current;
    if (!pc) return;
    try {
      if (!micRef.current || micRef.current.readyState === 'ended') {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        const track = mic.getAudioTracks()[0];
        if (!track) throw new Error('no microphone track');
        micRef.current = track;
        const audioSender = pc
          .getTransceivers()
          .find((t) => t.receiver.track.kind === 'audio')?.sender;
        await audioSender?.replaceTrack(track);
      }
      micRef.current.enabled = true;
      setTalking(true);
    } catch (err) {
      setTalkError(err instanceof Error ? err.message : String(err));
    }
  }

  function talkStop() {
    if (micRef.current) micRef.current.enabled = false;
    setTalking(false);
  }

  if (!codeOk) {
    return (
      <div className="page">
        <h1>
          <Link to="/">babymon</Link> · watch
        </h1>
        <div className="card">
          <p className="muted">No valid camera code in this link.</p>
          <button className="primary" onClick={() => navigate('/')}>
            Enter a code
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>
        <Link to="/">babymon</Link> · watch
      </h1>

      <div className="row spread">
        <button
          className={`badge ${status === 'live' ? 'live' : status === 'revoked' ? 'bad' : 'warn'}`}
          onClick={() => setPanelOpen((v) => !v)}
        >
          <span className="dot" />
          {STATUS_TEXT[status]}
          {status === 'live' && roster && `: ${roster.viewers.length} watching`} {panelOpen ? '▴' : '▾'}
        </button>
        {status === 'live' && (
          <button
            onClick={() => {
              const next = !muted;
              setMuted(next);
              if (!next) void videoRef.current?.play().catch(() => {});
            }}
          >
            {muted ? '🔊 Unmute' : '🔇 Mute'}
          </button>
        )}
      </div>

      {panelOpen && (
        <ConnectionsPanel
          roster={roster}
          perspective="viewer"
          selfPeerId={selfId}
          routes={new Map(route ? [['camera', route]] : [])}
        />
      )}

      <div className="videoWrap" ref={wrapRef}>
        <video ref={videoRef} autoPlay playsInline muted={muted} />
      </div>

      {status === 'live' && (
        <>
          <button
            className={`talkBtn ${talking ? 'talking' : ''}`}
            onPointerDown={() => void talkStart()}
            onPointerUp={talkStop}
            onPointerLeave={talkStop}
            onPointerCancel={talkStop}
            onContextMenu={(e) => e.preventDefault()}
          >
            {talking ? 'Talking… release to stop' : '🎙 Hold to talk to baby'}
          </button>
          {talkError && (
            <span style={{ color: 'var(--bad)', fontSize: '0.85rem' }}>
              Microphone unavailable: {talkError}
            </span>
          )}
          <MonitorPanel stream={remoteStream} videoRef={videoRef} overlayHostRef={wrapRef} />

          <details className="card shareCard">
            <summary>Invite another viewer</summary>
            <p className="muted">
              Let someone else watch too — scan this on their phone, or send them the link. (Two
              viewers can watch at once; if the room is full, one of you closes the page first.)
            </p>
            <div className="qr">
              <QRCodeSVG value={`${window.location.origin}/watch#${code}`} size={168} />
            </div>
            <div className="code">{code}</div>
            <button
              onClick={() =>
                void navigator.clipboard.writeText(`${window.location.origin}/watch#${code}`)
              }
            >
              Copy link
            </button>
          </details>
        </>
      )}

      {status === 'revoked' && (
        <div className="card">
          <p className="muted">
            The camera generated a new code, so this device no longer has access. Ask for the new
            link to reconnect.
          </p>
          <button className="primary" onClick={() => navigate('/')}>
            Back home
          </button>
        </div>
      )}
    </div>
  );
}
