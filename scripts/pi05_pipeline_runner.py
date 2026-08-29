"""pi0.5 pipeline: convert → norm_stats → train → eval → serve.

Primary route: Tonglu PyTorch full FT (mlu_full_ft*). Secondary: JAX LoRA smoke.
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
RUNS_DIR = ROOT / "agent_skills" / ".run" / "pi05_pipeline"
PI05_ROOT = Path(os.environ.get("PI05_ROOT", "/root/autodl-tmp/pi05"))
ACT_ROBOT_ROOT = Path(os.environ.get("ACT_ROBOT_ROOT", "/root/autodl-tmp/act_robot"))
BASH = os.environ.get("PI05_PIPELINE_BASH", "/bin/bash")

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


def _default_paths(pi05: Path | None = None, act: Path | None = None, route: str = ROUTE_FULL_FT) -> dict[str, str]:
    pi05 = pi05 or PI05_ROOT
    act = act or ACT_ROBOT_ROOT
    route = normalize_route(route)
    smoke = str(pi05 / "configs" / "pi05_act_robot_smoke.yaml")
    full_ft = str(pi05 / "configs" / "pi05_tonglu0630_full_ft_two_view.yaml")
    train_full = str(pi05 / "scripts" / "train_tonglu_full_ft.sh")
    train_jax8 = str(pi05 / "scripts" / "train_8gpu.sh")
    train_jax2 = str(pi05 / "scripts" / "train_2gpu.sh")
    base_pytorch = str(pi05 / "checkpoints" / "pi05_base_pytorch")
    base_jax = str(pi05 / "checkpoints" / "pi0.5_base" / "params")
    docs_full = str(pi05 / "docs" / "tonglu_mlu_full_ft_reproduce.md")
    return {
        "pi05Root": str(pi05),
        "actRobotRoot": str(act),
        "route": route,
        "smokeConfig": smoke,
        "fullFtConfig": full_ft,
        "fullConfig": str(pi05 / "configs" / "pi05_act_robot_local.yaml"),
        "rawDir": str(act / "data" / "raw"),
        "annotationDir": str(act / "data" / "annotation" / "annotation" / "restored_txt"),
        "lerobotHome": str(pi05 / "data" / "lerobot"),
        "assetsDir": str(pi05 / "artifacts" / "assets"),
        "ckptBaseDir": str(pi05 / "artifacts" / "checkpoints"),
        "evalDir": str(pi05 / "artifacts" / "eval"),
        "baseCkpt": base_pytorch if route == ROUTE_FULL_FT else base_jax,
        "baseCkptPytorch": base_pytorch,
        "baseCkptJax": base_jax,
        "prepareScript": str(pi05 / "scripts" / "prepare_dataset.sh"),
        "normScript": str(pi05 / "scripts" / "compute_norm_stats.sh"),
        "trainScript": train_full if route == ROUTE_FULL_FT else train_jax8,
        "trainFullFtScript": train_full,
        "trainScriptJax8": train_jax8,
        "train2Script": train_jax2,
        "evalScript": str(pi05 / "scripts" / "evaluate_checkpoint.sh"),
        "serveScript": str(pi05 / "scripts" / "serve.sh"),
        "docsInstall": str(pi05 / "docs" / "installation.md"),
        "docsIssues": str(pi05 / "docs" / "issues.md"),
        "docsFullFt": docs_full,
    }


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
    pi05 = _resolve_dir(pi05_root) if pi05_root else PI05_ROOT
    act = _resolve_dir(act_root) if act_root else ACT_ROBOT_ROOT
    route = normalize_route(route)
    paths = _default_paths(pi05, act, route)
    configs = _config_options(pi05)

    if route == ROUTE_FULL_FT:
        preferred = paths["fullFtConfig"]
        train_options = [paths["trainFullFtScript"]]
        train_title = "训练 π0.5（PyTorch 全参）"
        train_subtitle = "train_tonglu_full_ft.sh / torchrun"
        train_desc = (
            "Tonglu mlu_full_ft*：gemma_2b + gemma_300m 双全参，全局 batch=256，"
            "默认 8 卡 torchrun。缺 pi05_base_pytorch 或 GPU<8 时 preflight 失败。"
        )
        default_cfg = preferred if Path(preferred).is_file() else (
            paths["smokeConfig"] if Path(paths["smokeConfig"]).is_file() else (configs[0] if configs else "")
        )
    else:
        train_options = [paths["trainScriptJax8"], paths["train2Script"]]
        train_title = "训练 π0.5（JAX LoRA 冒烟）"
        train_subtitle = "train_*.sh / pi05_jax_sft.train"
        train_desc = "JAX + FSDP；单卡 32GB 请用双 LoRA + 小 batch（smoke 配置）。"
        default_cfg = (
            paths["smokeConfig"]
            if Path(paths["smokeConfig"]).is_file()
            else (configs[0] if configs else "")
        )

    def cfg_field(default: str) -> dict[str, Any]:
        return {
            "key": "configPath",
            "label": "YAML 配置",
            "type": "select" if configs else "path",
            "pathKind": "file",
            "browseRoot": "pi05",
            "io": "input",
            "default": default,
            "options": configs or None,
        }

    steps = [
        {
            "id": "convert",
            "step": 1,
            "title": "转 LeRobot",
            "subtitle": "prepare_dataset.sh",
            "description": "将 raw + annotation 转为 LeRobot。全参主线用 Tonglu YAML。",
            "outputs": [],
            "fields": [
                {
                    "key": "scriptPath",
                    "label": "脚本",
                    "type": "path",
                    "pathKind": "file",
                    "browseRoot": "pi05",
                    "io": "config",
                    "default": paths["prepareScript"],
                    "hint": "prepare_dataset.sh",
                },
                cfg_field(default_cfg),
                {"key": "dryRun", "label": "dry-run（只扫描不写）", "type": "checkbox", "io": "config", "default": False},
                {"key": "resume", "label": "resume（断点续转）", "type": "checkbox", "io": "config", "default": True},
                {"key": "imageWriterThreads", "label": "image-writer-threads", "type": "number", "io": "config", "default": 4},
                {"key": "imageWriterProcesses", "label": "image-writer-processes", "type": "number", "io": "config", "default": 2},
            ],
        },
        {
            "id": "norm_stats",
            "step": 2,
            "title": "计算 norm_stats",
            "subtitle": "compute_norm_stats.sh",
            "description": "在 LeRobot 数据集上统计归一化参数；训练前必须完成。",
            "outputs": [],
            "fields": [
                {
                    "key": "scriptPath",
                    "label": "脚本",
                    "type": "path",
                    "pathKind": "file",
                    "browseRoot": "pi05",
                    "io": "config",
                    "default": paths["normScript"],
                    "hint": "compute_norm_stats.sh",
                },
                cfg_field(default_cfg),
            ],
        },
        {
            "id": "train",
            "step": 3,
            "title": train_title,
            "subtitle": train_subtitle,
            "description": train_desc,
            "outputs": [],
            "fields": [
                {
                    "key": "scriptPath",
                    "label": "启动脚本",
                    "type": "select",
                    "io": "config",
                    "default": paths["trainScript"],
                    "options": train_options,
                },
                cfg_field(default_cfg),
                {"key": "printOnly", "label": "print-only（预检 TrainConfig）", "type": "checkbox", "io": "config", "default": False},
            ],
        },
        {
            "id": "eval",
            "step": 4,
            "title": "离线评测",
            "subtitle": "evaluate_checkpoint.sh",
            "description": "对指定 step 的 checkpoint 跑离线样本评测，结果写入 artifacts/eval。",
            "outputs": [],
            "fields": [
                {
                    "key": "scriptPath",
                    "label": "脚本",
                    "type": "path",
                    "pathKind": "file",
                    "browseRoot": "pi05",
                    "io": "config",
                    "default": paths["evalScript"],
                    "hint": "evaluate_checkpoint.sh",
                },
                cfg_field(default_cfg),
                {"key": "checkpointStep", "label": "checkpoint step（空=最新）", "type": "text", "io": "config", "default": ""},
                {"key": "sampleIndex", "label": "sample-index", "type": "number", "io": "config", "default": 0},
            ],
        },
        {
            "id": "serve",
            "step": 5,
            "title": "推理服务",
            "subtitle": "serve.sh",
            "description": "TCP 推理服务；全参主线默认对接 Tonglu MLU serve 配置。",
            "outputs": [],
            "fields": [
                {
                    "key": "scriptPath",
                    "label": "脚本",
                    "type": "path",
                    "pathKind": "file",
                    "browseRoot": "pi05",
                    "io": "config",
                    "default": paths["serveScript"],
                    "hint": "serve.sh",
                },
                cfg_field(default_cfg),
                {"key": "checkpointStep", "label": "checkpoint step（空=最新）", "type": "text", "io": "config", "default": ""},
                {"key": "port", "label": "PORT", "type": "number", "io": "config", "default": 5000},
                {
                    "key": "imageProtocol",
                    "label": "IMAGE_PROTOCOL",
                    "type": "select",
                    "io": "config",
                    "default": "three-view",
                    "options": ["legacy", "three-view"],
                },
                {"key": "temporalAgg", "label": "TEMPORAL_AGG", "type": "checkbox", "io": "config", "default": False},
                {"key": "taskPrompt", "label": "TASK_PROMPT（可选覆盖）", "type": "text", "io": "config", "default": ""},
            ],
        },
    ]

    pytorch_weights = Path(paths["baseCkptPytorch"]) / "model.safetensors"
    gpu_count = _count_gpus()
    checks = {
        "pi05Root": str(pi05),
        "pi05Exists": pi05.is_dir(),
        "actRobotRoot": str(act),
        "actRobotExists": act.is_dir(),
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
            {"id": ROUTE_FULL_FT, "label": "Tonglu 全参", "primary": True, "backend": "pytorch", "defaultConfig": paths["fullFtConfig"]},
            {"id": ROUTE_SMOKE_LORA, "label": "LoRA 冒烟", "primary": False, "backend": "jax", "defaultConfig": paths["smokeConfig"]},
        ],
        "paths": paths,
        "steps": steps,
        "checks": checks,
        "browseRoots": {"pi05": str(pi05), "act": str(act)},
        "configs": configs,
    }



def build_argv(step_id: str, params: dict[str, Any]) -> tuple[list[str], Path, str, dict[str, str]]:
    pi05 = Path(str(params.get("_pi05Root") or PI05_ROOT)).expanduser().resolve()
    act = Path(str(params.get("_actRoot") or ACT_ROBOT_ROOT)).expanduser().resolve()
    route = normalize_route(str(params.get("_route") or params.get("route") or ROUTE_FULL_FT))
    spec_data = pipeline_spec(str(pi05), str(act), route)
    spec = {s["id"]: s for s in spec_data["steps"]}
    if step_id not in spec:
        raise ValueError(f"unknown step: {step_id}")
    step = spec[step_id]
    meta_keys = {"stepId", "_pi05Root", "_actRoot", "_route", "route"}
    p = {f["key"]: params.get(f["key"], f.get("default")) for f in step["fields"]}
    p.update({k: v for k, v in params.items() if k not in meta_keys})

    script = Path(str(p.get("scriptPath") or "")).expanduser()
    if not script.is_absolute():
        script = pi05 / script
    if not script.is_file():
        raise FileNotFoundError(f"script not found: {script}")

    config = str(p.get("configPath") or "").strip()
    if not config:
        raise ValueError("configPath required")
    config_path = Path(config).expanduser()
    if not config_path.is_absolute():
        config_path = pi05 / config_path
    if not config_path.is_file():
        raise FileNotFoundError(f"config not found: {config_path}")

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    cwd = pi05

    if step_id == "convert":
        env["DRY_RUN"] = "1" if p.get("dryRun") else "0"
        env["RESUME"] = "1" if p.get("resume") else "0"
        env["IMAGE_WRITER_THREADS"] = str(int(p.get("imageWriterThreads") or 4))
        env["IMAGE_WRITER_PROCESSES"] = str(int(p.get("imageWriterProcesses") or 2))
        argv = [BASH, str(script), str(config_path)]
    elif step_id == "norm_stats":
        argv = [BASH, str(script), str(config_path)]
    elif step_id == "train":
        if p.get("printOnly"):
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
            mod = "pi05_jax_sft.train_pytorch" if route == ROUTE_FULL_FT else "pi05_jax_sft.train"
            argv = [py, "-m", mod, "--config", str(config_path), "--print-only"]
        else:
            argv = [BASH, str(script), str(config_path)]
    elif step_id == "eval":
        env["SAMPLE_INDEX"] = str(int(p.get("sampleIndex") or 0))
        argv = [BASH, str(script), str(config_path)]
        step_s = str(p.get("checkpointStep") or "").strip()
        if step_s:
            argv.append(step_s)
    elif step_id == "serve":
        env["PORT"] = str(int(p.get("port") or 5000))
        env["IMAGE_PROTOCOL"] = str(p.get("imageProtocol") or "three-view")
        env["TEMPORAL_AGG"] = "1" if p.get("temporalAgg") else "0"
        prompt = str(p.get("taskPrompt") or "").strip()
        if prompt:
            env["TASK_PROMPT"] = prompt
        argv = [BASH, str(script), str(config_path)]
        step_s = str(p.get("checkpointStep") or "").strip()
        if step_s:
            argv.append(step_s)
    else:
        raise ValueError(step_id)

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
