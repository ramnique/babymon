import {
  AdaptiveThreshold,
  DEFAULT_MOTION_OPTIONS,
  DEFAULT_NOISE_OPTIONS,
  MotionDetector,
} from '@babymon/detection';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { playAlertSound, vibrate } from '../lib/alerts';

const GRID_W = 64;
const GRID_H = 48;
const ALERT_COOLDOWN_MS = 10_000;
const ROI_KEY = 'babymon.roi';

type Sensitivity = 'low' | 'medium' | 'high';
const NOISE_SIGMAS: Record<Sensitivity, number> = { low: 4, medium: 3, high: 2.25 };
const MOTION_AREA: Record<Sensitivity, number> = { low: 0.05, medium: 0.02, high: 0.008 };

/** Region of interest, normalized to the video frame (0..1). */
interface Roi {
  x: number;
  y: number;
  w: number;
  h: number;
}

function loadRoi(): Roi | null {
  try {
    const raw = localStorage.getItem(ROI_KEY);
    return raw ? (JSON.parse(raw) as Roi) : null;
  } catch {
    return null;
  }
}

function buildMask(roi: Roi | null): Uint8Array | undefined {
  if (!roi) return undefined;
  const mask = new Uint8Array(GRID_W * GRID_H);
  const x0 = Math.floor(roi.x * GRID_W);
  const y0 = Math.floor(roi.y * GRID_H);
  const x1 = Math.ceil((roi.x + roi.w) * GRID_W);
  const y1 = Math.ceil((roi.y + roi.h) * GRID_H);
  for (let y = y0; y < y1 && y < GRID_H; y++) {
    for (let x = x0; x < x1 && x < GRID_W; x++) {
      if (x >= 0 && y >= 0) mask[y * GRID_W + x] = 1;
    }
  }
  return mask;
}

interface Props {
  stream: MediaStream | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  overlayHostRef: RefObject<HTMLDivElement | null>;
}

export default function MonitorPanel({ stream, videoRef, overlayHostRef }: Props) {
  const [noiseOn, setNoiseOn] = useState(true);
  const [motionOn, setMotionOn] = useState(true);
  const [sensitivity, setSensitivity] = useState<Sensitivity>('medium');
  const [level, setLevel] = useState(0);
  const [threshold, setThreshold] = useState(1);
  const [roi, setRoi] = useState<Roi | null>(loadRoi);
  const [editingRoi, setEditingRoi] = useState(false);
  const [flash, setFlash] = useState<'noise' | 'motion' | null>(null);

  const lastAlertRef = useRef<Record<string, number>>({});
  const noiseOnRef = useRef(noiseOn);
  const motionOnRef = useRef(motionOn);
  noiseOnRef.current = noiseOn;
  motionOnRef.current = motionOn;

  function fireAlert(kind: 'noise' | 'motion') {
    const now = Date.now();
    const last = lastAlertRef.current[kind] ?? 0;
    if (now - last < ALERT_COOLDOWN_MS) return;
    lastAlertRef.current[kind] = now;
    playAlertSound();
    vibrate();
    setFlash(kind);
    setTimeout(() => setFlash(null), 2000);
  }

  // ---- noise: RMS of the remote audio at ~10 Hz through AdaptiveThreshold
  useEffect(() => {
    if (!stream || !noiseOn || stream.getAudioTracks().length === 0) return;
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const detector = new AdaptiveThreshold({
      ...DEFAULT_NOISE_OPTIONS,
      sigmas: NOISE_SIGMAS[sensitivity],
    });
    const buf = new Uint8Array(analyser.fftSize);

    const resume = () => void audioCtx.resume();
    document.addEventListener('pointerdown', resume);

    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = ((buf[i] ?? 128) - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      setLevel(rms);
      setThreshold(detector.threshold());
      if (detector.sample(rms) && noiseOnRef.current) fireAlert('noise');
    }, 100);

    return () => {
      clearInterval(timer);
      document.removeEventListener('pointerdown', resume);
      source.disconnect();
      void audioCtx.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, noiseOn, sensitivity]);

  // ---- motion: downscaled grayscale frame diff at ~4 fps
  useEffect(() => {
    if (!stream || !motionOn) return;
    const canvas = document.createElement('canvas');
    canvas.width = GRID_W;
    canvas.height = GRID_H;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (!g) return;
    const detector = new MotionDetector({
      ...DEFAULT_MOTION_OPTIONS,
      areaThreshold: MOTION_AREA[sensitivity],
    });
    detector.mask = buildMask(roi);
    const gray = new Uint8Array(GRID_W * GRID_H);

    const timer = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      g.drawImage(video, 0, 0, GRID_W, GRID_H);
      const { data } = g.getImageData(0, 0, GRID_W, GRID_H);
      for (let i = 0; i < gray.length; i++) {
        const o = i * 4;
        gray[i] = ((data[o] ?? 0) + (data[o + 1] ?? 0) + (data[o + 2] ?? 0)) / 3;
      }
      if (detector.frame(gray) && motionOnRef.current) fireAlert('motion');
    }, 250);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, motionOn, sensitivity, roi]);

  function saveRoi(next: Roi | null) {
    setRoi(next);
    if (next) localStorage.setItem(ROI_KEY, JSON.stringify(next));
    else localStorage.removeItem(ROI_KEY);
  }

  const loud = level > threshold;

  return (
    <div className={`card ${flash ? 'flash' : ''}`}>
      <div className="row spread">
        <strong>Monitoring</strong>
        {flash && (
          <span className="badge bad">
            <span className="dot" />
            {flash === 'noise' ? 'Noise!' : 'Motion!'}
          </span>
        )}
      </div>

      <label className="toggle">
        <input type="checkbox" checked={noiseOn} onChange={(e) => setNoiseOn(e.target.checked)} />
        Noise alerts (adapts to steady background noise)
      </label>
      {noiseOn && (
        <div className="meter">
          <div
            className={`fill ${loud ? 'loud' : ''}`}
            style={{ width: `${Math.min(100, level * 300)}%` }}
          />
          <div className="thresh" style={{ left: `${Math.min(100, threshold * 300)}%` }} />
        </div>
      )}

      <label className="toggle">
        <input type="checkbox" checked={motionOn} onChange={(e) => setMotionOn(e.target.checked)} />
        Motion alerts
      </label>
      {motionOn && (
        <div className="row">
          <button onClick={() => setEditingRoi((v) => !v)}>
            {editingRoi ? 'Done' : roi ? 'Redraw watch area' : 'Draw watch area'}
          </button>
          {roi && <button onClick={() => saveRoi(null)}>Watch whole frame</button>}
        </div>
      )}

      <div className="row" role="radiogroup" aria-label="Alert sensitivity">
        <span className="muted">Sensitivity:</span>
        {(['low', 'medium', 'high'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSensitivity(s)}
            style={sensitivity === s ? { background: 'var(--accent)', color: '#04141d' } : undefined}
          >
            {s}
          </button>
        ))}
      </div>

      {(editingRoi || roi) &&
        motionOn &&
        overlayHostRef.current &&
        createPortal(
          <RoiOverlay
            videoRef={videoRef}
            roi={roi}
            editing={editingRoi}
            onDrawn={(r) => {
              saveRoi(r);
              setEditingRoi(false);
            }}
          />,
          overlayHostRef.current,
        )}
    </div>
  );
}

/**
 * Overlay sized to the *displayed* video area (object-fit: contain leaves
 * letterbox bars), so pointer coordinates map 1:1 onto the video frame.
 */
function RoiOverlay({
  videoRef,
  roi,
  editing,
  onDrawn,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  roi: Roi | null;
  editing: boolean;
  onDrawn: (roi: Roi) => void;
}) {
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [draft, setDraft] = useState<Roi | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function measure() {
      const video = videoRef.current;
      if (!video || !video.videoWidth || !video.videoHeight) return;
      const cw = video.clientWidth;
      const ch = video.clientHeight;
      const scale = Math.min(cw / video.videoWidth, ch / video.videoHeight);
      const width = video.videoWidth * scale;
      const height = video.videoHeight * scale;
      setBox({ left: (cw - width) / 2, top: (ch - height) / 2, width, height });
    }
    measure();
    window.addEventListener('resize', measure);
    const video = videoRef.current;
    video?.addEventListener('loadedmetadata', measure);
    const timer = setInterval(measure, 2000); // cheap guard against layout shifts
    return () => {
      window.removeEventListener('resize', measure);
      video?.removeEventListener('loadedmetadata', measure);
      clearInterval(timer);
    };
  }, [videoRef]);

  if (!box) return null;

  function toNorm(e: React.PointerEvent): { x: number; y: number } {
    const rect = layerRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }

  function rectFrom(a: { x: number; y: number }, b: { x: number; y: number }): Roi {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(a.x - b.x),
      h: Math.abs(a.y - b.y),
    };
  }

  const shown = draft ?? roi;

  return (
    <div
      ref={layerRef}
      className={`roiLayer ${editing ? 'editing' : ''}`}
      style={{ position: 'absolute', left: box.left, top: box.top, width: box.width, height: box.height }}
      onPointerDown={(e) => {
        if (!editing) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        startRef.current = toNorm(e);
        setDraft({ ...startRef.current, w: 0, h: 0 });
      }}
      onPointerMove={(e) => {
        if (!editing || !startRef.current) return;
        setDraft(rectFrom(startRef.current, toNorm(e)));
      }}
      onPointerUp={(e) => {
        if (!editing || !startRef.current) return;
        const rect = rectFrom(startRef.current, toNorm(e));
        startRef.current = null;
        setDraft(null);
        if (rect.w > 0.05 && rect.h > 0.05) onDrawn(rect);
      }}
    >
      {shown && (
        <div
          className="roiRect"
          style={{
            left: `${shown.x * 100}%`,
            top: `${shown.y * 100}%`,
            width: `${shown.w * 100}%`,
            height: `${shown.h * 100}%`,
          }}
        />
      )}
    </div>
  );
}
