# OpenSTF Client Install Guide

This is the install guide for licensed deployments. The custom services
(wall, exporter, healer, monitor, device-info) are distributed as private
Docker images pulled from GitHub Container Registry (GHCR).

## Prerequisites

- Linux host (Ubuntu 22.04+ recommended) — `network_mode: host` does not
  work reliably on Docker Desktop for Mac/Windows.
- Docker Engine 20.10+ and Docker Compose v2.
- Android platform-tools on the host (`sudo apt install android-tools-adb`).
- A GHCR Personal Access Token provided by your vendor (read-only, scoped to
  `read:packages`). Treat this like a password.

## 1. Authenticate to GHCR

Your vendor will give you:

- `GHCR_USERNAME` — typically the vendor's GitHub username.
- `GHCR_TOKEN` — a per-client PAT with `read:packages` scope only.

Log in once on the host:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
```

The credential is persisted in `~/.docker/config.json`. If your vendor
rotates your token, run the same command again with the new value.

## 2. Configure environment

Copy the example env file and fill in your server's public IP:

```bash
cp .env.example .env
sed -i "s/PUBLIC_IP=.*/PUBLIC_IP=$(hostname -I | awk '{print $1}')/" .env
```

Optional: pin a specific image version (defaults to `latest`):

```bash
echo "STF_IMAGE_TAG=v1.0.0" >> .env
```

Optional: configure Grafana email alerts:

```bash
cat >> .env <<EOF
GF_SMTP_ENABLED=true
GF_SMTP_HOST=smtp.example.com:587
GF_SMTP_USER=alerts@example.com
GF_SMTP_PASSWORD=...
GF_SMTP_FROM_ADDRESS=alerts@example.com
EOF
```

## 3. Start ADB on the host

```bash
adb kill-server
adb -a nodaemon server start &
adb devices -l
```

## 4. Bring up the stack

```bash
docker compose -f docker-compose.client.yml --env-file .env up -d
```

Verify:

```bash
docker compose -f docker-compose.client.yml ps
curl http://localhost/healthz   # nginx
curl http://localhost:7100      # STF
```

## 5. Access the UI

- Portal: `http://<server-ip>/`
- Device wall: `http://<server-ip>/wall`
- STF: `http://<server-ip>:7100`
- Grafana: `http://<server-ip>:3000`
- Prometheus: `http://<server-ip>:9090`

## Updating

When your vendor releases a new version:

```bash
docker compose -f docker-compose.client.yml pull
docker compose -f docker-compose.client.yml up -d
```

If `STF_IMAGE_TAG` is pinned in `.env`, update it first.

## Token rotation

If you lose access (`docker pull` returns 401), your token may have been
rotated. Get a new one from your vendor and re-run step 1. The new token
takes effect on the next `docker pull` — running containers keep running.

## What you do NOT have

- Source code for the wall, exporter, healer, monitor, or device-info
  services. These are distributed as compiled images only.
- Permission to redistribute the images or share your GHCR token.

If you need a feature or have a bug to report, contact your vendor.
