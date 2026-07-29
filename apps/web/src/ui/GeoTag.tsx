import { useEffect, useState } from 'react';
import { flagEmoji, geoFor, geoRows, type GeoDetails } from '../lib/geoip';
import { isPrivateAddr } from '../lib/rtcstats';

/**
 * Country flag for a public IP, 🏠 for private/LAN addresses (never sent to
 * the lookup service). Hover or tap reveals the full GeoIP detail.
 */
export default function GeoTag({ ip }: { ip: string }) {
  const [geo, setGeo] = useState<GeoDetails | null>(null);
  const [open, setOpen] = useState(false);
  const isPrivate = isPrivateAddr(ip) === true;

  useEffect(() => {
    let live = true;
    void geoFor(ip).then((g) => {
      if (live) setGeo(g);
    });
    return () => {
      live = false;
    };
  }, [ip]);

  if (isPrivate) {
    return (
      <span className="geoTag" title="Private address — this device is on the local network">
        🏠
      </span>
    );
  }
  if (!geo?.country) return null;

  return (
    <span
      className="geoTag"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen((v) => !v)}
    >
      {flagEmoji(geo.country)}
      {open && (
        <span className="geoPop">
          {geoRows(geo).map(([label, value]) => (
            <span className="geoPopRow" key={label}>
              <span className="geoPopLabel">{label}</span>
              <span>{value}</span>
            </span>
          ))}
          <span className="geoPopRow">
            <span className="geoPopLabel">Source</span>
            <span>country.is</span>
          </span>
        </span>
      )}
    </span>
  );
}
