#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

export POSTGRES_USER=smoke POSTGRES_DB=smoke
export POSTGRES_PASSWORD="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
export POSTGRES_URL='postgres://?sslmode=disable' REDIS_URL=redis://redis:6379/0
export APP_DOMAIN=traefik APP_ORIGIN=http://traefik HTTP_PORT=8081
export TRAEFIK_HTTP_PORT=0 POSTGRES_PORT=0 METRICS_TOKEN=
export SMOKE_MAP_TLS_DIR="$(mktemp -d)"
export SMOKE_GEOCODING_KEY=smoke-geocoder-key SMOKE_TILES_KEY=smoke-map-key
compose=(docker compose --env-file /dev/null -f infra/compose.yaml -f infra/compose.smoke.yaml --profile smoke -p "shifthelper-smoke-$$")
cleanup() {
  result=$?
  if [ "$result" -ne 0 ]; then
    "${compose[@]}" ps -a
    "${compose[@]}" logs --tail 50 backend goose frontend traefik
  fi
  "${compose[@]}" down --volumes --remove-orphans || result=1
  rm -f -- "$SMOKE_MAP_TLS_DIR/tls.crt" "$SMOKE_MAP_TLS_DIR/tls.key"
  rmdir -- "$SMOKE_MAP_TLS_DIR"
  exit "$result"
}
trap cleanup EXIT

openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj /CN=api.geoapify.com -addext subjectAltName=DNS:api.geoapify.com \
  -keyout "$SMOKE_MAP_TLS_DIR/tls.key" -out "$SMOKE_MAP_TLS_DIR/tls.crt" >/dev/null 2>&1
"${compose[@]}" up -d --build --wait --wait-timeout 240 traefik
"${compose[@]}" build smoke
"${compose[@]}" run --rm --no-deps -T smoke
export SMOKE_GEOCODING_KEY= SMOKE_TILES_KEY=
"${compose[@]}" restart postgres
"${compose[@]}" up -d --build --wait --wait-timeout 120 traefik
"${compose[@]}" run --rm --no-deps -T -e SMOKE_PHASE=resume smoke
