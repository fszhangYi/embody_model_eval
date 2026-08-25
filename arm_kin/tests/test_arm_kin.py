"""
Robot 运动学回归测试集。

运行：在 embody_model_eval 根目录执行
  pytest arm_kin/tests/test_arm_kin.py -v
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

_ARM_KIN_ROOT = Path(__file__).resolve().parents[1]
_SRC = _ARM_KIN_ROOT / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from arm_kin import robot_fk

TEACH_POSES = robot_fk.teach_poses_joint_xyz_mm()


@pytest.fixture(autouse=True)
def _reset_cfg() -> None:
    robot_fk.clear_kinematic_config_cache()
    yield


def test_fk_position_matches_teach_mm() -> None:
    for q_deg, p_ref_mm in TEACH_POSES:
        p = robot_fk.fk_position_mm(q_deg, joint_angle_mode="machine_deg")
        err = float(np.linalg.norm(p - p_ref_mm))
        assert err < 0.01, f"FK vs teach mm err={err} mm, p={p}, ref={p_ref_mm}"


def test_ik_roundtrip_exact_seed() -> None:
    for q_deg, _ in TEACH_POSES:
        T = robot_fk.fk_flange(q_deg, joint_angle_mode="machine_deg")
        q2 = robot_fk.ik_flange(T, q_deg)
        assert np.allclose(q_deg, q2, atol=1e-3, rtol=0), f"q={q_deg} q2={q2}"


def test_ik_roundtrip_perturbed_seed_lm() -> None:
    delta_deg = np.array([8.0, -6.0, 10.0, -5.0, 7.0, -4.0])
    for q_deg, _ in TEACH_POSES:
        T = robot_fk.fk_flange(q_deg, joint_angle_mode="machine_deg")
        seed = q_deg + delta_deg
        q_sol = robot_fk.ik_flange(T, seed, lm_method="lm", max_nfev=800)
        T2 = robot_fk.fk_flange(q_sol, joint_angle_mode="machine_deg")
        assert np.linalg.norm(T2[:3, 3] - T[:3, 3]) < 1e-4
        R_err = T[:3, :3] @ T2[:3, :3].T
        assert np.linalg.norm(R_err - np.eye(3)) < 1e-3


def test_kinematic_config_from_robot_xml_matches_defaults() -> None:
    xml = _ARM_KIN_ROOT / "robot.xml"
    cfg, vel, acc = robot_fk.kinematic_config_and_limits_from_robot_xml(str(xml))
    ref = robot_fk.get_kinematic_config()
    np.testing.assert_allclose(cfg.link_len_m, ref.link_len_m, rtol=0, atol=1e-9)
    np.testing.assert_allclose(cfg.joint_offset_deg, ref.joint_offset_deg, rtol=0, atol=1e-9)
    assert vel.shape == (6,) and acc.shape == (6,)
