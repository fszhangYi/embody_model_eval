"""π0.5 train YAML ↔ pipeline form params (load / save / run overlay)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

# (form_key, yaml_section, yaml_key, field_type, label, default)
# field_type: text | number | checkbox | select | path | nullable_number
TRAIN_HP_FIELDS: list[tuple[str, str, str, str, str, Any]] = [
    ("projectName", "project", "name", "text", "project.name", "pi05_tonglu0630_mlu"),
    ("expName", "project", "exp_name", "text", "project.exp_name", "mlu_full_ft_two_view"),
    ("wandbProject", "project", "project_name", "text", "project.project_name", "pi05-tonglu0630"),
    ("repoId", "data", "repo_id", "text", "data.repo_id", "company/tonglu0630_two_view_terminated"),
    ("hfLerobotHome", "data", "hf_lerobot_home", "path", "data.hf_lerobot_home", "./data/lerobot"),
    ("actionHorizon", "model", "action_horizon", "number", "model.action_horizon", 10),
    ("maxTokenLen", "model", "max_token_len", "number", "model.max_token_len", 200),
    ("discreteStateInput", "model", "discrete_state_input", "checkbox", "model.discrete_state_input", True),
    ("paligemmaVariant", "model", "paligemma_variant", "select", "model.paligemma_variant", "gemma_2b"),
    ("actionExpertVariant", "model", "action_expert_variant", "select", "model.action_expert_variant", "gemma_300m"),
    ("rtcSimulatedDelay", "model", "rtc_simulated_delay", "nullable_number", "model.rtc_simulated_delay", ""),
    ("seed", "training", "seed", "number", "training.seed", 42),
    ("batchSize", "training", "batch_size", "number", "training.batch_size", 256),
    ("fsdpDevices", "training", "fsdp_devices", "number", "training.fsdp_devices", 8),
    ("numWorkers", "training", "num_workers", "number", "training.num_workers", 8),
    ("numTrainSteps", "training", "num_train_steps", "number", "training.num_train_steps", 16000),
    ("logInterval", "training", "log_interval", "number", "training.log_interval", 100),
    ("saveInterval", "training", "save_interval", "number", "training.save_interval", 2000),
    ("keepPeriod", "training", "keep_period", "number", "training.keep_period", 10000),
    ("peakLr", "training", "peak_lr", "number", "training.peak_lr", 5.0e-5),
    ("decayLr", "training", "decay_lr", "number", "training.decay_lr", 5.0e-5),
    ("warmupSteps", "training", "warmup_steps", "number", "training.warmup_steps", 500),
    ("decaySteps", "training", "decay_steps", "number", "training.decay_steps", 20000),
    ("emaDecay", "training", "ema_decay", "nullable_number", "training.ema_decay", ""),
    ("clipGradientNorm", "training", "clip_gradient_norm", "number", "training.clip_gradient_norm", 1.0),
    ("wandbEnabled", "training", "wandb_enabled", "checkbox", "training.wandb_enabled", False),
    ("trainOverwrite", "training", "overwrite", "checkbox", "training.overwrite", False),
    ("trainResume", "training", "resume", "checkbox", "training.resume", False),
    ("assetsBaseDir", "paths", "assets_base_dir", "path", "paths.assets_base_dir", "./artifacts/assets"),
    ("checkpointBaseDir", "paths", "checkpoint_base_dir", "path", "paths.checkpoint_base_dir", "./artifacts/checkpoints"),
    ("baseCheckpointPath", "paths", "base_checkpoint_path", "path", "paths.base_checkpoint_path", "./checkpoints/pi05_base_pytorch"),
    ("evalOutputDir", "paths", "eval_output_dir", "path", "paths.eval_output_dir", "./artifacts/eval"),
]

_SELECT_OPTIONS: dict[str, list[str]] = {
    "paligemmaVariant": ["gemma_2b", "gemma_2b_lora", "dummy"],
    "actionExpertVariant": ["gemma_300m", "gemma_300m_lora", "dummy"],
}

_META_KEYS = {
    "scriptPath",
    "configPath",
    "savePath",
    "printOnly",
}


def train_hp_form_fields(browse_root: str = "pi05") -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for key, _sec, _yk, ftype, label, default in TRAIN_HP_FIELDS:
        field: dict[str, Any] = {
            "key": key,
            "label": label,
            "type": "number" if ftype == "nullable_number" else ftype,
            "io": "config",
            "default": default if default is not None else "",
        }
        if ftype in ("path",):
            field["pathKind"] = "dir" if "dir" in key.lower() or key.endswith("Dir") or key.endswith("Home") else "file"
            # base checkpoint is usually a dir
            if key == "baseCheckpointPath":
                field["pathKind"] = "dir"
            field["browseRoot"] = browse_root
        if ftype == "select":
            field["options"] = _SELECT_OPTIONS.get(key, [])
        out.append(field)
    return out


def _coerce_form_value(ftype: str, raw: Any) -> Any:
    if ftype == "checkbox":
        return bool(raw) if not isinstance(raw, str) else raw.strip().lower() in ("1", "true", "yes", "on")
    if ftype == "nullable_number":
        if raw is None:
            return ""
        if isinstance(raw, str) and not raw.strip():
            return ""
        if raw == "":
            return ""
        try:
            v = float(raw)
            return int(v) if v.is_integer() else v
        except (TypeError, ValueError):
            return ""
    if ftype == "number":
        if raw is None or raw == "":
            return 0
        try:
            v = float(raw)
            return int(v) if float(v).is_integer() else v
        except (TypeError, ValueError):
            return 0
    return "" if raw is None else str(raw)


def flatten_train_yaml(data: dict[str, Any] | None) -> dict[str, Any]:
    data = data or {}
    out: dict[str, Any] = {}
    for key, section, ykey, ftype, _label, default in TRAIN_HP_FIELDS:
        block = data.get(section) if isinstance(data.get(section), dict) else {}
        raw = block.get(ykey, default) if isinstance(block, dict) else default
        if raw is None and ftype == "nullable_number":
            out[key] = ""
        elif ftype == "checkbox":
            out[key] = bool(raw)
        elif ftype == "number":
            out[key] = _coerce_form_value("number", raw if raw is not None else default)
        elif ftype == "nullable_number":
            out[key] = "" if raw is None else _coerce_form_value("nullable_number", raw)
        else:
            out[key] = "" if raw is None else str(raw)
    return out


def _yaml_value_from_form(ftype: str, raw: Any) -> Any:
    if ftype == "checkbox":
        return bool(raw) if not isinstance(raw, str) else raw.strip().lower() in ("1", "true", "yes", "on")
    if ftype == "nullable_number":
        if raw is None or (isinstance(raw, str) and not raw.strip()):
            return None
        v = float(raw)
        return int(v) if v.is_integer() else v
    if ftype == "number":
        v = float(raw)
        return int(v) if v.is_integer() else v
    return None if raw is None or raw == "" else str(raw)


def merge_train_yaml(base: dict[str, Any] | None, params: dict[str, Any]) -> dict[str, Any]:
    """Merge form hyperparams into YAML document (preserve unrelated keys)."""
    doc: dict[str, Any] = {}
    if isinstance(base, dict):
        for k, v in base.items():
            if isinstance(v, dict):
                doc[k] = dict(v)
            else:
                doc[k] = v
    for key, section, ykey, ftype, _label, _default in TRAIN_HP_FIELDS:
        if key not in params and key in _META_KEYS:
            continue
        if section not in doc or not isinstance(doc.get(section), dict):
            doc[section] = {} if section not in doc else doc[section]
            if not isinstance(doc[section], dict):
                doc[section] = {}
        if key in params:
            doc[section][ykey] = _yaml_value_from_form(ftype, params[key])
    return doc


def load_train_yaml(path: str | Path, pi05_root: str | Path | None = None) -> dict[str, Any]:
    pi05 = Path(pi05_root).expanduser().resolve() if pi05_root else None
    p = Path(path).expanduser()
    if not p.is_absolute() and pi05 is not None:
        p = pi05 / p
    p = p.resolve()
    if not p.is_file():
        raise FileNotFoundError(str(p))
    data = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise ValueError(f"YAML root must be a mapping: {p}")
    flat = flatten_train_yaml(data)
    return {
        "ok": True,
        "path": str(p),
        "yaml": data,
        "params": flat,
    }


def save_train_yaml(
    path: str | Path,
    params: dict[str, Any],
    pi05_root: str | Path | None = None,
    *,
    merge_from: str | Path | None = None,
) -> dict[str, Any]:
    pi05 = Path(pi05_root).expanduser().resolve() if pi05_root else None
    out = Path(path).expanduser()
    if not out.is_absolute() and pi05 is not None:
        out = pi05 / out
    out = out.resolve()

    base: dict[str, Any] | None = None
    src = Path(merge_from).expanduser() if merge_from else None
    if src is not None:
        if not src.is_absolute() and pi05 is not None:
            src = pi05 / src
        src = src.resolve()
        if src.is_file():
            loaded = yaml.safe_load(src.read_text(encoding="utf-8")) or {}
            if isinstance(loaded, dict):
                base = loaded
    elif out.is_file():
        loaded = yaml.safe_load(out.read_text(encoding="utf-8")) or {}
        if isinstance(loaded, dict):
            base = loaded

    doc = merge_train_yaml(base, params)
    out.parent.mkdir(parents=True, exist_ok=True)
    text = yaml.safe_dump(doc, allow_unicode=True, sort_keys=False)
    out.write_text(text, encoding="utf-8")
    return {"ok": True, "path": str(out), "bytes": len(text.encode("utf-8")), "yaml": doc}
