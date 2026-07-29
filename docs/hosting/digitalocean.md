# Hosting babymon on DigitalOcean

Total time: ~15 minutes. Cost: $6/month.

## 1. Create the droplet

**Create → Droplets:**

- **Region:** whichever is closest to your home (relayed video round-trips
  through this box, so latency matters)
- **Image:** Ubuntu 24.04 LTS
- **Size:** Basic → Regular → **$6/mo (1 GB / 1 vCPU)**. Avoid the 512 MB
  tier — the Docker build can run out of memory on it.
- **Authentication:** SSH key (paste `~/.ssh/id_ed25519.pub` from your
  machine; create one with `ssh-keygen -t ed25519` if needed)

Note the droplet's public IP after creation.

## 2. Firewall

**Networking → Firewalls → Create Firewall**, then apply it to the droplet
under "Droplets":

| Type | Protocol | Ports | Sources |
|---|---|---|---|
| SSH | TCP | 22 | All |
| HTTP | TCP | 80 | All |
| HTTPS | TCP | 443 | All |
| Custom | UDP | 443 | All |
| Custom | TCP | 3478 | All |
| Custom | UDP | 3478 | All |
| Custom | UDP | 49160–49200 | All |

Leave outbound rules at their defaults (allow all).

## 3. DNS

Wherever your domain is managed, add an **A record**:
`babymon` → `<droplet-ip>`. Confirm before continuing:

```sh
dig +short babymon.yourdomain.com   # must print the droplet IP
```

## 4. Deploy

Follow the [common deploy steps](../self-hosting.md#deploy) — SSH in, install
Docker, clone, set `.env`, `docker compose up -d --build`.

## 5. Verify

`https://babymon.yourdomain.com/healthz` should return `{"ok":true,...}`, and
the [forced-relay test](../self-hosting.md#verifying-turn-actually-works)
should show **via relay**.
