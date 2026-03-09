# OpenSTF Device Farm

A Docker Compose setup for running [STF (Smartphone Test Farm)](https://github.com/DeviceFarmer/stf) on a physical Ubuntu server with USB-connected Android devices. Includes a live device wall, monitoring stack (Prometheus + Grafana), Spotify self-healing watcher, and CI/CD pipelines with dev/prod environments.

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│                  Ubuntu Server (Physical)                  │
│  ┌─────────────┐    ┌───────────────────────────────┐     │
│  │ ADB Server  │◄───│ USB Hubs + Android Devices    │     │
│  │ (native)    │    └───────────────────────────────┘     │
│  └──────┬──────┘                                          │
│         │                                                  │
│  ┌──────▼──────────────────────────────────────────────┐  │
│  │              Docker (network_mode: host)             │  │
│  │                                                      │  │
│  │  ┌───────────┐  ┌───────┐  ┌───────────────────┐   │  │
│  │  │ RethinkDB │  │  STF  │  │  Nginx (proxy +   │   │  │
│  │  │ :28015    │  │ :7100 │  │  portal) :80      │   │  │
│  │  └───────────┘  └───────┘  └───────────────────┘   │  │
│  │                                                      │  │
│  │  ┌────────────┐  ┌────────────┐  ┌─────────┐       │  │
│  │  │ Exporter   │  │ Prometheus │  │ Grafana │       │  │
│  │  │ :9105      │  │ :9090      │  │ :3000   │       │  │
│  │  └────────────┘  └────────────┘  └─────────┘       │  │
│  │                                                      │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │  │
│  │  │ Healer :9106 │  │ Monitor     │  │ Resource │  │  │
│  │  │              │  │ :9107       │  │ :9108    │  │  │
│  │  └──────────────┘  └──────────────┘  └──────────┘  │  │
│  └─────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
```

## Prerequisites

- Ubuntu server (physical, with USB ports)
- Docker Engine 20.10+ and Docker Compose
- Android platform-tools: `sudo apt install android-tools-adb`

## Quick Start

1. **Start the ADB server** (must allow remote connections):
   ```bash
   adb kill-server
   adb -a nodaemon server start &
   ```

2. **Verify devices are connected:**
   ```bash
   adb devices -l
   ```

3. **Create your `.env` file:**
   ```bash
   cp .env.example .env
   sed -i "s/PUBLIC_IP=.*/PUBLIC_IP=$(hostname -I | awk '{print $1}')/" .env
   ```

4. **Start all services:**
   ```bash
   docker compose up -d
   ```

5. **Access the portal** at `http://<server-ip>` (port 80)

### Automated Device Provisioning

For new devices, use the provisioning script to configure all required settings:

```bash
./scripts/provision-device.sh <serial>   # single device
./scripts/provision-device.sh --all      # all connected devices
```

## Services

| Service | Description | Port (Prod) | Port (Dev) |
|---------|-------------|-------------|------------|
| **rethinkdb** | Database for STF | 8080 / 28015 | 8180 / 28115 |
| **stf** | Device farm — device control, screen streaming | 7100 / 7110 | 7200 / 7210 |
| **nginx** | Reverse proxy — portal, wall, STF, Grafana, healer | 80 | 8880 |
| **stf-exporter** | Prometheus exporter — per-device online/offline metrics | 9105 | 9205 |
| **device-monitor** | ADB device polling — battery, connectivity, auto-reconnect | 9107 | 9207 |
| **resource-monitor** | Server resource metrics — CPU, RAM, disk, USB count | 9108 | 9208 |
| **prometheus** | Metrics scraping and storage | 9090 | 9190 |
| **grafana** | Dashboards and email alerts (Zoho SMTP) | 3000 | 3100 |
| **spotify-healer** | Auto-restarts Spotify playback on devices via ADB | 9106 | 9206 |

## Deployment

### Environments

Both dev and prod environments can run on the same server using a port offset strategy. Dev is infra-only (validates configs, dashboards, alerts) while prod owns all physical devices.

```bash
# Production (default)
docker compose --env-file envs/.env.prod -p stf-prod up -d

# Development
docker compose --env-file envs/.env.dev -p stf-dev up -d

# Or use the deploy helper script
./scripts/deploy.sh prod
./scripts/deploy.sh dev
```

### CI/CD Pipelines (GitHub Actions)

| Workflow | Trigger | Environment |
|----------|---------|-------------|
| `deploy-dev.yml` | Push to `feature/*` branches, PRs to main/dev | Dev |
| `deploy-prod.yml` | Push to `main` | Production |

Both workflows run smoke tests after deployment to validate all service endpoints.

**Setup requirements:**
1. Configure the Ubuntu server as a [GitHub self-hosted runner](https://docs.github.com/en/actions/hosting-your-own-runners)
2. Add `PUBLIC_IP` as a repository secret (Settings > Secrets > Actions)
3. Create `dev` and `production` environments in GitHub (Settings > Environments)
4. Optionally add approval gates for the `production` environment

### Smoke Tests

```bash
./scripts/smoke-test.sh prod   # test production endpoints
./scripts/smoke-test.sh dev    # test dev endpoints
```

Tests all service health endpoints, metrics endpoints, and nginx proxied routes.

### RethinkDB Backup & Restore

```bash
./scripts/backup-rethinkdb.sh           # creates timestamped backup in ./backups/
./scripts/restore-rethinkdb.sh <file>   # restores from a backup file
```

Backups retain the last 7 files automatically. Add to cron for scheduled backups.

## Branching Strategy

Feature development uses categorized branches that are gradually rolled out to production:

| Branch | Phase | Description |
|--------|-------|-------------|
| `feature/reliability-monitoring` | 1 | Error metrics, auto-reconnect, alerts, Docker health checks |
| `feature/spotify-hardening` | 2 | Playlist rotation, human-like pauses, volume variation |
| `feature/ux-management` | 3 | Bulk actions, grouping, event log, device labels, search, find device |
| `feature/infrastructure` | 4 | Device provisioning, DB backups, resource monitoring |
| `feature/chores` | 5 | API key auth, wall auto-refresh with toast notifications |
| `feature/cicd-pipelines` | 6 | GitHub Actions dev/prod deploy, smoke tests, port strategy |

**Workflow:**
1. Each improvement phase gets its own `feature/*` branch from `main`
2. Feature branches are deployed and tested in the dev environment first
3. After validation, branches are merged into `main` for production deployment
4. This allows gradual rollout — merge one phase at a time

## Web Portal

Nginx serves a tabbed portal at `http://<server-ip>/` with three views:

| Tab | Path | Description |
|-----|------|-------------|
| **Wall** | `/wall` | Live device screen grid — streams all connected devices via WebSocket |
| **STF Panel** | `/stf/` | Full STF web UI for device control and management |
| **Grafana** | `/grafana/` | Monitoring dashboards |

### Device Wall

The wall (`wall/grid.html`) displays a live grid of all connected device screens. It requires an STF access token:

1. Log into STF at `http://<server-ip>:7100`
2. Go to **Settings > Keys > Add a new key**
3. Copy the token and paste it into the wall setup prompt

Each device card features:
- **Rack label** — editable nickname (e.g. "Rack 1 - Slot 3"), auto-imports STF notes
- **Model & serial** — shown as secondary text below the label
- **Find button** — flashes the physical device screen to locate it on the rack
- **Spotify toggle** — enables/disables the Spotify self-healing watcher with duration picker
- **Live countdown** — shows remaining heal duration

The toolbar provides:
- **Start All / Stop All** — bulk healer control for all devices
- **Search bar** — filter devices by label, model, or serial
- **Group by Model** — organize the grid by device model
- **Event Log** — collapsible panel showing heal actions, connects, disconnects

## Spotify Self-Healing Watcher

Devices in the farm play Spotify music continuously. The healer service automatically detects when Spotify stops playing and restarts playback via ADB.

### How It Works

Every 4-6 minutes (randomized) per watched device, the healer runs:

1. **`adb shell pidof com.spotify.music`** — checks if Spotify is running
2. If not running: launches Spotify with a random playlist, waits 3s, sends play command
3. If running: checks `dumpsys media_session` for `state=3` (playing)
4. If paused: sends `input keyevent 126` (play)

### Hardening Features

- **Playlist rotation** — cycles through a pool of playlists to avoid pattern detection
- **Human-like pauses** — 7% chance per cycle to pause 30-120s then resume
- **Volume variation** — random volume (8-15) per device, 20% chance to vary each cycle
- **Staggered starts** — random initial delay so devices don't all heal simultaneously
- **API key auth** — optional `HEALER_API_KEY` env var to secure endpoints

### API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/healer/api/status` | All watcher states |
| `POST` | `/healer/api/watch/:serial` | Start watching (body: `{duration}`) |
| `DELETE` | `/healer/api/watch/:serial` | Stop watching |
| `GET` | `/healer/api/watch/:serial` | Single device state |
| `POST` | `/healer/api/find/:serial` | Flash device screen to locate it |
| `GET` | `/healer/api/playlists` | View playlist pool |
| `PUT` | `/healer/api/playlists` | Update playlist pool |
| `GET` | `/healer/metrics` | Prometheus metrics |

## Monitoring

### Grafana Dashboards

| Dashboard | Panels |
|-----------|--------|
| **Spotify & Battery** | Battery gauge, battery over time, heal timeline, playback status table |
| **System Health** | Scrape targets status, device online/offline, error rates, reconnect attempts, time since last heal |

### Alerts (via Zoho SMTP)

| Alert | Condition | Severity |
|-------|-----------|----------|
| Low Battery | < 15% for 5 min | Warning |
| Critical Battery | < 10% for 2 min | Critical |
| Device Offline | Offline > 5 min | Critical |
| Healer Error Spike | > 3 errors in 10 min | Warning |
| Scrape Target Down | `up == 0` for 2 min | Critical |
| Spotify Heal Event | Any heal action | Info |

### Prometheus Metrics

All Node.js services expose `/metrics` endpoints with per-device labels `{serial, model}`:

**STF Exporter (:9105):** `stf_devices_total`, `stf_devices_online`, `stf_device_online`, `stf_exporter_scrape_errors_total`

**Healer (:9106):** `spotify_healer_watching`, `spotify_healer_playing`, `spotify_healer_heal_total`, `spotify_healer_errors_total{type}`, `spotify_healer_last_success_timestamp`

**Device Monitor (:9107):** `device_online`, `device_battery_level`, `device_offline_streak`, `device_errors_total{type}`, `device_reconnect_attempts`

**Resource Monitor (:9108):** `server_cpu_usage_percent`, `server_memory_usage_bytes`, `server_disk_usage_percent{mount}`, `server_usb_device_count`

## Key Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Base service definitions |
| `docker-compose.override.yml` | Environment-aware overrides (ports, names, configs) |
| `envs/.env.prod` | Production port and volume config |
| `envs/.env.dev` | Development port and volume config |
| `.env` | `PUBLIC_IP` for the server |
| `wall/portal.html` | Tabbed portal page (Wall, STF, Grafana) |
| `wall/grid.html` | Device wall — live screen grid with labels, search, find, bulk actions |
| `wall/nginx-prod.conf` | Nginx config for production ports |
| `wall/nginx-dev.conf` | Nginx config for development ports |
| `exporter/stf-exporter.js` | Prometheus exporter for STF device status |
| `healer/spotify-healer.js` | Spotify self-healing watcher + find device endpoint |
| `monitor/device-monitor.js` | ADB device polling, battery, auto-reconnect |
| `monitor/resource-monitor.js` | Server CPU/RAM/disk/USB metrics |
| `prometheus-prod.yml` | Production scrape targets |
| `prometheus-dev.yml` | Development scrape targets |
| `grafana/dashboards/spotify-battery.json` | Spotify & Battery dashboard |
| `grafana/dashboards/system-health.json` | System Health dashboard |
| `grafana/provisioning/alerting/alerts.yml` | Alert rules and contact points |
| `scripts/deploy.sh` | Deploy helper (dev or prod) |
| `scripts/smoke-test.sh` | Health check all endpoints |
| `scripts/provision-device.sh` | Automated Android device setup |
| `scripts/backup-rethinkdb.sh` | RethinkDB backup (7-day retention) |
| `scripts/restore-rethinkdb.sh` | RethinkDB restore from backup |
| `.github/workflows/deploy-dev.yml` | GitHub Actions — deploy to dev |
| `.github/workflows/deploy-prod.yml` | GitHub Actions — deploy to prod |

## Device Setup

Each Android device requires:

1. **Developer Options** — Settings > About > Tap "Build Number" 7 times
2. **USB Debugging** — Developer Options > Enable USB Debugging
3. **Stay Awake** — Developer Options > Enable Stay Awake (recommended)
4. **File Transfer Mode** — Set USB mode to MTP/File Transfer
5. **Authorize Connection** — Accept the RSA key prompt on the device

Or run `./scripts/provision-device.sh <serial>` to automate post-connection setup.

### Samsung Devices (Additional)

- Enable: Settings > Developer Options > USB debugging (Security settings)
- May need: Settings > Biometrics and Security > Device admin apps > Allow STFService

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PUBLIC_IP` | Server's local IP address | Yes |
| `HEALER_API_KEY` | API key for healer endpoints (empty = no auth) | No |

### Nginx Proxy Routes

| Path | Backend | Purpose |
|------|---------|---------|
| `/` | `portal.html` (static) | Tabbed portal page |
| `/wall` | `grid.html` (static) | Device wall |
| `/stf/` | STF `:7100` | STF web UI |
| `/grafana/` | Grafana `:3000` | Grafana dashboards |
| `/healer/` | Healer `:9106` | Spotify healer API |
| `/monitor/` | Monitor `:9107` | Device monitor API |
| `/screen/:port` | STF stream port | WebSocket screen streams |
| `/*` | STF `:7100` | STF API and static assets (fallback) |

## Usage

```bash
# Start all services (default/legacy)
docker compose up -d

# Environment-specific deployment
./scripts/deploy.sh prod
./scripts/deploy.sh dev

# View logs
docker compose logs -f              # all services
docker compose logs -f spotify-healer # healer only

# Check status
docker compose ps

# Restart after config changes
docker compose restart nginx

# Stop everything
docker compose down

# Backup database
./scripts/backup-rethinkdb.sh

# Provision a new device
./scripts/provision-device.sh <serial>
```

## Troubleshooting

### Device Not Detected by ADB
1. Check USB cable supports data (not charge-only)
2. Check USB notification on device — set to File Transfer mode
3. Revoke USB debugging authorizations and reconnect
4. Try different USB port/cable
5. Check with `lsusb` (hardware level)

### STF Can't Connect to Devices
1. Ensure ADB server is running: `adb -a nodaemon server start &`
2. Verify `--adb-host 127.0.0.1` in `docker-compose.yml`
3. Check `PUBLIC_IP` in `.env` matches the server's actual IP

### Blank Screen in STF
- Unlock the device screen
- Check for authorization dialogs on device
- Enable "Stay Awake" in Developer Options
- Try clicking "Use" again in STF web UI

### Wall Shows "no stream"
- Ensure the STF access token is valid (regenerate if needed)
- Check that devices aren't claimed by another STF user
- Verify STF is running: `docker compose logs stf`

### Spotify Healer Not Working
- Check healer logs: `docker compose logs spotify-healer`
- Test API directly: `curl http://<server-ip>:9106/api/status`
- Verify ADB can reach devices: `adb devices` on the host

### Dev/Prod Port Conflicts
- Verify no port overlap between environments (see Services table)
- Check with `docker compose -p stf-dev ps` and `docker compose -p stf-prod ps`
- Run `./scripts/smoke-test.sh dev` to validate dev endpoints

## Volumes

| Volume | Purpose |
|--------|---------|
| `rethinkdb-data` (prod: `stf-prod-rethinkdb-data`) | Persistent RethinkDB storage |
| `grafana-data` (prod: `stf-prod-grafana-data`) | Persistent Grafana dashboards and settings |

## License

STF is licensed under the Apache License 2.0. See the [STF repository](https://github.com/DeviceFarmer/stf) for details.
