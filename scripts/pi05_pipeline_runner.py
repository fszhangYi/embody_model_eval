"""pi0.5 pipeline: quality → convert → norm_stats → train → offline infer → embody.

Primary route: Tl PyTorch full FT (mlu_full_ft*). Secondary: JAX LoRA smoke.
Steps 1–3 and 5 use explicit dirs (no train YAML). Train (step 4) loads YAML
into form hyperparams; Save-as-YAML is a separate path dialog (syncs load path).
Run merges form → temp YAML (independent of Save). Step 6 converters may live
under act_robot.
"""

from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from pi05_train_yaml import load_train_yaml
from pi05_train_yaml import save_train_yaml
from pi05_train_yaml import train_hp_form_fields

ROOT = Path(__file__).resolve().parent.parent
RUNS_DIR = ROOT / "agent_skills" / ".run" / "pi05_pipeline"
PI05_ROOT = Path(os.environ.get("PI05_ROOT", "/root/autodl-tmp/pi05"))
ACT_ROBOT_ROOT = Path(os.environ.get("ACT_ROBOT_ROOT", "/root/autodl-tmp/act_robot"))
EMBODY_ROOT = Path(os.environ.get("EMBODY_ROOT", str(ROOT)))
BASH = os.environ.get("PI05_PIPELINE_BASH", "/bin/bash")
PYTHON = os.environ.get("PI05_PIPELINE_PYTHON", sys.executable)

ROUTE_FULL_FT = "full_ft"
ROUTE_SMOKE_LORA = "smoke_lora"
VALID_ROUTES = (ROUTE_FULL_FT, ROUTE_SMOKE_LORA)

_lock = threading.Lock()
_jobs: dict[str, dict[str, Any]] = {}
_procs: dict[str, subprocess.Popen[Any]] = {}


def _resolve_dir(path: str) -> Path:
    p = Path(path).expanduser().resolve()
    if not p.is_dir():
        raise ValueError(f"不是有效目录: {path}")
    return p


def normalize_route(route: str | None) -> str:
    r = (route or ROUTE_FULL_FT).strip().lower()
    return r if r in VALID_ROUTES else ROUTE_FULL_FT


def _count_gpus() -> int:
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
        return len([ln for ln in out.splitlines() if ln.strip()])
    except (FileNotFoundError, subprocess.CalledProcessError, OSError):
        return 0


def _default_paths(pi05: Path | None = None, route: str = ROUTE_FULL_FT) -> dict[str, str]:
    pi05 = pi05 or PI05_ROOT
    er = EMBODY_ROOT
    ar = ACT_ROBOT_ROOT
    route = normalize_route(route)
    smoke = str(pi05 / "configs" / "pi05_act_robot_smoke.yaml")
    full_ft = str(pi05 / "configs" / "pi05_tonglu0630_full_ft_two_view.yaml")
    train_full = str(pi05 / "scripts" / "train_tonglu_full_ft.sh")
    train_jax8 = str(pi05 / "scripts" / "train_8gpu.sh")
    train_jax2 = str(pi05 / "scripts" / "train_2gpu.sh")
    base_pytorch = str(pi05 / "checkpoints" / "pi05_base_pytorch")
    base_jax = str(pi05 / "checkpoints" / "pi0.5_base" / "params")
    docs_full = str(pi05 / "docs" / "tonglu_mlu_full_ft_reproduce.md")
    smoke_route = route == ROUTE_SMOKE_LORA
    # Smoke placeholders validated on RTX 5090 32GB (dual LoRA + bs=2): peak ~17GiB.
    if smoke_route:
        repo_id = "company/act_robot_three_view_smoke"
        assets_norm = str(
            pi05 / "artifacts" / "assets" / "pi05_act_robot_smoke" / "company" / "act_robot_three_view_smoke"
        )
        ckpt_run = str(pi05 / "artifacts" / "checkpoints" / "pi05_act_robot_smoke" / "convert_smoke")
        raw_dir = str(ar / "data" / "raw")
        annotation_dir = str(ar / "data" / "annotation" / "annotation" / "restored_txt")
        camera_names = "chest top wrist_2"
        paligemma = "gemma_2b_lora"
        action_expert = "gemma_300m_lora"
        embody_act = str(er / "data" / "ec616_pi05_smoke")
        embody_chunk = str(er / "data" / "ec616_pi05_smoke_chunk")
        quality_pass = str(pi05 / "data" / "smoke_quality_pass.json")
        quality_fail = str(pi05 / "data" / "smoke_quality_fail.txt")
        quality_report = str(pi05 / "data" / "smoke_quality_report.json")
    else:
        repo_id = "company/tonglu0630_two_view_terminated"
        assets_norm = str(
            pi05 / "artifacts" / "assets" / "pi05_tonglu0630_mlu" / "company" / "tonglu0630_two_view_terminated"
        )
        ckpt_run = str(pi05 / "artifacts" / "checkpoints" / "pi05_tonglu0630_mlu" / "mlu_full_ft_two_view")
        raw_dir = "/root/autodl-tmp/datasets/tonglu0630/raw_data"
        annotation_dir = "/root/autodl-tmp/datasets/tonglu0630/annotation"
        camera_names = "top wrist_2"
        paligemma = "gemma_2b"
        action_expert = "gemma_300m"
        embody_act = str(er / "data" / "ec616_pi05")
        embody_chunk = str(er / "data" / "ec616_pi05_chunk")
        quality_pass = str(pi05 / "data" / "quality_pass.json")
        quality_fail = str(pi05 / "data" / "quality_fail.txt")
        quality_report = str(pi05 / "data" / "quality_report.json")
    return {
        "pi05Root": str(pi05),
        "embodyRoot": str(er),
        "actRobotRoot": str(ar),
        "route": route,
        "smokeConfig": smoke,
        "fullFtConfig": full_ft,
        "fullConfig": str(pi05 / "configs" / "pi05_act_robot_local.yaml"),
        "lerobotHome": str(pi05 / "data" / "lerobot"),
        "assetsDir": str(pi05 / "artifacts" / "assets"),
        "assetsNormDir": assets_norm,
        "ckptBaseDir": str(pi05 / "artifacts" / "checkpoints"),
        "evalDir": str(pi05 / "artifacts" / "eval"),
        "inferDir": str(pi05 / "artifacts" / "infer"),
        "ckptRunDir": ckpt_run,
        "embodyActDir": embody_act,
        "embodyChunkDir": embody_chunk,
        "baseCkpt": base_pytorch if route == ROUTE_FULL_FT else base_jax,
        "baseCkptPytorch": base_pytorch,
        "baseCkptJax": base_jax,
        "prepareScript": str(pi05 / "scripts" / "prepare_dataset.sh"),
        "qualityScript": str(ar / "scripts" / "check_episode_quality.py"),
        "rawDir": raw_dir,
        "annotationDir": annotation_dir,
        "repoId": repo_id,
        "cameraNames": camera_names,
        "paligemmaVariant": paligemma,
        "actionExpertVariant": action_expert,
        "qualityPassJson": quality_pass,
        "qualityFailTxt": quality_fail,
        "qualityReportJson": quality_report,
        "normScript": str(pi05 / "scripts" / "compute_norm_stats.sh"),
        "trainScript": train_full if route == ROUTE_FULL_FT else train_jax8,
        "trainFullFtScript": train_full,
        "trainScriptJax8": train_jax8,
        "train2Script": train_jax2,
        "inferBatchScript": str(pi05 / "scripts" / "infer_offline_batch.sh"),
        "inferSingleScript": str(pi05 / "scripts" / "evaluate_checkpoint.sh"),
        # Format helpers currently ship under act_robot; default is absolute path only.
        "embodyScript": str(ar / "scripts" / "infer_to_embody_eval.py"),
        "embodyChunkScript": str(ar / "scripts" / "infer_to_embody_eval_chunk.py"),
        "docsInstall": str(pi05 / "docs" / "installation.md"),
        "docsIssues": str(pi05 / "docs" / "issues.md"),
        "docsFullFt": docs_full,
    }


def _exec_fields_pi05(pi05: Path, script_rel: str, script_hint: str, fields: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "key": "scriptPath",
            "label": "脚本路径",
            "type": "path",
            "pathKind": "file",
            "browseRoot": "pi05",
            "default": str(pi05 / script_rel) if not Path(script_rel).is_absolute() else script_rel,
            "hint": script_hint,
            "io": "config",
        },
        *fields,
    ]


def _config_options(pi05: Path) -> list[str]:
    cfg_dir = pi05 / "configs"
    if not cfg_dir.is_dir():
        return []
    names = sorted(p.name for p in cfg_dir.glob("*.yaml") if p.is_file())
    return [str(cfg_dir / n) for n in names]


def pipeline_spec(
    pi05_root: str | None = None,
    act_root: str | None = None,
    route: str | None = None,
) -> dict[str, Any]:
    # act_root ignored (API compat).
    _ = act_root
    pi05 = _resolve_dir(pi05_root) if pi05_root else PI05_ROOT
    route = normalize_route(route)
    paths = _default_paths(pi05, route)
    configs = _config_options(pi05)

    if route == ROUTE_FULL_FT:
        preferred = paths["fullFtConfig"]
        train_options = [paths["trainFullFtScript"]]
        train_title = "训练 π0.5（PyTorch 全参）"
        train_subtitle = "train_tonglu_full_ft.sh / torchrun"
        train_desc = (
            "选 YAML 文件自动回填超参；点「保存为 YAML」弹出路径写入（与开训无关）。"
            "运行时用当前表单生成临时配置（Tl 全参 / torchrun）。"
        )
        default_cfg = preferred if Path(preferred).is_file() else (
            paths["smokeConfig"] if Path(paths["smokeConfig"]).is_file() else (configs[0] if configs else "")
        )
    else:
        train_options = [paths["trainScriptJax8"], paths["train2Script"]]
        train_title = "训练 π0.5（JAX LoRA 冒烟）"
        train_subtitle = "train_*.sh / pi05_jax_sft.train"
        train_desc = (
            "选 YAML 文件自动回填超参；点「保存为 YAML」弹出路径写入（与开训无关）。"
            "JAX + FSDP；单卡 32GB 请用双 LoRA + 小 batch（smoke 配置）。"
        )
        default_cfg = (
            paths["smokeConfig"]
            if Path(paths["smokeConfig"]).is_file()
            else (configs[0] if configs else "")
        )

    steps = [
        {
            "id": "quality",
            "step": 1,
            "title": "质量过滤",
            "subtitle": "check_episode_quality.py",
            "description": "依据 gripper 轨迹筛 episode，输出 quality_pass.json 白名单（与 ACT 同脚本）。",
            "outputs": ["writePassJson", "writeFailList", "outputJson"],
            "fields": _exec_fields_pi05(
                pi05,
                paths["qualityScript"],
                "check_episode_quality.py",
                [
                    {"key": "inputDir", "label": "原始数据目录", "type": "path", "pathKind": "dir", "browseRoot": "pi05", "io": "input", "default": paths["rawDir"]},
                    {"key": "annotationDir", "label": "标注目录", "type": "path", "pathKind": "dir", "browseRoot": "pi05", "io": "input", "default": paths["annotationDir"]},
                    {"key": "writePassJson", "label": "白名单 JSON", "type": "path", "pathKind": "file", "browseRoot": "pi05", "io": "output", "default": paths["qualityPassJson"]},
                    {"key": "writeFailList", "label": "失败列表", "type": "path", "pathKind": "file", "browseRoot": "pi05", "io": "output", "default": paths["qualityFailTxt"]},
                    {"key": "outputJson", "label": "质量报告", "type": "path", "pathKind": "file", "browseRoot": "pi05", "io": "output", "default": paths["qualityReportJson"]},
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
            "title": "转 LeRobot",
            "subtitle": "convert_company_dataset",
            "description": "将白名单 episode 转为 LeRobot（原始目录 → 输出目录；与 ACT 转 HDF5 同构）。",
            "outputs": ["outputDir"],
            "fields": [
                {"key": "scriptPath", "label": "脚本", "type": "path", "pathKind": "file", "browseRoot": "pi05", "io": "config", "default": paths["prepareScript"], "hint": "prepare_dataset.sh"},
                {"key": "inputDir", "label": "原始数据", "type": "path", "pathKind": "dir", "browseRoot": "pi05", "io": "input", "default": paths["rawDir"]},
                {"key": "outputDir", "label": "LeRobot 输出根", "type": "path", "pathKind": "dir", "browseRoot": "pi05", "io": "output", "default": paths["lerobotHome"]},
                {"key": "annotationDir", "label": "标注目录", "type": "path", "pathKind": "dir", "browseRoot": "pi05", "io": "input", "default": paths["annotationDir"]},
                {"key": "filterJson", "label": "白名单 JSON", "type": "path", "pathKind": "file", "browseRoot": "pi05", "io": "input", "default": paths["qualityPassJson"]},
                {"key": "repoId", "label": "repo_id（数据集名）", "type": "text", "io": "config", "default": paths["repoId"]},
                {"key": "datasetFormat", "label": "dataset_format", "type": "select", "io": "config", "default": "tonglu_annotation", "options": ["tonglu_annotation", "company_steps"]},
                {"key": "cameraNames", "label": "相机（空格分隔）", "type": "text", "io": "config", "default": paths["cameraNames"]},
                {"key": "stride", "label": "stride", "type": "number", "io": "config", "default": 1},
                {"key": "seed", "label": "seed", "type": "number", "io": "config", "default": 42},
                {"key": "dryRun", "label": "dry-run（只扫描不写）", "type": "checkbox", "io": "config", "default": False},
                {"key": "resume", "label": "resume（断点续转）", "type": "checkbox", "io": "config", "default": True},
                {"key": "imageWriterThreads", "label": "image-writer-threads", "type": "number", "io": "config", "default": 4},
                {"key": "imageWriterProcesses", "label": "image-writer-processes", "type": "number", "io": "config", "default": 2},
            ],
        },
        {
            "id": "norm_stats",
            "step": 3,
            "title": "计算 norm_stats",
            "subtitle": "compute_norm_stats",
            "description": "在所选 LeRobot 数据集上统计 state/action 归一化，写入 norm_stats.json 供训练读取。",
            "outputs": ["outputDir"],
            "fields": [
                {
                    "key": "scriptPath",
                    "label": "脚本",
                    "type": "path",
                    "pathKind": "file",
                    "browseRoot": "pi05",
                    "io": "config",
                    "default": paths["normScript"],
                    "hint": "compute_norm_stats.sh（流水线直接调 python -m）",
                },
                {
                    "key": "inputDir",
                    "label": "LeRobot 数据根",
                    "type": "path",
                    "pathKind": "dir",
                    "browseRoot": "pi05",
                    "io": "input",
                    "default": paths["lerobotHome"],
                },
                {
                    "key": "repoId",
                    "label": "repo_id（数据集名）",
                    "type": "text",
                    "io": "config",
                    "default": paths["repoId"],
                },
                {
                    "key": "outputDir",
                    "label": "norm_stats 输出目录",
                    "type": "path",
                    "pathKind": "dir",
                    "browseRoot": "pi05",
                    "io": "output",
                    "default": paths["assetsNormDir"],
                },
                {
                    "key": "maxFrames",
                    "label": "max-frames（0=全部）",
                    "type": "number",
                    "io": "config",
                    "default": 0,
                },
            ],
        },
        {
            "id": "train",
            "step": 4,
            "title": train_title,
            "subtitle": train_subtitle,
            "description": train_desc,
            "outputs": [],
            "ui": "train_yaml",
            "fields": [
                {
                    "key": "scriptPath",
                    "label": "启动脚本",
                    "type": "path",
                    "pathKind": "file",
                    "browseRoot": "pi05",
                    "io": "config",
                    "default": train_options[0] if train_options else paths.get("trainFullFtScript") or paths["trainScript"],
                },
                {
                    "key": "configPath",
                    "label": "YAML 配置（加载回填）",
                    "type": "path",
                    "pathKind": "file",
                    "browseRoot": "pi05",
                    "io": "input",
                    "default": default_cfg,
                    "hint": "选择文件后自动回填超参；「保存为 YAML」另选写入路径（与开训无关）",
                },
                {"key": "printOnly", "label": "print-only（预检 TrainConfig）", "type": "checkbox", "io": "config", "default": False},
                *train_hp_form_fields("pi05"),
            ],
        },
        {
            "id": "infer_batch",
            "step": 5,
            "title": "批量离线推理",
            "subtitle": "evaluate_checkpoint",
            "description": "按 sample 范围在所选 LeRobot + checkpoint 上批量离线推理，结果写入 eval 目录（无需训练 YAML）。",
            "outputs": ["outputDir"],
            "fields": [
                {
                    "key": "scriptPath",
                    "label": "脚本",
                    "type": "path",
                    "pathKind": "file",
                    "browseRoot": "pi05",
                    "io": "config",
                    "default": paths["inferBatchScript"],
                    "hint": "infer_offline_batch.sh（流水线直接调 python -m）",
                },
                {
                    "key": "ckptDir",
                    "label": "Checkpoint 目录",
                    "type": "path",
                    "pathKind": "dir",
                    "browseRoot": "pi05",
                    "io": "input",
                    "default": paths["ckptRunDir"],
                },
                {
                    "key": "inputDir",
                    "label": "LeRobot 数据根",
                    "type": "path",
                    "pathKind": "dir",
                    "browseRoot": "pi05",
                    "io": "input",
                    "default": paths["lerobotHome"],
                },
                {
                    "key": "repoId",
                    "label": "repo_id（数据集名）",
                    "type": "text",
                    "io": "config",
                    "default": paths["repoId"],
                },
                {
                    "key": "assetsBaseDir",
                    "label": "assets 根（含 norm_stats）",
                    "type": "path",
                    "pathKind": "dir",
                    "browseRoot": "pi05",
                    "io": "input",
                    "default": paths["assetsDir"],
                },
                {
                    "key": "outputDir",
                    "label": "推理输出目录",
                    "type": "path",
                    "pathKind": "dir",
                    "browseRoot": "pi05",
                    "io": "output",
                    "default": paths["evalDir"],
                },
                {"key": "checkpointStep", "label": "checkpoint step（空=最新）", "type": "text", "io": "config", "default": ""},
                {"key": "sampleStart", "label": "sample-start", "type": "number", "io": "config", "default": 0},
                {"key": "sampleCount", "label": "sample-count", "type": "number", "io": "config", "default": 8},
                {"key": "actionHorizon", "label": "action_horizon", "type": "number", "io": "config", "default": 10},
                {
                    "key": "paligemmaVariant",
                    "label": "paligemma_variant",
                    "type": "select",
                    "io": "config",
                    "default": paths["paligemmaVariant"],
                    "options": ["gemma_2b", "gemma_2b_lora", "dummy"],
                },
                {
                    "key": "actionExpertVariant",
                    "label": "action_expert_variant",
                    "type": "select",
                    "io": "config",
                    "default": paths["actionExpertVariant"],
                    "options": ["gemma_300m", "gemma_300m_lora", "dummy"],
                },
            ],
        },
        {
            "id": "infer_single",
            "step": 5,
            "title": "单条推理（调试）",
            "subtitle": "evaluate_checkpoint",
            "description": "对单个 LeRobot sample-index 做离线推理调试（无需训练 YAML）。",
            "variant": True,
            "outputs": ["outputDir"],
            "fields": [
                {
                    "key": "scriptPath",
                    "label": "脚本",
                    "type": "path",
                    "pathKind": "file",
                    "browseRoot": "pi05",
                    "io": "config",
                    "default": paths["inferSingleScript"],
                    "hint": "evaluate_checkpoint.sh（流水线直接调 python -m）",
                },
                {
                    "key": "ckptDir",
                    "label": "Checkpoint 目录",
                    "type": "path",
                    "pathKind": "dir",
                    "browseRoot": "pi05",
                    "io": "input",
                    "default": paths["ckptRunDir"],
                },
                {
                    "key": "inputDir",
                    "label": "LeRobot 数据根",
                    "type": "path",
                    "pathKind": "dir",
                    "browseRoot": "pi05",
                    "io": "input",
                    "default": paths["lerobotHome"],
                },
                {
                    "key": "repoId",
                    "label": "repo_id（数据集名）",
                    "type": "text",
                    "io": "config",
                    "default": paths["repoId"],
                },
                {
                    "key": "assetsBaseDir",
                    "label": "assets 根（含 norm_stats）",
                    "type": "path",
                    "pathKind": "dir",
                    "browseRoot": "pi05",
                    "io": "input",
                    "default": paths["assetsDir"],
                },
                {
                    "key": "outputDir",
                    "label": "推理输出目录",
                    "type": "path",
                    "pathKind": "dir",
                    "browseRoot": "pi05",
                    "io": "output",
                    "default": paths["evalDir"],
                },
                {"key": "checkpointStep", "label": "checkpoint step（空=最新）", "type": "text", "io": "config", "default": ""},
                {"key": "sampleIndex", "label": "sample-index", "type": "number", "io": "config", "default": 0},
                {"key": "actionHorizon", "label": "action_horizon", "type": "number", "io": "config", "default": 10},
                {
                    "key": "paligemmaVariant",
                    "label": "paligemma_variant",
                    "type": "select",
                    "io": "config",
                    "default": paths["paligemmaVariant"],
                    "options": ["gemma_2b", "gemma_2b_lora", "dummy"],
                },
                {
                    "key": "actionExpertVariant",
                    "label": "action_expert_variant",
                    "type": "select",
                    "io": "config",
                    "default": paths["actionExpertVariant"],
                    "options": ["gemma_300m", "gemma_300m_lora", "dummy"],
                },
            ],
        },
        {
            "id": "embody",
            "step": 6,
            "title": "转 embody（chunk 第 0 步）",
            "subtitle": "infer_to_embody_eval.py",
            "description": "每 episode 一个 JSON，供 Eval / Hub 加载 ec616_pi05。",
            "outputs": ["outputDir"],
            "fields": [
                {"key": "scriptPath", "label": "脚本", "type": "path", "pathKind": "file", "browseRoot": "pi05", "io": "config", "default": paths["embodyScript"], "hint": "infer_to_embody_eval.py"},
                {"key": "inferDir", "label": "推理目录", "type": "path", "pathKind": "dir", "browseRoot": "pi05", "io": "input", "default": paths["inferDir"]},
                {"key": "inferJson", "label": "单条 infer JSON（可选）", "type": "path", "pathKind": "file", "browseRoot": "pi05", "io": "input", "default": ""},
                {"key": "rawDir", "label": "raw 目录", "type": "path", "pathKind": "dir", "browseRoot": "pi05", "io": "input", "default": paths["rawDir"]},
                {"key": "outputDir", "label": "embody 输出", "type": "path", "pathKind": "dir", "browseRoot": "embody", "io": "output", "default": paths["embodyActDir"]},
                {"key": "suite", "label": "套件 ID", "type": "text", "io": "config", "default": "ec616_pi05_smoke" if route == ROUTE_SMOKE_LORA else "ec616_pi05"},
                {"key": "refreshIndex", "label": "refresh-index", "type": "checkbox", "io": "config", "default": False},
                {"key": "fps", "label": "fps", "type": "number", "io": "config", "default": 30.0},
                {"key": "limit", "label": "limit（0=全部）", "type": "number", "io": "config", "default": 0},
                {"key": "embodyRoot", "label": "embody-root（refresh-index）", "type": "path", "pathKind": "dir", "browseRoot": "embody", "io": "config", "default": paths["embodyRoot"]},
                {"key": "tcpToolZM", "label": "tcp-tool-z-m", "type": "number", "io": "config", "default": 0.18},
                {"key": "ikEnforceLimits", "label": "ik-enforce-limits", "type": "checkbox", "io": "config", "default": False},
            ],
        },
        {
            "id": "embody_chunk",
            "step": 6,
            "title": "转 embody（完整 chunk）",
            "subtitle": "infer_to_embody_eval_chunk.py",
            "description": "每观测帧一个 JSON（chunk 对比）。",
            "variant": True,
            "outputs": ["outputDir"],
            "fields": [
                {"key": "scriptPath", "label": "脚本", "type": "path", "pathKind": "file", "browseRoot": "pi05", "io": "config", "default": paths["embodyChunkScript"], "hint": "infer_to_embody_eval_chunk.py"},
                {"key": "inferDir", "label": "推理目录", "type": "path", "pathKind": "dir", "browseRoot": "pi05", "io": "input", "default": paths["inferDir"]},
                {"key": "inferJson", "label": "单条 infer JSON（可选）", "type": "path", "pathKind": "file", "browseRoot": "pi05", "io": "input", "default": ""},
                {"key": "rawDir", "label": "raw 目录", "type": "path", "pathKind": "dir", "browseRoot": "pi05", "io": "input", "default": paths["rawDir"]},
                {"key": "outputDir", "label": "embody 输出", "type": "path", "pathKind": "dir", "browseRoot": "embody", "io": "output", "default": paths["embodyChunkDir"]},
                {"key": "suite", "label": "套件 ID", "type": "text", "io": "config", "default": "ec616_pi05_smoke_chunk" if route == ROUTE_SMOKE_LORA else "ec616_pi05_chunk"},
                {"key": "refreshIndex", "label": "refresh-index", "type": "checkbox", "io": "config", "default": False},
                {"key": "fps", "label": "fps", "type": "number", "io": "config", "default": 30.0},
                {"key": "limit", "label": "limit（0=全部）", "type": "number", "io": "config", "default": 0},
                {"key": "embodyRoot", "label": "embody-root（refresh-index）", "type": "path", "pathKind": "dir", "browseRoot": "embody", "io": "config", "default": paths["embodyRoot"]},
                {"key": "tcpToolZM", "label": "tcp-tool-z-m", "type": "number", "io": "config", "default": 0.18},
                {"key": "ikEnforceLimits", "label": "ik-enforce-limits", "type": "checkbox", "io": "config", "default": False},
            ],
        },
    ]

    pytorch_weights = Path(paths["baseCkptPytorch"]) / "model.safetensors"
    gpu_count = _count_gpus()
    checks = {
        "pi05Root": str(pi05),
        "pi05Exists": pi05.is_dir(),
        "baseCkptExists": Path(paths["baseCkpt"]).exists() or (route == ROUTE_FULL_FT and pytorch_weights.is_file()),
        "basePytorchExists": pytorch_weights.is_file(),
        "baseJaxExists": Path(paths["baseCkptJax"]).exists(),
        "lerobotHome": paths["lerobotHome"],
        "lerobotExists": Path(paths["lerobotHome"]).is_dir(),
        "fullFtConfigExists": Path(paths["fullFtConfig"]).is_file(),
        "trainFullFtScriptExists": Path(paths["trainFullFtScript"]).is_file(),
        "gpuCount": gpu_count,
        "gpuEnoughForFullFt": gpu_count >= 8,
        "configCount": len(configs),
        "docsInstall": paths["docsInstall"],
        "docsIssues": paths["docsIssues"],
        "docsFullFt": paths["docsFullFt"],
    }
    return {
        "ok": True,
        "route": route,
        "routeModes": [
            {"id": ROUTE_FULL_FT, "label": "Tl 全参", "primary": True, "backend": "pytorch", "defaultConfig": paths["fullFtConfig"]},
            {"id": ROUTE_SMOKE_LORA, "label": "LoRA 冒烟", "primary": False, "backend": "jax", "defaultConfig": paths["smokeConfig"]},
        ],
        "paths": paths,
        "steps": steps,
        "checks": checks,
        "browseRoots": {"pi05": str(pi05), "embody": str(EMBODY_ROOT)},
        "configs": configs,
    }


def _flag(key: str) -> str:
    s = re.sub(r"(?<!^)(?=[A-Z])", "-", key).lower().replace("_", "-")
    return f"--{s}"


def _append_arg(argv: list[str], key: str, value: Any) -> None:
    argv.extend([_flag(key), str(value)])


def _append_camera_names(argv: list[str], params: dict[str, Any], key: str = "cameraNames") -> None:
    argv.append(_flag(key))
    argv.extend(str(params[key]).split())


def _append_embody_ik_args(argv: list[str], p: dict[str, Any]) -> None:
    _append_arg(argv, "fps", p["fps"])
    _append_arg(argv, "tcpToolZM", p["tcpToolZM"])
    if p.get("ikEnforceLimits"):
        argv.append(_flag("ikEnforceLimits"))


def _camera_prefixes(camera_names: str) -> dict[str, str | None]:
    """Map ACT-style camera tokens to Tonglu filename prefixes."""
    wanted = {t.strip() for t in str(camera_names or "").split() if t.strip()}
    mapping = {
        "chest": "rgb_chest",
        "top": "rgb_top",
        "wrist": "rgb_wrist_1",
        "wrist_1": "rgb_wrist_1",
        "wrist_2": "rgb_wrist_2",
    }
    return {
        "chest_image_prefix": mapping["chest"] if "chest" in wanted else None,
        "top_image_prefix": mapping["top"] if "top" in wanted else None,
        "wrist_image_prefix": (
            mapping["wrist_2"] if "wrist_2" in wanted
            else mapping["wrist_1"] if ("wrist_1" in wanted or "wrist" in wanted)
            else "rgb_wrist_2"
        ),
    }


def _write_convert_data_yaml(pi05: Path, p: dict[str, Any]) -> Path:
    """Minimal data-only YAML for convert; no training hyperparams."""
    import yaml

    prefixes = _camera_prefixes(str(p.get("cameraNames") or "top wrist_2"))
    payload = {
        "project": {
            "name": "pi05_pipeline_convert",
            "exp_name": "convert",
            "project_name": "pi05-convert",
        },
        "data": {
            "repo_id": str(p.get("repoId") or "company/tonglu0630_two_view_terminated"),
            "dataset_format": str(p.get("datasetFormat") or "tonglu_annotation"),
            "raw_root": str(p["inputDir"]),
            "annotation_root": str(p.get("annotationDir") or "") or None,
            "hf_lerobot_home": str(p["outputDir"]),
            "robot_type": "custom",
            "fps": 15,
            "chest_image_prefix": prefixes["chest_image_prefix"],
            "top_image_prefix": prefixes["top_image_prefix"],
            "wrist_image_prefix": prefixes["wrist_image_prefix"],
            "task_name": (
                "pick the workpiece from the cardboard box in order and place it in the grid tray"
            ),
            "task_prompt_template": (
                "pick the workpiece from the cardboard box in order and place it in the "
                "{row} row, {column} column of the grid tray"
            ),
            "prompt_from_task": True,
            "normalize_rx_to_2pi": True,
            "gripper_action_source": "next_observation",
            "max_episodes": None,
        },
    }
    out_dir = RUNS_DIR / "convert_cfgs"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"convert_{uuid.uuid4().hex[:10]}.yaml"
    out.write_text(yaml.safe_dump(payload, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return out


def build_argv(step_id: str, params: dict[str, Any]) -> tuple[list[str], Path, str, dict[str, str]]:
    pi05 = Path(str(params.get("_pi05Root") or PI05_ROOT)).expanduser().resolve()
    embody = Path(str(params.get("_embodyRoot") or EMBODY_ROOT)).expanduser().resolve()
    route = normalize_route(str(params.get("_route") or params.get("route") or ROUTE_FULL_FT))
    spec_data = pipeline_spec(str(pi05), None, route)
    spec = {s["id"]: s for s in spec_data["steps"]}
    if step_id not in spec:
        raise ValueError(f"unknown step: {step_id}")
    step = spec[step_id]
    meta_keys = {"stepId", "_pi05Root", "_actRoot", "_embodyRoot", "_route", "route"}
    p = {f["key"]: params.get(f["key"], f.get("default")) for f in step["fields"]}
    p.update({k: v for k, v in params.items() if k not in meta_keys})

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"

    # Step 1: quality filter (same script as ACT)
    if step_id == "quality":
        script = Path(str(p.get("scriptPath") or "")).expanduser()
        if not script.is_file():
            raise FileNotFoundError(f"script not found: {script}")
        cwd = script.parent.parent
        argv = [
            PYTHON, str(script),
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
        if p.get("strict"):
            argv.append(_flag("strict"))
        return argv, cwd, " ".join(argv), env

    # Step 2: convert — explicit dirs; generates data-only YAML (no train recipe)
    if step_id == "convert":
        input_dir = str(p.get("inputDir") or "").strip()
        output_dir = str(p.get("outputDir") or "").strip()
        if not input_dir:
            raise ValueError("inputDir required")
        if not output_dir:
            raise ValueError("outputDir required")
        cfg_path = _write_convert_data_yaml(pi05, p)
        py = env.get("PYTHON_BIN") or env.get("PI05_PYTHON") or "python3"
        venv_py = pi05 / ".venv" / "bin" / "python"
        if venv_py.is_file():
            py = str(venv_py)
        src = pi05 / "src"
        lerobot = pi05 / "lerobot"
        openpi = pi05 / "external" / "openpi" / "src"
        env["PYTHONPATH"] = os.pathsep.join(
            [str(src), str(lerobot), str(openpi), env.get("PYTHONPATH", "")]
        )
        argv = [
            py, "-m", "pi05_jax_sft.convert_company_dataset",
            "--config", str(cfg_path),
            "--raw-root", input_dir,
            "--hf-lerobot-home", output_dir,
            "--stride", str(int(p.get("stride") or 1)),
            "--seed", str(int(p.get("seed") or 42)),
            "--image-writer-threads", str(int(p.get("imageWriterThreads") or 4)),
            "--image-writer-processes", str(int(p.get("imageWriterProcesses") or 2)),
        ]
        ann = str(p.get("annotationDir") or "").strip()
        if ann:
            argv += ["--annotation-root", ann]
        repo = str(p.get("repoId") or "").strip()
        if repo:
            argv += ["--repo-id", repo]
        filt = str(p.get("filterJson") or "").strip()
        if filt:
            argv += ["--filter-json", filt]
        if p.get("dryRun"):
            argv.append("--dry-run")
        if p.get("resume"):
            argv.append("--resume")
        else:
            argv.append("--overwrite")
        return argv, pi05, " ".join(argv), env

    # Step 5: offline infer — explicit ckpt/lerobot/assets/out (no train YAML)
    if step_id in ("infer_batch", "infer_single"):
        ckpt_dir = str(p.get("ckptDir") or "").strip()
        input_dir = str(p.get("inputDir") or "").strip()
        output_dir = str(p.get("outputDir") or "").strip()
        repo_id = str(p.get("repoId") or "").strip()
        assets_base = str(p.get("assetsBaseDir") or "").strip()
        if not ckpt_dir:
            raise ValueError("ckptDir required")
        if not input_dir:
            raise ValueError("inputDir required（LeRobot 数据根）")
        if not repo_id:
            raise ValueError("repoId required")
        if not output_dir:
            raise ValueError("outputDir required")
        py = env.get("PYTHON_BIN") or env.get("PI05_PYTHON") or "python3"
        venv_py = pi05 / ".venv" / "bin" / "python"
        if venv_py.is_file():
            py = str(venv_py)
        src = pi05 / "src"
        lerobot = pi05 / "lerobot"
        openpi = pi05 / "external" / "openpi" / "src"
        env["PYTHONPATH"] = os.pathsep.join(
            [str(src), str(lerobot), str(openpi), env.get("PYTHONPATH", "")]
        )
        argv = [
            py, "-m", "pi05_jax_sft.evaluate_checkpoint",
            "--checkpoint-dir", ckpt_dir,
            "--hf-lerobot-home", input_dir,
            "--repo-id", repo_id,
            "--eval-output-dir", output_dir,
        ]
        if assets_base:
            argv += ["--assets-base-dir", assets_base]
        step_s = str(p.get("checkpointStep") or "").strip()
        if step_s:
            argv += ["--checkpoint-step", step_s]
        if p.get("actionHorizon") not in (None, ""):
            argv += ["--action-horizon", str(int(p.get("actionHorizon") or 10))]
        if p.get("paligemmaVariant"):
            argv += ["--paligemma-variant", str(p["paligemmaVariant"])]
        if p.get("actionExpertVariant"):
            argv += ["--action-expert-variant", str(p["actionExpertVariant"])]
        if step_id == "infer_batch":
            argv += [
                "--sample-start", str(int(p.get("sampleStart") or 0)),
                "--sample-count", str(int(p.get("sampleCount") or 8)),
            ]
        else:
            argv += ["--sample-index", str(int(p.get("sampleIndex") or 0))]
        return argv, pi05, " ".join(argv), env

    # Step 6: embody format conversion
    if step_id in ("embody", "embody_chunk"):
        script = Path(str(p.get("scriptPath") or "")).expanduser()
        if not script.is_file():
            raise FileNotFoundError(f"script not found: {script}")
        cwd = script.parent.parent
        argv = [PYTHON, str(script)]
        infer_json = str(p.get("inferJson") or "").strip()
        raw_dir = str(p.get("rawDir") or "").strip()
        if not raw_dir:
            raise ValueError("rawDir required")
        if step_id == "embody":
            if infer_json:
                argv += [
                    _flag("inferJson"), infer_json,
                    _flag("rawDir"), raw_dir,
                    _flag("output"), str(Path(p["outputDir"]) / "episode.json"),
                ]
            else:
                argv += [
                    _flag("inferDir"), str(p["inferDir"]),
                    _flag("rawDir"), raw_dir,
                    _flag("outputDir"), str(p["outputDir"]),
                    _flag("suite"), str(p["suite"]),
                ]
                limit = int(p.get("limit") or 0)
                if limit > 0:
                    _append_arg(argv, "limit", limit)
                if p.get("refreshIndex"):
                    argv.append(_flag("refreshIndex"))
                    _append_arg(argv, "embodyRoot", p.get("embodyRoot") or embody)
            _append_embody_ik_args(argv, p)
        else:
            if infer_json:
                argv += [
                    _flag("inferJson"), infer_json,
                    _flag("rawDir"), raw_dir,
                    _flag("outputDir"), str(p["outputDir"]),
                ]
            else:
                argv += [
                    _flag("inferDir"), str(p["inferDir"]),
                    _flag("rawDir"), raw_dir,
                    _flag("outputDir"), str(p["outputDir"]),
                    _flag("suite"), str(p["suite"]),
                ]
                limit = int(p.get("limit") or 0)
                if limit > 0:
                    _append_arg(argv, "limit", limit)
                if p.get("refreshIndex"):
                    argv.append(_flag("refreshIndex"))
                    _append_arg(argv, "embodyRoot", p.get("embodyRoot") or embody)
            _append_embody_ik_args(argv, p)
        return argv, cwd, " ".join(argv), env

    # Step 3: norm_stats — explicit LeRobot in / norm_stats.json out (no train YAML)
    if step_id == "norm_stats":
        input_dir = str(p.get("inputDir") or "").strip()
        output_dir = str(p.get("outputDir") or "").strip()
        repo_id = str(p.get("repoId") or "").strip()
        if not input_dir:
            raise ValueError("inputDir required（LeRobot 数据根）")
        if not output_dir:
            raise ValueError("outputDir required（norm_stats.json 所在目录）")
        if not repo_id:
            raise ValueError("repoId required")
        py = env.get("PYTHON_BIN") or env.get("PI05_PYTHON") or "python3"
        venv_py = pi05 / ".venv" / "bin" / "python"
        if venv_py.is_file():
            py = str(venv_py)
        src = pi05 / "src"
        lerobot = pi05 / "lerobot"
        openpi = pi05 / "external" / "openpi" / "src"
        env["PYTHONPATH"] = os.pathsep.join(
            [str(src), str(lerobot), str(openpi), env.get("PYTHONPATH", "")]
        )
        argv = [
            py, "-m", "pi05_jax_sft.compute_norm_stats",
            "--hf-lerobot-home", input_dir,
            "--repo-id", repo_id,
            "--output-dir", output_dir,
        ]
        max_frames = int(p.get("maxFrames") or 0)
        if max_frames > 0:
            argv += ["--max-frames", str(max_frames)]
        return argv, pi05, " ".join(argv), env

    if step_id != "train":
        raise ValueError(step_id)

    # Step 4: train — form hyperparams written to a run YAML (merge from configPath)
    script = Path(str(p.get("scriptPath") or "")).expanduser()
    if not script.is_absolute():
        script = pi05 / script
    if not script.is_file():
        raise FileNotFoundError(f"script not found: {script}")

    config = str(p.get("configPath") or "").strip()
    if not config:
        raise ValueError("configPath required（用于加载/合并训练配方）")
    config_path = Path(config).expanduser()
    if not config_path.is_absolute():
        config_path = pi05 / config_path
    if not config_path.is_file():
        raise FileNotFoundError(f"config not found: {config_path}")

    # Materialize current form hyperparams so UI edits apply even without Save.
    run_cfg_dir = RUNS_DIR / "train_cfgs"
    run_cfg_dir.mkdir(parents=True, exist_ok=True)
    run_cfg = run_cfg_dir / f"train_{uuid.uuid4().hex[:10]}.yaml"
    save_train_yaml(run_cfg, p, pi05, merge_from=config_path)
    config_path = run_cfg

    cwd = pi05
    # Prefer pi05/.venv for JAX (and any script that honors USE_VENV / PYTHON_BIN).
    venv_py = pi05 / ".venv" / "bin" / "python"
    if venv_py.is_file():
        env["USE_VENV"] = "1"
        env.setdefault("PYTHON_BIN", str(venv_py))
        env.setdefault("PI05_PYTHON", str(venv_py))
    env.setdefault("XLA_PYTHON_CLIENT_PREALLOCATE", "false")
    env.setdefault("XLA_PYTHON_CLIENT_ALLOCATOR", "platform")
    env.setdefault("XLA_PYTHON_CLIENT_MEM_FRACTION", "0.92")
    env.setdefault("TOKENIZERS_PARALLELISM", "false")

    if p.get("printOnly"):
        py = env.get("PYTHON_BIN") or env.get("PI05_PYTHON") or "python3"
        if venv_py.is_file():
            py = str(venv_py)
        src = pi05 / "src"
        lerobot = pi05 / "lerobot"
        openpi = pi05 / "external" / "openpi" / "src"
        env["PYTHONPATH"] = os.pathsep.join(
            [str(src), str(lerobot), str(openpi), env.get("PYTHONPATH", "")]
        )
        mod = "pi05_jax_sft.train_pytorch" if route == ROUTE_FULL_FT else "pi05_jax_sft.train"
        argv = [py, "-m", mod, "--config", str(config_path), "--print-only"]
    else:
        argv = [BASH, str(script), str(config_path)]

    return argv, cwd, " ".join(argv), env


def _read_log_tail(path: Path, max_chars: int = 12000) -> str:
    if not path.is_file():
        return ""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    return text[-max_chars:] if len(text) > max_chars else text


def _log_header(job_id: str, cmdline: str, cwd: Path) -> str:
    return f"# pi05_pipeline job {job_id}\n# {cmdline}\n# cwd={cwd}\n\n"


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


def _enrich(job: dict[str, Any]) -> dict[str, Any]:
    out = dict(job)
    log_path = Path(str(job.get("logPath") or ""))
    out["logTail"] = _read_log_tail(log_path)
    return out


def _run_job(job_id: str) -> None:
    with _lock:
        job = _jobs.get(job_id)
    if not job or _is_job_cancelled(job_id):
        return
    log_path = Path(job["logPath"])
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    job["status"] = "running"
    job["startedAt"] = time.time()
    _persist_job(job_id, job)
    try:
        if _is_job_cancelled(job_id):
            return
        argv, cwd, cmdline, env = build_argv(job["stepId"], job["params"])
        job["command"] = cmdline
        job["argv"] = argv
        header = _log_header(job_id, cmdline, cwd)
        with open(log_path, "w", encoding="utf-8") as logf:
            logf.write(header)
            logf.flush()
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
            rc = proc.wait()
        with _lock:
            _procs.pop(job_id, None)
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
        with open(log_path, "a", encoding="utf-8") as logf:
            logf.write(f"\n[runner] {exc}\n")
        with _lock:
            _procs.pop(job_id, None)
    _persist_job(job_id, job)


def start_job(
    step_id: str,
    params: dict[str, Any] | None = None,
    pi05_root: str | None = None,
    act_root: str | None = None,
    route: str | None = None,
) -> dict[str, Any]:
    _load_jobs()
    merged = dict(params or {})
    if pi05_root:
        merged["_pi05Root"] = pi05_root
    if act_root:
        merged["_actRoot"] = act_root
    route_n = normalize_route(route or merged.get("_route") or merged.get("route"))
    merged["_route"] = route_n
    # Validate roots early
    pipeline_spec(pi05_root, act_root, route_n)
    job_id = uuid.uuid4().hex[:12]
    log_path = RUNS_DIR / f"{job_id}.log"
    job = {
        "id": job_id,
        "stepId": step_id,
        "params": merged,
        "status": "queued",
        "createdAt": time.time(),
        "logPath": str(log_path),
        "route": route_n,
    }
    _persist_job(job_id, job)
    threading.Thread(target=_run_job, args=(job_id,), daemon=True).start()
    return _enrich(job)


def list_jobs() -> list[dict[str, Any]]:
    _load_jobs()
    with _lock:
        jobs = list(_jobs.values())
    jobs.sort(key=lambda j: float(j.get("createdAt") or 0), reverse=True)
    return [_enrich(j) for j in jobs[:80]]


def get_job(job_id: str) -> dict[str, Any] | None:
    _load_jobs()
    with _lock:
        job = _jobs.get(job_id)
    return _enrich(job) if job else None


def cancel_job(job_id: str) -> dict[str, Any] | None:
    _load_jobs()
    with _lock:
        job = _jobs.get(job_id)
    if not job:
        return None
    if job.get("status") in ("succeeded", "failed", "cancelled"):
        return _enrich(job)
    job["status"] = "cancelled"
    job["finishedAt"] = time.time()
    _persist_job(job_id, job)
    _kill_job_process(job_id)
    return _enrich(job)


def delete_job(job_id: str) -> bool:
    _load_jobs()
    with _lock:
        job = _jobs.pop(job_id, None)
        _procs.pop(job_id, None)
    if not job:
        return False
    for key in ("logPath",):
        p = Path(str(job.get(key) or ""))
        if p.is_file():
            try:
                p.unlink()
            except OSError:
                pass
    jp = _job_path(job_id)
    if jp.is_file():
        try:
            jp.unlink()
        except OSError:
            pass
    return True
