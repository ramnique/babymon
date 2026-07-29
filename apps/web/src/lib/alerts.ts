let ctx: AudioContext | null = null;

/** Three short beeps. Safe to call repeatedly; lazily creates the context. */
export function playAlertSound(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const start = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      osc.connect(gain);
      gain.connect(ctx.destination);
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
}

export function vibrate(): void {
  navigator.vibrate?.([200, 100, 200]);
}
