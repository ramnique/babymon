let ctx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
  try {
    if (!ctx || ctx.state === 'closed') ctx = new AudioContext();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * iOS suspends (or "interrupts") every AudioContext when the screen locks, a
 * call comes in, or another app takes audio focus — and after that, resume()
 * only reliably works from a user gesture. Revive opportunistically on every
 * tap and whenever the page becomes visible again.
 */
function revive(): void {
  const c = ensureCtx();
  if (c && c.state !== 'running') void c.resume().catch(() => {});
}

if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', revive, true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') revive();
  });
}

/** Whether the alert sound would actually be audible right now. */
export function alertSoundReady(): boolean {
  return ctx?.state === 'running';
}

/** Call from a user gesture (toggle/unmute) to unlock audio up front. */
export function primeAlertSound(): void {
  revive();
}

/** Three short beeps. Safe to call repeatedly; lazily creates the context. */
export function playAlertSound(): void {
  const c = ensureCtx();
  if (!c) return;
  const schedule = () => {
    try {
      const start = c.currentTime;
      for (let i = 0; i < 3; i++) {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.frequency.value = 880;
        osc.connect(gain);
        gain.connect(c.destination);
        const t = start + i * 0.28;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.5, t + 0.02);
        gain.gain.linearRampToValueAtTime(0, t + 0.2);
        osc.start(t);
        osc.stop(t + 0.22);
      }
    } catch {
      // Audio unavailable — visual/vibration alerts still fire.
    }
  };
  // Scheduling against a suspended context plays nothing even if it resumes
  // later; wait for the resume to land, then schedule against fresh time.
  if (c.state === 'running') schedule();
  else void c.resume().then(schedule).catch(() => {});
}

export function vibrate(): void {
  navigator.vibrate?.([200, 100, 200]);
}
