#!/usr/bin/env bash
# Usage: ./scripts/restore-rethinkdb.sh <backup-file>
#
# Restores a RethinkDB backup via docker exec.

set -euo pipefail

CONTAINER="stf-rethinkdb"

if [ $# -eq 0 ]; then
  echo "Usage: $0 <backup-file>"
  echo "Example: $0 ./backups/stf-backup-2026-03-08-020000.tar.gz"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: Backup file not found: $BACKUP_FILE"
  exit 1
fi

# Check that the container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "ERROR: Container '$CONTAINER' is not running."
  exit 1
fi

echo "WARNING: This will overwrite existing data in RethinkDB."
read -p "Are you sure you want to restore from '$BACKUP_FILE'? [y/N] " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
  echo "Aborted."
  exit 0
fi

echo "Restoring RethinkDB from: $BACKUP_FILE"

# Copy backup into container and restore
docker cp "$BACKUP_FILE" "$CONTAINER:/tmp/restore.tar.gz"
docker exec "$CONTAINER" rethinkdb restore -c 127.0.0.1:28015 --force /tmp/restore.tar.gz
docker exec "$CONTAINER" rm -f /tmp/restore.tar.gz

echo "Restore complete."
