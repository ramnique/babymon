interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * Token bucket per key (client IP). Join attempts are the only guessing
 * surface for room codes, so they pay a token each; with 100-bit codes even
 * an unthrottled attacker is hopeless, this just keeps the noise down.
 */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly capacity = 10,
    private readonly refillPerSecond = 0.2, // 1 token / 5s
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const t = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.capacity, updatedAt: t };
      this.buckets.set(key, bucket);
    } else {
      const elapsed = (t - bucket.updatedAt) / 1000;
      bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerSecond);
      bucket.updatedAt = t;
    }
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  /** Drop buckets that have fully refilled (call periodically). */
  sweep(): void {
    const t = this.now();
    for (const [key, bucket] of this.buckets) {
      const elapsed = (t - bucket.updatedAt) / 1000;
      if (bucket.tokens + elapsed * this.refillPerSecond >= this.capacity) {
        this.buckets.delete(key);
      }
    }
  }
}
