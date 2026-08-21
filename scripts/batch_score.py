#!/usr/bin/env python3
"""Batch score compare_result.json files and apply threshold gates (E22 / E23).

Joint-space metrics always come from JSON meta/frames.
TCP gates apply when a sidecar ``*.summary.json`` (from viewer export) exists,
or when the compare JSON embeds ``tcp_summary``.

Examples:
  python3 scripts/batch_score.py ./runs --thresholds scripts/thresholds.example.json
  python3 scripts/batch_score.py compare_result.json -o /tmp/batch_out
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _looks_like_episode(path: Path) -> bool:
    try:
        obj = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return False
    if not isinstance(obj, dict):
        return False
    meta, frames = obj.get("meta"), obj.get("frames")
    if not isinstance(meta, dict) or not isinstance(frames, list) or not frames:
        return False
    robot = meta.get("robot") or meta.get("robot_id") or meta.get("robot_model") or meta.get("arm")
    if not robot:
        return False
    f0 = frames[0] if isinstance(frames[0], dict) else {}
    joints = f0.get("current") or f0.get("next_gt") or f0.get("next_pred")
    return isinstance(joints, list) and len(joints) > 0


def find_inputs(root: Path) -> list[Path]:
    if root.is_file():
        return [root]
    skip = {
        "index.json",
        "catalog.json",
        "manifest.json",
        "thresholds.example.json",
        "episodes.manifest.example.json",
        "package.json",
        "package-lock.json",
    }
    out: list[Path] = []
    for path in sorted(root.rglob("*.json")):
        if path.name.lower() in skip:
            continue
        # Ignore vendored / unrelated JSON trees
        if "vendor" in path.parts or "node_modules" in path.parts:
            continue
        if _looks_like_episode(path):
            out.append(path)
    return out


def load_thresholds(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {}
    return load_json(path)


def sidecar_summary(compare_path: Path) -> dict[str, Any] | None:
    for cand in (
        compare_path.with_name("eval_summary.json"),
        compare_path.with_suffix(".summary.json"),
        compare_path.parent / "tcp_summary.json",
    ):
        if cand.is_file():
            return load_json(cand)
    return None


def score_one(path: Path, thresholds: dict[str, Any]) -> dict[str, Any]:
    data = load_json(path)
    meta = data.get("meta") or {}
    frames = data.get("frames") or []

    mean_l2 = meta.get("mean_l2")
    max_l2 = meta.get("max_l2")
    if mean_l2 is None and frames:
        errs = [float(f.get("err_l2", 0.0)) for f in frames]
        mean_l2 = sum(errs) / len(errs)
        max_l2 = max(errs)

    summary = sidecar_summary(path) or {}
    tcp = summary.get("tcp") or meta.get("tcp_summary") or {}
    tcp_summary = tcp.get("summary") if isinstance(tcp, dict) else None

    checks: list[dict[str, Any]] = []

    def add(name: str, actual: float | None, limit: Any, ok: bool) -> None:
        checks.append(
            {
                "name": name,
                "actual": None if actual is None else round(float(actual), 6),
                "limit": limit,
                "ok": bool(ok),
            }
        )

    if thresholds.get("max_mean_l2") is not None and mean_l2 is not None:
        lim = float(thresholds["max_mean_l2"])
        add("mean_l2", mean_l2, f"<= {lim}", mean_l2 <= lim)

    if thresholds.get("max_l2") is not None and max_l2 is not None:
        lim = float(thresholds["max_l2"])
        add("max_l2", max_l2, f"<= {lim}", max_l2 <= lim)

    if tcp_summary:
        ep = (tcp_summary.get("ep_mm") or {}).get("mean")
        eR = (tcp_summary.get("eR_deg") or {}).get("mean")
        ep95 = (tcp_summary.get("ep_mm") or {}).get("p95")
        if thresholds.get("max_tcp_ep_mean_mm") is not None and ep is not None:
            lim = float(thresholds["max_tcp_ep_mean_mm"])
            add("tcp_ep_mean_mm", ep, f"<= {lim}", float(ep) <= lim)
        if thresholds.get("max_tcp_ep_p95_mm") is not None and ep95 is not None:
            lim = float(thresholds["max_tcp_ep_p95_mm"])
            add("tcp_ep_p95_mm", ep95, f"<= {lim}", float(ep95) <= lim)
        if thresholds.get("max_tcp_eR_mean_deg") is not None and eR is not None:
            lim = float(thresholds["max_tcp_eR_mean_deg"])
            add("tcp_eR_mean_deg", eR, f"<= {lim}", float(eR) <= lim)

    passed = all(c["ok"] for c in checks) if checks else True
    return {
        "path": str(path),
        "title": meta.get("title"),
        "n_frames": meta.get("n_frames", len(frames)),
        "action_mode": meta.get("action_mode"),
        "mean_l2": mean_l2,
        "max_l2": max_l2,
        "has_tcp_summary": bool(tcp_summary),
        "gates": {"passed": passed, "checks": checks},
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input", type=Path, help="compare_result.json or directory")
    ap.add_argument(
        "--thresholds",
        type=Path,
        default=None,
        help="JSON thresholds (see scripts/thresholds.example.json)",
    )
    ap.add_argument("-o", "--out-dir", type=Path, default=None, help="write summary.json/csv here")
    ap.add_argument("--fail-on-gate", action="store_true", help="exit 2 if any gate fails")
    args = ap.parse_args()

    thresholds = load_thresholds(args.thresholds)
    paths = find_inputs(args.input)
    if not paths:
        print("no valid episode JSON found", file=sys.stderr)
        return 1

    rows = [score_one(p, thresholds) for p in paths]
    payload = {
        "n": len(rows),
        "thresholds": thresholds,
        "results": rows,
        "passed": all(r["gates"]["passed"] for r in rows),
    }

    text = json.dumps(payload, ensure_ascii=False, indent=2)
    print(text)

    if args.out_dir:
        args.out_dir.mkdir(parents=True, exist_ok=True)
        (args.out_dir / "batch_summary.json").write_text(text + "\n", encoding="utf-8")
        csv_path = args.out_dir / "batch_summary.csv"
        with csv_path.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(
                f,
                fieldnames=[
                    "path",
                    "title",
                    "n_frames",
                    "action_mode",
                    "mean_l2",
                    "max_l2",
                    "has_tcp_summary",
                    "gate_passed",
                ],
            )
            w.writeheader()
            for r in rows:
                w.writerow(
                    {
                        "path": r["path"],
                        "title": r["title"],
                        "n_frames": r["n_frames"],
                        "action_mode": r["action_mode"],
                        "mean_l2": r["mean_l2"],
                        "max_l2": r["max_l2"],
                        "has_tcp_summary": r["has_tcp_summary"],
                        "gate_passed": r["gates"]["passed"],
                    }
                )

    if args.fail_on_gate and not payload["passed"]:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
