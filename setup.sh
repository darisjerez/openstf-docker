#!/bin/bash
set -e

# OpenSTF Device Farm — Full Server Setup
# Run as root or with sudo on a fresh Ubuntu server (20.04+)
# Usage: sudo bash setup.sh

REPO_URL="https://github.com/darisjerez/openstf-docker.git"
INSTALL_DIR="/opt/openstf"
SERVICE_USER="${SUDO_USER:-$(whoami)}"

echo "============================================"
echo "  OpenSTF Device Farm — Server Setup"
echo "============================================"
echo ""
echo "  Install dir:  $INSTALL_DIR"
echo "  Service user:  $SERVICE_USER"
echo ""

if [ "$EUID" -ne 0 ]; then
  echo "ERROR: Please run with sudo"
  exit 1
fi

# ── 1. System packages ──────────────────────────────────────────────

echo "[1/7] Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq git curl android-tools-adb > /dev/null

# ── 2. Docker ────────────────────────────────────────────────────────

if ! command -v docker &> /dev/null; then
  echo "[2/7] Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  usermod -aG docker "$SERVICE_USER"
else
  echo "[2/7] Docker already installed — skipping"
fi

# Ensure Docker starts on boot
systemctl enable docker
systemctl start docker

# ── 3. Clone / update repo ──────────────────────────────────────────

if [ -d "$INSTALL_DIR/.git" ]; then
  echo "[3/7] Updating repo..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  echo "[3/7] Cloning repo..."
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

# ── 4. Configure .env ───────────────────────────────────────────────

echo "[4/7] Configuring .env..."
PUBLIC_IP=$(hostname -I | awk '{print $1}')
cat > "$INSTALL_DIR/.env" << EOF
PUBLIC_IP=$PUBLIC_IP
EOF
echo "  PUBLIC_IP=$PUBLIC_IP"

# ── 5. ADB systemd service ──────────────────────────────────────────

echo "[5/7] Creating ADB server service..."
cat > /etc/systemd/system/adb-server.service << EOF
[Unit]
Description=ADB Server (remote access)
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
ExecStartPre=-/usr/bin/adb kill-server
ExecStart=/usr/bin/adb -a server nodaemon
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable adb-server
systemctl start adb-server

# ── 6. STF Farm systemd service ─────────────────────────────────────

echo "[6/7] Creating STF Farm service..."
cat > /etc/systemd/system/stf-farm.service << EOF
[Unit]
Description=OpenSTF Device Farm
Requires=docker.service adb-server.service
After=docker.service adb-server.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
ExecStartPre=/bin/sleep 5
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable stf-farm

# ── 7. Auto-login (no password on boot) ─────────────────────────────

echo "[7/7] Configuring auto-login on tty1..."
mkdir -p /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/override.conf << EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $SERVICE_USER --noclear %I \$TERM
EOF

systemctl daemon-reload

# ── Start everything ─────────────────────────────────────────────────

echo ""
echo "Starting STF Farm..."
systemctl start stf-farm

echo ""
echo "============================================"
echo "  Setup complete!"
echo "============================================"
echo ""
echo "  Services:"
echo "    systemctl status adb-server"
echo "    systemctl status stf-farm"
echo ""
echo "  Access:"
echo "    Portal:     http://$PUBLIC_IP/"
echo "    Wall:       http://$PUBLIC_IP/wall"
echo "    STF:        http://$PUBLIC_IP:7100"
echo "    Grafana:    http://$PUBLIC_IP:3000"
echo ""
echo "  Auto-login:   enabled for '$SERVICE_USER' on tty1"
echo "  Boot order:   adb-server → docker → stf-farm (automatic)"
echo ""
echo "  Next steps:"
echo "    1. Connect Android devices via USB"
echo "    2. Check: adb devices -l"
echo "    3. Log into STF, create access token at Settings > Keys"
echo "    4. Paste token in the Wall page to enable streaming"
echo ""
