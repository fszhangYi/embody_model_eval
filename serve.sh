#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${1:-6006}"
exec python3 -m http.server "$PORT" --bind 0.0.0.0
