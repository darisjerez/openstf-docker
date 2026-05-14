#!/usr/bin/env bash
# Create a new license via the admin API.
#   WORKER_URL=https://openstf-license.example.workers.dev \
#   ADMIN_TOKEN=... \
#   ./create-license.sh "Acme Corp" 2026-12-31 1
set -euo pipefail

WORKER_URL="${WORKER_URL:?set WORKER_URL}"
ADMIN_TOKEN="${ADMIN_TOKEN:?set ADMIN_TOKEN}"

CLIENT_NAME="${1:?usage: $0 <client_name> <expires YYYY-MM-DD> [max_installs]}"
EXPIRES_DATE="${2:?usage: $0 <client_name> <expires YYYY-MM-DD> [max_installs]}"
MAX_INSTALLS="${3:-1}"

# Cross-platform date parsing (macOS uses BSD date; Linux uses GNU date)
if EXPIRES_AT=$(date -j -f '%Y-%m-%d' "$EXPIRES_DATE" +%s 2>/dev/null); then
  :
else
  EXPIRES_AT=$(date -d "$EXPIRES_DATE" +%s)
fi

curl -sS -X POST "$WORKER_URL/admin/create" \
  -H "content-type: application/json" \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -d "$(cat <<EOF
{
  "client_name": "$CLIENT_NAME",
  "expires_at": $EXPIRES_AT,
  "max_installs": $MAX_INSTALLS
}
EOF
)"
echo
