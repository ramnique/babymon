import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/ratelimit.js';

describe('RateLimiter', () => {
  it('allows up to capacity, then blocks', () => {
    let t = 0;
    const limiter = new RateLimiter(3, 1, () => t);
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('a')).toBe(false);
  });

  it('refills over time', () => {
    let t = 0;
    const limiter = new RateLimiter(1, 0.5, () => t); // 1 token / 2s
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('a')).toBe(false);
    t += 2000;
    expect(limiter.allow('a')).toBe(true);
  });

  it('tracks keys independently and sweeps refilled buckets', () => {
    let t = 0;
    const limiter = new RateLimiter(1, 1, () => t);
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('b')).toBe(true);
    expect(limiter.allow('a')).toBe(false);
    t += 5000;
    limiter.sweep();
    expect(limiter.allow('a')).toBe(true);
  });
});
