export interface MotionOptions {
  /** Per-pixel luma delta (0..255) that counts as "changed", at normal light. */
  pixelThreshold: number;
  /** Fraction of (masked) pixels that must change to count as motion. */
  areaThreshold: number;
  /** Consecutive motion frames required before triggering. */
  consecutive: number;
  /**
   * Background adaptation rate per frame (0..1). The frame is compared
   * against a slowly-evolving background instead of just the previous frame,
   * so slow movement accumulates drift and gets caught.
   */
  bgAlpha: number;
  /**
   * Floor for the darkness-scaled pixel threshold. In dim scenes contrast
   * collapses, so the threshold scales down with mean brightness — but never
   * below this, or sensor noise starts counting as motion.
   */
  minPixelThreshold: number;
  /**
   * When at least this fraction of the WHOLE frame changes at once, treat it
   * as auto-exposure / a light switching on / the camera being bumped:
   * adopt the new scene silently instead of alerting.
   */
  globalChangeFraction: number;
  /**
   * Grid width in cells. When set, an isolated changed cell with no changed
   * 4-neighbor is ignored (cheap stand-in for morphological open).
   */
  width?: number;
}

export const DEFAULT_MOTION_OPTIONS: MotionOptions = {
  pixelThreshold: 24,
  areaThreshold: 0.02,
  consecutive: 3,
  bgAlpha: 0.12,
  minPixelThreshold: 7,
  globalChangeFraction: 0.6,
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

/**
 * Motion detector over successive grayscale frames: running-background
 * comparison, darkness-adaptive threshold, exposure-change guard,
 * isolated-cell filter, and a consecutive-frame streak gate.
 */
export class MotionDetector {
  private bg: Float32Array | null = null;
  private changed: Uint8Array | null = null;
  private streak = 0;
  mask?: Uint8Array;
  private readonly opts: MotionOptions;

  constructor(opts: MotionOptions = DEFAULT_MOTION_OPTIONS) {
    this.opts = opts;
  }

  /** Returns true when this frame completes a triggering streak. */
  frame(gray: Uint8ClampedArray | Uint8Array): boolean {
    const n = gray.length;
    if (!this.bg || this.bg.length !== n) {
      this.bg = Float32Array.from(gray);
      this.changed = new Uint8Array(n);
      this.streak = 0;
      return false;
    }
    const bg = this.bg;
    const changed = this.changed!;

    // Darkness-adaptive threshold: scale with mean brightness (128 = "normal
    // light"), so low-contrast movement in a dim nursery still registers.
    let sum = 0;
    for (let i = 0; i < n; i++) sum += gray[i]!;
    const mean = sum / n;
    const threshold = Math.max(
      this.opts.minPixelThreshold,
      this.opts.pixelThreshold * Math.min(1, mean / 128),
    );

    let globalChanged = 0;
    for (let i = 0; i < n; i++) {
      const c = Math.abs(gray[i]! - bg[i]!) > threshold ? 1 : 0;
      changed[i] = c;
      globalChanged += c;
    }

    if (globalChanged / n >= this.opts.globalChangeFraction) {
      // Exposure shift, a light switching on, or the camera being moved —
      // everything changed at once, which real motion in a crib never does.
      bg.set(gray);
      this.streak = 0;
      return false;
    }

    const w = this.opts.width;
    const useNeighbors = w !== undefined && w > 0 && n % w === 0;
    let hits = 0;
    let considered = 0;
    for (let i = 0; i < n; i++) {
      if (this.mask && !this.mask[i]) continue;
      considered++;
      if (!changed[i]) continue;
      if (useNeighbors) {
        const x = i % w!;
        const hasNeighbor =
          (x > 0 && changed[i - 1]! > 0) ||
          (x < w! - 1 && changed[i + 1]! > 0) ||
          (i >= w! && changed[i - w!]! > 0) ||
          (i + w! < n && changed[i + w!]! > 0);
        if (!hasNeighbor) continue; // lone speck: sensor/compression noise
      }
      hits++;
    }
    const fraction = considered === 0 ? 0 : hits / considered;

    // Adapt the background after measuring against it.
    const a = this.opts.bgAlpha;
    for (let i = 0; i < n; i++) bg[i]! += a * (gray[i]! - bg[i]!);

    this.streak = fraction >= this.opts.areaThreshold ? this.streak + 1 : 0;
    if (this.streak >= this.opts.consecutive) {
      this.streak = 0;
      return true;
    }
    return false;
  }
}
