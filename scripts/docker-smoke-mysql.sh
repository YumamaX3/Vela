#!/bin/sh
# Storage Covenant Wave C7 — Docker smoke: boot VELA_DB_MODE=mysql against a
# THROWAWAY MariaDB, prove the gateway comes up healthy, tear everything down.
#
# Plan (plans/storage-covenant.md): "Dockerfile COPY ... + Docker smoke test
# booting VELA_DB_MODE=mysql against a throwaway MariaDB — without this, the
# fleet chart cannot run mysql/mirror at all."
#
# What this proves:
#   1. The Dockerfile carries mysql2's FULL runtime closure (pool.js loads it
#      via a dynamic import the file-tracer can't follow — a missing dep would
#      crash at boot, and this smoke is what fails LOUD).
#   2. The mysql posture boots, migrates the throwaway DB, and /api/health
#      answers ok — the same boot matrix the driver×mode contract pins.
#
# Requires: docker. Run from the repo root:  ./scripts/docker-smoke-mysql.sh
# Exit codes: 0 = smoke passed · non-zero = failed (containers are cleaned up).
set -eu

IMAGE="${VELA_SMOKE_IMAGE:-vela-smoke:mysql}"
NET=vela-smoke-net
DB=vela-smoke-db
GW=vela-smoke-gw
PASS='vela-smoke-throwaway-pass'

cleanup() {
  docker rm -f "$GW" >/dev/null 2>&1 || true
  docker rm -f "$DB" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[c7-smoke] building image ${IMAGE} ..."
docker build -t "$IMAGE" .

echo "[c7-smoke] creating throwaway network + MariaDB ..."
docker network create "$NET"
docker run -d --name "$DB" --network "$NET" \
  -e MARIADB_DATABASE=vela \
  -e MARIADB_USER=vela \
  -e MARIADB_PASSWORD="$PASS" \
  -e MARIADB_ROOT_PASSWORD="$PASS" \
  mariadb:11
echo "[c7-smoke] waiting for MariaDB to accept connections ..."
for i in $(seq 1 40); do
  if docker exec "$DB" mariadb -u vela -p"$PASS" vela -e 'SELECT 1' >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 40 ]; then
    echo "[c7-smoke] FAIL — MariaDB never became ready"; exit 1
  fi
  sleep 2
done

echo "[c7-smoke] booting the gateway (VELA_DB_MODE=mysql) ..."
docker run -d --name "$GW" --network "$NET" \
  -e VELA_DB_MODE=mysql \
  -e VELA_MYSQL_URL="mysql://vela:${PASS}@${DB}:3306/vela" \
  -e JWT_SECRET=vela-smoke-jwt-secret-not-for-production \
  -e API_KEY_SECRET=vela-smoke-api-key-secret-not-for-production \
  -e MACHINE_ID_SALT=vela-smoke-machine-id-salt \
  -e INITIAL_PASSWORD=vela-smoke \
  -e PORT=32060 -e HOSTNAME=0.0.0.0 \
  "$IMAGE"

echo "[c7-smoke] waiting for healthy (next standalone + migrations take a breath) ..."
sleep 5
status=""
for i in $(seq 1 40); do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$GW" 2>/dev/null || echo unknown)"
  if [ "$status" = "healthy" ]; then break; fi
  if ! docker inspect -f '{{.State.Running}}' "$GW" >/dev/null 2>&1; then
    echo "[c7-smoke] FAIL — the container exited before becoming healthy. Logs:"
    docker logs --tail 60 "$GW" || true
    exit 1
  fi
  if [ "$i" -eq 40 ]; then
    echo "[c7-smoke] FAIL — never healthy (last status: $status). Logs:"
    docker logs --tail 60 "$GW" || true
    exit 1
  fi
  sleep 3
done

echo "[c7-smoke] PASS — VELA_DB_MODE=mysql booted healthy against the throwaway MariaDB"
