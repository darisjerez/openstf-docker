#!/usr/bin/env bash
# Deploy STF device farm
# Usage: ./scripts/deploy.sh [dev|prod]

set -euo pipefail

ENV="${1:-prod}"
PROJECT="stf-${ENV}"
ENV_FILE="envs/.env.${ENV}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: ${ENV_FILE} not found"
  exit 1
fi

# Resolve PUBLIC_IP if not already set
if [ -z "${PUBLIC_IP:-}" ]; then
  PUBLIC_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0 2>/dev/null || echo "127.0.0.1")
  export PUBLIC_IP
fi

echo "Deploying ${ENV} environment (project: ${PROJECT})"
echo "  PUBLIC_IP: ${PUBLIC_IP}"
echo ""

# Generate resolved env file
envsubst < "$ENV_FILE" > .env.deploy
echo "PUBLIC_IP=${PUBLIC_IP}" >> .env.deploy

# Deploy
echo "Stopping existing containers..."
docker compose --env-file .env.deploy -p "$PROJECT" down --remove-orphans || true

echo "Starting services..."
docker compose --env-file .env.deploy -p "$PROJECT" up -d

echo ""
echo "Waiting for services to start..."
sleep 15

echo ""
docker compose -p "$PROJECT" ps

echo ""
echo "Running smoke tests..."
./scripts/smoke-test.sh "$ENV"
