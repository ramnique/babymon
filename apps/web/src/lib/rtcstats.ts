export interface RouteInfo {
  kind: 'lan' | 'internet' | 'relay' | 'connecting';
  localAddr?: string;
  remoteAddr?: string;
  rttMs?: number;
}

type AnyStat = Record<string, unknown> & { id: string; type: string };

/** True for addresses that can't leave the local network; null if unknown. */
export function isPrivateAddr(addr: unknown): boolean | null {
  if (typeof addr !== 'string' || addr.length === 0) return null;
  const a = addr.toLowerCase().replace(/^\[|\]$/g, '');
  if (a.endsWith('.local')) return true; // mDNS-obfuscated LAN address
  if (a === '::1' || a.startsWith('127.')) return true; // loopback
  if (a.startsWith('fe80:') || a.startsWith('fd') || a.startsWith('fc')) return true; // IPv6 link-local/ULA
  if (a.startsWith('10.') || a.startsWith('192.168.')) return true;
  const octets = a.match(/^172\.(\d{1,3})\./);
  if (octets) {
    const second = Number(octets[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

/** Expand an IPv6 address into its 8 padded hextets; null if not IPv6. */
export function expandV6(addr: string): string[] | null {
  const s = addr.split('%')[0]!; // drop zone id (fe80::1%en0)
  if (!s.includes(':')) return null;
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1) {
    return head.length === 8 ? head.map((h) => h.padStart(4, '0')) : null;
  }
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  return [...head, ...Array<string>(missing).fill('0'), ...tail].map((h) => h.padStart(4, '0'));
}

/**
 * Same-network heuristic. Private/loopback/mDNS on both ends is local; so is
 * an identical address on both ends (same machine), and two global IPv6
 * addresses sharing a /64 prefix (one home network = one SLAAC prefix).
 */
export function isSameLan(
  a: string | undefined,
  b: string | undefined,
  aType: string | undefined,
  bType: string | undefined,
): boolean {
  if (a && b && a === b) return true;
  const aPrivate = isPrivateAddr(a) ?? aType === 'host';
  const bPrivate = isPrivateAddr(b) ?? bType === 'host';
  if (aPrivate && bPrivate) return true;
  if (a && b) {
    const pa = expandV6(a.toLowerCase().replace(/^\[|\]$/g, ''));
    const pb = expandV6(b.toLowerCase().replace(/^\[|\]$/g, ''));
    if (pa && pb && pa.slice(0, 4).join(':') === pb.slice(0, 4).join(':')) return true;
  }
  return false;
}

/**
 * Classify the route the media is actually taking, from the selected ICE
 * candidate pair: both ends 'host' → same-LAN direct; any 'relay' → TURN;
 * anything else → hole-punched direct over the internet.
 */
export async function getRouteInfo(pc: RTCPeerConnection): Promise<RouteInfo> {
  let report: RTCStatsReport;
  try {
    report = await pc.getStats();
  } catch {
    return { kind: 'connecting' };
  }

  const byId = new Map<string, AnyStat>();
  report.forEach((r) => byId.set((r as AnyStat).id, r as AnyStat));

  let pair: AnyStat | undefined;
  report.forEach((r) => {
    const s = r as AnyStat;
    if (s.type === 'transport' && typeof s.selectedCandidatePairId === 'string') {
      pair = byId.get(s.selectedCandidatePairId);
    }
  });
  if (!pair) {
    // Firefox: no transport.selectedCandidatePairId; find the nominated pair.
    report.forEach((r) => {
      const s = r as AnyStat;
      if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated) pair ??= s;
    });
  }
  if (!pair) return { kind: 'connecting' };

  const local = byId.get(pair.localCandidateId as string);
  const remote = byId.get(pair.remoteCandidateId as string);
  const localType = local?.candidateType as string | undefined;
  const remoteType = remote?.candidateType as string | undefined;

  // Classify by what the addresses are, not the candidate-type labels: a
  // permission-less page hides its LAN IP behind mDNS (shows as 'prflx' on
  // the far side), and same-LAN IPv6 uses globally-routable addresses.
  const localAddr = (local?.address ?? local?.ip) as string | undefined;
  const remoteAddr = (remote?.address ?? remote?.ip) as string | undefined;

  const kind =
    localType === 'relay' || remoteType === 'relay'
      ? 'relay'
      : isSameLan(localAddr, remoteAddr, localType, remoteType)
        ? 'lan'
        : 'internet';

  const rtt = pair.currentRoundTripTime as number | undefined;
  return {
    kind,
    localAddr,
    remoteAddr: remoteAddr ? `${remoteAddr}:${remote?.port ?? ''}` : undefined,
    rttMs: typeof rtt === 'number' ? Math.round(rtt * 1000) : undefined,
  };
}

/**
 * Final route classification, combining getStats (authoritative for relay vs
 * direct) with the signaling server's view of both parties' IPs. Two peers
 * reaching the server from the same address are behind the same router —
 * that's what "local network" means — and this signal is symmetric, so both
 * panels always agree. Browser-side address heuristics can't do this reliably
 * because a page without media permission is not allowed to know its own LAN
 * address (mDNS obfuscation).
 */
export function resolveKind(
  route: RouteInfo | null | undefined,
  serverIpA: string | undefined,
  serverIpB: string | undefined,
): RouteInfo['kind'] {
  if (!route || route.kind === 'connecting') return 'connecting';
  if (route.kind === 'relay') return 'relay';
  if (serverIpA && serverIpB) return serverIpA === serverIpB ? 'lan' : 'internet';
  return route.kind;
}

export function routeSummary(route: RouteInfo | null | undefined): string {
  switch (route?.kind) {
    case 'lan':
      return 'local network · direct';
    case 'internet':
      return 'internet · direct P2P';
    case 'relay':
      return 'internet · via relay';
    default:
      return 'route: checking…';
  }
}

export const ROUTE_EXPLAINER =
  'Video is encrypted end-to-end (DTLS-SRTP) on every route. “Local network” ' +
  'means it never leaves your Wi-Fi. “Direct P2P” means it flows straight ' +
  'between the two devices over the internet. “Via relay” means both devices ' +
  'connect out to your TURN server, which forwards the encrypted stream ' +
  'without being able to decrypt it. IP addresses are as seen by your ' +
  'signaling server. Country flags are looked up via country.is (public IPs ' +
  'only are sent there; the service states it does not log requests).';
