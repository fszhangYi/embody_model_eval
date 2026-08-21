#!/usr/bin/env python3
"""Scan data/<suite>/*.json and rewrite data/index.json (optional cache for Hub)."""

from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SKIP = {"index.json", "catalog.json", "manifest.json"}


def is_valid_episode(obj: object) -> bool:
    if not isinstance(obj, dict):
        return False
    meta = obj.get("meta")
    frames = obj.get("frames")
    if not isinstance(meta, dict) or not isinstance(frames, list) or not frames:
        return False
    f0 = frames[0] if isinstance(frames[0], dict) else {}
    joints = f0.get("current") or f0.get("next_gt") or f0.get("next_pred")
    return isinstance(joints, list) and len(joints) > 0


def main() -> int:
    DATA.mkdir(parents=True, exist_ok=True)
    suites = []
    for d in sorted(p for p in DATA.iterdir() if p.is_dir() and not p.name.startswith(".")):
        eps = []
        for f in sorted(d.glob("*.json")):
            if f.name.lower() in SKIP:
                continue
            try:
                obj = json.loads(f.read_text(encoding="utf-8"))
            except Exception:
                continue
            if is_valid_episode(obj):
                eps.append(f.name)
        suites.append({"id": d.name, "episodes": eps})

    idx = {
        "root": "./data",
        "suites": suites,
        "_comment": "Optional cache for Hub when HTTP directory listing is unavailable. Regenerate: python3 scripts/refresh_data_index.py",
    }
    out = DATA / "index.json"
    out.write_text(json.dumps(idx, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT)} · {len(suites)} suites")
    for s in suites:
        print(f"  {s['id']}: {len(s['episodes'])} episode(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
