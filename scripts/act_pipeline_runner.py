"""ACT raw-data → embody eval pipeline: step specs and background job runner."""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from act_train_yaml import save_train_yaml as save_act_train_yaml

ROOT = Path(__file__).resolve().parent.parent
RUNS_DIR = ROOT / "agent_skills" / ".run" / "act_pipeline"
ACT_ROBOT_ROOT = Path(os.environ.get("ACT_ROBOT_ROOT", "/root/autodl-tmp/act_robot"))
EMBODY_ROOT = Path(os.environ.get("EMBODY_ROOT", str(ROOT)))
PYTHON = os.environ.get("ACT_PIPELINE_PYTHON", sys.executable)
ACT_LINK_NAME = "act_robot"

_lock = threading.Lock()
_jobs: dict[str, dict[str, Any]] = {}
_procs: dict[str, subprocess.Popen[Any]] = {}


def _resolve_dir(path: str) -> Path:
    p = Path(path).expanduser().resolve()
    if not p.is_dir():
        raise ValueError(f"不是有效目录: {path}")
    return p


def _is_under(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def link_path(embody_root: Path) -> Path:
    return embody_root / ACT_LINK_NAME


def link_status(embody_root: str, act_root: str | None = None) -> dict[str, Any]:
    embody = _resolve_dir(embody_root)
    link = link_path(embody)
    out: dict[str, Any] = {
        "ok": True,
        "embodyRoot": str(embody),
        "linkPath": str(link),
        "linkName": ACT_LINK_NAME,
        "linked": False,
        "target": None,
        "matches": False,
    }
    expected_act: Path | None = None
    if act_root:
        expected_act = _resolve_dir(act_root)
        out["actRoot"] = str(expected_act)
    if link.is_symlink():
        target = Path(os.readlink(link))
        if not target.is_absolute():
            target = (link.parent / target).resolve()
        else:
            target = target.resolve()
        out["linked"] = True
        out["target"] = str(target)
        if expected_act is not None:
            out["matches"] = target == expected_act
    elif link.exists():
        out["ok"] = False
        out["error"] = f"{link} 已存在且不是软链"
    return out


def create_act_link(embody_root: str, act_root: str) -> dict[str, Any]:
    embody = _resolve_dir(embody_root)
    act = _resolve_dir(act_root)
    if embody == act:
        raise ValueError("评测根目录与训练/推理根目录不能相同")
    if _is_under(act, embody):
        raise ValueError("训练/推理根目录不能位于评测根目录内部")
    link = link_path(embody)
    if link.is_symlink():
        existing = Path(os.readlink(link))
        if not existing.is_absolute():
            existing = (link.parent / existing).resolve()
        else:
            existing = existing.resolve()
        if existing == act:
            st = link_status(embody_root, act_root)
            st["created"] = False
            return st
        link.unlink()
    elif link.exists():
        raise ValueError(f"无法创建软链：{link} 已存在且不是软链")
    link.symlink_to(act, target_is_directory=True)
    st = link_status(embody_root, act_root)
    st["created"] = True
    return st


def remove_act_link(embody_root: str) -> dict[str, Any]:
    embody = Path(embody_root).expanduser()
    if not embody.is_dir():
        return {"ok": True, "removed": False, "reason": "invalid embody root"}
    link = link_path(embody.resolve())
    if link.is_symlink():
        link.unlink()
        return {"ok": True, "removed": True, "linkPath": str(link)}
    return {"ok": True, "removed": False, "linkPath": str(link)}


def _default_paths(ar: Path | None = None, er: Path | None = None) -> dict[str, str]:
    ar = ar or ACT_ROBOT_ROOT
    er = er or EMBODY_ROOT
    return {
        "actRobotRoot": str(ar),
        "embodyRoot": str(er),
        "python": PYTHON,
        "rawDir": str(ar / "data" / "raw"),
        "annotationDir": str(ar / "data" / "annotation" / "annotation"),
        "qualityPassJson": str(ar / "data" / "quality_pass.json"),
        "qualityFailTxt": str(ar / "data" / "quality_fail.txt"),
        "qualityReportJson": str(ar / "data" / "quality_report.json"),
        "convertedDir": str(ar / "data" / "converted_cam100_15_cart_abs"),
        "ckptDir": str(ar / "data" / "ckpt_cam100_15_cart_abs_v1"),
        "inferDir": str(ar / "data" / "infer_cam100_15_cart_abs_v1"),
        "embodyActDir": str(er / "data" / "ec616_act"),
        "embodyChunkDir": str(er / "data" / "ec616_act_chunk"),
    }


def _exec_fields(ar: Path, script_rel: str, script_hint: str, fields: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "key": "scriptPath",
            "label": "脚本路径",
            "type": "path",
            "pathKind": "file",
            "browseRoot": "act",
            "default": str(ar / script_rel),
            "hint": script_hint,
            "io": "config",
        },
        *fields,
    ]


def parse_script_args(script_path: str) -> dict[str, Any]:
    """Parse argparse.add_argument flags from a Python train-like script via AST."""
    import ast

    path = Path(script_path).expanduser().resolve()
    if not path.is_file():
        raise FileNotFoundError(f"script not found: {path}")
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except SyntaxError as e:
        raise ValueError(f"无法解析脚本: {e}") from e

    def _literal(node: ast.AST | None) -> Any:
        if node is None:
            return None
        try:
            return ast.literal_eval(node)
        except Exception:
            if isinstance(node, ast.Name):
                # type=int / float / str
                if node.id in ("int", "float", "str", "bool"):
                    return node.id
                if node.id == "True":
                    return True
                if node.id == "False":
                    return False
                if node.id == "None":
                    return None
            return None

    args_out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        is_add = (
            isinstance(func, ast.Attribute) and func.attr == "add_argument"
        ) or (isinstance(func, ast.Name) and func.id == "add_argument")
        if not is_add:
            continue
        opt_names: list[str] = []
        for a in node.args:
            v = _literal(a)
            if isinstance(v, str) and v.startswith("--"):
                opt_names.append(v.lstrip("-"))
        if not opt_names:
            continue
        flag = opt_names[0]
        if flag in seen:
            continue
        seen.add(flag)
        meta: dict[str, Any] = {
            "flag": flag,
            "cli": f"--{flag}",
            "required": False,
            "action": None,
            "type": None,
            "default": None,
            "choices": None,
            "nargs": None,
            "help": "",
            "sweepable": True,
        }
        for kw in node.keywords:
            if kw.arg == "required":
                meta["required"] = bool(_literal(kw.value))
            elif kw.arg == "action":
                meta["action"] = _literal(kw.value)
            elif kw.arg == "type":
                t = _literal(kw.value)
                meta["type"] = t if isinstance(t, str) else None
            elif kw.arg == "default":
                meta["default"] = _literal(kw.value)
            elif kw.arg == "choices":
                meta["choices"] = _literal(kw.value)
            elif kw.arg == "nargs":
                meta["nargs"] = _literal(kw.value)
            elif kw.arg == "help":
                h = _literal(kw.value)
                meta["help"] = h if isinstance(h, str) else ""
        if meta["action"] == "store_true":
            meta["type"] = "bool"
            if meta["default"] is None:
                meta["default"] = False
        elif meta["type"] is None:
            meta["type"] = "str"
        # Paths / resume are fixed via dedicated UI fields or not meaningful for sweep
        if flag in {"data-dir", "ckpt-dir", "resume-from"}:
            meta["sweepable"] = False
        args_out.append(meta)

    # Preferred default sweep set for throughput search
    default_sweep = {
        "batch-size": ["8", "16", "24", "32"],
        "num-workers": ["4", "8", "12", "16"],
        "hdf5-cache-size": ["8", "16"],
    }
    return {
        "ok": True,
        "scriptPath": str(path),
        "args": args_out,
        "defaultSweepFlags": [k for k in default_sweep if any(a["flag"] == k for a in args_out)],
        "defaultSweepValues": {k: v for k, v in default_sweep.items() if any(a["flag"] == k for a in args_out)},
    }


def pipeline_spec(act_root: str | None = None, embody_root: str | None = None) -> dict[str, Any]:
    ar = _resolve_dir(act_root) if act_root else ACT_ROBOT_ROOT
    er = _resolve_dir(embody_root) if embody_root else EMBODY_ROOT
    paths = _default_paths(ar, er)
    steps = [
        {
            "id": "quality",
            "step": 1,
            "title": "质量过滤",
            "subtitle": "check_episode_quality.py",
            "description": "依据 gripper 轨迹筛 episode，输出 quality_pass.json 白名单。",
            "outputs": ["writePassJson", "writeFailList", "outputJson"],
            "fields": _exec_fields(
                ar,
                "scripts/check_episode_quality.py",
                "check_episode_quality.py",
                [
                {"key": "inputDir", "label": "原始数据目录", "type": "path", "pathKind": "dir", "browseRoot": "act", "io": "input", "default": paths["rawDir"]},
                {"key": "annotationDir", "label": "标注目录", "type": "path", "pathKind": "dir", "browseRoot": "act", "io": "input", "default": paths["annotationDir"]},
                {"key": "writePassJson", "label": "白名单 JSON", "type": "path", "pathKind": "file", "browseRoot": "act", "io": "output", "default": paths["qualityPassJson"]},
                {"key": "writeFailList", "label": "失败列表", "type": "path", "pathKind": "file", "browseRoot": "act", "io": "output", "default": paths["qualityFailTxt"]},
                {"key": "outputJson", "label": "质量报告", "type": "path", "pathKind": "file", "browseRoot": "act", "io": "output", "default": paths["qualityReportJson"]},
                {"key": "zeroEps", "label": "zero-eps（闭合阈值）", "type": "number", "io": "config", "default": 0.001},
                {"key": "minPeak", "label": "min-peak（最小开度）", "type": "number", "io": "config", "default": 0.05},
                {"key": "sentinelValue", "label": "sentinel-value", "type": "number", "io": "config", "default": 0.14651000499725342},
                {"key": "sentinelMinRun", "label": "sentinel-min-run", "type": "number", "io": "config", "default": 20},
                {"key": "valueTol", "label": "value-tol", "type": "number", "io": "config", "default": 1e-9},
                {"key": "strict", "label": "strict（有失败则 exit 1）", "type": "checkbox", "io": "config", "default": False},
                ],
            ),
        },
        {
            "id": "convert",
            "step": 2,
            "title": "转 HDF5",
            "subtitle": "convert_episodes.py",
            "description": "将白名单 episode 转为训练用 HDF5。",
            "outputs": ["outputDir"],
            "fields": _exec_fields(
                ar,
                "convert_episodes.py",
                "convert_episodes.py",
                [
                {"key": "inputDir", "label": "原始数据", "type": "path", "pathKind": "dir", "browseRoot": "act", "io": "input", "default": paths["rawDir"]},
                {"key": "outputDir", "label": "HDF5 输出", "type": "path", "pathKind": "dir", "browseRoot": "act", "io": "output", "default": paths["convertedDir"]},
                {"key": "annotationDir", "label": "标注目录", "type": "path", "pathKind": "dir", "browseRoot": "act", "io": "input", "default": paths["annotationDir"]},
                {"key": "filterJson", "label": "白名单 JSON", "type": "path", "pathKind": "file", "browseRoot": "act", "io": "input", "default": paths["qualityPassJson"]},
                {"key": "cameraNames", "label": "相机（空格分隔）", "type": "text", "io": "config", "default": "chest top wrist_2"},
                {"key": "actionSpace", "label": "动作空间", "type": "select", "io": "config", "default": "cartesian_abs", "options": ["joint", "cartesian_abs", "cartesian"]},
                {"key": "unwrapRx", "label": "unwrap-rx", "type": "checkbox", "io": "config", "default": True},
                {"key": "stride", "label": "stride", "type": "number", "io": "config", "default": 1},
                {"key": "trainRatio", "label": "train-ratio", "type": "number", "io": "config", "default": 0.9},
                {"key": "seed", "label": "seed", "type": "number", "io": "config", "default": 42},
                {"key": "numWorkers", "label": "并行 worker", "type": "number", "io": "config", "default": 8},
                {"key": "skipExisting", "label": "skip-existing（跳过已有 HDF5）", "type": "checkbox", "io": "config", "default": False},
                ],
            ),
        },
        {
            "id": "train",
            "step": 3,
            "title": "训练 ACT",
            "subtitle": "train.py",
            "description": (
                "选 YAML 文件自动回填超参；点「保存为 YAML」弹出路径写入（与开训无关）。"
                "运行时用当前表单超参生成 train.py CLI。"
            ),
            "outputs": ["ckptDir"],
            "ui": "train_yaml",
            "fields": _exec_fields(
                ar,
                "train.py",
                "train.py",
                [
                {
                    "key": "configPath",
                    "label": "YAML 配置（加载回填）",
                    "type": "path",
                    "pathKind": "file",
                    "browseRoot": "act",
                    "io": "input",
                    "default": "",
                    "hint": "选择文件后自动回填超参；「保存为 YAML」另选写入路径（与开训无关）",
                },
                {"key": "dataDir", "label": "HDF5 目录", "type": "path", "pathKind": "dir", "browseRoot": "act", "io": "input", "default": paths["convertedDir"]},
                {"key": "ckptDir", "label": "Checkpoint 输出", "type": "path", "pathKind": "dir", "browseRoot": "act", "io": "output", "default": paths["ckptDir"]},
                {"key": "actionSpace", "label": "动作空间", "type": "select", "io": "config", "default": "cartesian_abs", "options": ["joint", "cartesian_abs", "cartesian"]},
                {"key": "cameraNames", "label": "相机", "type": "text", "io": "config", "default": "chest top wrist_2"},
                {"key": "chunkSize", "label": "chunk-size", "type": "number", "io": "config", "default": 10},
                {"key": "numEpochs", "label": "num-epochs", "type": "number", "io": "config", "default": 2000},
                {"key": "batchSize", "label": "batch-size", "type": "number", "io": "config", "default": 64},
                {"key": "numWorkers", "label": "DataLoader 并行数 (num-workers)", "type": "number", "io": "config", "default": 4},
                {"key": "hdf5CacheSize", "label": "HDF5 LRU 缓存 (hdf5-cache-size)", "type": "number", "io": "config", "default": 16},
                {"key": "lr", "label": "lr", "type": "number", "io": "config", "default": 1e-5},
                {"key": "klWeight", "label": "kl-weight", "type": "number", "io": "config", "default": 10.0},
                {"key": "hiddenDim", "label": "hidden-dim", "type": "number", "io": "config", "default": 512},
                {"key": "dimFeedforward", "label": "dim-feedforward", "type": "number", "io": "config", "default": 3200},
                {"key": "encLayers", "label": "enc-layers", "type": "number", "io": "config", "default": 4},
                {"key": "decLayers", "label": "dec-layers", "type": "number", "io": "config", "default": 7},
                {"key": "nheads", "label": "nheads", "type": "number", "io": "config", "default": 8},
                {"key": "seed", "label": "seed", "type": "number", "io": "config", "default": 0},
                {"key": "useSam2Features", "label": "use-sam2-features", "type": "checkbox", "io": "config", "default": False},
                {"key": "actionRepr", "label": "action-repr（SAM2）", "type": "select", "io": "config", "default": "absolute", "options": ["absolute", "delta"]},
                {"key": "poolSize", "label": "pool-size（SAM2）", "type": "number", "io": "config", "default": 0},
                {"key": "useCvae", "label": "use-cvae（SAM2）", "type": "checkbox", "io": "config", "default": False},
                {"key": "cumulativeLossWeight", "label": "cumulative-loss-weight", "type": "number", "io": "config", "default": 0.0},
                {"key": "gradClip", "label": "grad-clip", "type": "number", "io": "config", "default": 0.0},
                {"key": "cosineLr", "label": "cosine-lr", "type": "checkbox", "io": "config", "default": False},
                {"key": "minLr", "label": "min-lr", "type": "number", "io": "config", "default": 1e-6},
                {"key": "resumeFrom", "label": "resume-from（checkpoint）", "type": "path", "pathKind": "file", "browseRoot": "act", "io": "config", "default": ""},
                {"key": "earlyStopPatience", "label": "early-stop-patience", "type": "number", "io": "config", "default": 100},
                {"key": "earlyStopThreshold", "label": "early-stop-threshold", "type": "number", "io": "config", "default": 0.002},
                ],
            ),
        },
        {
            "id": "hyperparam_bench",
            "step": 3,
            "title": "超参吞吐搜索",
            "subtitle": "bench_hyperparam_combos.py",
            "description": "从 train 脚本解析超参，勾选搜索维度与候选值后短测吞吐，输出最快组合。",
            "variant": True,
            "outputs": ["outJson"],
            "ui": "hyperparam_bench",
            "fields": _exec_fields(
                ar,
                "train.py",
                "train.py（用于解析超参）",
                [
                {"key": "dataDir", "label": "HDF5 目录", "type": "path", "pathKind": "dir", "browseRoot": "act", "io": "input", "default": paths["convertedDir"]},
                {"key": "trainSteps", "label": "每组计时 train steps", "type": "number", "io": "config", "default": 30},
                {"key": "valSteps", "label": "每组 val steps", "type": "number", "io": "config", "default": 10},
                {"key": "outJson", "label": "结果 JSON", "type": "path", "pathKind": "file", "browseRoot": "act", "io": "output", "default": str(ar / "data" / "bench_hyperparam_best.json")},
                {"key": "sweepJson", "label": "sweep-json", "type": "text", "io": "config", "default": "{}", "hidden": True},
                {"key": "baseJson", "label": "base-json", "type": "text", "io": "config", "default": "{}", "hidden": True},
                ],
            ),
        },
        {
            "id": "infer_batch",
            "step": 4,
            "title": "批量离线推理",
            "subtitle": "infer_all_quality_pass.py",
            "description": "对白名单全集，在所选 raw 目录上跑离线推理。",
            "outputs": ["outputDir"],
            "fields": _exec_fields(
                ar,
                "scripts/infer_all_quality_pass.py",
                "infer_all_quality_pass.py",
                [
                {"key": "filterJson", "label": "白名单 JSON", "type": "path", "pathKind": "file", "browseRoot": "act", "io": "input", "default": paths["qualityPassJson"]},
                {"key": "rawDir", "label": "raw 目录", "type": "path", "pathKind": "dir", "browseRoot": "act", "io": "input", "default": paths["rawDir"]},
                {"key": "annotationDir", "label": "标注目录", "type": "path", "pathKind": "dir", "browseRoot": "act", "io": "input", "default": paths["annotationDir"]},
                {"key": "ckptDir", "label": "Checkpoint", "type": "path", "pathKind": "dir", "browseRoot": "act", "io": "input", "default": paths["ckptDir"]},
                {"key": "outputDir", "label": "推理输出", "type": "path", "pathKind": "dir", "browseRoot": "act", "io": "output", "default": paths["inferDir"]},
                {"key": "actionSpace", "label": "动作空间", "type": "select", "io": "config", "default": "cartesian_abs", "options": ["joint", "cartesian_abs", "cartesian"]},
                {"key": "cameraNames", "label": "相机", "type": "text", "io": "config", "default": "chest top wrist_2"},
                {"key": "unwrapRx", "label": "unwrap-rx", "type": "checkbox", "io": "config", "default": True},
                {"key": "ckptName", "label": "ckpt-name", "type": "text", "io": "config", "default": "policy_best.ckpt"},
                {"key": "stride", "label": "stride", "type": "number", "io": "config", "default": 1},
                ],
            ),
        },
        {
            "id": "infer_single",
            "step": 4,
            "title": "单条推理（调试）",
            "subtitle": "infer_from_raw.py",
            "description": "对单个 episode 调试推理。",
            "variant": True,
            "outputs": ["output"],
            "fields": _exec_fields(
                ar,
                "scripts/infer_from_raw.py",
                "infer_from_raw.py",
                [
                {"key": "episode", "label": "Episode ID", "type": "number", "io": "input", "default": 3},
                {"key": "rawDir", "label": "raw 目录", "type": "path", "pathKind": "dir", "browseRoot": "act", "io": "input", "default": paths["rawDir"]},
                {"key": "annotationDir", "label": "标注目录", "type": "path", "pathKind": "dir", "browseRoot": "act", "io": "input", "default": paths["annotationDir"]},
                {"key": "ckptDir", "label": "Checkpoint", "type": "path", "pathKind": "dir", "browseRoot": "act", "io": "input", "default": paths["ckptDir"]},
                {"key": "output", "label": "输出 JSON", "type": "path", "pathKind": "file", "browseRoot": "act", "io": "output", "default": str(ar / "data" / "infer_ep3_debug.json")},
                {"key": "actionSpace", "label": "动作空间", "type": "select", "io": "config", "default": "cartesian_abs", "options": ["joint", "cartesian_abs", "cartesian"]},
                {"key": "cameraNames", "label": "相机", "type": "text", "io": "config", "default": "chest top wrist_2"},
                {"key": "unwrapRx", "label": "unwrap-rx", "type": "checkbox", "io": "config", "default": True},
                {"key": "ckptName", "label": "ckpt-name", "type": "text", "io": "config", "default": "policy_best.ckpt"},
                {"key": "stride", "label": "stride", "type": "number", "io": "config", "default": 1},
                {"key": "maxFrames", "label": "max-frames（0=不限）", "type": "number", "io": "config", "default": 0},
                ],
            ),
        },
        {
            "id": "embody",
            "step": 5,
            "title": "转 embody（chunk 第 0 步）",
            "subtitle": "infer_to_embody_eval.py",
            "description": "每 episode 一个 JSON，供 Eval / Hub 加载 ec616_act。",
            "outputs": ["outputDir"],
            "fields": _exec_fields(
                ar,
                "scripts/infer_to_embody_eval.py",
                "infer_to_embody_eval.py",
                [
                {"key": "inferDir", "label": "推理目录", "type": "path", "pathKind": "dir", "browseRoot": "act", "io": "input", "default": paths["inferDir"]},
                {"key": "rawDir", "label": "raw 目录", "type": "path", "pathKind": "dir", "browseRoot": "act", "io": "input", "default": paths["rawDir"]},
                {"key": "outputDir", "label": "embody 输出", "type": "path", "pathKind": "dir", "browseRoot": "embody", "io": "output", "default": paths["embodyActDir"]},
                {"key": "suite", "label": "套件 ID", "type": "text", "io": "config", "default": "ec616_act"},
                {"key": "refreshIndex", "label": "refresh-index", "type": "checkbox", "io": "config", "default": True},
                {"key": "inferJson", "label": "单文件 infer JSON（留空=批量）", "type": "path", "pathKind": "file", "browseRoot": "act", "io": "input", "default": ""},
                {"key": "fps", "label": "fps", "type": "number", "io": "config", "default": 30.0},
                {"key": "limit", "label": "limit（0=全部）", "type": "number", "io": "config", "default": 0},
                {"key": "embodyRoot", "label": "embody-root（refresh-index）", "type": "path", "pathKind": "dir", "browseRoot": "embody", "io": "config", "default": paths["embodyRoot"]},
                {"key": "tcpToolZM", "label": "tcp-tool-z-m", "type": "number", "io": "config", "default": 0.18},
                {"key": "ikEnforceLimits", "label": "ik-enforce-limits", "type": "checkbox", "io": "config", "default": False},
                ],
            ),
        },
        {
            "id": "embody_chunk",
            "step": 5,
            "title": "转 embody（完整 chunk）",
            "subtitle": "infer_to_embody_eval_chunk.py",
            "description": "每观测帧一个 JSON（10 步 chunk 对比）。",
            "variant": True,
            "outputs": ["outputDir"],
            "fields": _exec_fields(
                ar,
                "scripts/infer_to_embody_eval_chunk.py",
                "infer_to_embody_eval_chunk.py",
                [
                {"key": "inferDir", "label": "推理目录（批量）", "type": "path", "pathKind": "dir", "browseRoot": "act", "io": "input", "default": paths["inferDir"]},
                {"key": "inferJson", "label": "单 infer JSON（优先）", "type": "path", "pathKind": "file", "browseRoot": "act", "io": "input", "default": ""},
                {"key": "rawDir", "label": "raw 目录", "type": "path", "pathKind": "dir", "browseRoot": "act", "io": "input", "default": paths["rawDir"]},
                {"key": "outputDir", "label": "embody 输出", "type": "path", "pathKind": "dir", "browseRoot": "embody", "io": "output", "default": paths["embodyChunkDir"]},
                {"key": "suite", "label": "套件 ID", "type": "text", "io": "config", "default": "ec616_act_chunk"},
                {"key": "refreshIndex", "label": "refresh-index", "type": "checkbox", "io": "config", "default": False},
                {"key": "fps", "label": "fps", "type": "number", "io": "config", "default": 30.0},
                {"key": "limit", "label": "limit（0=全部）", "type": "number", "io": "config", "default": 0},
                {"key": "embodyRoot", "label": "embody-root（refresh-index）", "type": "path", "pathKind": "dir", "browseRoot": "embody", "io": "config", "default": paths["embodyRoot"]},
                {"key": "tcpToolZM", "label": "tcp-tool-z-m", "type": "number", "io": "config", "default": 0.18},
                {"key": "ikEnforceLimits", "label": "ik-enforce-limits", "type": "checkbox", "io": "config", "default": False},
                ],
            ),
        },
    ]
    link_info: dict[str, Any] = {"linked": False}
    if embody_root:
        try:
            link_info = link_status(str(er), str(ar) if act_root else None)
        except ValueError:
            link_info = {"linked": False, "ok": False}
    checks = {
        "actRobotRoot": str(ar),
        "actRobotExists": ar.is_dir(),
        "embodyRoot": str(er),
        "embodyExists": er.is_dir(),
        "python": PYTHON,
        "doc": str(ar / "scripts" / "EVAL_PIPELINE.md"),
    }
    return {
        "ok": True,
        "paths": paths,
        "steps": steps,
        "checks": checks,
        "browseRoots": {"act": str(ar), "embody": str(er)},
        "actLinkName": ACT_LINK_NAME,
        "link": link_info,
    }


def _flag(key: str) -> str:
    import re

    s = re.sub(r"(?<!^)(?=[A-Z])", "-", key).lower().replace("_", "-")
    return f"--{s}"


def _append_arg(argv: list[str], key: str, value: Any) -> None:
    argv.extend([_flag(key), str(value)])


def _append_arg_if(argv: list[str], key: str, value: Any, *, skip_empty: bool = False) -> None:
    if skip_empty and not str(value or "").strip():
        return
    _append_arg(argv, key, value)


def _append_flag_if(argv: list[str], key: str, params: dict[str, Any]) -> None:
    if params.get(key):
        argv.append(_flag(key))


def _append_camera_names(argv: list[str], params: dict[str, Any], key: str = "cameraNames") -> None:
    argv.append(_flag(key))
    argv.extend(str(params[key]).split())


def _append_embody_ik_args(argv: list[str], p: dict[str, Any]) -> None:
    _append_arg(argv, "fps", p["fps"])
    _append_arg(argv, "tcpToolZM", p["tcpToolZM"])
    _append_flag_if(argv, "ikEnforceLimits", p)


def build_argv(step_id: str, params: dict[str, Any]) -> tuple[list[str], Path, str]:
    act_root = Path(str(params.get("_actRoot") or ACT_ROBOT_ROOT))
    embody_root = Path(str(params.get("_embodyRoot") or EMBODY_ROOT))
    spec_data = pipeline_spec(str(act_root), str(embody_root))
    spec = {s["id"]: s for s in spec_data["steps"]}
    if step_id not in spec:
        raise ValueError(f"unknown step: {step_id}")
    step = spec[step_id]
    paths = spec_data["paths"]
    meta_keys = {"stepId", "_actRoot", "_embodyRoot"}
    p = {f["key"]: params.get(f["key"], f.get("default")) for f in step["fields"]}
    p.update({k: v for k, v in params.items() if k not in meta_keys})

    cwd = act_root
    script = Path(str(p.get("scriptPath") or ""))
    if not script.is_absolute():
        script = cwd / script
    if not script.is_file():
        raise FileNotFoundError(f"script not found: {script}")

    argv = [PYTHON, str(script)]

    if step_id == "quality":
        argv += [
            _flag("inputDir"), str(p["inputDir"]),
            _flag("annotationDir"), str(p["annotationDir"]),
            _flag("writePassJson"), str(p["writePassJson"]),
            _flag("writeFailList"), str(p["writeFailList"]),
            _flag("outputJson"), str(p["outputJson"]),
            _flag("zeroEps"), str(p["zeroEps"]),
            _flag("minPeak"), str(p["minPeak"]),
            _flag("sentinelValue"), str(p["sentinelValue"]),
            _flag("sentinelMinRun"), str(p["sentinelMinRun"]),
            _flag("valueTol"), str(p["valueTol"]),
        ]
        _append_flag_if(argv, "strict", p)
    elif step_id == "convert":
        argv += [
            _flag("inputDir"), str(p["inputDir"]),
            _flag("outputDir"), str(p["outputDir"]),
            _flag("annotationDir"), str(p["annotationDir"]),
            _flag("filterJson"), str(p["filterJson"]),
        ]
        _append_camera_names(argv, p)
        argv += [
            _flag("actionSpace"), str(p["actionSpace"]),
            _flag("stride"), str(p["stride"]),
            _flag("trainRatio"), str(p["trainRatio"]),
            _flag("seed"), str(p["seed"]),
            _flag("numWorkers"), str(p["numWorkers"]),
        ]
        if p.get("unwrapRx"):
            argv.append(_flag("unwrapRx"))
        _append_flag_if(argv, "skipExisting", p)
    elif step_id == "train":
        # Snapshot current form hyperparams to a run recipe YAML (provenance);
        # train.py still receives CLI built from the form.
        merge_from = str(p.get("configPath") or "").strip() or None
        run_cfg_dir = RUNS_DIR / "train_cfgs"
        run_cfg_dir.mkdir(parents=True, exist_ok=True)
        run_cfg = run_cfg_dir / f"train_{uuid.uuid4().hex[:10]}.yaml"
        save_act_train_yaml(run_cfg, p, act_root, merge_from=merge_from)
        p["_runRecipePath"] = str(run_cfg)

        argv += [
            _flag("dataDir"), str(p["dataDir"]),
            _flag("ckptDir"), str(p["ckptDir"]),
            _flag("actionSpace"), str(p["actionSpace"]),
        ]
        _append_camera_names(argv, p)
        argv += [
            _flag("chunkSize"), str(p["chunkSize"]),
            _flag("numEpochs"), str(p["numEpochs"]),
            _flag("batchSize"), str(p["batchSize"]),
            _flag("lr"), str(p["lr"]),
            _flag("klWeight"), str(p["klWeight"]),
            _flag("hiddenDim"), str(p["hiddenDim"]),
            _flag("dimFeedforward"), str(p["dimFeedforward"]),
            _flag("encLayers"), str(p["encLayers"]),
            _flag("decLayers"), str(p["decLayers"]),
            _flag("nheads"), str(p["nheads"]),
            _flag("seed"), str(p["seed"]),
            _flag("numWorkers"), str(p["numWorkers"]),
            _flag("hdf5CacheSize"), str(p["hdf5CacheSize"]),
            _flag("actionRepr"), str(p["actionRepr"]),
            _flag("poolSize"), str(p["poolSize"]),
            _flag("cumulativeLossWeight"), str(p["cumulativeLossWeight"]),
            _flag("gradClip"), str(p["gradClip"]),
            _flag("minLr"), str(p["minLr"]),
            _flag("earlyStopPatience"), str(p["earlyStopPatience"]),
            _flag("earlyStopThreshold"), str(p["earlyStopThreshold"]),
        ]
        _append_flag_if(argv, "useSam2Features", p)
        _append_flag_if(argv, "useCvae", p)
        _append_flag_if(argv, "cosineLr", p)
        _append_arg_if(argv, "resumeFrom", p.get("resumeFrom"), skip_empty=True)
    elif step_id == "hyperparam_bench":
        # Always run the combo bench harness under act_robot, regardless of
        # which train.py was selected for argparse discovery.
        bench = act_root / "scripts" / "bench_hyperparam_combos.py"
        if not bench.is_file():
            raise FileNotFoundError(f"bench script not found: {bench}")
        argv = [PYTHON, str(bench)]
        argv += [
            _flag("dataDir"), str(p["dataDir"]),
            _flag("trainSteps"), str(p["trainSteps"]),
            _flag("valSteps"), str(p["valSteps"]),
            "--out", str(p["outJson"]),
            "--base-json", str(p.get("baseJson") or "{}"),
            "--sweep-json", str(p.get("sweepJson") or "{}"),
        ]
        sweep_raw = str(p.get("sweepJson") or "{}").strip()
        try:
            sweep_obj = json.loads(sweep_raw) if sweep_raw else {}
        except json.JSONDecodeError as e:
            raise ValueError(f"sweepJson 不是合法 JSON: {e}") from e
        if not isinstance(sweep_obj, dict) or not sweep_obj:
            raise ValueError("请至少勾选一个超参并填写候选值后再运行")
    elif step_id == "infer_batch":
        argv += [
            _flag("filterJson"), str(p["filterJson"]),
            _flag("rawDir"), str(p["rawDir"]),
            _flag("annotationDir"), str(p["annotationDir"]),
            _flag("ckptDir"), str(p["ckptDir"]),
            _flag("ckptName"), str(p["ckptName"]),
            _flag("outputDir"), str(p["outputDir"]),
            _flag("actionSpace"), str(p["actionSpace"]),
        ]
        _append_camera_names(argv, p)
        argv.append(_flag("stride"))
        argv.append(str(p["stride"]))
        if p.get("unwrapRx"):
            argv.append(_flag("unwrapRx"))
    elif step_id == "infer_single":
        argv += [
            _flag("episode"), str(p["episode"]),
            _flag("rawDir"), str(p["rawDir"]),
            _flag("annotationDir"), str(p["annotationDir"]),
            _flag("ckptDir"), str(p["ckptDir"]),
            _flag("ckptName"), str(p["ckptName"]),
            _flag("output"), str(p["output"]),
            _flag("actionSpace"), str(p["actionSpace"]),
        ]
        _append_camera_names(argv, p)
        argv += [_flag("stride"), str(p["stride"])]
        if p.get("unwrapRx"):
            argv.append(_flag("unwrapRx"))
        max_frames = int(p.get("maxFrames") or 0)
        if max_frames > 0:
            _append_arg(argv, "maxFrames", max_frames)
    elif step_id == "embody":
        infer_json = str(p.get("inferJson") or "").strip()
        if infer_json:
            argv += [
                _flag("inferJson"), infer_json,
                _flag("rawDir"), str(p["rawDir"]),
                _flag("output"), str(Path(p["outputDir"]) / "episode.json"),
            ]
        else:
            argv += [
                _flag("inferDir"), str(p["inferDir"]),
                _flag("rawDir"), str(p["rawDir"]),
                _flag("outputDir"), str(p["outputDir"]),
                _flag("suite"), str(p["suite"]),
            ]
            limit = int(p.get("limit") or 0)
            if limit > 0:
                _append_arg(argv, "limit", limit)
            if p.get("refreshIndex"):
                argv.append(_flag("refreshIndex"))
                _append_arg(argv, "embodyRoot", p["embodyRoot"])
        _append_embody_ik_args(argv, p)
    elif step_id == "embody_chunk":
        infer_json = str(p.get("inferJson") or "").strip()
        if infer_json:
            argv += [
                _flag("inferJson"), infer_json,
                _flag("rawDir"), str(p["rawDir"]),
                _flag("outputDir"), str(p["outputDir"]),
            ]
        else:
            argv += [
                _flag("inferDir"), str(p["inferDir"]),
                _flag("rawDir"), str(p["rawDir"]),
                _flag("outputDir"), str(p["outputDir"]),
                _flag("suite"), str(p["suite"]),
            ]
            limit = int(p.get("limit") or 0)
            if limit > 0:
                _append_arg(argv, "limit", limit)
            if p.get("refreshIndex"):
                argv.append(_flag("refreshIndex"))
                _append_arg(argv, "embodyRoot", p["embodyRoot"])
        _append_embody_ik_args(argv, p)
    else:
        raise ValueError(step_id)

    cmdline = " ".join(argv)
    recipe = str(p.get("_runRecipePath") or "").strip()
    if recipe:
        cmdline = f"{cmdline}  # recipe={recipe}"
    return argv, cwd, cmdline


def _read_log_tail(path: Path, max_chars: int = 12000) -> str:
    if not path.is_file():
        return ""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    return text[-max_chars:] if len(text) > max_chars else text


def _log_header(job_id: str, cmdline: str, cwd: Path, *, script_log: Path | None = None) -> str:
    lines = [
        f"# act_pipeline job {job_id}",
        f"# {cmdline}",
        f"# cwd={cwd}",
    ]
    if script_log is not None:
        lines.append(f"# scriptLog={script_log}")
    lines.append("")
    return "\n".join(lines)


def _is_job_cancelled(job_id: str) -> bool:
    with _lock:
        job = _jobs.get(job_id)
    return bool(job and job.get("status") == "cancelled")


def _kill_job_process(job_id: str) -> None:
    with _lock:
        proc = _procs.get(job_id)
    if proc is None or proc.poll() is not None:
        return
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except (ProcessLookupError, OSError):
        try:
            proc.terminate()
        except OSError:
            return
    try:
        proc.wait(timeout=8)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, OSError):
            try:
                proc.kill()
            except OSError:
                pass
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            pass


def _append_job_log(job: dict[str, Any], line: str) -> None:
    for key in ("logPath", "scriptLogPath"):
        path = job.get(key)
        if not path:
            continue
        try:
            with open(path, "a", encoding="utf-8") as logf:
                logf.write(line)
        except OSError:
            continue


def _run_job(job_id: str) -> None:
    with _lock:
        job = _jobs.get(job_id)
    if not job or _is_job_cancelled(job_id):
        return
    log_path = Path(job["logPath"])
    script_log_path = Path(job["scriptLogPath"]) if job.get("scriptLogPath") else None
    if script_log_path is not None:
        script_log_path.parent.mkdir(parents=True, exist_ok=True)
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    job["status"] = "running"
    job["startedAt"] = time.time()
    _persist_job(job_id, job)
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    try:
        if _is_job_cancelled(job_id):
            return
        argv, cwd, cmdline = build_argv(job["stepId"], job["params"])
        job["command"] = cmdline
        job["argv"] = argv
        header = _log_header(job_id, cmdline, cwd, script_log=script_log_path)
        with open(log_path, "w", encoding="utf-8") as logf:
            logf.write(header)
            logf.flush()
            script_logf = (
                open(script_log_path, "w", encoding="utf-8")
                if script_log_path is not None
                else None
            )
            try:
                if script_logf is not None:
                    script_logf.write(header)
                    script_logf.flush()
                if _is_job_cancelled(job_id):
                    return
                proc = subprocess.Popen(
                    argv,
                    cwd=str(cwd),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                    env=env,
                    start_new_session=True,
                )
                with _lock:
                    _procs[job_id] = proc
                job["pid"] = proc.pid
                _persist_job(job_id, job)
                assert proc.stdout is not None
                for line in proc.stdout:
                    if _is_job_cancelled(job_id):
                        break
                    logf.write(line)
                    logf.flush()
                    if script_logf is not None:
                        script_logf.write(line)
                        script_logf.flush()
                rc = proc.wait()
            finally:
                with _lock:
                    _procs.pop(job_id, None)
                if script_logf is not None:
                    script_logf.close()
        if _is_job_cancelled(job_id):
            return
        job["exitCode"] = rc
        job["status"] = "succeeded" if rc == 0 else "failed"
        job["finishedAt"] = time.time()
    except Exception as exc:
        if _is_job_cancelled(job_id):
            return
        job["status"] = "failed"
        job["error"] = str(exc)
        job["finishedAt"] = time.time()
        err_line = f"\n[runner] {exc}\n"
        with open(log_path, "a", encoding="utf-8") as logf:
            logf.write(err_line)
        if script_log_path is not None:
            with open(script_log_path, "a", encoding="utf-8") as script_logf:
                script_logf.write(err_line)
    _persist_job(job_id, job)


def _job_path(job_id: str) -> Path:
    return RUNS_DIR / f"{job_id}.json"


def _persist_job(job_id: str, job: dict[str, Any]) -> None:
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    _job_path(job_id).write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
    with _lock:
        _jobs[job_id] = job


def _load_jobs() -> None:
    if not RUNS_DIR.is_dir():
        return
    for p in RUNS_DIR.glob("*.json"):
        try:
            job = json.loads(p.read_text(encoding="utf-8"))
            with _lock:
                _jobs[p.stem] = job
        except Exception:
            continue


def start_job(
    step_id: str,
    params: dict[str, Any] | None = None,
    act_root: str | None = None,
    embody_root: str | None = None,
) -> dict[str, Any]:
    _load_jobs()
    merged = dict(params or {})
    if act_root:
        merged["_actRoot"] = act_root
    if embody_root:
        merged["_embodyRoot"] = embody_root
    if act_root and embody_root:
        st = link_status(embody_root, act_root)
        if not st.get("linked") or not st.get("matches"):
            raise ValueError("软链未就绪：请先选择评测根目录与训练/推理根目录并完成软链")
    job_id = uuid.uuid4().hex[:12]
    log_path = RUNS_DIR / f"{job_id}.log"
    script_log_path: Path | None = None
    if step_id == "train":
        ckpt_dir = str(merged.get("ckptDir") or "").strip()
        if ckpt_dir:
            script_log_path = Path(ckpt_dir) / f"train_{job_id}.log"
            script_log_path.parent.mkdir(parents=True, exist_ok=True)
    job = {
        "id": job_id,
        "stepId": step_id,
        "params": merged,
        "status": "queued",
        "createdAt": time.time(),
        "logPath": str(log_path),
    }
    if script_log_path is not None:
        job["scriptLogPath"] = str(script_log_path)
    _persist_job(job_id, job)
    t = threading.Thread(target=_run_job, args=(job_id,), daemon=True)
    t.start()
    return job


def cancel_job(job_id: str) -> dict[str, Any] | None:
    _load_jobs()
    with _lock:
        job = _jobs.get(job_id)
    if not job:
        return None
    status = job.get("status")
    if status in ("succeeded", "failed", "cancelled"):
        return get_job(job_id)
    if status not in ("queued", "running"):
        raise ValueError(f"无法取消状态为 {status} 的任务")

    job["status"] = "cancelled"
    job["finishedAt"] = time.time()
    job["error"] = "用户取消"
    _persist_job(job_id, job)
    _append_job_log(job, "\n[runner] cancelled by user\n")
    _kill_job_process(job_id)
    return get_job(job_id)


def delete_job(job_id: str) -> bool:
    _load_jobs()
    with _lock:
        job = _jobs.get(job_id)
    if not job:
        return False
    status = job.get("status")
    if status in ("queued", "running"):
        cancel_job(job_id)

    log_path = Path(job.get("logPath", ""))
    with _lock:
        _jobs.pop(job_id, None)
    json_path = _job_path(job_id)
    if json_path.is_file():
        json_path.unlink()
    if log_path.is_file():
        log_path.unlink()
    return True


def get_job(job_id: str) -> dict[str, Any] | None:
    _load_jobs()
    with _lock:
        job = _jobs.get(job_id)
    if not job:
        return None
    tails: list[str] = []
    for key in ("logPath", "scriptLogPath"):
        tail = _read_log_tail(Path(job.get(key, "")))
        if tail:
            tails.append(tail)
    out = dict(job)
    out["logTail"] = max(tails, key=len) if tails else ""
    return out


def list_jobs(limit: int = 30) -> list[dict[str, Any]]:
    _load_jobs()
    with _lock:
        items = sorted(_jobs.values(), key=lambda j: j.get("createdAt", 0), reverse=True)
    return items[:limit]


_load_jobs()
