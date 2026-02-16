# OpenSTF Device Farm

A Docker Compose setup for running [STF (Smartphone Test Farm)](https://github.com/DeviceFarmer/stf) on a physical Ubuntu server with USB-connected Android devices. Includes a live device wall, monitoring stack (Prometheus + Grafana), and Spotify self-healing watcher.

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│                  Ubuntu Server (Physical)                  │
│  ┌─────────────┐    ┌───────────────────────────────┐     │
│  │ ADB Server  │◄───│ USB Hub + 8 Android Devices   │     │
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
│  │  ┌─────────────────┐                                │  │
│  │  │ Spotify Healer  │                                │  │
│  │  │ :9106           │                                │  │
│  │  └─────────────────┘                                │  │
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
   docker-compose up -d
   ```

5. **Access the portal** at `http://<server-ip>` (port 80)

## Services

| Service | Description | Port | Image |
|---------|-------------|------|-------|
| **rethinkdb** | Database for STF | 8080 (admin), 28015 (driver) | `rethinkdb:2.4` |
| **stf** | Device farm — device control, screen streaming | 7100 (web), 7110 (ws) | `devicefarmer/stf:latest` |
| **nginx** | Reverse proxy — portal, wall, STF, Grafana, healer | 80 | `nginx:latest` |
| **stf-exporter** | Prometheus exporter — per-device online/offline metrics | 9105 | `node:18` |
| **prometheus** | Metrics scraping and storage | 9090 | `prom/prometheus` |
| **grafana** | Dashboards and email alerts (Zoho SMTP) | 3000 | `grafana/grafana` |
| **spotify-healer** | Auto-restarts Spotify playback on devices via ADB | 9106 | `node:18-alpine` |

## Web Portal

Nginx serves a tabbed portal at `http://<server-ip>/` with three views:

| Tab | Path | Description |
|-----|------|-------------|
| **Wall** | `/wall` | Live device screen grid — streams all connected devices via WebSocket |
| **STF Panel** | `/stf/` | Full STF web UI for device control and management |
| **Grafana** | `/grafana/` | Monitoring dashboards |

The Wall tab is the default view. Switching tabs destroys the wall iframe to free resources, and reloads it when switching back.

### Device Wall

The wall (`wall/grid.html`) displays a live grid of all connected device screens. It requires an STF access token:

1. Log into STF at `http://<server-ip>:7100`
2. Go to **Settings > Keys > Add a new key**
3. Copy the token and paste it into the wall setup prompt

The wall claims all present devices, opens WebSocket streams for each, and renders frames on canvas elements. Each device card has:

- **Stop/Resume** button — pauses or resumes the screen stream
- **Spotify** toggle — enables/disables the Spotify self-healing watcher for that device

## Spotify Self-Healing Watcher

Devices in the farm play Spotify music continuously. The healer service automatically detects when Spotify stops playing and restarts playback via ADB.

### How It Works

Every 5 minutes per watched device, the healer runs:

1. **`adb shell pidof com.spotify.music`** — checks if Spotify is running
2. If not running: launches Spotify via `am start`, waits 3s, sends play command
3. If running: checks `dumpsys media_session` for `state=3` (playing)
4. If paused: sends `media dispatch play` (fallback: `input keyevent 126`)

### API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/healer/api/status` | All watcher states |
| `POST` | `/healer/api/watch/:serial` | Start watching a device |
| `DELETE` | `/healer/api/watch/:serial` | Stop watching a device |
| `GET` | `/healer/api/watch/:serial` | Single device state |
| `GET` | `/healer/metrics` | Prometheus metrics |

### Prometheus Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `spotify_healer_watching{serial,model}` | gauge | Watcher active (1/0) |
| `spotify_healer_playing{serial,model}` | gauge | Spotify playing (1/0) |
| `spotify_healer_heal_total{serial,model}` | counter | Number of heal actions |
| `spotify_healer_battery_level{serial,model}` | gauge | Battery percentage |
| `spotify_healer_heals_total{serial,model,action}` | counter | Heals by type (launched/play_sent) |

## Monitoring

### STF Exporter (port 9105)

Reads device data from RethinkDB and exposes Prometheus metrics:

| Metric | Type | Description |
|--------|------|-------------|
| `stf_devices_total` | gauge | Total registered devices |
| `stf_devices_online` | gauge | Currently online devices |
| `stf_devices_offline` | gauge | Currently offline devices |
| `stf_device_online{serial, model}` | gauge | Per-device status (1/0) |

### Prometheus (port 9090)

Scrapes metrics from:
- STF exporter on `:9105` (every 15s)
- Spotify healer on `:9106` (every 15s)

### Grafana (port 3000)

- Anonymous access enabled (Viewer role)
- Embedded in the portal via `/grafana/` sub-path
- Email alerts configured via Zoho SMTP

## Key Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | All 7 services |
| `.env` | `PUBLIC_IP` for the server |
| `wall/portal.html` | Tabbed portal page (Wall, STF, Grafana) |
| `wall/grid.html` | Device wall — live screen grid with Spotify toggles |
| `wall/nginx.conf` | Nginx config — proxies STF, Grafana, healer; serves portal and wall |
| `exporter/stf-exporter.js` | Prometheus exporter for device online/offline status |
| `healer/spotify-healer.js` | Spotify self-healing watcher service |
| `healer/package.json` | Dependencies for the healer |
| `prometheus.yml` | Scrape config for exporter and healer |

## Connected Devices

| Serial | Model | SDK |
|--------|-------|-----|
| 320216036286 | ZTE Blade L8 | 28 |
| 5063698484070606 | S34 | 30 |
| A41CF923 | T790W (Seattle 5G) | 30 |
| DMEAVGPNSOSSSSYH | REVVL 2 | 27 |
| LMK500TW8HYTRW7HJB | LG K500 | 29 |
| R5CN60BYPPN | Samsung A71 (SM-A716U) | - |
| R9WT60FF3NK | Samsung SM-S134DL | 33 |
| ZT3226HXRF | Moto G20 | 30 |

## Device Setup

Each Android device requires:

1. **Developer Options** — Settings > About > Tap "Build Number" 7 times
2. **USB Debugging** — Developer Options > Enable USB Debugging
3. **Stay Awake** — Developer Options > Enable Stay Awake (recommended)
4. **File Transfer Mode** — Set USB mode to MTP/File Transfer
5. **Authorize Connection** — Accept the RSA key prompt on the device

### Samsung Devices (Additional)

- Enable: Settings > Developer Options > USB debugging (Security settings)
- May need: Settings > Biometrics and Security > Device admin apps > Allow STFService

## Configuration

### .env File

| Variable | Description |
|----------|-------------|
| `PUBLIC_IP` | Server's local IP address (required) |

```bash
cp .env.example .env
sed -i "s/PUBLIC_IP=.*/PUBLIC_IP=$(hostname -I | awk '{print $1}')/" .env
```

### Nginx Proxy Routes

| Path | Backend | Purpose |
|------|---------|---------|
| `/` | `portal.html` (static) | Tabbed portal page |
| `/wall` | `grid.html` (static) | Device wall |
| `/stf/` | `172.17.0.1:7100` | STF web UI |
| `/grafana/` | `172.17.0.1:3000` | Grafana dashboards |
| `/healer/` | `172.17.0.1:9106` | Spotify healer API |
| `/screen/:port` | `172.17.0.1:<port>` | WebSocket screen streams |
| `/*` | `172.17.0.1:7100` | STF API and static assets (fallback) |

## Usage

```bash
# Start all services
docker-compose up -d

# Start a specific service
docker-compose up -d spotify-healer

# View logs
docker-compose logs -f              # all services
docker-compose logs -f stf           # STF only
docker-compose logs -f spotify-healer # healer only

# Check status
docker-compose ps

# Restart services
docker-compose restart
docker-compose restart nginx         # after config changes

# Stop everything
docker-compose down

# Stop and remove volumes (destructive)
docker-compose down -v
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
- Verify STF is running: `docker-compose logs stf`

### Spotify Healer Not Working
- Check healer logs: `docker-compose logs spotify-healer`
- Test API directly: `curl http://<server-ip>:9106/api/status`
- Verify ADB can reach devices: `adb devices` on the host

## Volumes

| Volume | Purpose |
|--------|---------|
| `rethinkdb-data` | Persistent RethinkDB storage |
| `grafana-data` | Persistent Grafana dashboards and settings |

## License

STF is licensed under the Apache License 2.0. See the [STF repository](https://github.com/DeviceFarmer/stf) for details.
