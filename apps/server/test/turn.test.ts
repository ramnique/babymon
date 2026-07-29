import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { mintIceServers, turnConfigFromEnv } from '../src/turn.js';

describe('mintIceServers', () => {
  it('returns stun-only when no TURN is configured', () => {
    const servers = mintIceServers({
      stunUrls: ['stun:s.example.org'],
      turnUrls: [],
      turnSecret: null,
      ttlSeconds: 3600,
    });
    expect(servers).toEqual([{ urls: ['stun:s.example.org'] }]);
  });

  it('mints coturn REST-style ephemeral credentials', () => {
    const now = 1_700_000_000_000;
    const servers = mintIceServers(
      {
        stunUrls: [],
        turnUrls: ['turn:t.example.org:3478'],
        turnSecret: 'sekrit',
        ttlSeconds: 600,
      },
      () => now,
    );
    expect(servers).toHaveLength(1);
    const turn = servers[0]!;
    expect(turn.username).toBe(`${1_700_000_000 + 600}:babymon`);
    const expected = createHmac('sha1', 'sekrit').update(turn.username!).digest('base64');
    expect(turn.credential).toBe(expected);
  });
});

describe('turnConfigFromEnv', () => {
  it('defaults to a public STUN server and no TURN', () => {
    const config = turnConfigFromEnv({} as NodeJS.ProcessEnv);
    expect(config.stunUrls.length).toBeGreaterThan(0);
    expect(config.turnUrls).toEqual([]);
    expect(config.turnSecret).toBeNull();
  });

  it('parses comma-separated TURN urls', () => {
    const config = turnConfigFromEnv({
      TURN_URLS: 'turn:x:3478?transport=udp,turns:x:5349',
      TURN_SECRET: 's',
    } as unknown as NodeJS.ProcessEnv);
    expect(config.turnUrls).toHaveLength(2);
    expect(config.turnSecret).toBe('s');
  });
});
