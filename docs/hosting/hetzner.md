# Hosting babymon on Hetzner Cloud

Total time: ~15 minutes. Cost: from ~€4/month — the best price/performance of
the common providers, with regions in Germany, Finland, US, and Singapore.

## 1. Create the server

**Hetzner Cloud console → New project → Add server:**

- **Location:** closest to your home (relayed video round-trips through this
  box — note Hetzner has no South/East Asia region besides Singapore)
- **Image:** Ubuntu 24.04
- **Type:** shared vCPU (x86) — the smallest tier (2 vCPU / 4 GB) is already
  more than enough
- **SSH key:** add your public key (`~/.ssh/id_ed25519.pub`)

## 2. Firewall

**Firewalls → Create firewall**, apply to the server, with inbound rules:

| Protocol | Port |
|---|---|
| TCP | 22 |
| TCP | 80 |
| TCP | 443 |
| UDP | 443 |
| TCP | 3478 |
| UDP | 3478 |
| UDP | 49160–49200 |

(Hetzner firewalls accept port ranges like `49160-49200` directly.)

## 3. DNS

Add an **A record**: `babymon.yourdomain.com` → the server's IPv4 address.
Confirm with `dig +short babymon.yourdomain.com`.

## 4. Deploy

Follow the [common deploy steps](../self-hosting.md#deploy) — SSH in as
`root`, install Docker, clone, set `.env`, `docker compose up -d --build`.

## 5. Verify

`https://babymon.yourdomain.com/healthz` should return `{"ok":true,...}`, and
the [forced-relay test](../self-hosting.md#verifying-turn-actually-works)
should show **via relay**.
