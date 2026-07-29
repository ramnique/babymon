import { isPrivateAddr } from './rtcstats';

export interface GeoDetails {
  ip?: string;
  country?: string | null;
  city?: string | null;
  continent?: string | null;
  subdivision?: string | null;
  postal?: string | null;
  location?: {
    latitude?: number;
    longitude?: number;
    accuracy_radius?: number;
    time_zone?: string;
  } | null;
  asn?: { number?: number; organization?: string } | null;
}

const FIELDS = 'city,continent,subdivision,postal,location,asn';

/**
 * GeoIP details via https://country.is — free, keyless, claims no request
 * logging, rate-limited at 10 req/s (our per-IP cache keeps us far below).
 * Private/LAN addresses are never sent anywhere.
 */
const cache = new Map<string, Promise<GeoDetails | null>>();

export function geoFor(ip: string): Promise<GeoDetails | null> {
  if (isPrivateAddr(ip) !== false) return Promise.resolve(null);
  let hit = cache.get(ip);
  if (!hit) {
    hit = fetch(`https://api.country.is/${encodeURIComponent(ip)}?fields=${FIELDS}`)
      .then((res) => (res.ok ? (res.json() as Promise<GeoDetails>) : null))
      .then((body) => (body?.country ? body : null))
      .catch(() => {
        cache.delete(ip); // transient failure — allow a retry later
        return null;
      });
    cache.set(ip, hit);
  }
  return hit;
}

/** 'DE' → 🇩🇪 via regional indicator symbols. */
export function flagEmoji(countryCode: string): string {
  return countryCode
    .toUpperCase()
    .replace(/[A-Z]/g, (c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65));
}

/** Human-readable label/value rows for the detail popover. */
export function geoRows(geo: GeoDetails): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (geo.country) rows.push(['Country', `${flagEmoji(geo.country)} ${geo.country}`]);
  const place = [geo.city, geo.subdivision].filter(Boolean).join(', ');
  if (place) rows.push(['Place', place]);
  if (geo.postal) rows.push(['Postal', geo.postal]);
  if (geo.continent) rows.push(['Continent', geo.continent]);
  const loc = geo.location;
  if (loc?.latitude !== undefined && loc?.longitude !== undefined) {
    const radius = loc.accuracy_radius !== undefined ? ` (±${loc.accuracy_radius} km)` : '';
    rows.push(['Coords', `${loc.latitude}, ${loc.longitude}${radius}`]);
  }
  if (loc?.time_zone) rows.push(['Timezone', loc.time_zone]);
  if (geo.asn?.number !== undefined || geo.asn?.organization) {
    const parts = [
      geo.asn.number !== undefined ? `AS${geo.asn.number}` : null,
      geo.asn.organization ?? null,
    ].filter(Boolean);
    rows.push(['Network', parts.join(' · ')]);
  }
  return rows;
}
