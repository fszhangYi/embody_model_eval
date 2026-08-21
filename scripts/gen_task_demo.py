#!/usr/bin/env python3
"""Attach G28–G30 demo fields with realistic pick-place motion.

Design (matches user feedback):
  - Object sits still on the table until a successful grasp lifts it.
  - Arm joints interpolate: home → approach → grasp → lift → place/fail.
  - Does not freely animate the cube around the scene before contact.
  - Supports so100 (6-DoF) and ec616 (6 arm + mirrored parallel jaws).
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

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

# SO-100 absolute joints (deg / gripper 0–1 open→closed-ish in this repo’s sim).
SO100_POSES = {
    "home": [0.0, -95.0, 85.0, 55.0, 0.0, 0.55],
    "approach": [6.0, -72.0, 68.0, 48.0, 0.0, 0.50],
    "grasp": [8.0, -58.0, 58.0, 42.0, 0.0, 0.12],
    "lift": [8.0, -68.0, 62.0, 46.0, 0.0, 0.12],
    "place": [22.0, -62.0, 58.0, 44.0, 0.0, 0.12],
    "release": [22.0, -62.0, 58.0, 44.0, 0.0, 0.55],
    "miss": [10.0, -64.0, 62.0, 44.0, 0.0, 0.50],
}

# EC616: arm deg + parallel jaws as ±open_deg (matches index.html direct setJointValue).
EC616_POSES = {
    "home": [0.0, -45.0, 60.0, 0.0, 30.0, 0.0, 25.0, -25.0],
    "approach": [15.0, -32.0, 48.0, 8.0, 28.0, 0.0, 24.0, -24.0],
    "grasp": [18.0, -18.0, 38.0, 12.0, 22.0, 0.0, 4.0, -4.0],
    "lift": [18.0, -28.0, 42.0, 10.0, 26.0, 0.0, 4.0, -4.0],
    "place": [40.0, -22.0, 40.0, 8.0, 20.0, 5.0, 4.0, -4.0],
    "release": [40.0, -22.0, 40.0, 8.0, 20.0, 5.0, 24.0, -24.0],
    "miss": [20.0, -20.0, 42.0, 10.0, 24.0, 0.0, 22.0, -22.0],
}

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
    u = u * u * (3.0 - 2.0 * u)
    n = min(len(a), len(b))
    return [a[j] + (b[j] - a[j]) * u for j in range(n)]


def _phase_u(i: int, i0: int, i1: int) -> float:
    if i1 <= i0:
        return 1.0 if i >= i1 else 0.0
    return (i - i0) / (i1 - i0)


def _resolve_robot(meta: dict) -> tuple[str, list[str], dict, str, tuple[float, float, float]]:
    robot_id = str(
        meta.get("robot") or meta.get("robot_id") or meta.get("robot_model") or meta.get("arm") or "so100"
    )
    names = meta.get("joint_names")
    contact_link = "gripper"
    object_xyz = (0.20, 0.00, 0.022)

    robots_path = ROOT / "robots.json"
    if robots_path.is_file():
        reg = json.loads(robots_path.read_text(encoding="utf-8"))
        profile = (reg.get("robots") or {}).get(robot_id) or {}
        if isinstance(profile.get("joint_names"), list) and profile["joint_names"]:
            names = names or profile["joint_names"]
        tcp = profile.get("tcp") or {}
        if tcp.get("link"):
            contact_link = str(tcp["link"])

    if robot_id == "ec616":
        joint_names = [str(n) for n in (names or EC616_JOINTS)]
        poses = EC616_POSES
        object_xyz = (0.42, 0.02, 0.035)
        contact_link = contact_link if contact_link != "gripper" else "gripper_centor_link"
    else:
        joint_names = [str(n) for n in (names or SO100_JOINTS)]
        poses = SO100_POSES

    return robot_id, joint_names, poses, contact_link, object_xyz


def _object_table_pose(ep_index: int, base: tuple[float, float, float]) -> tuple[float, float, float]:
    bx, by, bz = base
    return (
        bx + 0.015 * ((ep_index % 3) - 1),
        by + 0.012 * ((ep_index % 2) * 2 - 1),
        bz,
    )


def _build_gt_joints(n: int, code: str, poses: dict) -> tuple[list[list[float]], int, int, int, int]:
    """Keyframe absolute joint trajectory: approach object, then branch by outcome."""
    i_app = max(1, n // 3)
    i_grasp = min(n - 1, i_app + max(1, n // 5))
    i_lift = min(n - 1, i_grasp + max(1, n // 6))
    i_end = n - 1
    dof = len(poses["home"])

    out: list[list[float]] = []
    for i in range(n):
        if code == "miss_grasp":
            if i <= i_app:
                q = _lerp(poses["home"], poses["approach"], _phase_u(i, 0, i_app))
            else:
                q = _lerp(poses["approach"], poses["miss"], _phase_u(i, i_app, i_end))
            out.append([round(v, 4) for v in q])
            continue

        if i <= i_app:
            q = _lerp(poses["home"], poses["approach"], _phase_u(i, 0, i_app))
        elif i <= i_grasp:
            q = _lerp(poses["approach"], poses["grasp"], _phase_u(i, i_app, i_grasp))
        elif i <= i_lift:
            q = _lerp(poses["grasp"], poses["lift"], _phase_u(i, i_grasp, i_lift))
        else:
            if code == "ok":
                mid = i_lift + max(1, (i_end - i_lift) // 2)
                if i <= mid:
                    q = _lerp(poses["lift"], poses["place"], _phase_u(i, i_lift, mid))
                else:
                    q = _lerp(poses["place"], poses["release"], _phase_u(i, mid, i_end))
            elif code == "slip":
                q = _lerp(poses["lift"], poses["place"], _phase_u(i, i_lift, i_end))
                open_u = _phase_u(i, i_lift, i_end)
                # Open jaws (so100: increase gripper; ec616: grow ±open)
                if dof == 6:
                    q[5] = poses["lift"][5] + (0.45 - poses["lift"][5]) * open_u
                else:
                    open0 = abs(poses["lift"][6])
                    open1 = 22.0
                    g = open0 + (open1 - open0) * open_u
                    q[6], q[7] = g, -g
            elif code == "miss_place":
                settle = [poses["lift"][j] + (1.5 if j < 2 else 0.0) for j in range(dof)]
                q = _lerp(poses["lift"], settle, _phase_u(i, i_lift, i_end) * 0.3)
                if dof >= 8:
                    q[6], q[7] = poses["lift"][6], poses["lift"][7]
                else:
                    q[5] = poses["lift"][5]
            else:
                q = _lerp(poses["lift"], poses["place"], _phase_u(i, i_lift, i_end))
        out.append([round(v, 4) for v in q])
    return out, i_app, i_grasp, i_lift, i_end


def _add_pred_noise(gt: list[list[float]], scale: float = 1.0) -> list[list[float]]:
    """Small lag/bias so pred ≠ GT but still approaches the same object."""
    dof = len(gt[0]) if gt else 0
    pred = []
    for i, row in enumerate(gt):
        if i == 0:
            base = row[:]
        else:
            base = [0.75 * row[j] + 0.25 * gt[i - 1][j] for j in range(dof)]
        bias = [
            0.8 * scale * math.sin(0.4 * i + 0.0),
            0.6 * scale * math.sin(0.35 * i + 1.2),
            0.9 * scale * math.cos(0.3 * i),
            0.5 * scale * math.sin(0.45 * i + 0.5),
            0.3 * scale * math.sin(0.2 * i),
            0.35 * scale * math.sin(0.25 * i + 0.8),
            0.20 * scale * math.sin(0.5 * i),
            0.20 * scale * math.sin(0.5 * i + 0.3),
        ][:dof]
        if dof == 6:
            bias[5] = 0.02 * scale * math.sin(0.5 * i)
        q = [base[j] + bias[j] for j in range(dof)]
        if dof == 6:
            q[5] = min(1.0, max(0.0, q[5]))
        elif dof >= 8:
            open_cmd = max(0.0, min(40.0, 0.5 * (q[6] - q[7])))
            q[6], q[7] = open_cmd, -open_cmd
        pred.append([round(v, 4) for v in q])
    return pred


def _states_from_gt(gt: list[list[float]]) -> list[list[float]]:
    """current ≈ delayed GT (plant lag)."""
    n = len(gt)
    dof = len(gt[0])
    states = [gt[0][:]]
    for i in range(1, n):
        states.append([0.82 * states[i - 1][j] + 0.18 * gt[i - 1][j] for j in range(dof)])
        states[-1] = [round(v, 4) for v in states[-1]]
    return states


def patch_episode(ep_path: Path, ep_index: int = 0) -> None:
    data = json.loads(ep_path.read_text(encoding="utf-8"))
    meta = data.setdefault("meta", {})
    frames = data.get("frames") or []
    n = len(frames)
    if n == 0:
        raise SystemExit(f"empty frames: {ep_path}")

    robot_id, joint_names, poses, contact_link, object_base = _resolve_robot(meta)
    dof = len(joint_names)
    if len(poses["home"]) != dof:
        # Prefer pose length if joint_names drifted; keep robot kinematics coherent.
        dof = len(poses["home"])
        joint_names = joint_names[:dof] if len(joint_names) >= dof else (
            joint_names + [f"j{i}" for i in range(len(joint_names), dof)]
        )

    fps = float(meta.get("fps") or 20)
    outcome, labels, code, reason = REASON_CYCLE[ep_index % len(REASON_CYCLE)]

    ox0, oy0, oz0 = _object_table_pose(ep_index, object_base)
    place_x, place_y, place_z = ox0 + (0.10 if robot_id == "ec616" else 0.06), oy0 - 0.03, oz0

    meta["objects"] = [{"id": "cube", "label": "demo cube", "color": "#fbbf24"}]
    meta["task"] = meta.get("task") or "pick_place_demo"
    meta["robot"] = robot_id
    meta["goal_pose"] = {
        "pos": {"x": round(ox0, 4), "y": round(oy0, 4), "z": round(oz0 + 0.02, 4)},
        "quat": _quat_identity(),
        "approach": {"x": 0.0, "y": 0.0, "z": -1.0},
        "frame": "world",
        "note": "static grasp target above table object",
    }

    gt, i_app, i_grasp, i_lift, i_end = _build_gt_joints(n, code, poses)
    pred = _add_pred_noise(gt, scale=1.0 + 0.15 * (ep_index % 3))
    states = _states_from_gt(gt)

    err = [[pred[i][j] - gt[i][j] for j in range(dof)] for i in range(n)]
    err_l2 = [math.sqrt(sum(v * v for v in row)) for row in err]

    events = []

    for i, fr in enumerate(frames):
        fr["current"] = states[i][:]
        fr["action_gt"] = gt[i][:]
        fr["action_pred"] = pred[i][:]
        fr["next_gt"] = gt[i][:]
        fr["next_pred"] = pred[i][:]
        fr["err"] = [round(v, 4) for v in err[i]]
        fr["err_l2"] = round(err_l2[i], 4)
        if "next_obs" in fr:
            fr["next_obs"] = states[min(i + 1, n - 1)][:]

        attached = False
        ox, oy, oz = ox0, oy0, oz0
        in_c, force, slip, width = False, 0.0, 0.0, 52.0

        if code == "miss_grasp":
            if i >= i_app:
                width = 50.0
                force = 0.4 if i >= i_grasp else 0.0
            in_c = False
        elif i < i_grasp:
            width = 52.0 - 20.0 * _phase_u(i, i_app, i_grasp) if i >= i_app else 52.0
            force = 0.0
            in_c = False
        elif i < i_lift:
            attached = True
            in_c, force, slip, width = True, 6.0 + 0.5 * (i - i_grasp), 0.2, 26.0
            ox, oy, oz = ox0, oy0, oz0
        else:
            u = _phase_u(i, i_lift, i_end)
            if code == "ok":
                attached = True
                in_c, force, slip, width = True, 7.0, 0.3, 26.0
                ox = ox0 + (place_x - ox0) * u
                oy = oy0 + (place_y - oy0) * u
                oz = oz0 + 0.04 * math.sin(math.pi * min(1.0, u * 1.2))
                if u > 0.85:
                    oz = place_z
                    width = 50.0
                    force = 0.5
                    in_c = False
                    attached = False
                    ox, oy, oz = place_x, place_y, place_z
            elif code == "slip":
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
                ox, oy, oz = ox0, oy0, oz0 + 0.04
                in_c, force, slip, width = True, 6.5, 0.2, 26.0
            else:
                ox, oy, oz = ox0, oy0, oz0
                in_c, force, slip, width = False, 0.0, 0.0, 50.0

        grasp = {
            "pos": {"x": round(ox0, 4), "y": round(oy0, 4), "z": round(oz0 + 0.02, 4)},
            "quat": _quat_identity(),
        }
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
            "object": "cube", "link": contact_link,
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
        joint_names[j]: float(sum(abs(err[i][j]) for i in range(n)) / n) for j in range(dof)
    }
    meta["joint_names"] = joint_names[:]

    ep_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"patched {ep_path} · {robot_id} · {outcome}/{code} · "
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
