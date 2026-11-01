#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

export POSTGRES_USER=smoke POSTGRES_DB=smoke
export POSTGRES_PASSWORD="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
export POSTGRES_URL='postgres://?sslmode=disable' REDIS_URL=redis://redis:6379/0
export APP_DOMAIN=traefik APP_ORIGIN=http://traefik HTTP_PORT=8081
export TRAEFIK_HTTP_PORT=0 POSTGRES_PORT=0 METRICS_TOKEN=
compose=(docker compose --env-file /dev/null -f infra/compose.yaml -f infra/compose.smoke.yaml --profile smoke -p "shifthelper-smoke-$$")
cleanup() {
  result=$?
  if [ "$result" -ne 0 ]; then
    "${compose[@]}" ps -a
    "${compose[@]}" logs --tail 50 backend goose frontend traefik
  fi
  "${compose[@]}" down --volumes --remove-orphans
  exit "$result"
}
trap cleanup EXIT

"${compose[@]}" up -d --build --wait --wait-timeout 240 traefik
"${compose[@]}" build smoke
"${compose[@]}" run --rm --no-deps -T smoke
"${compose[@]}" restart postgres backend frontend
"${compose[@]}" up -d --wait --wait-timeout 120 traefik
"${compose[@]}" run --rm --no-deps -T -e SMOKE_PHASE=resume smoke
