export interface AdaptiveThresholdOptions {
  /** EMA half-life in samples for the ambient baseline (~600 samples = 60s at 10 Hz). */
  baselineHalfLife: number;
  /** How many standard deviations above baseline counts as loud. */
  sigmas: number;
  /** Consecutive loud samples required before triggering. */
  consecutive: number;
  /** Floor on the deviation so a dead-silent room doesn't trigger on a whisper. */
  minDeviation: number;
}

export const DEFAULT_NOISE_OPTIONS: AdaptiveThresholdOptions = {
  baselineHalfLife: 600,
  sigmas: 3,
  consecutive: 3,
  minDeviation: 0.04,
};

/**
 * Spike-above-ambient detector. Feed it a level sample (RMS 0..1) at a fixed
 * rate; it tracks a slow-moving baseline + variance so steady noise (white
 * noise machine, fan) raises the floor instead of alerting, while a cry —
 * a sustained spike above ambient — triggers.
 *
 * Pure math, no DOM: runs identically on viewer (v1) or camera (v2).
 */
export class AdaptiveThreshold {
  private mean = 0;
  private variance = 0;
  private initialized = false;
  private loudStreak = 0;
  private readonly alpha: number;
  private readonly opts: AdaptiveThresholdOptions;

  constructor(opts: AdaptiveThresholdOptions = DEFAULT_NOISE_OPTIONS) {
    this.opts = opts;
    this.alpha = 1 - Math.pow(0.5, 1 / opts.baselineHalfLife);
  }

  /** Returns true when this sample completes a triggering streak. */
  sample(level: number): boolean {
    if (!this.initialized) {
      this.mean = level;
      this.initialized = true;
      return false;
    }

    const threshold = this.threshold();
    const loud = level > threshold;
    const d = level - this.mean;

    // Variance always adapts at full speed: a persistently loud environment
    // (white-noise machine switching on) quickly widens the tolerance band.
    this.variance += this.alpha * (d * d - this.variance);
    // The mean adapts an order slower to loud samples, so minutes of crying
    // can't teach the detector that crying is ambient — but hours of steady
    // noise eventually become the new baseline.
    this.mean += (loud ? this.alpha / 6 : this.alpha) * d;

    this.loudStreak = loud ? this.loudStreak + 1 : 0;

    if (this.loudStreak >= this.opts.consecutive) {
      this.loudStreak = 0;
      return true;
    }
    return false;
  }

  threshold(): number {
    const dev = Math.max(this.opts.sigmas * Math.sqrt(this.variance), this.opts.minDeviation);
    return this.mean + dev;
  }

  baseline(): number {
    return this.mean;
  }
}
