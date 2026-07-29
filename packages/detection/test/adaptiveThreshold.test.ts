import { describe, expect, it } from 'vitest';
import { AdaptiveThreshold } from '../src/adaptiveThreshold.js';

function feed(det: AdaptiveThreshold, level: number, n: number): number {
  let triggers = 0;
  for (let i = 0; i < n; i++) if (det.sample(level)) triggers++;
  return triggers;
}

describe('AdaptiveThreshold', () => {
  it('triggers on a spike above a quiet baseline', () => {
    const det = new AdaptiveThreshold();
    feed(det, 0.02, 600); // quiet room
    expect(feed(det, 0.4, 5)).toBeGreaterThan(0); // cry
  });

  it('does not trigger on steady white noise', () => {
    const det = new AdaptiveThreshold();
    feed(det, 0.02, 100);
    // White noise machine turns on: one alert at onset is acceptable, but the
    // baseline must adapt — sustained level must stop triggering.
    feed(det, 0.25, 2000);
    expect(feed(det, 0.25, 500)).toBe(0);
  });

  it('still catches a cry above the white-noise floor', () => {
    const det = new AdaptiveThreshold();
    feed(det, 0.25, 3000); // adapted to white noise
    expect(feed(det, 0.7, 5)).toBeGreaterThan(0);
  });

  it('ignores single-sample blips', () => {
    const det = new AdaptiveThreshold();
    feed(det, 0.02, 600);
    expect(det.sample(0.5)).toBe(false); // one loud sample, streak = 1 < 3
    expect(feed(det, 0.02, 10)).toBe(0);
  });
});
