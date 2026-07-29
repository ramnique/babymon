import { describe, expect, it } from 'vitest';
import { MotionDetector, changedFraction } from '../src/motion.js';

const W = 8;
const H = 6;

function frame(fill: number): Uint8Array {
  return new Uint8Array(W * H).fill(fill);
}

describe('changedFraction', () => {
  it('is 0 for identical frames and 1 for fully changed frames', () => {
    expect(changedFraction(frame(10), frame(10), 24)).toBe(0);
    expect(changedFraction(frame(10), frame(200), 24)).toBe(1);
  });

  it('respects the ROI mask', () => {
    const prev = frame(10);
    const curr = frame(10);
    curr[0] = 255; // change outside the mask
    const mask = new Uint8Array(W * H);
    mask[W * H - 1] = 1; // ROI = last pixel only
    expect(changedFraction(prev, curr, 24, mask)).toBe(0);
    curr[W * H - 1] = 255;
    expect(changedFraction(prev, curr, 24, mask)).toBe(1);
  });
});

describe('MotionDetector', () => {
  it('triggers after sustained change', () => {
    const det = new MotionDetector();
    expect(det.frame(frame(10))).toBe(false);
    expect(det.frame(frame(100))).toBe(false); // streak 1
    expect(det.frame(frame(200))).toBe(true); // streak 2 → trigger
  });

  it('does not trigger on a static scene or a single flicker', () => {
    const det = new MotionDetector();
    det.frame(frame(10));
    expect(det.frame(frame(100))).toBe(false); // flicker
    expect(det.frame(frame(100))).toBe(false); // settled again (streak reset)
    for (let i = 0; i < 10; i++) expect(det.frame(frame(100))).toBe(false);
  });

  it('resets cleanly when frame size changes', () => {
    const det = new MotionDetector();
    det.frame(frame(10));
    expect(det.frame(new Uint8Array(4).fill(255))).toBe(false);
  });
});
