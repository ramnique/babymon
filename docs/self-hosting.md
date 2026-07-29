# Self-hosting babymon

babymon runs anywhere Docker runs. The stack is three containers: **Caddy**
(HTTPS, automatic Let's Encrypt certificate), the **app** (web + signaling),
and **coturn** (STUN/TURN relay for networks where direct peer-to-peer fails).

Provider-specific walkthroughs: [DigitalOcean](hosting/digitalocean.md) ·
[AWS Lightsail](hosting/aws-lightsail.md) · [Hetzner](hosting/hetzner.md).
Everything below applies to all of them.

## Requirements

- A Linux host with Docker and a **public IPv4 address** — the smallest paid
  tier of any VPS provider is plenty (1 GB RAM recommended; the Docker build
  runs on the host)
- A **domain or subdomain** you can point at it (e.g. `babymon.example.com`)
- These ports reachable from the internet:

| Port | Protocol | What |
|---|---|---|
| 22 | TCP | SSH (your access) |
| 80 | TCP | HTTP → HTTPS redirect + certificate issuance |
| 443 | TCP + UDP | HTTPS (UDP is HTTP/3, optional) |
| 3478 | TCP + UDP | TURN |
| 49160–49200 | UDP | TURN relay range |

## Deploy

DNS first — create an **A record** for your subdomain pointing at the server's
IP, and confirm it resolves (`dig +short babymon.example.com`) *before*
starting the stack, or certificate issuance will fail.

```sh
ssh root@<server-ip>
curl -fsSL https://get.docker.com | sh

git clone https://github.com/ramnique/babymon && cd babymon
cp .env.example .env
# edit .env: set PUBLIC_HOST to your domain, TURN_SECRET to a random value
#   sed -i "s/babymon.example.com/<your-domain>/" .env
#   sed -i "s/change-me/$(openssl rand -hex 32)/" .env

docker compose up -d --build
```

Verify:

```sh
docker compose ps                        # caddy, app, coturn all Up
curl -s https://<your-domain>/healthz    # {"ok":true,"rooms":0}
```

Open `https://<your-domain>` on the nursery phone → **Start as camera**. Scan
the QR with another device → watching.

## Updating

```sh
cd babymon && git pull && docker compose up -d --build
```

Only changed containers are recreated; certificates persist in a volume.
Reload open camera/viewer pages afterwards to pick up the new frontend.

## Verifying TURN actually works

Most connections go direct and never touch coturn, so a broken TURN setup can
hide for weeks until someone joins from a strict network. Force it once:
open both the camera and a viewer with `?relay=1` in the URL (e.g.
`https://<domain>/camera?relay=1` and `.../watch?relay=1#<code>`). If video
flows and the connections panel shows an amber **via relay** chip, TURN works.

## LAN-only use (no VPS)

On a single home network you can skip TURN and public exposure entirely, but
browsers still require HTTPS for camera access. Options:

- [mkcert](https://github.com/FiloSottile/mkcert) — generate a locally-trusted
  certificate for your machine's LAN IP and put any TLS proxy in front of the
  app container (re-expose port 8080 in `docker-compose.yml`)
- Tailscale — `tailscale cert` gives you a valid certificate and every device
  on your tailnet can reach the server

## Troubleshooting

- **Certificate errors / site unreachable over HTTPS** — DNS wasn't pointing
  at the server when Caddy started. Fix DNS, then `docker compose restart
  caddy` and watch `docker compose logs -f caddy`.
- **Viewer stuck on "checking…" with no video** — the viewer's network needs
  TURN and TURN isn't reachable. Check the UDP firewall rules (3478 +
  49160–49200), then run the `?relay=1` test above.
- **Roster shows a wrong/proxy IP** — if you replaced Caddy with your own
  proxy, make sure it forwards `X-Forwarded-For`.
- **Everything looks up but no video on any network** — check
  `docker compose logs coturn` for auth errors (mismatched `TURN_SECRET`).
