#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Detect docker compose command
if docker compose version &>/dev/null; then
  DC="docker compose"
elif command -v docker-compose &>/dev/null; then
  DC="docker-compose"
else
  echo "[✗] Docker Compose not found." >&2; exit 1
fi

$DC up -d --build
echo "[✓] Started at http://localhost:${PORT:-9999}"
