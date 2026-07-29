import { describe, expect, it } from 'vitest';
import { expandV6, isPrivateAddr, isSameLan, resolveKind, type RouteInfo } from './rtcstats';

describe('isPrivateAddr', () => {
  it('recognizes private, loopback, link-local, and mDNS addresses', () => {
    for (const a of [
      '192.168.1.5',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.1',
      '127.0.0.1',
      '::1',
      'fe80::abcd%en0',
      'fd12:3456::1',
      'a1b2c3d4-e5f6.local',
    ]) {
      expect(isPrivateAddr(a), a).toBe(true);
    }
  });

  it('recognizes public addresses', () => {
    for (const a of ['8.8.8.8', '172.32.0.1', '203.0.113.7', '2a00:1450:4009::1']) {
      expect(isPrivateAddr(a), a).toBe(false);
    }
  });

  it('returns null for unknown input', () => {
    expect(isPrivateAddr(undefined)).toBeNull();
    expect(isPrivateAddr('')).toBeNull();
  });
});

describe('expandV6', () => {
  it('expands compressed forms', () => {
    expect(expandV6('::1')).toEqual(['0000', '0000', '0000', '0000', '0000', '0000', '0000', '0001']);
    expect(expandV6('2a00:1450::8:9')?.slice(0, 4)).toEqual(['2a00', '1450', '0000', '0000']);
  });

  it('rejects non-IPv6', () => {
    expect(expandV6('192.168.1.1')).toBeNull();
    expect(expandV6('not-an-address')).toBeNull();
  });
});

describe('isSameLan', () => {
  it('same-machine loopback and identical addresses are local', () => {
    expect(isSameLan('::1', '::1', 'host', 'prflx')).toBe(true);
    expect(isSameLan('2a00:1:2:3::9', '2a00:1:2:3::9', 'host', 'host')).toBe(true);
  });

  it('both-private is local even when one side is prflx (mDNS obfuscation)', () => {
    expect(isSameLan('192.168.1.5', '192.168.1.9', 'host', 'prflx')).toBe(true);
    expect(isSameLan('192.168.1.5', 'abcd1234.local', 'host', 'host')).toBe(true);
  });

  it('global IPv6 on the same /64 prefix is local; different prefixes are not', () => {
    expect(isSameLan('2a00:1:2:3:aaaa::1', '2a00:1:2:3:bbbb::2', 'host', 'host')).toBe(true);
    expect(isSameLan('2a00:1:2:3::1', '2a00:9:9:9::2', 'host', 'host')).toBe(false);
  });

  it('private-to-public is the internet', () => {
    expect(isSameLan('192.168.1.5', '203.0.113.7', 'host', 'srflx')).toBe(false);
  });

  it('falls back to candidate types when addresses are missing', () => {
    expect(isSameLan(undefined, undefined, 'host', 'host')).toBe(true);
    expect(isSameLan(undefined, undefined, 'host', 'srflx')).toBe(false);
  });
});

describe('resolveKind', () => {
  const direct = (kind: RouteInfo['kind']): RouteInfo => ({ kind });

  it('same server-observed IP wins over browser heuristics', () => {
    expect(resolveKind(direct('internet'), '::1', '::1')).toBe('lan');
    expect(resolveKind(direct('internet'), '81.2.3.4', '81.2.3.4')).toBe('lan');
  });

  it('different server-observed IPs mean internet even if heuristics said lan', () => {
    expect(resolveKind(direct('lan'), '81.2.3.4', '99.5.6.7')).toBe('internet');
  });

  it('relay and connecting are never overridden', () => {
    expect(resolveKind(direct('relay'), '::1', '::1')).toBe('relay');
    expect(resolveKind(direct('connecting'), '::1', '::1')).toBe('connecting');
    expect(resolveKind(null, '::1', '::1')).toBe('connecting');
  });

  it('falls back to the stats classification when roster IPs are missing', () => {
    expect(resolveKind(direct('lan'), undefined, '::1')).toBe('lan');
    expect(resolveKind(direct('internet'), '::1', undefined)).toBe('internet');
  });
});
