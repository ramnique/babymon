import { afterEach, describe, expect, it, vi } from 'vitest';
import { flagEmoji, geoFor, geoRows, type GeoDetails } from './geoip';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('flagEmoji', () => {
  it('maps country codes to regional indicator flags', () => {
    expect(flagEmoji('DE')).toBe('🇩🇪');
    expect(flagEmoji('in')).toBe('🇮🇳');
    expect(flagEmoji('US')).toBe('🇺🇸');
  });
});

describe('geoFor', () => {
  it('never sends private or unknown addresses anywhere', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    for (const ip of ['192.168.1.5', '10.0.0.2', '::1', '127.0.0.1', 'abcd.local', '']) {
      expect(await geoFor(ip)).toBeNull();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('requests full fields for public IPs and caches per IP', async () => {
    const body: GeoDetails = { ip: '203.0.113.7', country: 'DE', city: 'Berlin' };
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });
    vi.stubGlobal('fetch', fetchSpy);

    expect((await geoFor('203.0.113.7'))?.city).toBe('Berlin');
    expect((await geoFor('203.0.113.7'))?.country).toBe('DE');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.country.is/203.0.113.7?fields=city,continent,subdivision,postal,location,asn',
    );
  });

  it('returns null on API failure without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await geoFor('198.51.100.9')).toBeNull();
  });
});

describe('geoRows', () => {
  it('formats a full record into labeled rows, skipping nulls', () => {
    const rows = geoRows({
      ip: '81.2.69.142',
      country: 'GB',
      city: 'Ipswich',
      continent: 'EU',
      subdivision: 'ENG',
      postal: 'IP4',
      location: { latitude: 52.06, longitude: 1.15, accuracy_radius: 100, time_zone: 'Europe/London' },
      asn: { number: 20712, organization: 'Andrews & Arnold Ltd' },
    });
    expect(rows).toEqual([
      ['Country', '🇬🇧 GB'],
      ['Place', 'Ipswich, ENG'],
      ['Postal', 'IP4'],
      ['Continent', 'EU'],
      ['Coords', '52.06, 1.15 (±100 km)'],
      ['Timezone', 'Europe/London'],
      ['Network', 'AS20712 · Andrews & Arnold Ltd'],
    ]);
  });

  it('handles sparse records (nulled fields) gracefully', () => {
    const rows = geoRows({ country: 'US', city: null, subdivision: null, postal: null });
    expect(rows).toEqual([['Country', '🇺🇸 US']]);
  });
});
