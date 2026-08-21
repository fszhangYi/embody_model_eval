#!/usr/bin/env python3
"""Attach G28–G30 demo fields with realistic pick-place motion.

Design (matches user feedback):
  - Object sits still on the table until a successful grasp lifts it.
  - Arm joints interpolate: home → approach → grasp → lift → place/fail.
  - Does not freely animate the cube around the scene before contact.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

JOINT_NAMES = [
    "shoulder_pan",
    "shoulder_lift",
    "elbow_flex",
    "wrist_flex",
    "wrist_roll",
    "gripper",
]

# Approx SO-100 absolute joints (deg / gripper 0–1 open→closed-ish in this repo’s sim).
POSE_HOME = [0.0, -95.0, 85.0, 55.0, 0.0, 0.55]
POSE_APPROACH = [6.0, -72.0, 68.0, 48.0, 0.0, 0.50]  # above object, still open
POSE_GRASP = [8.0, -58.0, 58.0, 42.0, 0.0, 0.12]  # at object, closed
POSE_LIFT = [8.0, -68.0, 62.0, 46.0, 0.0, 0.12]
POSE_PLACE = [22.0, -62.0, 58.0, 44.0, 0.0, 0.12]
POSE_RELEASE = [22.0, -62.0, 58.0, 44.0, 0.0, 0.55]
POSE_MISS = [10.0, -64.0, 62.0, 44.0, 0.0, 0.50]  # short of object, gripper open

REASON_CYCLE = [
    ("success", ["grasp", "place"], "ok", "抓取并放置成功"),
    ("fail", ["grasp"], "slip", "抬升后发生滑移，放置失败"),
    ("partial", ["grasp"], "miss_place", "抓取成功但未完成放置"),
    ("fail", [], "miss_grasp", "未建立稳定接触"),
    ("success", ["grasp", "place"], "ok", "任务完成"),
]


def _quat_identity():
    return {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0}


def _lerp(a: list[float], b: list[float], u: float) -> list[float]:
    u = 0.0 if u < 0 else 1.0 if u > 1 else u
    # smoothstep for slower approach near the object
    u = u * u * (3.0 - 2.0 * u)
    return [a[j] + (b[j] - a[j]) * u for j in range(len(a))]


def _phase_u(i: int, i0: int, i1: int) -> float:
    if i1 <= i0:
        return 1.0 if i >= i1 else 0.0
    return (i - i0) / (i1 - i0)


def _object_table_pose(ep_index: int) -> tuple[float, float, float]:
    """Fixed table-top cube; slight per-episode offset only (still static in time)."""
    return (
        0.20 + 0.01 * ((ep_index % 3) - 1),
        0.00 + 0.008 * ((ep_index % 2) * 2 - 1),
        0.022,
    )


def _build_gt_joints(n: int, code: str) -> list[list[float]]:
    """Keyframe absolute joint trajectory: approach object, then branch by outcome."""
    # Phase boundaries (inclusive ends for segments)
    i_app = max(1, n // 3)  # arrive above object
    i_grasp = min(n - 1, i_app + max(1, n // 5))  # lower + close
    i_lift = min(n - 1, i_grasp + max(1, n // 6))
    i_end = n - 1

    out: list[list[float]] = []
    for i in range(n):
        if code == "miss_grasp":
            if i <= i_app:
                q = _lerp(POSE_HOME, POSE_APPROACH, _phase_u(i, 0, i_app))
            else:
                # move toward miss pose (never close gripper on object)
                q = _lerp(POSE_APPROACH, POSE_MISS, _phase_u(i, i_app, i_end))
            out.append(q)
            continue

        if i <= i_app:
            q = _lerp(POSE_HOME, POSE_APPROACH, _phase_u(i, 0, i_app))
        elif i <= i_grasp:
            q = _lerp(POSE_APPROACH, POSE_GRASP, _phase_u(i, i_app, i_grasp))
        elif i <= i_lift:
            q = _lerp(POSE_GRASP, POSE_LIFT, _phase_u(i, i_grasp, i_lift))
        else:
            if code == "ok":
                # carry to place then release on last frames
                mid = i_lift + max(1, (i_end - i_lift) // 2)
                if i <= mid:
                    q = _lerp(POSE_LIFT, POSE_PLACE, _phase_u(i, i_lift, mid))
                else:
                    q = _lerp(POSE_PLACE, POSE_RELEASE, _phase_u(i, mid, i_end))
            elif code == "slip":
                # try place but gripper slowly opens (lose object)
                q = _lerp(POSE_LIFT, POSE_PLACE, _phase_u(i, i_lift, i_end))
                open_u = _phase_u(i, i_lift, i_end)
                q[5] = POSE_LIFT[5] + (0.45 - POSE_LIFT[5]) * open_u
            elif code == "miss_place":
                # lift and hold — never go to place
                q = _lerp(POSE_LIFT, POSE_LIFT, 1.0)
                # tiny settle
                q = _lerp(POSE_LIFT, [POSE_LIFT[j] + (1.5 if j < 2 else 0) for j in range(6)],
                          _phase_u(i, i_lift, i_end) * 0.3)
                q[5] = POSE_LIFT[5]
            else:
                q = _lerp(POSE_LIFT, POSE_PLACE, _phase_u(i, i_lift, i_end))
        out.append([round(v, 4) for v in q])
    return out, i_app, i_grasp, i_lift, i_end


def _add_pred_noise(gt: list[list[float]], scale: float = 1.0) -> list[list[float]]:
    """Small lag/bias so pred ≠ GT but still approaches the same object."""
    pred = []
    for i, row in enumerate(gt):
        # lag: blend with previous GT
        if i == 0:
            base = row[:]
        else:
            base = [0.75 * row[j] + 0.25 * gt[i - 1][j] for j in range(6)]
        bias = [
            0.8 * scale * math.sin(0.4 * i + 0.0),
            0.6 * scale * math.sin(0.35 * i + 1.2),
            0.9 * scale * math.cos(0.3 * i),
            0.5 * scale * math.sin(0.45 * i + 0.5),
            0.3 * scale * math.sin(0.2 * i),
            0.02 * scale * math.sin(0.5 * i),
        ]
        q = [base[j] + bias[j] for j in range(6)]
        q[5] = min(1.0, max(0.0, q[5]))
        pred.append([round(v, 4) for v in q])
    return pred


def _states_from_gt(gt: list[list[float]]) -> list[list[float]]:
    """current ≈ delayed GT (plant lag)."""
    n = len(gt)
    states = [gt[0][:]]
    for i in range(1, n):
        states.append([0.82 * states[i - 1][j] + 0.18 * gt[i - 1][j] for j in range(6)])
        states[-1] = [round(v, 4) for v in states[-1]]
    return states


def patch_episode(ep_path: Path, ep_index: int = 0) -> None:
    data = json.loads(ep_path.read_text(encoding="utf-8"))
    meta = data.setdefault("meta", {})
    frames = data.get("frames") or []
    n = len(frames)
    if n == 0:
        raise SystemExit(f"empty frames: {ep_path}")

    fps = float(meta.get("fps") or 20)
    outcome, labels, code, reason = REASON_CYCLE[ep_index % len(REASON_CYCLE)]

    ox0, oy0, oz0 = _object_table_pose(ep_index)
    # place spot (static target location on table) — object only moves here after grasp+carry
    place_x, place_y, place_z = ox0 + 0.06, oy0 - 0.03, oz0

    meta["objects"] = [{"id": "cube", "label": "demo cube", "color": "#fbbf24"}]
    meta["task"] = meta.get("task") or "pick_place_demo"
    meta["goal_pose"] = {
        "pos": {"x": round(ox0, 4), "y": round(oy0, 4), "z": round(oz0 + 0.02, 4)},
        "quat": _quat_identity(),
        "approach": {"x": 0.0, "y": 0.0, "z": -1.0},
        "frame": "world",
        "note": "static grasp target above table object",
    }

    gt, i_app, i_grasp, i_lift, i_end = _build_gt_joints(n, code)
    pred = _add_pred_noise(gt, scale=1.0 + 0.15 * (ep_index % 3))
    states = _states_from_gt(gt)

    err = [[pred[i][j] - gt[i][j] for j in range(6)] for i in range(n)]
    err_l2 = [math.sqrt(sum(v * v for v in row)) for row in err]

    events = []

    for i, fr in enumerate(frames):
        # --- joints: approach object ---
        fr["current"] = states[i][:]
        fr["action_gt"] = gt[i][:]
        fr["action_pred"] = pred[i][:]
        fr["next_gt"] = gt[i][:]
        fr["next_pred"] = pred[i][:]
        fr["err"] = [round(v, 4) for v in err[i]]
        fr["err_l2"] = round(err_l2[i], 4)
        if "next_obs" in fr:
            fr["next_obs"] = states[min(i + 1, n - 1)][:]

        # --- object: static on table until lifted ---
        attached = False
        ox, oy, oz = ox0, oy0, oz0
        in_c, force, slip, width = False, 0.0, 0.0, 52.0

        if code == "miss_grasp":
            # never attach; maybe brief near-contact with no grip
            if i >= i_app:
                width = 50.0
                force = 0.4 if i >= i_grasp else 0.0
            in_c = False
        elif i < i_grasp:
            # approaching: object still, gripper closing near the end
            width = 52.0 - 20.0 * _phase_u(i, i_app, i_grasp) if i >= i_app else 52.0
            force = 0.0
            in_c = False
        elif i < i_lift:
            # grasp established; object still on table (pinched in place)
            attached = True
            in_c, force, slip, width = True, 6.0 + 0.5 * (i - i_grasp), 0.2, 26.0
            ox, oy, oz = ox0, oy0, oz0
        else:
            # after lift
            u = _phase_u(i, i_lift, i_end)
            if code == "ok":
                attached = True
                in_c, force, slip, width = True, 7.0, 0.3, 26.0
                ox = ox0 + (place_x - ox0) * u
                oy = oy0 + (place_y - oy0) * u
                oz = oz0 + 0.04 * math.sin(math.pi * min(1.0, u * 1.2))  # up then down
                if u > 0.85:
                    oz = place_z
                    width = 50.0
                    force = 0.5
                    in_c = False
                    attached = False
                    ox, oy, oz = place_x, place_y, place_z
            elif code == "slip":
                # leaves gripper and falls/slides on table — only now does object "move"
                attached = i < i_lift + max(1, (i_end - i_lift) // 3)
                if attached:
                    ox, oy, oz = ox0, oy0, oz0 + 0.035 * _phase_u(i, i_lift, i_lift + 2)
                    in_c, force, slip, width = True, 3.0, 1.5 + 2.0 * u, 32.0
                else:
                    ox = ox0 + 0.025 * (i - i_lift)
                    oy = oy0 - 0.01 * (i - i_lift)
                    oz = oz0
                    in_c, force, slip, width = False, 0.2, 4.0, 45.0
            elif code == "miss_place":
                attached = True
                ox, oy, oz = ox0, oy0, oz0 + 0.04  # held in air
                in_c, force, slip, width = True, 6.5, 0.2, 26.0
            else:
                ox, oy, oz = ox0, oy0, oz0
                in_c, force, slip, width = False, 0.0, 0.0, 50.0

        grasp = {
            "pos": {"x": round(ox0, 4), "y": round(oy0, 4), "z": round(oz0 + 0.02, 4)},
            "quat": _quat_identity(),
        }
        # After lift on success path, goal switches to static place pose
        if code == "ok" and i >= i_lift:
            goal = {
                "pos": {"x": round(place_x, 4), "y": round(place_y, 4), "z": round(place_z + 0.02, 4)},
                "quat": _quat_identity(),
                "approach": {"x": 0.0, "y": 0.0, "z": -1.0},
                "frame": "world",
                "note": "static place target",
            }
        else:
            goal = {
                "pos": dict(grasp["pos"]),
                "quat": _quat_identity(),
                "approach": {"x": 0.0, "y": 0.0, "z": -1.0},
                "frame": "world",
                "note": "static grasp target (object fixed on table)",
            }

        fr["objects"] = {
            "cube": {
                "pos": {"x": round(ox, 4), "y": round(oy, 4), "z": round(oz, 4)},
                "quat": _quat_identity(),
                "grasp": grasp,
                "attached": attached,
            }
        }
        fr["goal_pose"] = goal
        fr["contact"] = {
            "in_contact": bool(in_c),
            "force_n": round(float(force), 3),
            "slip_mm": round(float(slip), 3),
            "width_mm": round(float(width), 2),
        }

    # Events aligned to phases
    def _t(fi: int) -> float:
        return float(frames[fi].get("timestamp", fi / fps))

    if code == "miss_grasp":
        events.append({
            "frame": i_app, "t": _t(i_app), "type": "approach",
            "object": "cube", "note": "接近物体（未抓住）",
        })
        events.append({
            "frame": min(i_grasp, i_end), "t": _t(min(i_grasp, i_end)),
            "type": "miss_grasp", "object": "cube", "note": "夹爪未闭合 / 未建立接触",
        })
    else:
        events.append({
            "frame": i_app, "t": _t(i_app), "type": "approach",
            "object": "cube", "note": "到达物体上方",
        })
        events.append({
            "frame": i_grasp, "t": _t(i_grasp), "type": "contact_start",
            "object": "cube", "link": "gripper",
            "force_n": float(frames[i_grasp]["contact"]["force_n"]),
            "note": "接触桌面物体（物体此前保持静止）",
        })
        events.append({
            "frame": i_grasp, "t": _t(i_grasp), "type": "grasp_force",
            "object": "cube",
            "force_n": float(frames[i_grasp]["contact"]["force_n"]),
            "width_mm": float(frames[i_grasp]["contact"]["width_mm"]),
            "note": "夹紧",
        })
        if code == "slip":
            events.append({
                "frame": i_lift, "t": _t(i_lift), "type": "slip",
                "object": "cube",
                "slip_mm": float(frames[i_lift]["contact"]["slip_mm"]),
                "note": "抬升后滑落（物体这才离开原位）",
            })
        elif code == "ok":
            events.append({
                "frame": i_lift, "t": _t(i_lift), "type": "lift",
                "object": "cube", "note": "带起物体",
            })
            events.append({
                "frame": i_end, "t": _t(i_end), "type": "place",
                "object": "cube", "note": "放置到目标位",
            })
            events.append({
                "frame": i_end, "t": _t(i_end), "type": "contact_end",
                "object": "cube", "force_n": 0.0,
            })
        elif code == "miss_place":
            events.append({
                "frame": i_lift, "t": _t(i_lift), "type": "lift",
                "object": "cube", "note": "抬起后未放置",
            })

    data["events"] = events
    meta["task_outcome"] = {
        "task": meta["task"],
        "outcome": outcome,
        "labels": labels,
        "reason_code": code,
        "reason": reason,
        "score": 1.0 if outcome == "success" else (0.5 if outcome == "partial" else 0.0),
        "judged_at_frame": i_end,
    }

    # Keep series in sync with rewritten joints
    series = data.setdefault("series", {})
    series["t"] = list(range(n))
    series["current"] = [row[:] for row in states]
    series["next_gt"] = [row[:] for row in gt]
    series["next_pred"] = [row[:] for row in pred]
    series["per_joint_err"] = err
    series["err_l2"] = [float(x) for x in err_l2]

    meta["n_frames"] = n
    meta["mean_l2"] = float(sum(err_l2) / n)
    meta["max_l2"] = float(max(err_l2))
    meta["per_joint_mae"] = {
        JOINT_NAMES[j]: float(sum(abs(err[i][j]) for i in range(n)) / n) for j in range(6)
    }
    meta["joint_names"] = meta.get("joint_names") or JOINT_NAMES[:]

    ep_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"patched {ep_path} · {outcome}/{code} · "
        f"phases app={i_app} grasp={i_grasp} lift={i_lift} · "
        f"object@({ox0:.3f},{oy0:.3f},{oz0:.3f}) static→lift"
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--all", action="store_true", help="patch all suites under data/")
    ap.add_argument("--suite", action="append", dest="suites", default=None)
    ap.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = ap.parse_args()

    data_root = args.root / "data"
    if args.all or not args.suites:
        suites = sorted(
            p.name for p in data_root.iterdir() if p.is_dir() and any(p.glob("episode_*.json"))
        )
    else:
        suites = args.suites

    k = 0
    for suite in suites:
        files = sorted((data_root / suite).glob("episode_*.json"))
        for p in files:
            patch_episode(p, k)
            k += 1


if __name__ == "__main__":
    main()
