import { isValidRoomCode, normalizeRoomCode } from '@babymon/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { loadWatchCode } from '../lib/store';

/** Accepts a raw code or a full share link (code travels in the #fragment). */
function parseCodeInput(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let candidate = s;
  try {
    candidate = new URL(s).hash.slice(1) || s;
  } catch {
    // not a URL — treat as a bare code
  }
  const code = normalizeRoomCode(candidate);
  return isValidRoomCode(code) ? code : null;
}

export default function HomePage() {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const lastCode = loadWatchCode();

  function goWatch() {
    const code = parseCodeInput(input);
    if (!code) {
      setError("That doesn't look like a babymon code or link.");
      return;
    }
    navigate(`/watch#${code}`);
  }

  return (
    <div className="page">
      <h1>babymon</h1>
      <p className="muted">
        A baby monitor in your browser. One device is the camera in the nursery; others watch —
        from the couch or from anywhere.
      </p>

      <div className="card">
        <strong>This device is the camera</strong>
        <p className="muted">
          Put this device in the nursery. It will show a code for viewers to scan.
        </p>
        <Link to="/camera">
          <button className="primary" style={{ width: '100%' }}>
            Start as camera
          </button>
        </Link>
      </div>

      <div className="card">
        <strong>Watch a camera</strong>
        <p className="muted">Scan the camera's QR code, or paste its link/code here.</p>
        <input
          type="text"
          placeholder="Paste link or code"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && goWatch()}
        />
        {error && <span style={{ color: 'var(--bad)', fontSize: '0.85rem' }}>{error}</span>}
        <button className="primary" onClick={goWatch}>
          Watch
        </button>
        {lastCode && (
          <button onClick={() => navigate(`/watch#${lastCode}`)}>Reconnect to last camera</button>
        )}
      </div>
    </div>
  );
}
