import { describe, expect, it } from 'vitest';
import { DEFAULT_MOTION_OPTIONS, MotionDetector, changedFraction } from '../src/motion.js';

const W = 8;
const H = 6;

function frame(fill: number): Uint8Array {
  return new Uint8Array(W * H).fill(fill);
}

/** Frame with a rectangular block set to a different value. */
function frameWithBlock(fill: number, block: number, x0 = 2, y0 = 2, bw = 3, bh = 2): Uint8Array {
  const f = frame(fill);
  for (let y = y0; y < y0 + bh; y++) {
    for (let x = x0; x < x0 + bw; x++) f[y * W + x] = block;
  }
  return f;
}

function detector(overrides: Partial<typeof DEFAULT_MOTION_OPTIONS> = {}) {
  return new MotionDetector({ ...DEFAULT_MOTION_OPTIONS, width: W, ...overrides });
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
  it('triggers on sustained localized change', () => {
    const det = detector();
    expect(det.frame(frame(100))).toBe(false); // background init
    expect(det.frame(frameWithBlock(100, 220))).toBe(false); // streak 1
    expect(det.frame(frameWithBlock(100, 220))).toBe(false); // streak 2
    expect(det.frame(frameWithBlock(100, 220))).toBe(true); // streak 3 → trigger
  });

  it('does not trigger on a static scene or a single flicker', () => {
    const det = detector();
    det.frame(frame(100));
    expect(det.frame(frameWithBlock(100, 220))).toBe(false); // one-frame flicker
    for (let i = 0; i < 20; i++) {
      expect(det.frame(frame(100))).toBe(false);
    }
  });

  it('catches slow drift that per-frame comparison would miss', () => {
    // The block brightens by 8/frame — always below the bright-scene
    // threshold of 24 versus the PREVIOUS frame, but drift accumulates
    // against the slow background model.
    const det = detector();
    det.frame(frame(100));
    let triggered = false;
    for (let step = 1; step <= 12; step++) {
      if (det.frame(frameWithBlock(100, 100 + step * 8))) triggered = true;
    }
    expect(triggered).toBe(true);
  });

  it('catches low-contrast movement in a dark scene', () => {
    // Mean brightness ~20 scales the threshold down to the floor (7), so a
    // 20-level change registers even though it is far below the default 24.
    const det = detector();
    det.frame(frame(20));
    expect(det.frame(frameWithBlock(20, 40))).toBe(false);
    expect(det.frame(frameWithBlock(20, 40))).toBe(false);
    expect(det.frame(frameWithBlock(20, 40))).toBe(true);
  });

  it('ignores isolated single-cell noise', () => {
    // Three scattered non-adjacent hot cells: 3/48 = 6% of the frame, well
    // over areaThreshold, but every one is a lone speck.
    const det = detector();
    det.frame(frame(100));
    for (let i = 0; i < 10; i++) {
      const f = frame(100);
      f[0] = 250; // corner
      f[3 * W + 4] = 250; // middle
      f[5 * W + 7] = 250; // opposite corner
      expect(det.frame(f)).toBe(false);
    }
  });

  it('treats a whole-frame jump as an exposure change, not motion', () => {
    const det = detector();
    det.frame(frame(20));
    // Light switches on: every cell changes at once.
    for (let i = 0; i < 6; i++) {
      expect(det.frame(frame(180))).toBe(false);
    }
    // ...and the detector still works against the new baseline.
    expect(det.frame(frameWithBlock(180, 60))).toBe(false);
    expect(det.frame(frameWithBlock(180, 60))).toBe(false);
    expect(det.frame(frameWithBlock(180, 60))).toBe(true);
  });

  it('respects the ROI mask', () => {
    const det = detector();
    const mask = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) mask[y * W] = 1; // ROI = first column only
    det.mask = mask;
    det.frame(frame(100));
    // Sustained block change entirely outside the ROI.
    for (let i = 0; i < 10; i++) {
      expect(det.frame(frameWithBlock(100, 220, 3, 2, 3, 2))).toBe(false);
    }
  });

  it('resets cleanly when frame size changes', () => {
    const det = detector();
    det.frame(frame(10));
    expect(det.frame(new Uint8Array(4).fill(255))).toBe(false);
  });
});
