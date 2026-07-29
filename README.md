# babymon

A baby monitor that runs entirely in the browser. Point a spare phone at the
crib, open a link on your own phone — video streams peer-to-peer over WebRTC,
on your LAN or across the internet. Self-hosted, open source, no accounts, no
cloud in the media path.

- **Camera**: any spare phone (designed/tested iPhone-first) on a charger with
  the page open. Persistent room code, shown as a QR/link.
- **Viewers** (up to 2): open the link, watch live. Push-to-talk to soothe the
  baby, noise alerts that adapt to white-noise machines, motion alerts with a
  drawable watch area.
- **Server**: one small container — serves the app, relays a few KB of
  signaling per session, and mints ephemeral TURN credentials. Video never
  touches it (except via optional coturn relay when direct P2P is impossible).

## Self-hosting

Requirements: any Linux host running Docker with a public IP (a $5 VPS is
plenty), and a domain pointing at it. HTTPS is included — a bundled Caddy
container obtains and renews the Let's Encrypt certificate automatically
(browsers require HTTPS for camera access).

```sh
git clone https://github.com/ramnique/babymon && cd babymon
cp .env.example .env        # set PUBLIC_HOST and a random TURN_SECRET
docker compose up -d --build
```

Point your domain's DNS at the server *before* the first start so Caddy can
obtain the certificate. That's the whole deployment.

Step-by-step guides: **[Self-hosting guide](docs/self-hosting.md)** (deploy,
updating, TURN verification, troubleshooting) with provider walkthroughs for
[DigitalOcean](docs/hosting/digitalocean.md),
[AWS Lightsail](docs/hosting/aws-lightsail.md), and
[Hetzner](docs/hosting/hetzner.md).

Prefer your own reverse proxy (nginx/Traefik)? Remove the `caddy` service,
re-expose `app` on 8080, and remember the WebSocket upgrade headers for `/ws`
and `X-Forwarded-For` (used for rate limiting).

### Ports to open

| Port | Protocol | What |
|---|---|---|
| 80 + 443 | TCP (+443 UDP for HTTP/3) | HTTPS via bundled Caddy |
| 3478 | UDP + TCP | TURN (coturn) |
| 49160–49200 | UDP | TURN relay range |

The TURN ports are only *needed* by the ~10–20% of network combinations that
can't connect peer-to-peer (strict NATs, some mobile carriers). Everything
still works without them for everyone else.

### LAN-only use

Skip the ports/coturn entirely — devices on the same Wi-Fi connect directly.
You still need HTTPS (or `localhost`) for camera permission; for a quick LAN
setup use [mkcert](https://github.com/FiloSottile/mkcert) with your machine's
LAN IP, or run behind Tailscale which provides certificates.

## How it works

```
        setup only (~KBs, via wss:// through your reverse proxy)
camera ──ws── app container (rooms, relay, TURN creds) ──ws── viewer
   │                                                            │
   └────────── coturn (STUN/TURN, ports 3478 + relay) ──────────┘

        live media (P2P where possible, coturn relay otherwise)
camera ═══════════ encrypted SRTP audio/video ═══════════▶ viewer
```

- The **room code** (~100 bits of entropy, generated on the camera device,
  never stored server-side) is the only credential. Share it as QR/link;
  regenerate it to kick every viewer. Join attempts are rate-limited per IP.
- Signaling is a dumb relay: offer/answer/ICE pass through opaque.
- TURN credentials are ephemeral HMACs (coturn `use-auth-secret`), issued only
  after a successful room join.
- Media is DTLS-SRTP end-to-end between the two browsers; a TURN relay, when
  used, forwards ciphertext it cannot read.

## Development

```sh
pnpm install
pnpm dev          # server on :8080, web (Vite) on :5173 with /ws proxied
pnpm test         # vitest across the workspace
pnpm typecheck
pnpm build
```

Monorepo layout:

| Path | What |
|---|---|
| `apps/web` | React + Vite app (camera, viewer, monitoring UI) |
| `apps/server` | Hono + WebSocket signaling server, TURN cred minting |
| `packages/shared` | zod-typed signaling protocol + room-code generation |
| `packages/detection` | pure-TS noise/motion detection (runs viewer-side today, camera-side later) |

The full design and milestone plan is in [PLAN.md](PLAN.md).

## License

MIT
