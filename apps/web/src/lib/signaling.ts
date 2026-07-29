import { serverToClient, type ClientToServer, type ServerToClient } from '@babymon/shared';

export type SignalingStatus = 'connecting' | 'open' | 'closed';

export function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

const MAX_BACKOFF_MS = 30_000;
/** Server pings every 10s; if nothing arrives for this long the socket is dead. */
const WATCHDOG_MS = 35_000;

/**
 * Typed WebSocket wrapper with automatic reconnect. Callers re-send their
 * host/join in `onstatus('open')` — reconnection re-runs the whole room
 * handshake, which is exactly what the server expects.
 */
export class SignalingClient {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;

  onmessage: (msg: ServerToClient) => void = () => {};
  onstatus: (status: SignalingStatus) => void = () => {};
  private readonly url: string;

  constructor(url: string = wsUrl()) {
    this.url = url;
  }

  connect(): void {
    if (this.closed) return;
    this.onstatus('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
      this.resetWatchdog();
      this.onstatus('open');
    };

    ws.onmessage = (evt) => {
      this.resetWatchdog();
      if (typeof evt.data !== 'string') return;
      let msg: ServerToClient;
      try {
        msg = serverToClient.parse(JSON.parse(evt.data));
      } catch {
        return;
      }
      if (msg.t === 'ping') {
        this.send({ t: 'pong' });
        return;
      }
      this.onmessage(msg);
    };

    ws.onclose = () => {
      if (this.ws !== ws) return; // superseded by a newer socket
      this.ws = null;
      this.clearWatchdog();
      this.onstatus('closed');
      this.scheduleReconnect();
    };
  }

  send(msg: ClientToServer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Politely close the current socket without ending the client — the server
   * frees our room slot immediately, and the normal reconnect/backoff logic
   * revives the session if the page turns out to still be alive (bfcache).
   * Call on pagehide.
   */
  dropConnection(): void {
    this.ws?.close();
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.clearWatchdog();
    this.ws?.close();
    this.ws = null;
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempts);
    this.attempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private resetWatchdog(): void {
    this.clearWatchdog();
    this.watchdog = setTimeout(() => this.ws?.close(), WATCHDOG_MS);
  }

  private clearWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
  }
}
