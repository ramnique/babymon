import { describe, expect, it } from 'vitest';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '../src/roomCode.js';

describe('generateRoomCode', () => {
  it('produces valid, well-formed codes', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(/^[0-9a-z]{4}(-[0-9a-z]{4}){4}$/);
      expect(isValidRoomCode(code)).toBe(true);
    }
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 1000 }, generateRoomCode));
    expect(seen.size).toBe(1000);
  });
});

describe('normalizeRoomCode', () => {
  it('round-trips generated codes through messy input', () => {
    const code = generateRoomCode();
    expect(normalizeRoomCode(` ${code.toUpperCase()} `)).toBe(code);
    expect(normalizeRoomCode(code.replace(/-/g, ' '))).toBe(code);
  });

  it('maps confusable characters', () => {
    expect(normalizeRoomCode('Oi lU')).toBe('011v');
  });
});
