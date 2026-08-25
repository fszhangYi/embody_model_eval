#!/usr/bin/env python3
"""机械臂传感器后端：接入 embody_model_eval 内置 arm_kin 运动学。

无实机驱动时，用示教标定点做 FK 自检，并用一组「当前关节角」跑 FK 供页面展示。
后续接控制器时，只需把 get/set 关节换成实机读数。
"""

from __future__ import annotations

import sys
import threading
from typing import Any, Optional

import numpy as np

from arm_kin_bridge import (
    ARM_KIN_ROOT,
    ROBOT_XML,
    get_arm_kin_bundle as _build_arm_kin_bundle,
    get_build_guide,
    get_project_overview,
)

_ARM_KIN_SRC = ARM_KIN_ROOT / "src"

_lock = threading.Lock()
_robot_fk = None  # type: ignore[var-annotated]
_import_error: Optional[str] = None
_current_joint_deg: Optional[np.ndarray] = None
_last_test: Optional[dict[str, Any]] = None


def _ensure_import() -> Any:
    global _robot_fk, _import_error
    if _robot_fk is not None:
        return _robot_fk
    if _import_error is not None:
        raise ImportError(_import_error)
    try:
        src = str(_ARM_KIN_SRC)
        if src not in sys.path:
            sys.path.insert(0, src)
        from arm_kin import robot_fk  # type: ignore

        _robot_fk = robot_fk
        return robot_fk
    except Exception as e:  # noqa: BLE001
        _import_error = f"无法导入 arm_kin（{ARM_KIN_ROOT}）: {e}"
        raise ImportError(_import_error) from e


def _fmt_joints(q: np.ndarray, prec: int = 1) -> str:
    return "[" + ", ".join(f"{float(x):.{prec}f}" for x in np.asarray(q, dtype=float).reshape(6)) + "]"


def _fmt_xyz(p_mm: np.ndarray, prec: int = 1) -> str:
    p = np.asarray(p_mm, dtype=float).reshape(3)
    return f"{p[0]:.{prec}f}, {p[1]:.{prec}f}, {p[2]:.{prec}f}"


def _rxyz_deg_from_T(T: np.ndarray) -> list[float]:
    from scipy.spatial.transform import Rotation

    R = np.asarray(T, dtype=float).reshape(4, 4)[:3, :3]
    return [float(x) for x in Rotation.from_matrix(R).as_euler("XYZ", degrees=True)]


def _default_joints(rf: Any) -> np.ndarray:
    poses = rf.teach_poses_joint_xyz_mm()
    if poses:
        return np.asarray(poses[0][0], dtype=float).reshape(6)
    return np.zeros(6, dtype=float)


def _get_joints(rf: Any) -> np.ndarray:
    global _current_joint_deg
    with _lock:
        if _current_joint_deg is None:
            _current_joint_deg = _default_joints(rf)
        return _current_joint_deg.copy()


def _set_joints(q: np.ndarray) -> None:
    global _current_joint_deg
    with _lock:
        _current_joint_deg = np.asarray(q, dtype=float).reshape(6).copy()


def run_teach_fk_check(rf: Any) -> dict[str, Any]:
    samples: list[dict[str, Any]] = []
    errs: list[float] = []
    for i, (q_deg, p_ref) in enumerate(rf.teach_poses_joint_xyz_mm(), start=1):
        p = rf.fk_position_mm(q_deg, joint_angle_mode="machine_deg")
        err = float(np.linalg.norm(p - p_ref))
        errs.append(err)
        samples.append(
            {
                "index": i,
                "jointDeg": [float(x) for x in np.asarray(q_deg, dtype=float).reshape(6)],
                "refMm": [float(x) for x in np.asarray(p_ref, dtype=float).reshape(3)],
                "fkMm": [float(x) for x in np.asarray(p, dtype=float).reshape(3)],
                "errMm": err,
                "ok": err < 0.01,
            }
        )
    max_err = float(max(errs)) if errs else float("inf")
    mean_err = float(np.mean(errs)) if errs else float("inf")
    return {
        "n": len(samples),
        "maxErrMm": max_err,
        "meanErrMm": mean_err,
        "passed": bool(errs) and max_err < 0.01,
        "thresholdMm": 0.01,
        "samples": samples,
    }


def run_ik_roundtrip(rf: Any, q_deg: np.ndarray) -> dict[str, Any]:
    T = rf.fk_flange(q_deg, joint_angle_mode="machine_deg")
    out = rf.ik_flange(T, q_deg, return_details=True)
    q2 = np.asarray(out.joint_deg, dtype=float).reshape(6)
    return {
        "success": bool(out.success),
        "nfev": int(out.nfev),
        "residualNorm": float(out.residual_norm),
        "message": str(out.message),
        "jointDeg": [float(x) for x in q2],
        "jointErrDegL2": float(np.linalg.norm(q2 - np.asarray(q_deg, dtype=float).reshape(6))),
    }


def _config_snapshot(rf: Any) -> dict[str, Any]:
    cfg = rf.get_kinematic_config()
    lo, hi = rf.teach_joint_soft_limits_deg()
    xml_ok = ROBOT_XML.is_file()
    return {
        "armKinRoot": str(ARM_KIN_ROOT),
        "robotXml": str(ROBOT_XML) if xml_ok else None,
        "robotXmlExists": xml_ok,
        "manipulatorType": int(cfg.manipulator_type),
        "linkLengthMm": [float(x) * 1000.0 for x in np.asarray(cfg.link_len_m, dtype=float).reshape(6)],
        "jointOffsetDeg": [float(x) for x in np.asarray(cfg.joint_offset_deg, dtype=float).reshape(6)],
        "jointDirection": [float(x) for x in np.asarray(cfg.joint_dir, dtype=float).reshape(6)],
        "softMinDeg": [float(x) for x in np.asarray(lo, dtype=float).reshape(6)],
        "softMaxDeg": [float(x) for x in np.asarray(hi, dtype=float).reshape(6)],
        "teachPoseCount": len(rf.TEACH_PENDANT_POSES),
        "modelName": "EA66 / EC616",
        "backend": "arm_kin",
    }


def _pose_payload(rf: Any, q_deg: np.ndarray) -> dict[str, Any]:
    T = rf.fk_flange(q_deg, joint_angle_mode="machine_deg")
    p_mm = T[:3, 3] * 1000.0
    rxyz = _rxyz_deg_from_T(T)
    within = bool(rf.joints_within_teach_soft_limits(q_deg))
    return {
        "jointDeg": [float(x) for x in np.asarray(q_deg, dtype=float).reshape(6)],
        "tcpMm": [float(x) for x in p_mm],
        "tcpRxyzDeg": rxyz,
        "T": [[float(v) for v in row] for row in T.tolist()],
        "withinSoftLimits": within,
        "jointText": _fmt_joints(q_deg),
        "tcpText": _fmt_xyz(p_mm),
        "rpyText": ", ".join(f"{x:.1f}" for x in rxyz),
    }


def get_arm_status(*, run_check: bool = False) -> dict[str, Any]:
    global _last_test
    try:
        rf = _ensure_import()
    except ImportError as e:
        return {
            "ok": False,
            "available": False,
            "status": "offline",
            "id": "arm-ec616",
            "name": "机械臂",
            "model": "EC616（arm_kin 未加载）",
            "endpoint": "arm_kin://unavailable",
            "message": str(e),
            "metrics": [
                {"label": "关节", "value": "—"},
                {"label": "TCP", "value": "—"},
                {"label": "使能", "value": "—"},
            ],
        }

    rf.clear_kinematic_config_cache()
    q = _get_joints(rf)
    pose = _pose_payload(rf, q)
    cfg = _config_snapshot(rf)

    teach = None
    ik = None
    if run_check:
        teach = run_teach_fk_check(rf)
        ik = run_ik_roundtrip(rf, q)
        with _lock:
            _last_test = {"teachCheck": teach, "ikRoundtrip": ik}
    else:
        with _lock:
            cached = _last_test
        if cached:
            teach = cached.get("teachCheck")
            ik = cached.get("ikRoundtrip")

    if teach and teach.get("passed") and (ik is None or ik.get("success")):
        status = "ok"
        message = (
            f"arm_kin FK 自检通过 · 示教 max_err={teach['maxErrMm']:.4f} mm"
            if teach
            else "arm_kin 已加载（未跑自检）"
        )
    elif teach and not teach.get("passed"):
        status = "error"
        message = f"FK 示教对表失败 · max_err={teach['maxErrMm']:.4f} mm"
    elif ik and not ik.get("success"):
        status = "warn"
        message = f"IK 回环未收敛 · residual={ik.get('residualNorm')}"
    else:
        status = "ok" if ROBOT_XML.is_file() else "warn"
        message = "arm_kin 已加载 · 点击「测试连接」跑示教 FK / IK 自检（无实机驱动）"

    return {
        "ok": True,
        "available": True,
        "status": status,
        "id": "arm-ec616",
        "name": "机械臂",
        "model": cfg["modelName"],
        "endpoint": f"arm_kin://{ARM_KIN_ROOT.name}",
        "message": message,
        "hardwareLinked": False,
        "pose": pose,
        "config": cfg,
        "teachCheck": teach,
        "ikRoundtrip": ik,
        "metrics": [
            {"label": "关节", "value": pose["jointText"]},
            {"label": "TCP", "value": pose["tcpText"] + " mm"},
            {"label": "使能", "value": "仿真"},
        ],
    }


def test_arm() -> dict[str, Any]:
    return get_arm_status(run_check=True)


def refresh_arm(body: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    body = body or {}
    try:
        rf = _ensure_import()
    except ImportError:
        return get_arm_status()

    if "jointDeg" in body and body["jointDeg"] is not None:
        q = np.asarray(body["jointDeg"], dtype=float).reshape(6)
        _set_joints(q)
    elif body.get("useTeachIndex") is not None:
        idx = int(body["useTeachIndex"])
        poses = rf.teach_poses_joint_xyz_mm()
        if 1 <= idx <= len(poses):
            _set_joints(np.asarray(poses[idx - 1][0], dtype=float))
    return get_arm_status(run_check=False)


def compute_fk(body: dict[str, Any]) -> dict[str, Any]:
    try:
        rf = _ensure_import()
    except ImportError as e:
        return {"ok": False, "error": str(e)}
    if "jointDeg" not in body:
        return {"ok": False, "error": "jointDeg required (deg x6)"}
    q = np.asarray(body["jointDeg"], dtype=float).reshape(6)
    pose = _pose_payload(rf, q)
    return {"ok": True, "pose": pose}


def get_arm_kin_overview() -> dict[str, Any]:
    try:
        rf = _ensure_import()
        return get_project_overview(rf)
    except ImportError as e:
        overview = get_project_overview(None)
        overview["importError"] = str(e)
        return overview


def get_arm_build_guide() -> dict[str, Any]:
    return get_build_guide()


def get_arm_kin_bundle() -> dict[str, Any]:
    try:
        rf = _ensure_import()
        return _build_arm_kin_bundle(rf)
    except ImportError:
        return _build_arm_kin_bundle(None)
