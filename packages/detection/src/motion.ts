export interface MotionOptions {
  /** Per-pixel luma delta (0..255) that counts as "changed". */
  pixelThreshold: number;
  /** Fraction of (masked) pixels that must change to count as motion. */
  areaThreshold: number;
  /** Consecutive motion frames required before triggering. */
  consecutive: number;
}

export const DEFAULT_MOTION_OPTIONS: MotionOptions = {
  pixelThreshold: 24,
  areaThreshold: 0.02,
  consecutive: 2,
};

/**
 * Fraction of pixels whose grayscale value changed beyond `pixelThreshold`.
 * `mask`, when given, limits detection to a region of interest: only pixels
 * with mask[i] > 0 are considered. Frames are raw grayscale buffers (one
 * byte per pixel) — the caller owns downscaling/gray conversion (canvas on
 * the web, anything else elsewhere).
 */
export function changedFraction(
  prev: Uint8ClampedArray | Uint8Array,
  curr: Uint8ClampedArray | Uint8Array,
  pixelThreshold: number,
  mask?: Uint8Array,
): number {
  if (prev.length !== curr.length) throw new Error('frame size mismatch');
  let changed = 0;
  let considered = 0;
  for (let i = 0; i < curr.length; i++) {
    if (mask && !mask[i]) continue;
    considered++;
    const a = prev[i]!;
    const b = curr[i]!;
    if (Math.abs(a - b) > pixelThreshold) changed++;
  }
  return considered === 0 ? 0 : changed / considered;
}

/** Streak-gated motion detector over successive grayscale frames. */
export class MotionDetector {
  private prev: Uint8ClampedArray | Uint8Array | null = null;
  private streak = 0;
  mask?: Uint8Array;
  private readonly opts: MotionOptions;

  constructor(opts: MotionOptions = DEFAULT_MOTION_OPTIONS) {
    this.opts = opts;
  }

  /** Returns true when this frame completes a triggering streak. */
  frame(gray: Uint8ClampedArray | Uint8Array): boolean {
    if (this.prev && this.prev.length === gray.length) {
      const fraction = changedFraction(this.prev, gray, this.opts.pixelThreshold, this.mask);
      this.streak = fraction >= this.opts.areaThreshold ? this.streak + 1 : 0;
    } else {
      this.streak = 0;
    }
    this.prev = gray.slice();
    if (this.streak >= this.opts.consecutive) {
      this.streak = 0;
      return true;
    }
    return false;
  }
}
