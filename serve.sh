#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${1:-6006}"

# 静态页 + /api/*（skills / agent chat）；启动前刷新 data/index.json
exec python3 scripts/agent_server.py "$PORT" --bind 0.0.0.0
