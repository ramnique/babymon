# babymon — Plan

A browser-based, WebRTC baby monitor. Open-source and self-hostable: one Docker
deployment anyone can run on their own host, behind their own domain and TLS.
No accounts, no third-party services in the media path.

## Decisions (agreed)

| Area | Decision |
|---|---|
| Audience | Open-source, anyone can self-host |
| Reach | Works on LAN and over the internet (same code path — ICE picks the route) |
| Deployment | Docker Compose: app container (web + signaling + TURN-cred minting) + coturn (STUN/TURN). User brings hosting + domain + TLS via their own reverse proxy |
| Auth | Persistent high-entropy room code, generated and stored on the camera device; shared as link/QR; "regenerate" revokes all viewers; server rate-limits join attempts |
| Topology | 1 camera, max 2 concurrent viewers (3rd gets "room full") |
| v1 features | Live video+audio · push-to-talk talk-back · noise meter with adaptive-baseline alerts (white-noise tolerant) · motion detection with viewer-drawn region of interest |
| Detection | Viewer-side in v1, written as pure functions over a MediaStream so the same module can run camera-side in v2 (needed for push notifications) |
| Stack | pnpm monorepo · React + Vite + TS frontend · Hono on Node (TS) backend with `@hono/node-ws` |
| Primary camera device | Spare iPhone (Safari) on a charger — the strictest target; Android/desktop inherit |
| Deferred to v2+ | Web-push notifications, recording/snapshots, multi-camera, camera-side detection, ML denoising (RNNoise) |

## How it works (architecture)

```
                   SETUP ONLY (~KBs, via WSS through user's reverse proxy)
Camera (iPhone) ──ws── Hono server (rooms, relay, TURN creds) ──ws── Viewer(s)
        │                                                             │
        └───── STUN/TURN (coturn, UDP + TCP/443, exposed directly) ───┘

                   LIVE MEDIA (P2P where possible, coturn relay otherwise)
Camera ═══════════ encrypted SRTP video/audio ═══════════▶ Viewer
Camera ◀══════════ talk-back audio (while held) ══════════ Viewer
```

- **Signaling** is a dumb room-scoped message relay over WebSocket: offer/answer
  (SDP) and ICE candidates pass through; the server never sees media.
- **Rooms are ephemeral**: a room exists while a camera holds it. The room code
  never persists server-side; the camera registers its code on connect, viewers
  present a code, the server compares (constant-time) and admits or rejects.
- **One RTCPeerConnection per viewer** (max 2). Camera encodes/uploads one
  stream per viewer. Perfect-negotiation pattern; camera is polite peer.
- **TURN credentials are ephemeral**: minted by the server via coturn's
  `use-auth-secret` (HMAC of expiry-timestamp:username with a shared secret),
  handed out only after a successful room join. The static room code never
  reaches coturn.

## Security model

- Room code = the credential. ~128 bits entropy, word-encoded for humans
  (e.g. `kite-mango-river-8342-lunar`), shared as URL/QR so it's never typed.
- Server rate-limits join attempts per IP (and globally) to make online
  guessing hopeless; failed attempts get a constant delay.
- Everything browser-facing rides the user's HTTPS (WSS included). Media is
  DTLS-SRTP encrypted end-to-end between peers by WebRTC itself; the TURN
  relay, when used, forwards ciphertext it cannot read.
- Regenerating the code tears down the room and all peer connections.
- No cookies, no accounts, no server-side PII. localStorage holds the code on
  camera (and last-used code on viewers) — a "forget this device" button clears it.

## iPhone-camera constraints (design drivers)

Safari kills camera capture when the page backgrounds or the screen locks, so
the camera device is an **appliance: plugged in, page open, screen on**.

- **Wake Lock API** (Safari ≥16.4) keeps the screen awake; re-acquire on
  `visibilitychange` (Safari releases it when the page hides).
- **Monitoring UI is near-black** (OLED-friendly, no light in the nursery) with
  a tap-to-reveal status layer: connection state, viewer count, noise level,
  battery.
- **Interruption recovery**: phone calls, Siri, tab switches suspend capture.
  On `visibilitychange`/track-`ended`/`mute`, tear down and re-`getUserMedia`,
  renegotiate, and resume — automatically, no taps needed.
- **H.264 preferred** in SDP munging/`setCodecPreferences` (iPhone hardware
  encoder → cooler phone, longer battery life on old devices).
- **Autoplay**: viewer `<video>` starts muted (allowed everywhere); one tap
  enables audio. Talk-back mic permission requested on first press.
- Onboarding checklist on camera start: plug in charger, enable Guided
  Access (optional), add to Home Screen (optional), keep Safari foregrounded.

## Detection design (v1, viewer-side)

`packages/detection` — pure TS, no DOM assumptions beyond canvas/WebAudio
injection, so it can run on camera pages in v2.

- **Noise**: `AnalyserNode` RMS sampled ~10 Hz → rolling ~60 s baseline
  (exponential moving average + variance). Alert when level exceeds
  `baseline + k·σ` for ≥ N consecutive samples. A white-noise machine raises
  the baseline; a cry spikes above it. Sensitivity `k` is a viewer-local slider.
- **Motion**: downscaled frames (~64×48 grayscale) drawn to offscreen canvas at
  ~4 fps; per-pixel diff vs previous frame; alert when changed-pixel ratio
  inside the ROI mask crosses a threshold for ≥ N frames.
- **ROI**: viewer draws a polygon/rect overlay on the video; stored per-viewer
  in localStorage; applied as the diff mask. No syncing needed.
- **Alerts**: in-app only in v1 — sound + visual flash + vibration
  (where supported). Per-viewer mute/cooldown to prevent alert storms.
- Camera page additionally exposes `getUserMedia` audio constraints toggle:
  `noiseSuppression` on/off (default on).

## Monorepo layout

```
babymon/
├── pnpm-workspace.yaml
├── package.json
├── apps/
│   ├── web/                 # React + Vite + TS
│   │   └── src/
│   │       ├── routes/      # Home (pick role) · Camera · Viewer
│   │       ├── webrtc/      # peer connection, negotiation, reconnect
│   │       └── ui/          # meters, ROI editor, QR display/scanner
│   └── server/              # Hono on Node + @hono/node-ws
│       └── src/
│           ├── rooms.ts     # ephemeral room registry, 2-viewer cap
│           ├── signaling.ts # ws relay: join/offer/answer/ice/leave/kick
│           ├── turn.ts      # ephemeral HMAC credentials for coturn
│           └── ratelimit.ts
├── packages/
│   ├── shared/              # signaling message types (zod), room-code gen
│   └── detection/           # noise + motion, pure TS
├── docker/
│   ├── Dockerfile           # multi-stage: build web+server → single Node image
│   ├── docker-compose.yml   # app + coturn
│   └── turnserver.conf.tmpl
└── docs/                    # self-hosting guide, port matrix, reverse-proxy examples
```

Server serves the built `apps/web` statics in production → one container, one
process, plus coturn beside it.

## Signaling protocol (WS, JSON, zod-validated)

```
camera → server:  { t:"host", code }            # claim/reclaim room
viewer → server:  { t:"join", code }            # admitted | rejected | full
server → camera:  { t:"viewer-joined", peerId }
both   ↔ server:  { t:"signal", peerId, data }  # SDP/ICE passthrough
camera → server:  { t:"regenerate", newCode }   # kicks all viewers
server → both:    { t:"peer-left", peerId }
heartbeat ping/pong; server reaps dead peers; clients reconnect with backoff
and re-host/re-join automatically (camera restart ⇒ viewers auto-recover).
```

## Deployment (what a self-hoster does)

1. `git clone` → copy `.env.example` → set `TURN_SECRET`, `PUBLIC_HOST`.
2. `docker compose up -d` — starts app (port 8080) + coturn.
3. Point their reverse proxy (Caddy/nginx/Traefik) at `:8080` with their TLS.
4. Open firewall for coturn: `3478/udp+tcp`, `5349/tcp` (TLS TURN), relay port
   range `49160–49200/udp`. Docs include a copy-paste port matrix and Caddy
   example.
5. Open the site on the iPhone → "Camera" → QR appears → scan with your phone
   → watching.

LAN-only users skip steps 3–4 and it still works (host candidates connect
directly; docs note the HTTPS requirement still applies — mkcert recipe).

## Milestones

1. **Scaffold** — pnpm workspaces, shared types, Hono server skeleton, Vite app,
   CI (typecheck + lint + build).
2. **Signaling core** — rooms, WS relay, heartbeats, 2-viewer cap, rate limiting.
3. **First video** — camera/viewer pages, getUserMedia, perfect negotiation,
   working stream on LAN (desktop browsers).
4. **Code lifecycle** — generation, localStorage persistence, QR display/scan,
   join-by-link, regenerate/kick.
5. **Internet path** — coturn container, ephemeral TURN creds, verified relay
   connection (test with forced-relay `iceTransportPolicy`).
6. **Talk-back** — renegotiated return audio track, push-to-talk UI.
7. **Detection** — noise meter + adaptive alerts; motion + ROI editor; alert UX.
8. **iPhone hardening** — wake lock, dim UI, interruption auto-recovery,
   H.264 preference, autoplay handling, onboarding checklist.
9. **Packaging & docs** — Dockerfile, compose, turnserver template, self-host
   guide, reverse-proxy recipes, security notes.
10. **Hardening pass** — reconnection chaos-testing, join-flood test, code
    review of auth path.

## Open items (deliberately deferred)

- Web-push crying alerts (requires camera-side detection + service worker;
  iOS requires Home-Screen install) — v2 flagship.
- Recording/snapshots, multi-camera, viewer PIN-per-device, ML denoise — later.
