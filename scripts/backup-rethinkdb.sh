#!/usr/bin/env bash
# Usage: ./scripts/backup-rethinkdb.sh [backup-dir]
#
# Creates a RethinkDB backup via docker exec.
# Stores backups with timestamp naming, keeps last 7.
# Can be run via cron:
#   0 2 * * * /path/to/scripts/backup-rethinkdb.sh

set -euo pipefail

BACKUP_DIR="${1:-./backups}"
CONTAINER="stf-rethinkdb"
TIMESTAMP=$(date +%Y-%m-%d-%H%M%S)
BACKUP_NAME="stf-backup-${TIMESTAMP}.tar.gz"
KEEP_COUNT=7

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo "Starting RethinkDB backup..."
echo "  Container: $CONTAINER"
echo "  Output:    $BACKUP_DIR/$BACKUP_NAME"

# Check that the container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "ERROR: Container '$CONTAINER' is not running."
  exit 1
fi

# Run rethinkdb dump inside the container and copy the file out
docker exec "$CONTAINER" rethinkdb dump -c 127.0.0.1:28015 -f /tmp/backup.tar.gz 2>/dev/null
docker cp "$CONTAINER:/tmp/backup.tar.gz" "$BACKUP_DIR/$BACKUP_NAME"
docker exec "$CONTAINER" rm -f /tmp/backup.tar.gz

echo "Backup created: $BACKUP_DIR/$BACKUP_NAME"

# Cleanup old backups — keep only the last N
backup_count=$(ls -1t "$BACKUP_DIR"/stf-backup-*.tar.gz 2>/dev/null | wc -l)
if [ "$backup_count" -gt "$KEEP_COUNT" ]; then
  echo "Cleaning up old backups (keeping last $KEEP_COUNT)..."
  ls -1t "$BACKUP_DIR"/stf-backup-*.tar.gz | tail -n +$((KEEP_COUNT + 1)) | xargs rm -f
  echo "Removed $((backup_count - KEEP_COUNT)) old backup(s)."
fi

echo "Done."
