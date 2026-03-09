#!/usr/bin/env bash
# Usage: ./scripts/provision-device.sh <serial>
#        ./scripts/provision-device.sh --all
#
# Automates setting up a new Android device for the STF device farm.

set -euo pipefail

provision_device() {
  local serial="$1"

  echo "=========================================="
  echo "Provisioning device: $serial"
  echo "=========================================="

  # Verify device is connected
  if ! adb devices | grep -q "^${serial}"; then
    echo "ERROR: Device $serial not found. Check USB connection and USB debugging."
    return 1
  fi

  echo "[1/7] Enabling stay awake while plugged in..."
  adb -s "$serial" shell settings put global stay_on_while_plugged_in 3

  echo "[2/7] Disabling screen lock timeout..."
  adb -s "$serial" shell settings put secure lock_screen_lock_after_timeout 0

  echo "[3/7] Setting screen timeout to maximum..."
  adb -s "$serial" shell settings put system screen_off_timeout 2147483647

  echo "[4/7] Disabling notification sounds..."
  adb -s "$serial" shell settings put system notification_sound '""'

  echo "[5/7] Setting media volume to 10..."
  adb -s "$serial" shell media volume --set 10 --stream 3 >/dev/null 2>&1 || \
    echo "  WARNING: Could not set media volume (older Android version?)"

  echo "[6/7] Checking Spotify installation..."
  if adb -s "$serial" shell pm list packages 2>/dev/null | grep -q "com.spotify.music"; then
    echo "  Spotify is already installed."
  else
    echo "  Spotify is NOT installed."
    echo "  Please install Spotify manually:"
    echo "    1. Open Google Play Store on the device"
    echo "    2. Search for 'Spotify' and install it"
    echo "    3. Or sideload: adb -s $serial install spotify.apk"
  fi

  echo "[7/7] Device info summary:"
  local model sdk android_version battery
  model=$(adb -s "$serial" shell getprop ro.product.model 2>/dev/null | tr -d '\r')
  sdk=$(adb -s "$serial" shell getprop ro.build.version.sdk 2>/dev/null | tr -d '\r')
  android_version=$(adb -s "$serial" shell getprop ro.build.version.release 2>/dev/null | tr -d '\r')
  battery=$(adb -s "$serial" shell dumpsys battery 2>/dev/null | grep "level:" | awk '{print $2}' | tr -d '\r')

  echo "  Model:           $model"
  echo "  Android Version: $android_version"
  echo "  SDK Level:       $sdk"
  echo "  Battery:         ${battery}%"
  echo ""
  echo "SUCCESS: Device $model ($serial) provisioned."
  echo ""
}

# --- Main ---

if [ $# -eq 0 ]; then
  echo "Usage: $0 <serial>"
  echo "       $0 --all"
  exit 1
fi

if [ "$1" = "--all" ]; then
  echo "Provisioning ALL connected devices..."
  echo ""
  serials=$(adb devices | grep -v "^List" | grep -v "^$" | awk '{print $1}')
  if [ -z "$serials" ]; then
    echo "ERROR: No devices connected."
    exit 1
  fi
  fail_count=0
  for serial in $serials; do
    provision_device "$serial" || ((fail_count++))
  done
  if [ "$fail_count" -gt 0 ]; then
    echo "WARNING: $fail_count device(s) failed provisioning."
    exit 1
  fi
  echo "All devices provisioned successfully."
else
  provision_device "$1"
fi
