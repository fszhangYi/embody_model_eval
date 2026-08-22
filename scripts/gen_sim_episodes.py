#!/usr/bin/env python3
"""Generate simulated compare episode JSON files under data/<suite>/.

Supports robots registered in robots.json (so100 / ec616 / koch). Schema matches
existing viewer payloads (meta / series / frames), including optional
meta.goal_pose for TCP task metrics.

Examples:
  python3 scripts/gen_sim_episodes.py --short
  python3 scripts/gen_sim_episodes.py --ec616
  python3 scripts/gen_sim_episodes.py --preset
  python3 scripts/gen_sim_episodes.py --suite demo --robot ec616 --count 3 --n-frames 8 --overwrite
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

SO100_JOINTS = [
    "shoulder_pan",
    "shoulder_lift",
    "elbow_flex",
    "wrist_flex",
    "wrist_roll",
    "gripper",
]

EC616_JOINTS = [
    "Joint1",
    "Joint2",
    "Joint3",
    "Joint4",
    "Joint5",
    "Joint6",
    "gripper_1_joint",
    "gripper_2_joint",
]

DEFAULT_GOAL_SO100 = {
    "pos": {"x": 0.18, "y": 0.02, "z": 0.08},
    "quat": {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0},
    "approach": {"x": 0.0, "y": 0.0, "z": -1.0},
    "frame": "world",
    "note": "simulate demo grasp goal for A5 task metrics",
}

# EC616 reach is ~0.5–1 m; goal sits in front of the base on the table plane.
DEFAULT_GOAL_EC616 = {
    "pos": {"x": 0.42, "y": 0.05, "z": 0.12},
    "quat": {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0},
    "approach": {"x": 0.0, "y": 0.0, "z": -1.0},
    "frame": "world",
    "note": "EC616 simulate demo grasp goal (industrial reach)",
}


def _clip(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x


def _load_robot_joints(robot_id: str) -> list[str]:
    robots_path = ROOT / "config" / "robots.json"
    if robots_path.is_file():
        reg = json.loads(robots_path.read_text(encoding="utf-8"))
        profile = (reg.get("robots") or {}).get(robot_id) or {}
        names = profile.get("joint_names")
        if isinstance(names, list) and names:
            return [str(n) for n in names]
    if robot_id == "ec616":
        return EC616_JOINTS[:]
    return SO100_JOINTS[:]


def simulate_episode_so100(
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
    dof = 6

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

    states: list[list[float]] = [[0.0] * dof for _ in range(n_frames)]
    states[0] = gt_actions[0][:]
    for i in range(1, n_frames):
        prev, target = states[i - 1], gt_actions[i - 1]
        states[i] = [0.85 * prev[j] + 0.15 * target[j] for j in range(dof)]

    phase = [rng.uniform(0.0, 2.0 * math.pi) for _ in range(dof)]
    amp = [a * error_scale for a in [0.55, 0.45, 0.70, 0.50, 0.35, 0.015]]
    residual = [[0.0] * dof for _ in range(n_frames)]
    innov0 = [rng.gauss(0.0, 0.12 * error_scale) for _ in range(dof)]
    innov0[5] *= 0.05
    residual[0] = innov0
    for i in range(1, n_frames):
        innov = [rng.gauss(0.0, 0.12 * error_scale) for _ in range(dof)]
        innov[5] *= 0.05
        residual[i] = [0.94 * residual[i - 1][j] + 0.06 * innov[j] for j in range(dof)]

    pred_actions: list[list[float]] = []
    for i, ti in enumerate(t):
        bias = [amp[j] * math.sin(0.35 * ti + phase[j]) for j in range(dof)]
        row = [gt_actions[i][j] + bias[j] + residual[i][j] for j in range(dof)]
        row[5] = _clip(row[5], 0.0, 1.0)
        pred_actions.append(row)

    return {
        "source": source,
        "fps": fps,
        "states": states,
        "gt_actions": gt_actions,
        "pred_actions": pred_actions,
    }


def _ec616_gripper_pair(open_deg: float) -> tuple[float, float]:
    """Episode degrees → joint values for index.html (direct setJointValue).

    Open amount is positive degrees (~0–40). Finger 2 is mirrored in mesh, so
    its commanded angle is opposite for a parallel open/close.
    """
    g = _clip(float(open_deg), 0.0, 40.0)
    return g, -g


def simulate_episode_ec616(
    n_frames: int,
    seed: int,
    *,
    error_scale: float = 1.0,
    fps: int = 30,
    source: str = "simulate",
) -> dict:
    """Synthetic EC616 trajectories around home_q, with mirrored parallel jaws."""
    rng = random.Random(seed)
    t = [2.0 * math.pi * i / max(1, n_frames - 1) for i in range(n_frames)]
    dof = 8
    # Center near robots.json home_q_deg (grippers stored as ±open).
    center = [0.0, -45.0, 60.0, 0.0, 30.0, 0.0]

    gt_actions: list[list[float]] = []
    for ti in t:
        arm = [
            center[0] + 18.0 * math.sin(ti),
            center[1] + 12.0 * math.sin(ti * 0.7 + 0.4),
            center[2] + 15.0 * math.cos(ti * 0.85),
            center[3] + 20.0 * math.sin(ti * 1.05 + 0.6),
            center[4] + 10.0 * math.sin(ti * 0.55 + 0.2),
            center[5] + 25.0 * math.sin(ti * 0.9 + 1.1),
        ]
        # Close near mid-trajectory, open at ends (pick-ish envelope).
        open_deg = 22.0 - 14.0 * (0.5 + 0.5 * math.sin(ti * 2.0 - 0.5))
        g1, g2 = _ec616_gripper_pair(open_deg)
        gt_actions.append(arm + [g1, g2])

    states: list[list[float]] = [[0.0] * dof for _ in range(n_frames)]
    states[0] = gt_actions[0][:]
    for i in range(1, n_frames):
        prev, target = states[i - 1], gt_actions[i - 1]
        states[i] = [0.85 * prev[j] + 0.15 * target[j] for j in range(dof)]

    phase = [rng.uniform(0.0, 2.0 * math.pi) for _ in range(dof)]
    amp = [a * error_scale for a in [0.50, 0.40, 0.55, 0.45, 0.35, 0.40, 0.25, 0.25]]
    residual = [[0.0] * dof for _ in range(n_frames)]
    innov0 = [rng.gauss(0.0, 0.10 * error_scale) for _ in range(dof)]
    innov0[6] *= 0.4
    innov0[7] *= 0.4
    residual[0] = innov0
    for i in range(1, n_frames):
        innov = [rng.gauss(0.0, 0.10 * error_scale) for _ in range(dof)]
        innov[6] *= 0.4
        innov[7] *= 0.4
        residual[i] = [0.94 * residual[i - 1][j] + 0.06 * innov[j] for j in range(dof)]

    pred_actions: list[list[float]] = []
    for i, ti in enumerate(t):
        bias = [amp[j] * math.sin(0.35 * ti + phase[j]) for j in range(dof)]
        row = [gt_actions[i][j] + bias[j] + residual[i][j] for j in range(dof)]
        # Keep jaws mirrored after noise.
        open_cmd = _clip(0.5 * (row[6] - row[7]), 0.0, 40.0)
        row[6], row[7] = _ec616_gripper_pair(open_cmd)
        pred_actions.append(row)

    return {
        "source": source,
        "fps": fps,
        "states": states,
        "gt_actions": gt_actions,
        "pred_actions": pred_actions,
    }


def simulate_episode_koch(
    n_frames: int,
    seed: int,
    *,
    error_scale: float = 1.0,
    fps: int = 30,
    source: str = "simulate",
) -> dict:
    """Synthetic Koch v1.1 trajectories (6 joints, deg) around a desktop home pose."""
    rng = random.Random(seed)
    t = [2.0 * math.pi * i / max(1, n_frames - 1) for i in range(n_frames)]
    dof = 6
    center = [0.0, -40.0, 70.0, 40.0, 0.0, -20.0]

    gt_actions: list[list[float]] = []
    for ti in t:
        gt_actions.append(
            [
                center[0] + 20.0 * math.sin(ti),
                center[1] + 12.0 * math.sin(ti * 0.7 + 0.3),
                center[2] + 15.0 * math.cos(ti * 0.85),
                center[3] + 14.0 * math.sin(ti * 1.05 + 0.6),
                center[4] + 18.0 * math.sin(ti * 0.55),
                _clip(center[5] + 8.0 * math.sin(ti * 1.6), -120.0, 0.0),
            ]
        )

    states: list[list[float]] = [[0.0] * dof for _ in range(n_frames)]
    states[0] = gt_actions[0][:]
    for i in range(1, n_frames):
        prev, target = states[i - 1], gt_actions[i - 1]
        states[i] = [0.85 * prev[j] + 0.15 * target[j] for j in range(dof)]

    phase = [rng.uniform(0.0, 2.0 * math.pi) for _ in range(dof)]
    amp = [a * error_scale for a in [0.6, 0.5, 0.65, 0.55, 0.4, 0.35]]
    residual = [[0.0] * dof for _ in range(n_frames)]
    residual[0] = [rng.gauss(0.0, 0.12 * error_scale) for _ in range(dof)]
    for i in range(1, n_frames):
        innov = [rng.gauss(0.0, 0.12 * error_scale) for _ in range(dof)]
        residual[i] = [0.94 * residual[i - 1][j] + 0.06 * innov[j] for j in range(dof)]

    pred_actions: list[list[float]] = []
    for i, ti in enumerate(t):
        bias = [amp[j] * math.sin(0.35 * ti + phase[j]) for j in range(dof)]
        row = [gt_actions[i][j] + bias[j] + residual[i][j] for j in range(dof)]
        row[5] = _clip(row[5], -120.0, 0.0)
        pred_actions.append(row)

    return {
        "source": source,
        "fps": fps,
        "states": states,
        "gt_actions": gt_actions,
        "pred_actions": pred_actions,
    }


def simulate_episode(
    n_frames: int,
    seed: int,
    *,
    robot_id: str = "so100",
    error_scale: float = 1.0,
    fps: int = 30,
    source: str = "simulate",
) -> dict:
    if robot_id == "ec616":
        return simulate_episode_ec616(
            n_frames, seed, error_scale=error_scale, fps=fps, source=source
        )
    if robot_id == "koch":
        return simulate_episode_koch(
            n_frames, seed, error_scale=error_scale, fps=fps, source=source
        )
    return simulate_episode_so100(
        n_frames, seed, error_scale=error_scale, fps=fps, source=source
    )


def build_payload(
    ep: dict,
    *,
    joint_names: list[str],
    action_mode: str = "absolute",
    title: str | None = None,
    policy: str | None = None,
    model: str | None = None,
    goal_pose: dict | None = None,
    robot_id: str = "so100",
) -> dict:
    states = ep["states"]
    gt_actions = ep["gt_actions"]
    pred_actions = ep["pred_actions"]
    n = len(states)
    fps = int(ep.get("fps", 30))
    dof = len(joint_names)
    if not states or len(states[0]) != dof:
        raise ValueError(f"trajectory dof {len(states[0]) if states else 0} ≠ joint_names {dof}")

    if action_mode == "relative":
        next_gt = [[states[i][j] + gt_actions[i][j] for j in range(dof)] for i in range(n)]
        next_pred = [[states[i][j] + pred_actions[i][j] for j in range(dof)] for i in range(n)]
    else:
        next_gt = [row[:] for row in gt_actions]
        next_pred = [row[:] for row in pred_actions]

    err = [[next_pred[i][j] - next_gt[i][j] for j in range(dof)] for i in range(n)]
    err_l2 = [math.sqrt(sum(v * v for v in row)) for row in err]
    err_abs_mean = [sum(abs(err[i][j]) for i in range(n)) / n for j in range(dof)]

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

    label = {"ec616": "EC616", "koch": "Koch v1.1"}.get(robot_id, "SO-100")
    default_goal = DEFAULT_GOAL_EC616 if robot_id == "ec616" else DEFAULT_GOAL_SO100
    meta = {
        "title": title or f"{label} 六轴：GT 下一时刻位姿 vs 模型下一时刻位姿",
        "robot": robot_id,
        "joint_names": joint_names[:],
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "n_frames": int(n),
        "action_mode": action_mode,
        "mean_l2": float(sum(err_l2) / n),
        "max_l2": float(max(err_l2)),
        "per_joint_mae": {name: float(err_abs_mean[i]) for i, name in enumerate(joint_names)},
        "source": ep["source"],
        "fps": fps,
        "goal_pose": goal_pose if goal_pose is not None else json.loads(json.dumps(default_goal)),
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


def _goal_for(robot_id: str, ep_idx: int) -> dict:
    if robot_id == "ec616":
        goal = json.loads(json.dumps(DEFAULT_GOAL_EC616))
        goal["pos"]["x"] = round(0.38 + 0.02 * (ep_idx % 5), 3)
        goal["pos"]["y"] = round(0.02 * ((ep_idx % 3) - 1), 3)
        goal["pos"]["z"] = round(0.10 + 0.01 * (ep_idx % 2), 3)
        return goal
    goal = json.loads(json.dumps(DEFAULT_GOAL_SO100))
    goal["pos"]["x"] = round(0.16 + 0.01 * (ep_idx % 5), 3)
    goal["pos"]["y"] = round(0.01 * ((ep_idx % 3) - 1), 3)
    return goal


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--suite", action="append", dest="suites", help="data/<suite> name; repeatable")
    ap.add_argument("--count", type=int, default=0, help="episodes to write starting at --start (per suite)")
    ap.add_argument("--start", type=int, default=1, help="first episode index (episode_N.json)")
    ap.add_argument("--robot", default="so100", help="meta.robot id registered in robots.json")
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
        help="write/overwrite SO-100 short demos (5–10 frames) under short/ + refresh suites",
    )
    ap.add_argument(
        "--ec616",
        action="store_true",
        help="write/overwrite EC616 demos under ec616_short/ + ec616/ (with obs+task)",
    )
    ap.add_argument(
        "--with-obs",
        dest="with_obs",
        action="store_true",
        default=None,
        help="生成后附加 RGB/Depth/注意力媒体（F）；--short / --ec616 默认开启",
    )
    ap.add_argument(
        "--no-obs",
        dest="with_obs",
        action="store_false",
        help="不生成观测媒体",
    )
    args = ap.parse_args()
    if args.with_obs is None:
        args.with_obs = bool(args.short or args.ec616)

    robots_path = ROOT / "config" / "robots.json"
    if robots_path.is_file():
        reg = json.loads(robots_path.read_text(encoding="utf-8"))
        known_robots = reg.get("robots") or {}
        if args.robot not in known_robots and not args.ec616:
            known = ", ".join(known_robots.keys()) or "(无)"
            print(f"error: --robot={args.robot} 未在 robots.json 登记；可用：{known}", file=sys.stderr)
            return 2
    else:
        known_robots = {}
        print("warning: robots.json missing; skip robot id check", file=sys.stderr)

    jobs: list[tuple[str, int, int, float, str, int, str]] = []
    # (suite, ep_idx, seed, error_scale, policy, n_frames, robot_id)

    if args.ec616:
        args.robot = "ec616"
        ec616_specs = [
            # suite, ep, scale, policy, n_frames
            ("ec616_short", 1, 1.00, "baseline", 5),
            ("ec616_short", 2, 1.20, "baseline", 6),
            ("ec616_short", 3, 0.85, "act_v1", 7),
            ("ec616_short", 4, 1.35, "act_v1", 8),
            ("ec616_short", 5, 0.95, "pi0_demo", 9),
            ("ec616_short", 6, 1.10, "teleop_ref", 10),
            ("ec616", 1, 1.00, "baseline", 60),
            ("ec616", 2, 0.85, "act_v1", 48),
            ("ec616", 3, 1.25, "pi0_demo", 72),
            ("ec616", 4, 1.10, "teleop_ref", 54),
        ]
        for i, (suite, ep_idx, scale, policy, n_frames) in enumerate(ec616_specs):
            jobs.append(
                (suite, ep_idx, args.seed_base + 700 + i * 17, scale, policy, n_frames, "ec616")
            )
        args.overwrite = True
    elif args.short:
        short_specs = [
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
            jobs.append(
                (suite, ep_idx, args.seed_base + 300 + i * 13, scale, policy, n_frames, args.robot)
            )
        args.overwrite = True
    elif args.preset or not args.suites:
        for i, (ep_idx, scale, policy) in enumerate(
            [
                (2, 0.85, "baseline"),
                (3, 1.15, "baseline"),
                (4, 1.40, "act_v1"),
                (5, 0.70, "act_v1"),
            ],
            start=0,
        ):
            jobs.append(
                ("20260819", ep_idx, args.seed_base + 100 + i, scale, policy, args.n_frames, args.robot)
            )
        for i, (ep_idx, scale, policy) in enumerate(
            [
                (1, 1.00, "teleop_ref"),
                (2, 1.25, "teleop_ref"),
                (3, 0.90, "pi0_demo"),
            ],
            start=0,
        ):
            jobs.append(
                ("20260405", ep_idx, args.seed_base + 200 + i, scale, policy, args.n_frames, args.robot)
            )
    else:
        count = args.count or 3
        for suite in args.suites:
            for k in range(count):
                ep_idx = args.start + k
                scale = 0.8 + 0.2 * ((k % 5) + 1)
                policy = "baseline" if k % 2 == 0 else "act_v1"
                n_frames = args.n_frames
                if n_frames <= 10:
                    n_frames = 5 + (k % 6)
                jobs.append(
                    (suite, ep_idx, args.seed_base + ep_idx * 17, scale, policy, n_frames, args.robot)
                )

    written = []
    skipped = []
    for suite, ep_idx, seed, scale, policy, n_frames, robot_id in jobs:
        if known_robots and robot_id not in known_robots:
            print(f"error: robot={robot_id} 未登记", file=sys.stderr)
            return 2
        joint_names = _load_robot_joints(robot_id)
        out = DATA / suite / f"episode_{ep_idx}.json"
        if out.is_file() and not args.overwrite:
            skipped.append(str(out.relative_to(ROOT)))
            continue
        ep = simulate_episode(
            n_frames,
            seed,
            robot_id=robot_id,
            error_scale=scale,
            fps=args.fps,
            source=f"simulate:{suite}/episode_{ep_idx}",
        )
        label = {"ec616": "EC616", "koch": "Koch v1.1"}.get(robot_id, "SO-100")
        payload = build_payload(
            ep,
            joint_names=joint_names,
            title=f"{label} 模拟评测 · {suite} · episode_{ep_idx} ({n_frames}帧)",
            policy=policy,
            model=policy,
            goal_pose=_goal_for(robot_id, ep_idx),
            robot_id=robot_id,
        )
        write_episode(out, payload)
        written.append(f"{out.relative_to(ROOT)} (n={n_frames}, robot={robot_id})")
        if args.with_obs:
            scripts_dir = Path(__file__).resolve().parent
            if str(scripts_dir) not in sys.path:
                sys.path.insert(0, str(scripts_dir))
            from gen_obs_media import patch_episode
            from gen_task_demo import patch_episode as patch_task

            media_root = out.parent / "media"
            rel_prefix = f"./data/{suite}/media"
            patch_episode(out, media_root, rel_prefix)
            patch_task(out, ep_idx)

    print(f"wrote {len(written)} file(s)")
    for p in written:
        print(f"  + {p}")
    if skipped:
        print(f"skipped {len(skipped)} existing (use --overwrite):")
        for p in skipped:
            print(f"  · {p}")
    if args.with_obs and written:
        print("obs media + task demo attached (F/G)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
