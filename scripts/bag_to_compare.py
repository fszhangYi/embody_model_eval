#!/usr/bin/env python3
"""Convert a simple robot log / bag export into episode compare JSON (E24).

Supported inputs:
  1) JSONL — one object per line with joints:
       {"t":0,"current":[...],"next_gt":[...],"next_pred":[...]}
     Aliases: gt / pred / action_gt / action_pred.
  2) CSV — columns: t, current_0..N, gt_0..N, pred_0..N  (or next_gt_* / next_pred_*).

This does not parse ROS bag binaries; export joints to JSONL/CSV first
(rosbag → csv, or your teleop logger). Output schema matches the viewer.

Example:
  python3 scripts/bag_to_compare.py run.jsonl -o data/test1/episode_2.json \\
    --joint-names shoulder_pan,shoulder_lift,elbow_flex,wrist_flex,wrist_roll,gripper \\
    --fps 30 --action-mode absolute --title "bag replay"
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


DEFAULT_JOINTS = [
    "shoulder_pan",
    "shoulder_lift",
    "elbow_flex",
    "wrist_flex",
    "wrist_roll",
    "gripper",
]


def parse_joint_names(s: str | None, n_hint: int | None) -> list[str]:
    if s:
        names = [x.strip() for x in s.split(",") if x.strip()]
        if names:
            return names
    if n_hint:
        return [f"joint_{i}" for i in range(n_hint)]
    return list(DEFAULT_JOINTS)


def as_float_list(v: Any) -> list[float]:
    if v is None:
        return []
    if isinstance(v, str):
        v = json.loads(v)
    return [float(x) for x in v]


def normalize_row(obj: dict[str, Any], idx: int) -> dict[str, Any]:
    current = as_float_list(obj.get("current") or obj.get("obs") or obj.get("q"))
    next_gt = as_float_list(
        obj.get("next_gt") or obj.get("gt") or obj.get("action_gt") or obj.get("q_gt")
    )
    next_pred = as_float_list(
        obj.get("next_pred") or obj.get("pred") or obj.get("action_pred") or obj.get("q_pred")
    )
    # allow current-only logs: treat current as gt/pred identical for pure replay
    if current and not next_gt and not next_pred:
        next_gt = list(current)
        next_pred = list(current)
    if not next_gt or not next_pred:
        raise ValueError(f"line/frame {idx}: need gt & pred (or current-only replay)")
    if not current:
        current = list(next_gt)
    n = min(len(current), len(next_gt), len(next_pred))
    current, next_gt, next_pred = current[:n], next_gt[:n], next_pred[:n]
    err = [p - g for p, g in zip(next_pred, next_gt)]
    err_l2 = math.sqrt(sum(e * e for e in err))
    t = obj.get("t", idx)
    ts = obj.get("timestamp", float(t) if not isinstance(t, str) else t)
    return {
        "t": int(t) if not isinstance(t, str) else idx,
        "timestamp": ts,
        "current": current,
        "action_gt": next_gt,
        "action_pred": next_pred,
        "next_gt": next_gt,
        "next_pred": next_pred,
        "err": err,
        "err_l2": err_l2,
    }


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    with path.open(encoding="utf-8") as f:
        for i, line in enumerate(f):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            rows.append(normalize_row(json.loads(line), i))
    return rows


def load_csv(path: Path) -> list[dict[str, Any]]:
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise ValueError("empty csv")
        fields = list(reader.fieldnames)

        def cols(prefix: str) -> list[str]:
            keyed = [c for c in fields if c.startswith(prefix)]
            if keyed:
                def idx(c: str) -> int:
                    tail = c[len(prefix) :]
                    return int(tail) if tail.isdigit() else 0
                return sorted(keyed, key=idx)
            return []

        cur_c = cols("current_") or cols("q_")
        gt_c = cols("next_gt_") or cols("gt_")
        pred_c = cols("next_pred_") or cols("pred_")
        rows = []
        for i, row in enumerate(reader):
            obj = {
                "t": row.get("t", i),
                "timestamp": row.get("timestamp", row.get("t", i)),
                "current": [row[c] for c in cur_c] if cur_c else None,
                "next_gt": [row[c] for c in gt_c] if gt_c else None,
                "next_pred": [row[c] for c in pred_c] if pred_c else None,
            }
            rows.append(normalize_row(obj, i))
        return rows


def build_compare(frames: list[dict[str, Any]], args: argparse.Namespace) -> dict[str, Any]:
    n = len(frames)
    if n == 0:
        raise ValueError("no frames")
    dof = len(frames[0]["next_gt"])
    names = parse_joint_names(args.joint_names, dof)
    if len(names) != dof:
        names = (names + [f"joint_{i}" for i in range(dof)])[:dof]

    mean_l2 = sum(f["err_l2"] for f in frames) / n
    max_l2 = max(f["err_l2"] for f in frames)
    per_joint = []
    for j in range(dof):
        mae = sum(abs(f["err"][j]) for f in frames) / n
        per_joint.append({"name": names[j], "mae": mae})

    series = {
        "t": [f["t"] for f in frames],
        "err_l2": [f["err_l2"] for f in frames],
    }
    for j, name in enumerate(names):
        series[f"gt_{name}"] = [f["next_gt"][j] for f in frames]
        series[f"pred_{name}"] = [f["next_pred"][j] for f in frames]
        series[f"cur_{name}"] = [f["current"][j] for f in frames]

    return {
        "meta": {
            "title": args.title or f"Bag / log replay ({path_stem(args.input)})",
            "joint_names": names,
            "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "n_frames": n,
            "action_mode": args.action_mode,
            "mean_l2": mean_l2,
            "max_l2": max_l2,
            "per_joint_mae": {p["name"]: p["mae"] for p in per_joint},
            "source": args.source or f"bag_to_compare:{args.input}",
            "fps": args.fps,
            "dataset_id": args.dataset_id,
            "policy": args.policy,
            "ckpt": args.ckpt,
        },
        "series": series,
        "frames": frames,
    }


def path_stem(p: Path) -> str:
    return p.stem


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input", type=Path, help="JSONL or CSV joint log")
    ap.add_argument("-o", "--output", type=Path, default=Path("data/test1/episode_1.json"))
    ap.add_argument("--fps", type=float, default=30.0)
    ap.add_argument("--action-mode", default="absolute")
    ap.add_argument("--joint-names", default=None, help="comma-separated")
    ap.add_argument("--title", default=None)
    ap.add_argument("--source", default=None)
    ap.add_argument("--dataset-id", default=None)
    ap.add_argument("--policy", default=None)
    ap.add_argument("--ckpt", default=None)
    args = ap.parse_args()

    suf = args.input.suffix.lower()
    if suf == ".jsonl" or suf == ".ndjson":
        frames = load_jsonl(args.input)
    elif suf == ".csv":
        frames = load_csv(args.input)
    elif suf == ".json":
        raw = json.loads(args.input.read_text(encoding="utf-8"))
        if isinstance(raw, list):
            frames = [normalize_row(x, i) for i, x in enumerate(raw)]
        elif isinstance(raw, dict) and "frames" in raw:
            # already compare-like — pass through with light meta fill
            args.output.write_text(
                json.dumps(raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            print(f"wrote {args.output} (passthrough)")
            return 0
        else:
            print("unsupported json shape", file=sys.stderr)
            return 1
    else:
        print("unsupported input type (use .jsonl / .csv / .json)", file=sys.stderr)
        return 1

    out = build_compare(frames, args)
    args.output.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"wrote {args.output} · n={out['meta']['n_frames']} · mean_l2={out['meta']['mean_l2']:.4f}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
