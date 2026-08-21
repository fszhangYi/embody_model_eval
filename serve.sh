#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${1:-6006}"

# 启动前实时扫描 data/<suite>/*.json，更新 data/index.json
python3 scripts/refresh_data_index.py

exec python3 -m http.server "$PORT" --bind 0.0.0.0
