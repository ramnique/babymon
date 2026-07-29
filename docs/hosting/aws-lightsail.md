# Hosting babymon on AWS Lightsail

Total time: ~15 minutes. Cost: $5/month (includes generous transfer).

## 1. Create the instance

**Lightsail console → Create instance:**

- **Region:** whichever is closest to your home (relayed video round-trips
  through this box)
- **Platform:** Linux/Unix → OS Only → **Ubuntu 24.04 LTS**
- **Plan:** **$5/mo (1 GB RAM)** — skip the 512 MB tier; the Docker build
  needs the memory
- **SSH key:** use the default Lightsail key (download the .pem) or upload
  your own public key

## 2. Static IP

**Networking → Create static IP**, attach it to the instance. (Free while
attached; without it the IP changes on stop/start and breaks your DNS.)

## 3. Firewall

On the instance page → **Networking → IPv4 Firewall**, add rules until the
list is:

| Application | Protocol | Port or range |
|---|---|---|
| SSH | TCP | 22 |
| HTTP | TCP | 80 |
| HTTPS | TCP | 443 |
| Custom | UDP | 443 |
| Custom | TCP | 3478 |
| Custom | UDP | 3478 |
| Custom | UDP | 49160–49200 |

## 4. DNS

Add an **A record** for `babymon.yourdomain.com` → the static IP (in Route 53
or wherever your domain lives). Confirm with
`dig +short babymon.yourdomain.com`.

## 5. Deploy

Follow the [common deploy steps](../self-hosting.md#deploy). Lightsail's
default user is `ubuntu`, not root:

```sh
ssh -i LightsailDefaultKey.pem ubuntu@<static-ip>
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu && exit   # re-login so docker works without sudo
```

Then clone, configure `.env`, and `docker compose up -d --build` as in the
common guide.

## 6. Verify

`https://babymon.yourdomain.com/healthz` should return `{"ok":true,...}`, and
the [forced-relay test](../self-hosting.md#verifying-turn-actually-works)
should show **via relay**.
