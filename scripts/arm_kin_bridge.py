#!/usr/bin/env python3
"""arm_kin 内置运动学：路径、文档、模块目录、构建说明解析。"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Optional

_EMBODY_ROOT = Path(__file__).resolve().parents[1]
_ARM_KIN_ROOT = _EMBODY_ROOT / "arm_kin"

ARM_KIN_ROOT = _ARM_KIN_ROOT.resolve()
ARM_KIN_SRC = ARM_KIN_ROOT / "src"
ARM_KIN_PKG = ARM_KIN_SRC / "arm_kin"
ROBOT_XML = ARM_KIN_ROOT / "robot.xml"
BUILD_GUIDE_MD = ARM_KIN_ROOT / "构建思路.md"
PYPROJECT = ARM_KIN_ROOT / "pyproject.toml"
README_MD = ARM_KIN_ROOT / "README.md"
TESTS_PY = ARM_KIN_ROOT / "tests" / "test_arm_kin.py"

MODULE_CATALOG: List[Dict[str, Any]] = [
    {
        "file": "model.py",
        "layer": "数据模型",
        "role": "KinematicConfig、TeachPendantPose、IkResult、JointAngleMode",
        "depends": [],
    },
    {
        "file": "constants.py",
        "layer": "常量事实",
        "role": "连杆、零偏、示教点、软限位、速度/加速度上限",
        "depends": ["model.py"],
    },
    {
        "file": "teach.py",
        "layer": "示教语义",
        "role": "软限位、示教位姿→4×4、安装角、欧拉角转换",
        "depends": ["constants.py"],
    },
    {
        "file": "dh.py",
        "layer": "DH 数学核",
        "role": "DH 表、单节变换、全链 FK、连杆位姿累积",
        "depends": ["constants.py", "model.py"],
    },
    {
        "file": "config.py",
        "layer": "配置组装",
        "role": "基座旋转、build/get_kinematic_config 缓存",
        "depends": ["constants.py", "dh.py", "model.py", "teach.py"],
    },
    {
        "file": "fk.py",
        "layer": "正运动学",
        "role": "joint_q_rad、fk_flange、fk_tool、fk_position_mm",
        "depends": ["config.py", "dh.py", "model.py"],
    },
    {
        "file": "ik.py",
        "layer": "逆运动学",
        "role": "SE(3) 残差、rotvec_so3、ik_flange (SciPy least_squares)",
        "depends": ["config.py", "dh.py", "model.py", "teach.py"],
    },
    {
        "file": "robot_xml.py",
        "layer": "XML 装载",
        "role": "RobotTemplate → KinematicConfig + 速度/加速度",
        "depends": ["config.py", "constants.py", "dh.py", "model.py", "teach.py"],
    },
    {
        "file": "rmp.py",
        "layer": "RMP 兼容",
        "role": "RobotRmpKinematics、pose16、P2P 轨迹（历史 DLL 语义）",
        "depends": ["config.py", "constants.py", "dh.py", "ik.py", "model.py", "robot_xml.py"],
    },
    {
        "file": "robot_fk.py",
        "layer": "对外入口",
        "role": "API 聚合、兼容别名、__main__ 自检",
        "depends": ["fk.py", "ik.py", "rmp.py", "robot_xml.py", "teach.py", "config.py", "constants.py", "model.py"],
    },
    {
        "file": "__init__.py",
        "layer": "包导出",
        "role": "from .robot_fk import *",
        "depends": ["robot_fk.py"],
    },
]

BUILD_STEPS: List[Dict[str, Any]] = [
    {"step": 1, "module": "model.py", "title": "统一数据模型", "acceptance": "类型可独立 import，无算法依赖"},
    {"step": 2, "module": "constants.py", "title": "集中常量事实", "acceptance": "数值与厂家手册 / XML 一致"},
    {"step": 3, "module": "teach.py", "title": "示教语义层", "acceptance": "mm↔m、欧拉序与现场一致"},
    {"step": 4, "module": "dh.py", "title": "DH 数学核", "acceptance": "全链 FK、中间连杆位姿"},
    {"step": 5, "module": "config.py", "title": "配置组装与缓存", "acceptance": "T_base 正交、cache 可清"},
    {"step": 6, "module": "fk.py", "title": "正运动学 API", "acceptance": "示教 FK 误差 < 0.01 mm"},
    {"step": 7, "module": "ik.py", "title": "IK 残差与求解", "acceptance": "精确初值回环、扰动收敛"},
    {"step": 8, "module": "robot_xml.py", "title": "XML 装载", "acceptance": "与 constants 几何一致"},
    {"step": 9, "module": "rmp.py", "title": "RMP 兼容壳", "acceptance": "pose16 与 fk_flange 对齐"},
    {"step": 10, "module": "robot_fk.py", "title": "对外聚合入口", "acceptance": "单文件 import 可用"},
    {"step": 11, "module": "__init__.py", "title": "包级导出", "acceptance": "from arm_kin import fk_flange"},
    {"step": 12, "module": "tests/test_arm_kin.py", "title": "自动化回归", "acceptance": "pytest 全绿"},
]

API_CATALOG: List[Dict[str, str]] = [
    {"symbol": "fk_flange", "module": "fk.py", "summary": "关节角(deg)→法兰 4×4 (m)", "unit": "deg / m"},
    {"symbol": "fk_position_mm", "module": "fk.py", "summary": "关节角→法兰 xyz (mm)", "unit": "deg / mm"},
    {"symbol": "fk_tool", "module": "fk.py", "summary": "关节角+工具变换→TCP 4×4", "unit": "deg / m"},
    {"symbol": "ik_flange", "module": "ik.py", "summary": "目标位姿+初值→关节角或 IkResult", "unit": "m / deg"},
    {"symbol": "get_kinematic_config", "module": "config.py", "summary": "惰性缓存运动学配置", "unit": "—"},
    {"symbol": "RobotRmpKinematics", "module": "rmp.py", "summary": "RMP 风格 FK/IK/P2P（关节 rad）", "unit": "rad"},
    {"symbol": "kinematic_config_and_limits_from_robot_xml", "module": "robot_xml.py", "summary": "解析 robot.xml", "unit": "—"},
    {"symbol": "teach_flange_T_m_from_pendant", "module": "teach.py", "summary": "示教器位姿→齐次矩阵", "unit": "mm / deg"},
]


def _read_text(path: Path) -> Optional[str]:
    if not path.is_file():
        return None
    return path.read_text(encoding="utf-8")


def _parse_pyproject_deps() -> List[Dict[str, str]]:
    text = _read_text(PYPROJECT)
    if not text:
        return []
    deps: List[Dict[str, str]] = []
    in_deps = False
    for line in text.splitlines():
        if line.strip().startswith("dependencies = ["):
            in_deps = True
            continue
        if in_deps:
            if line.strip().startswith("]"):
                break
            m = re.search(r'"([^"]+)"', line)
            if m:
                spec = m.group(1)
                name = spec.split(">=")[0].split("<")[0].strip()
                deps.append({"name": name, "spec": spec})
    dev_match = re.search(r"dev = \[(.*?)\]", text, re.DOTALL)
    if dev_match:
        for m in re.finditer(r'"([^"]+)"', dev_match.group(1)):
            spec = m.group(1)
            name = spec.split(">=")[0].split("<")[0].strip()
            deps.append({"name": name, "spec": spec, "dev": True})
    return deps


def _file_tree(root: Path, prefix: str = "", depth: int = 0, max_depth: int = 4) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    if depth > max_depth or not root.is_dir():
        return out
    try:
        entries = sorted(root.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    except OSError:
        return out
    skip = {".git", "__pycache__", ".pytest_cache", "*.pyc"}
    for p in entries:
        if p.name in skip or p.name.startswith(".") and p.name != ".gitignore":
            if p.name not in (".gitignore"):
                if p.name.startswith("."):
                    continue
        if p.is_dir():
            out.append({"path": f"{prefix}{p.name}", "type": "dir"})
            out.extend(_file_tree(p, prefix + p.name + "/", depth + 1, max_depth))
        else:
            try:
                size = p.stat().st_size
            except OSError:
                size = 0
            out.append({"path": f"{prefix}{p.name}", "type": "file", "size": size})
    return out


def parse_markdown_sections(md: str) -> List[Dict[str, Any]]:
    sections: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None
    buf: List[str] = []
    for line in md.splitlines():
        if line.startswith("## "):
            if current:
                current["body"] = "\n".join(buf).strip()
                sections.append(current)
            title = line[3:].strip()
            slug = re.sub(r"[^\w\u4e00-\u9fff]+", "-", title).strip("-").lower()[:40]
            idx = len(sections) + 1
            current = {
                "id": f"sec-{idx}-{slug}",
                "level": 2,
                "title": title,
                "body": "",
            }
            buf = []
        else:
            buf.append(line)
    if current:
        current["body"] = "\n".join(buf).strip()
        sections.append(current)
    return sections


def get_build_guide() -> Dict[str, Any]:
    md = _read_text(BUILD_GUIDE_MD)
    if not md:
        return {
            "ok": False,
            "error": f"构建说明未找到: {BUILD_GUIDE_MD}",
            "sourcePath": str(BUILD_GUIDE_MD),
        }
    return {
        "ok": True,
        "sourcePath": str(BUILD_GUIDE_MD),
        "title": "arm_kin 机械臂正逆解 — 构建思路与集成参考",
        "markdown": md,
        "sections": parse_markdown_sections(md),
        "buildSteps": BUILD_STEPS,
    }


def get_project_overview(rf: Any = None) -> Dict[str, Any]:
    deps = _parse_pyproject_deps()
    tree = _file_tree(ARM_KIN_ROOT, max_depth=3)
    pkg_files = []
    if ARM_KIN_PKG.is_dir():
        for p in sorted(ARM_KIN_PKG.glob("*.py")):
            try:
                pkg_files.append({"path": f"src/arm_kin/{p.name}", "size": p.stat().st_size})
            except OSError:
                pkg_files.append({"path": f"src/arm_kin/{p.name}", "size": 0})

    dh_rows: List[Dict[str, Any]] = []
    if rf is not None:
        try:
            cfg = rf.get_kinematic_config()
            for i, row in enumerate(cfg.dh_table, start=1):
                th, d, a, al = row
                dh_rows.append(
                    {
                        "joint": i,
                        "thetaOffsetRad": float(th),
                        "dM": float(d),
                        "aM": float(a),
                        "alphaRad": float(al),
                    }
                )
        except Exception:  # noqa: BLE001
            pass

    return {
        "ok": ARM_KIN_ROOT.is_dir(),
        "embodyRoot": str(_EMBODY_ROOT),
        "armKinRoot": str(ARM_KIN_ROOT),
        "armKinSrc": str(ARM_KIN_SRC),
        "paths": {
            "robotXml": str(ROBOT_XML),
            "robotXmlExists": ROBOT_XML.is_file(),
            "buildGuide": str(BUILD_GUIDE_MD),
            "buildGuideExists": BUILD_GUIDE_MD.is_file(),
            "readme": str(README_MD),
            "tests": str(TESTS_PY),
            "pyproject": str(PYPROJECT),
        },
        "install": {
            "pipEditable": f"pip install -e {ARM_KIN_ROOT}[dev]",
            "pytest": f"pytest {TESTS_PY} -v",
            "selfCheck": f"PYTHONPATH={ARM_KIN_SRC} python -m arm_kin.robot_fk",
        },
        "dependencies": deps,
        "modules": MODULE_CATALOG,
        "apiCatalog": API_CATALOG,
        "buildSteps": BUILD_STEPS,
        "packageFiles": pkg_files,
        "tree": tree[:80],
        "dhTable": dh_rows,
        "integrationNote": (
            "arm_kin 已内置于 embody_model_eval；传感器页通过 scripts/arm_kinematics "
            "+ arm_kin_bridge 加载，API 见 /api/sensors/arm/*。"
        ),
    }


def get_arm_kin_bundle(rf: Any = None) -> Dict[str, Any]:
    guide = get_build_guide()
    overview = get_project_overview(rf)
    return {
        "ok": overview.get("ok", False) and guide.get("ok", False),
        "guide": guide,
        "overview": overview,
    }
