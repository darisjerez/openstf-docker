#!/usr/bin/env bash
# Smoke test for STF device farm deployment
# Usage: ./scripts/smoke-test.sh [dev|prod]

set -euo pipefail

ENV="${1:-prod}"
FAILED=0
PASSED=0

# Port mapping per environment
if [ "$ENV" = "dev" ]; then
  NGINX_PORT=8880
  STF_PORT=7200
  RETHINKDB_PORT=8180
  EXPORTER_PORT=9205
  HEALER_PORT=9206
  MONITOR_PORT=9207
  PROMETHEUS_PORT=9190
  GRAFANA_PORT=3100
else
  NGINX_PORT=80
  STF_PORT=7100
  RETHINKDB_PORT=8080
  EXPORTER_PORT=9105
  HEALER_PORT=9106
  MONITOR_PORT=9107
  PROMETHEUS_PORT=9090
  GRAFANA_PORT=3000
fi

check() {
  local name="$1"
  local url="$2"
  local expected_status="${3:-200}"

  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")

  if [ "$status" = "$expected_status" ]; then
    echo "  PASS  $name ($url) -> $status"
    PASSED=$((PASSED + 1))
  else
    echo "  FAIL  $name ($url) -> $status (expected $expected_status)"
    FAILED=$((FAILED + 1))
  fi
}

echo ""
echo "========================================="
echo "  Smoke Tests — ${ENV} environment"
echo "========================================="
echo ""

echo "--- Core Services ---"
check "Nginx portal"          "http://127.0.0.1:${NGINX_PORT}/"
check "STF web UI"            "http://127.0.0.1:${STF_PORT}/"
check "RethinkDB admin"       "http://127.0.0.1:${RETHINKDB_PORT}/"

echo ""
echo "--- Exporters & Metrics ---"
check "STF exporter /metrics" "http://127.0.0.1:${EXPORTER_PORT}/metrics"
check "Healer /metrics"       "http://127.0.0.1:${HEALER_PORT}/metrics"
check "Monitor /metrics"      "http://127.0.0.1:${MONITOR_PORT}/metrics"
check "Healer API /api/status" "http://127.0.0.1:${HEALER_PORT}/api/status"

echo ""
echo "--- Monitoring Stack ---"
check "Prometheus"            "http://127.0.0.1:${PROMETHEUS_PORT}/-/healthy"
check "Grafana"               "http://127.0.0.1:${GRAFANA_PORT}/api/health"

echo ""
echo "--- Nginx Proxied Routes ---"
check "Nginx -> wall"         "http://127.0.0.1:${NGINX_PORT}/wall/"
check "Nginx -> healer API"   "http://127.0.0.1:${NGINX_PORT}/healer/api/status"
check "Nginx -> monitor"      "http://127.0.0.1:${NGINX_PORT}/monitor/metrics"

echo ""
echo "========================================="
echo "  Results: ${PASSED} passed, ${FAILED} failed"
echo "========================================="
echo ""

if [ "$FAILED" -gt 0 ]; then
  echo "Smoke tests FAILED"
  exit 1
fi

echo "All smoke tests PASSED"
exit 0
