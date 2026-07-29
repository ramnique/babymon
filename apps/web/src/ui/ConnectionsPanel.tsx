import type { ServerToClient } from '@babymon/shared';
import { resolveKind, ROUTE_EXPLAINER, type RouteInfo } from '../lib/rtcstats';
import GeoTag from './GeoTag';

type Roster = Extract<ServerToClient, { t: 'roster' }>;

const KIND_LABEL: Record<RouteInfo['kind'], string> = {
  lan: 'local network',
  internet: 'internet · P2P',
  relay: 'via relay',
  connecting: 'checking…',
};

interface Props {
  roster: Roster | null;
  /** Which end of the connection this page is. */
  perspective: 'camera' | 'viewer';
  /** This viewer's peerId (viewer perspective only). */
  selfPeerId?: string | null;
  /** camera: routes keyed by viewer peerId · viewer: route keyed 'camera'. */
  routes: Map<string, RouteInfo>;
}

function RouteChip({ route, kind }: { route: RouteInfo | undefined; kind: RouteInfo['kind'] }) {
  return (
    <span
      className={`chip ${kind}`}
      title={route ? `path: ${route.localAddr ?? '?'} ⇄ ${route.remoteAddr ?? '?'}` : undefined}
    >
      {KIND_LABEL[kind]}
      {route?.rttMs !== undefined && kind !== 'connecting' && ` · ${route.rttMs}ms`}
    </span>
  );
}

export default function ConnectionsPanel({ roster, perspective, selfPeerId, routes }: Props) {
  const cameraIp = roster?.camera?.ip;
  const selfIp =
    perspective === 'viewer'
      ? roster?.viewers.find((v) => v.peerId === selfPeerId)?.ip
      : cameraIp;

  return (
    <div className="card">
      <strong>Who's connected</strong>
      <div className="connList">
        <div className="connRow">
          <div className="connWho">
            <span className="connRole">
              📷 Camera
              {perspective === 'camera' && <span className="youTag">this device</span>}
            </span>
            <span className="connMeta">
              {cameraIp ? (
                <>
                  <span className="mono">{cameraIp}</span>
                  <GeoTag ip={cameraIp} />
                </>
              ) : (
                'offline'
              )}
            </span>
          </div>
          {perspective === 'viewer' && cameraIp && (
            <RouteChip
              route={routes.get('camera')}
              kind={resolveKind(routes.get('camera'), cameraIp, selfIp)}
            />
          )}
        </div>

        {(roster?.viewers ?? []).map((v) => {
          const isSelf = perspective === 'viewer' && v.peerId === selfPeerId;
          const route = perspective === 'camera' ? routes.get(v.peerId) : undefined;
          return (
            <div className="connRow" key={v.peerId}>
              <div className="connWho">
                <span className="connRole">
                  👁 Viewer
                  {isSelf && <span className="youTag">this device</span>}
                </span>
                <span className="connMeta">
                  <span className="mono">{v.ip}</span>
                  <GeoTag ip={v.ip} />
                </span>
              </div>
              {perspective === 'camera' && (
                <RouteChip route={route} kind={resolveKind(route, cameraIp, v.ip)} />
              )}
            </div>
          );
        })}

        {(roster?.viewers ?? []).length === 0 && (
          <div className="connRow">
            <span className="muted">No viewers right now.</span>
          </div>
        )}
      </div>

      <details className="explainer">
        <summary>What does this mean?</summary>
        <p className="muted">{ROUTE_EXPLAINER}</p>
      </details>
    </div>
  );
}
