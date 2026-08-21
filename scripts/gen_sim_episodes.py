#!/usr/bin/env python3
"""Generate simulated SO-100 compare episode JSON files under data/<suite>/.

Schema matches existing viewer payloads (meta / series / frames), including
optional meta.goal_pose for TCP task metrics.

Examples:
  python3 scripts/gen_sim_episodes.py --short
  python3 scripts/gen_sim_episodes.py --preset
  python3 scripts/gen_sim_episodes.py --suite 20260819 --count 4 --start 2
  python3 scripts/gen_sim_episodes.py --suite demo --count 3 --n-frames 8 --overwrite
"""

from __future__ import annotations

import argparse
import json
import math
import random
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

JOINT_NAMES = [
    "shoulder_pan",
    "shoulder_lift",
    "elbow_flex",
    "wrist_flex",
    "wrist_roll",
    "gripper",
]

DEFAULT_GOAL = {
    "pos": {"x": 0.18, "y": 0.02, "z": 0.08},
    "quat": {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0},
    "approach": {"x": 0.0, "y": 0.0, "z": -1.0},
    "frame": "world",
    "note": "simulate demo grasp goal for A5 task metrics",
}


def _clip(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x


def simulate_episode(
    n_frames: int,
    seed: int,
    *,
    error_scale: float = 1.0,
    fps: int = 30,
    source: str = "simulate",
) -> dict:
    """Synthetic absolute-joint trajectories (deg-like), SO-100-ish ranges."""
    rng = random.Random(seed)
    t = [2.0 * math.pi * i / max(1, n_frames - 1) for i in range(n_frames)]

    gt_actions: list[list[float]] = []
    for ti in t:
        gt_actions.append(
            [
                10.0 * math.sin(ti),
                -90.0 + 15.0 * math.sin(ti * 0.7 + 0.3),
                80.0 + 20.0 * math.cos(ti * 0.9),
                50.0 + 18.0 * math.sin(ti * 1.1 + 1.0),
                -10.0 * math.sin(ti * 0.5),
                _clip(0.5 + 0.4 * math.sin(ti * 2.0), 0.0, 1.0),
            ]
        )

    states: list[list[float]] = [[0.0] * 6 for _ in range(n_frames)]
    states[0] = gt_actions[0][:]
    for i in range(1, n_frames):
        prev, target = states[i - 1], gt_actions[i - 1]
        states[i] = [0.85 * prev[j] + 0.15 * target[j] for j in range(6)]

    phase = [rng.uniform(0.0, 2.0 * math.pi) for _ in range(6)]
    amp = [0.55, 0.45, 0.70, 0.50, 0.35, 0.015]
    amp = [a * error_scale for a in amp]
    residual = [[0.0] * 6 for _ in range(n_frames)]
    innov0 = [rng.gauss(0.0, 0.12 * error_scale) for _ in range(6)]
    innov0[5] *= 0.05
    residual[0] = innov0
    for i in range(1, n_frames):
        innov = [rng.gauss(0.0, 0.12 * error_scale) for _ in range(6)]
        innov[5] *= 0.05
        residual[i] = [0.94 * residual[i - 1][j] + 0.06 * innov[j] for j in range(6)]

    pred_actions: list[list[float]] = []
    for i, ti in enumerate(t):
        bias = [amp[j] * math.sin(0.35 * ti + phase[j]) for j in range(6)]
        row = [gt_actions[i][j] + bias[j] + residual[i][j] for j in range(6)]
        row[5] = _clip(row[5], 0.0, 1.0)
        pred_actions.append(row)

    return {
        "source": source,
        "fps": fps,
        "states": states,
        "gt_actions": gt_actions,
        "pred_actions": pred_actions,
    }


def build_payload(
    ep: dict,
    *,
    action_mode: str = "absolute",
    title: str | None = None,
    policy: str | None = None,
    model: str | None = None,
    goal_pose: dict | None = None,
) -> dict:
    states = ep["states"]
    gt_actions = ep["gt_actions"]
    pred_actions = ep["pred_actions"]
    n = len(states)
    fps = int(ep.get("fps", 30))

    if action_mode == "relative":
        next_gt = [[states[i][j] + gt_actions[i][j] for j in range(6)] for i in range(n)]
        next_pred = [[states[i][j] + pred_actions[i][j] for j in range(6)] for i in range(n)]
    else:
        next_gt = [row[:] for row in gt_actions]
        next_pred = [row[:] for row in pred_actions]

    err = [[next_pred[i][j] - next_gt[i][j] for j in range(6)] for i in range(n)]
    err_l2 = [math.sqrt(sum(v * v for v in row)) for row in err]
    err_abs_mean = [sum(abs(err[i][j]) for i in range(n)) / n for j in range(6)]

    next_obs = None
    if n >= 2:
        next_obs = [states[i + 1][:] for i in range(n - 1)] + [states[-1][:]]

    frames = []
    for i in range(n):
        item = {
            "t": i,
            "timestamp": float(i / fps),
            "current": states[i][:],
            "action_gt": gt_actions[i][:],
            "action_pred": pred_actions[i][:],
            "next_gt": next_gt[i][:],
            "next_pred": next_pred[i][:],
            "err": err[i][:],
            "err_l2": float(err_l2[i]),
        }
        if next_obs is not None:
            item["next_obs"] = next_obs[i][:]
        frames.append(item)

    meta = {
        "title": title or "SO-100 六轴：GT 下一时刻位姿 vs 模型下一时刻位姿",
        "joint_names": JOINT_NAMES[:],
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "n_frames": int(n),
        "action_mode": action_mode,
        "mean_l2": float(sum(err_l2) / n),
        "max_l2": float(max(err_l2)),
        "per_joint_mae": {name: float(err_abs_mean[i]) for i, name in enumerate(JOINT_NAMES)},
        "source": ep["source"],
        "fps": fps,
        "goal_pose": goal_pose if goal_pose is not None else json.loads(json.dumps(DEFAULT_GOAL)),
    }
    if policy:
        meta["policy"] = policy
    if model:
        meta["model"] = model

    return {
        "meta": meta,
        "series": {
            "t": list(range(n)),
            "err_l2": [float(x) for x in err_l2],
            "current": [row[:] for row in states],
            "next_gt": next_gt,
            "next_pred": next_pred,
            "per_joint_err": err,
        },
        "frames": frames,
    }


def write_episode(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--suite", action="append", dest="suites", help="data/<suite> name; repeatable")
    ap.add_argument("--count", type=int, default=0, help="episodes to write starting at --start (per suite)")
    ap.add_argument("--start", type=int, default=1, help="first episode index (episode_N.json)")
    ap.add_argument("--n-frames", type=int, default=120)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--seed-base", type=int, default=42)
    ap.add_argument("--overwrite", action="store_true", help="overwrite existing episode_*.json")
    ap.add_argument(
        "--preset",
        action="store_true",
        help="default demo layout: 20260819 (ep2-5) + 20260405 (ep1-3)",
    )
    ap.add_argument(
        "--short",
        action="store_true",
        help="write/overwrite short demos (5–10 frames) under short/ + refresh existing suites",
    )
    args = ap.parse_args()

    jobs: list[tuple[str, int, int, float, str, int]] = []
    # (suite, ep_idx, seed, error_scale, policy, n_frames)

    if args.short:
        short_specs = [
            # suite, ep, scale, policy, n_frames
            ("short", 1, 1.00, "baseline", 5),
            ("short", 2, 1.20, "baseline", 6),
            ("short", 3, 0.85, "act_v1", 7),
            ("short", 4, 1.35, "act_v1", 8),
            ("short", 5, 0.95, "pi0_demo", 9),
            ("short", 6, 1.10, "teleop_ref", 10),
            ("20260819", 1, 1.00, "baseline", 8),
            ("20260819", 2, 0.85, "baseline", 6),
            ("20260819", 3, 1.15, "baseline", 10),
            ("20260819", 4, 1.40, "act_v1", 5),
            ("20260819", 5, 0.70, "act_v1", 7),
            ("20260405", 1, 1.00, "teleop_ref", 6),
            ("20260405", 2, 1.25, "teleop_ref", 9),
            ("20260405", 3, 0.90, "pi0_demo", 5),
        ]
        for i, (suite, ep_idx, scale, policy, n_frames) in enumerate(short_specs):
            jobs.append((suite, ep_idx, args.seed_base + 300 + i * 13, scale, policy, n_frames))
        args.overwrite = True
    elif args.preset or not args.suites:
        # Keep existing 20260819/episode_1.json; add more variants.
        for i, (ep_idx, scale, policy) in enumerate(
            [
                (2, 0.85, "baseline"),
                (3, 1.15, "baseline"),
                (4, 1.40, "act_v1"),
                (5, 0.70, "act_v1"),
            ],
            start=0,
        ):
            jobs.append(("20260819", ep_idx, args.seed_base + 100 + i, scale, policy, args.n_frames))
        for i, (ep_idx, scale, policy) in enumerate(
            [
                (1, 1.00, "teleop_ref"),
                (2, 1.25, "teleop_ref"),
                (3, 0.90, "pi0_demo"),
            ],
            start=0,
        ):
            jobs.append(("20260405", ep_idx, args.seed_base + 200 + i, scale, policy, args.n_frames))
    else:
        count = args.count or 3
        for suite in args.suites:
            for k in range(count):
                ep_idx = args.start + k
                scale = 0.8 + 0.2 * ((k % 5) + 1)
                policy = "baseline" if k % 2 == 0 else "act_v1"
                # Spread 5–10 frames when caller asks for short n_frames default via --n-frames
                n_frames = args.n_frames
                if n_frames <= 10:
                    n_frames = 5 + (k % 6)
                jobs.append((suite, ep_idx, args.seed_base + ep_idx * 17, scale, policy, n_frames))

    written = []
    skipped = []
    for suite, ep_idx, seed, scale, policy, n_frames in jobs:
        out = DATA / suite / f"episode_{ep_idx}.json"
        if out.is_file() and not args.overwrite:
            skipped.append(str(out.relative_to(ROOT)))
            continue
        ep = simulate_episode(
            n_frames,
            seed,
            error_scale=scale,
            fps=args.fps,
            source=f"simulate:{suite}/episode_{ep_idx}",
        )
        # Slightly shift goal per episode for task-metric variety
        goal = json.loads(json.dumps(DEFAULT_GOAL))
        goal["pos"]["x"] = round(0.16 + 0.01 * (ep_idx % 5), 3)
        goal["pos"]["y"] = round(0.01 * ((ep_idx % 3) - 1), 3)
        payload = build_payload(
            ep,
            title=f"SO-100 模拟评测 · {suite} · episode_{ep_idx} ({n_frames}帧)",
            policy=policy,
            model=policy,
            goal_pose=goal,
        )
        write_episode(out, payload)
        written.append(f"{out.relative_to(ROOT)} (n={n_frames})")

    print(f"wrote {len(written)} file(s)")
    for p in written:
        print(f"  + {p}")
    if skipped:
        print(f"skipped {len(skipped)} existing (use --overwrite):")
        for p in skipped:
            print(f"  · {p}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
