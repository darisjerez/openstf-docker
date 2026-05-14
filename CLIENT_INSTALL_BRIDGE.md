# OpenSTF Client Install — Mac / Windows (Bridge Network)

This is the install path for clients running **Docker Desktop on macOS or
Windows**. On those platforms `network_mode: host` does not work, so the
stack uses a private bridge network and explicit port mappings.

For Linux clients use `CLIENT_INSTALL.md` instead.

## Known limitations on Mac/Windows

- **USB pass-through into containers is not supported by Docker Desktop.**
  ADB must run **natively on the host**; the containerized services
  connect to it via TCP on `host.docker.internal:5037`.
- **Many ports are mapped to the host.** Make sure 80, 7100, 7110,
  7400–7500, 9090, 9105–9109, 3000, and 28015 are not in use.
- **Stream performance may be lower** than a native Linux deployment due
  to Docker Desktop's VM networking. Acceptable for small fleets (≤8
  devices); not recommended past ~12.
- **STF flags for the provider port range** (`--provider-min-port`,
  `--provider-max-port`) are pinned to 7400–7500. If your STF build does
  not honor these flags, contact your vendor — a newer image may be
  required.

## Prerequisites

- Docker Desktop 4.x or newer.
- Native ADB on the host:
  - macOS: `brew install android-platform-tools`
  - Windows: install [Google's platform-tools](https://developer.android.com/studio/releases/platform-tools)
    and add `adb.exe` to your `PATH`.
- A GHCR Personal Access Token from your vendor with `read:packages`
  scope.

## 1. Authenticate to GHCR

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
```

## 2. Start ADB on the host, listening on TCP

ADB must listen on all interfaces so Docker containers can reach it.

**macOS / Linux:**

```bash
adb kill-server
adb -a -P 5037 nodaemon server &
adb devices -l
```

**Windows (PowerShell):**

```powershell
adb kill-server
Start-Process adb -ArgumentList "-a","-P","5037","nodaemon","server" -NoNewWindow
adb devices -l
```

You should see all your USB-connected phones listed. If a phone shows as
`unauthorized`, accept the debugging prompt on the device.

> **Important:** On macOS, if you do not see `host.docker.internal`
> resolving from inside containers, restart Docker Desktop. On Windows,
> ensure the WSL2 backend is enabled.

## 3. Configure environment

Copy the env template and set `PUBLIC_IP` to the machine's LAN IP:

```bash
cp .env.example .env
```

Edit `.env` and set, e.g.:

```env
PUBLIC_IP=192.168.1.50
STF_IMAGE_TAG=latest
```

Optional: Grafana SMTP, same vars as the Linux install.

## 4. Bring up the stack

```bash
docker compose -f docker-compose.client.bridge.yml --env-file .env up -d
```

Verify:

```bash
docker compose -f docker-compose.client.bridge.yml ps
```

The first start downloads images from GHCR; expect a few minutes.

## 5. Access the UI

- Portal: `http://localhost/`
- Device wall: `http://localhost/wall`
- STF: `http://localhost:7100`
- Grafana: `http://localhost:3000`
- Prometheus: `http://localhost:9090`

If `PUBLIC_IP` is set to a LAN address, other machines on the network can
also reach the same URLs at that IP.

## Updating

```bash
docker compose -f docker-compose.client.bridge.yml pull
docker compose -f docker-compose.client.bridge.yml up -d
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `stf` log: `Cannot connect to adb server` | Host ADB not running or not on TCP | Re-run step 2; check firewall isn't blocking 5037 |
| Device screens never load | Provider port range (7400–7500) not reachable from your browser | Confirm those ports are mapped (`docker port stf`) and not blocked locally |
| Healer/monitor metrics empty | ADB_HOST env var ignored | Confirm `extra_hosts: host.docker.internal:host-gateway` is present in your compose |
| `host.docker.internal` not resolving in container | Older Docker Desktop or Linux Docker without `host-gateway` | Upgrade Docker Desktop ≥ 20.10, or on Linux ensure compose has `extra_hosts` |
| Web UI is slow / streams drop | Docker Desktop VM resource limits | Increase VM CPU/memory in Docker Desktop settings |

## What's untested on this branch

This bridge variant is new. End-to-end verification with real USB devices
on Mac/Windows is still pending. Please report issues to your vendor with:

- `docker compose -f docker-compose.client.bridge.yml logs stf`
- `adb devices -l` from the host
- Docker Desktop version
