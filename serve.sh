#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${1:-6006}"

NODE_DIR="${NODE_DIR:-/root/autodl-tmp/node-v22.14.0-linux-x64}"
if [[ -x "${NODE_DIR}/bin/npm" ]]; then
  export PATH="${NODE_DIR}/bin:$PATH"
  echo "[serve] building frontend → dist/ ..."
  (cd frontend && npm run build)
else
  echo "[serve] warn: npm not found (${NODE_DIR}); skip frontend build" >&2
fi

# 静态页 + /api/*（skills / agent chat）；启动前刷新 data/index.json
exec python3 scripts/agent_server.py "$PORT" --bind 0.0.0.0
