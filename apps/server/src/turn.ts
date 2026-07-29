import { createHmac } from 'node:crypto';
import type { IceServer } from '@babymon/shared';

export interface TurnConfig {
  stunUrls: string[];
  turnUrls: string[];
  /** Shared secret matching coturn's `use-auth-secret` / `static-auth-secret`. */
  turnSecret: string | null;
  ttlSeconds: number;
}

export function turnConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TurnConfig {
  return {
    stunUrls: (env.STUN_URLS ?? 'stun:stun.l.google.com:19302').split(',').filter(Boolean),
    turnUrls: (env.TURN_URLS ?? '').split(',').filter(Boolean),
    turnSecret: env.TURN_SECRET || null,
    ttlSeconds: Number(env.TURN_TTL_SECONDS ?? 6 * 3600),
  };
}

/**
 * Ephemeral TURN credentials per coturn's REST API convention: username is
 * an expiry timestamp, credential is HMAC-SHA1(secret, username). Handed out
 * only inside hosted/joined acks, i.e. after room auth has succeeded.
 */
export function mintIceServers(config: TurnConfig, now: () => number = Date.now): IceServer[] {
  const servers: IceServer[] = [];
  if (config.stunUrls.length > 0) {
    servers.push({ urls: config.stunUrls });
  }
  if (config.turnUrls.length > 0 && config.turnSecret) {
    const username = `${Math.floor(now() / 1000) + config.ttlSeconds}:babymon`;
    const credential = createHmac('sha1', config.turnSecret).update(username).digest('base64');
    servers.push({ urls: config.turnUrls, username, credential });
  }
  return servers;
}
