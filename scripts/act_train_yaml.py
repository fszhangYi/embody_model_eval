"""ACT train recipe YAML ↔ pipeline form params (load / save / run snapshot).

train.py still takes CLI flags; the YAML is a UI recipe for hyperparams.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

# (form_key, yaml_key, field_type)
# field_type: text | number | checkbox | select | path
TRAIN_PARAM_FIELDS: list[tuple[str, str, str]] = [
    ("dataDir", "data_dir", "path"),
    ("ckptDir", "ckpt_dir", "path"),
    ("actionSpace", "action_space", "select"),
    ("cameraNames", "camera_names", "cameras"),
    ("chunkSize", "chunk_size", "number"),
    ("numEpochs", "num_epochs", "number"),
    ("batchSize", "batch_size", "number"),
    ("numWorkers", "num_workers", "number"),
    ("hdf5CacheSize", "hdf5_cache_size", "number"),
    ("lr", "lr", "number"),
    ("klWeight", "kl_weight", "number"),
    ("hiddenDim", "hidden_dim", "number"),
    ("dimFeedforward", "dim_feedforward", "number"),
    ("encLayers", "enc_layers", "number"),
    ("decLayers", "dec_layers", "number"),
    ("nheads", "nheads", "number"),
    ("seed", "seed", "number"),
    ("useSam2Features", "use_sam2_features", "checkbox"),
    ("actionRepr", "action_repr", "select"),
    ("poolSize", "pool_size", "number"),
    ("useCvae", "use_cvae", "checkbox"),
    ("cumulativeLossWeight", "cumulative_loss_weight", "number"),
    ("gradClip", "grad_clip", "number"),
    ("cosineLr", "cosine_lr", "checkbox"),
    ("minLr", "min_lr", "number"),
    ("resumeFrom", "resume_from", "path"),
    ("earlyStopPatience", "early_stop_patience", "number"),
    ("earlyStopThreshold", "early_stop_threshold", "number"),
]

_META_KEYS = {
    "scriptPath",
    "configPath",
    "savePath",
}


def _coerce_form_value(ftype: str, raw: Any, *, default: Any = None) -> Any:
    if ftype == "checkbox":
        if isinstance(raw, str):
            return raw.strip().lower() in ("1", "true", "yes", "on")
        return bool(raw)
    if ftype == "cameras":
        if isinstance(raw, list):
            return " ".join(str(x) for x in raw)
        return "" if raw is None else str(raw)
    if ftype == "number":
        if raw is None or raw == "":
            return 0 if default is None else default
        try:
            v = float(raw)
            return int(v) if float(v).is_integer() else v
        except (TypeError, ValueError):
            return 0 if default is None else default
    return "" if raw is None else str(raw)


def _yaml_value_from_form(ftype: str, raw: Any) -> Any:
    if ftype == "checkbox":
        if isinstance(raw, str):
            return raw.strip().lower() in ("1", "true", "yes", "on")
        return bool(raw)
    if ftype == "cameras":
        s = "" if raw is None else str(raw).strip()
        return s.split() if s else []
    if ftype == "number":
        if raw is None or raw == "":
            return 0
        v = float(raw)
        return int(v) if v.is_integer() else v
    if raw is None or raw == "":
        return None
    return str(raw)


def flatten_train_yaml(data: dict[str, Any] | None) -> dict[str, Any]:
    """YAML document → flat form params (only known train keys)."""
    data = data or {}
    # Support nested {train: {...}} or flat root.
    block = data.get("train") if isinstance(data.get("train"), dict) else data
    if not isinstance(block, dict):
        block = {}
    out: dict[str, Any] = {}
    for key, ykey, ftype in TRAIN_PARAM_FIELDS:
        raw = block.get(ykey, block.get(key))
        out[key] = _coerce_form_value(ftype, raw)
    return out


def merge_train_yaml(base: dict[str, Any] | None, params: dict[str, Any]) -> dict[str, Any]:
    """Merge form hyperparams into a flat recipe YAML (preserve unknown keys)."""
    doc: dict[str, Any] = {}
    if isinstance(base, dict):
        # Prefer flat recipes; if base used nested train:, keep other top-level keys
        # and write params flat at root for simplicity going forward.
        if isinstance(base.get("train"), dict) and len(base) == 1:
            doc = dict(base["train"])
        else:
            for k, v in base.items():
                if k == "train" and isinstance(v, dict):
                    continue
                doc[k] = dict(v) if isinstance(v, dict) else v
            if isinstance(base.get("train"), dict):
                for k, v in base["train"].items():
                    doc.setdefault(k, v)

    for key, ykey, ftype in TRAIN_PARAM_FIELDS:
        if key in _META_KEYS:
            continue
        if key in params:
            doc[ykey] = _yaml_value_from_form(ftype, params[key])
    return doc


def load_train_yaml(path: str | Path, act_root: str | Path | None = None) -> dict[str, Any]:
    root = Path(act_root).expanduser().resolve() if act_root else None
    p = Path(path).expanduser()
    if not p.is_absolute() and root is not None:
        p = root / p
    p = p.resolve()
    if not p.is_file():
        raise FileNotFoundError(str(p))
    data = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise ValueError(f"YAML root must be a mapping: {p}")
    return {
        "ok": True,
        "path": str(p),
        "yaml": data,
        "params": flatten_train_yaml(data),
    }


def save_train_yaml(
    path: str | Path,
    params: dict[str, Any],
    act_root: str | Path | None = None,
    *,
    merge_from: str | Path | None = None,
) -> dict[str, Any]:
    root = Path(act_root).expanduser().resolve() if act_root else None
    out = Path(path).expanduser()
    if not out.is_absolute() and root is not None:
        out = root / out
    out = out.resolve()

    base: dict[str, Any] | None = None
    src = Path(merge_from).expanduser() if merge_from else None
    if src is not None:
        if not src.is_absolute() and root is not None:
            src = root / src
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
