# OpenSTF Device Farm

A Docker Compose setup for running [STF (Smartphone Test Farm)](https://github.com/DeviceFarmer/stf) on macOS or Linux with USB-connected Android devices.

## Prerequisites

### macOS
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- Android platform-tools: `brew install android-platform-tools`

### Linux
- Docker Engine 20.10+ and Docker Compose
- Android platform-tools: `sudo apt install android-tools-adb` (Debian/Ubuntu)

## Quick Start

1. **Start the ADB server** (must allow remote connections):
   ```bash
   adb kill-server
   adb -a nodaemon server start &
   ```

2. **Create your `.env` file**:

   **macOS:**
   ```bash
   cp .env.example .env
   sed -i '' "s/PUBLIC_IP=.*/PUBLIC_IP=$(ipconfig getifaddr en0)/" .env
   ```

   **Linux:**
   ```bash
   cp .env.example .env
   sed -i "s/PUBLIC_IP=.*/PUBLIC_IP=$(hostname -I | awk '{print $1}')/" .env
   ```

3. **Start the services**:
   ```bash
   docker-compose up -d
   ```

4. **Access the web UI** at `http://<your-ip>:7100`

## Services

| Service | Description | Ports |
|---------|-------------|-------|
| **rethinkdb** | Database for STF | 8080 (admin UI), 28015 (driver) |
| **stf** | Device farm web application | 7100 (web), 7110 (websocket), 7400-7500 (device streams) |

## Usage

### Start Services
```bash
docker-compose up -d
```

### Stop Services
```bash
docker-compose down
```

### View Logs
```bash
# All services
docker-compose logs -f

# STF only
docker-compose logs -f stf

# RethinkDB only
docker-compose logs -f rethinkdb
```

### Check Status
```bash
docker-compose ps
```

### Restart Services
```bash
docker-compose restart

# Or restart a specific service
docker-compose restart stf
```

### Remove Everything (including data)
```bash
docker-compose down -v
```

## Configuration

### .env File

The `.env` file contains configuration variables used by docker-compose:

| Variable | Description | Default |
|----------|-------------|---------|
| `PUBLIC_IP` | Your host machine's local IP address | `192.168.1.100` |
| `ADB_HOST` | ADB server hostname | `host.docker.internal` |
| `ADB_PORT` | ADB server port | `5037` |
| `STF_PORT` | STF web interface port | `7100` |
| `STF_WS_PORT` | STF websocket port | `7110` |

To set up your environment:

**macOS:**
```bash
cp .env.example .env
sed -i '' "s/PUBLIC_IP=.*/PUBLIC_IP=$(ipconfig getifaddr en0)/" .env
```

**Linux:**
```bash
cp .env.example .env
sed -i "s/PUBLIC_IP=.*/PUBLIC_IP=$(hostname -I | awk '{print $1}')/" .env
```

### Container Environment Variables

| Variable | Description |
|----------|-------------|
| `RETHINKDB_PORT_28015_TCP` | Connection string to RethinkDB |

### STF Command Options

These flags are configured via environment variables in `.env`:

| Flag | Env Variable | Description |
|------|--------------|-------------|
| `--public-ip` | `PUBLIC_IP` | Host machine's local IP (required for device streaming) |
| `--adb-host` | `ADB_HOST` | ADB server host (`host.docker.internal` reaches host from Docker) |
| `--adb-port` | `ADB_PORT` | ADB server port |
| `--allow-remote` | - | Allow remote ADB connections (always enabled) |

### Ports

| Port | Env Variable | Purpose |
|------|--------------|---------|
| 7100 | `STF_PORT` | STF web interface |
| 7110 | `STF_WS_PORT` | STF websocket connections |
| 7400-7500 | - | Device screen streaming (one port per device) |
| 8080 | - | RethinkDB admin console |
| 28015 | - | RethinkDB driver connections |

## Volumes

| Volume | Purpose |
|--------|---------|
| `rethinkdb-data` | Persistent storage for RethinkDB |

## Device Setup

Each Android device requires:

1. **Developer Options** - Settings > About > Tap "Build Number" 7 times
2. **USB Debugging** - Developer Options > Enable USB Debugging
3. **Stay Awake** - Developer Options > Enable Stay Awake (recommended)
4. **File Transfer Mode** - Set USB mode to MTP/File Transfer
5. **Authorize Connection** - Accept the RSA key prompt on the device

Verify devices are connected:
```bash
adb devices -l
```

## Platform-Specific Notes

### macOS
- `host.docker.internal` works out of the box with Docker Desktop
- Find your IP with: `ipconfig getifaddr en0`

### Linux
- `host.docker.internal` requires Docker 20.10+
- For older Docker versions, add this to the `stf` service in `docker-compose.yml`:
  ```yaml
  extra_hosts:
    - "host.docker.internal:host-gateway"
  ```
- Find your IP with: `hostname -I | awk '{print $1}'`
- You may need to add your user to the `docker` group: `sudo usermod -aG docker $USER`

## Troubleshooting

### Devices not appearing in STF
- Ensure ADB server is running with `-a` flag for remote access
- Check that devices show as "device" (not "unauthorized") in `adb devices`
- Verify your `PUBLIC_IP` in `.env` matches your current IP

### Blank screen when using a device
- Unlock the device screen
- Enable "Stay Awake" in Developer Options
- Check for permission dialogs on the device

### Connection refused errors
- Restart ADB server: `adb kill-server && adb -a nodaemon server start &`
- Restart STF: `docker-compose restart stf`

### Port conflicts
If ports are already in use, update the values in `.env`:
```bash
STF_PORT=7101
STF_WS_PORT=7111
```

### Linux: host.docker.internal not resolving
If using Docker < 20.10, add `extra_hosts` to `docker-compose.yml` (see Platform-Specific Notes above).

## License

STF is licensed under the Apache License 2.0. See the [STF repository](https://github.com/DeviceFarmer/stf) for details.
