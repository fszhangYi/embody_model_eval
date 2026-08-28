"""Parse and compare ACT checkpoint artifacts.

JSON / pickle artifacts load without PyTorch. optimizer.pt and policy_best.ckpt
require torch and a CUDA-capable environment for the GPU analysis workflow.
"""

from __future__ import annotations

import json
import pickle
import re
from pathlib import Path
from typing import Any

from act_pipeline_runner import ACT_ROBOT_ROOT, EMBODY_ROOT

ARTIFACT_FILES: dict[str, str] = {
    "dataset_stats": "dataset_stats.pkl",
    "policy_config": "policy_config.json",
    "train_history": "train_history.json",
}

GPU_ARTIFACT_FILES: dict[str, str] = {
    "optimizer": "optimizer.pt",
    "policy_best": "policy_best.ckpt",
}

ALL_ARTIFACT_FILES = {**ARTIFACT_FILES, **GPU_ARTIFACT_FILES}

ALLOWED_ROOTS = [
    ACT_ROBOT_ROOT.resolve(),
    EMBODY_ROOT.resolve(),
    Path("/root/autodl-tmp").resolve(),
]

STATS_VECTOR_KEYS = (
    "action_mean",
    "action_std",
    "qpos_mean",
    "qpos_std",
    "delta_mean",
    "delta_std",
)
STATS_SCALAR_KEYS = ("state_dim", "max_episode_len", "chunk_size_for_delta")
EPISODE_SCALAR_KEYS = ("train_episodes", "val_episodes", "total_episodes")

_DATASET_LINE_RE = re.compile(
    r"Dataset:\s*(\d+)\s*episodes\s*\|\s*train=(\d+)\s*val=(\d+)",
    re.IGNORECASE,
)
_DATA_DIR_RE = re.compile(r"--data-dir\s+(\S+)")

DIM_LABELS_CART = ["x", "y", "z", "rx", "ry", "rz", "gripper"]
DIM_LABELS_JOINT = [f"J{i + 1}" for i in range(16)]

CONFIG_GROUPS: dict[str, tuple[str, ...]] = {
    "training": ("lr", "lr_backbone", "batch_size", "num_epochs", "seed", "kl_weight"),
    "model": (
        "hidden_dim",
        "dim_feedforward",
        "enc_layers",
        "dec_layers",
        "nheads",
        "backbone",
        "num_queries",
        "chunk_size",
        "state_dim",
        "use_sam2_features",
        "use_cvae",
        "action_repr",
    ),
    "data": ("action_space", "rx_unwrapped", "camera_names", "hdf5_cache_size", "num_workers"),
}


def _infer_dim_labels(runs: list[dict[str, Any]], dim_count: int) -> list[str]:
    action_space = None
    for run in runs:
        cfg_art = run["artifacts"].get("policy_config") or {}
        if cfg_art.get("ok"):
            action_space = (cfg_art.get("data") or {}).get("action_space")
            if action_space:
                break
    base = DIM_LABELS_CART if str(action_space or "").startswith("cart") else DIM_LABELS_JOINT
    return [base[i] if i < len(base) else f"d{i}" for i in range(dim_count)]


def _pct_from_baseline(values: list[float | None]) -> list[float | None]:
    if not values or values[0] is None:
        return [None] * len(values)
    base = values[0]
    if base == 0:
        return [0.0 if v == 0 else None for v in values]
    out: list[float | None] = []
    for v in values:
        if v is None:
            out.append(None)
        else:
            out.append((v - base) / abs(base) * 100.0)
    return out


def _is_under(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def validate_ckpt_dir(path: str) -> Path:
    target = Path(path).expanduser().resolve()
    if not target.is_dir():
        raise ValueError(f"not a directory: {path}")
    if not any(_is_under(target, root) for root in ALLOWED_ROOTS):
        raise PermissionError(f"path outside allowed roots: {path}")
    return target


def _serialize_value(value: Any) -> Any:
    if hasattr(value, "tolist"):
        return value.tolist()
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, dict):
        return {str(k): _serialize_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_serialize_value(v) for v in value]
    return str(value)


def _serialize_stats(raw: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in raw.items():
        if key == "example_qpos" and hasattr(value, "shape"):
            rows = value.tolist()
            out[key] = {
                "shape": list(value.shape),
                "preview": rows[:8],
            }
            continue
        out[key] = _serialize_value(value)
    return out


def _load_artifact(path: Path, artifact_key: str) -> dict[str, Any]:
    filename = ARTIFACT_FILES[artifact_key]
    fp = path / filename
    if not fp.is_file():
        return {"ok": False, "error": "missing", "filename": filename}
    try:
        if filename.endswith(".pkl"):
            with fp.open("rb") as f:
                data = _serialize_stats(pickle.load(f))
        else:
            with fp.open(encoding="utf-8") as f:
                data = json.load(f)
        return {
            "ok": True,
            "filename": filename,
            "sizeBytes": fp.stat().st_size,
            "data": data,
        }
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "filename": filename, "error": str(e)}


def _run_label(path: Path) -> str:
    return path.name or str(path)


def _empty_dataset_meta() -> dict[str, Any]:
    return {
        "trainEpisodes": None,
        "valEpisodes": None,
        "totalEpisodes": None,
        "source": None,
        "sourcePath": None,
        "dataDir": None,
    }


def _dataset_meta_payload(
    *,
    train: int | None,
    val: int | None,
    total: int | None,
    source: str,
    source_path: str | None = None,
    data_dir: str | None = None,
) -> dict[str, Any]:
    out = _empty_dataset_meta()
    out["trainEpisodes"] = train
    out["valEpisodes"] = val
    out["totalEpisodes"] = total if total is not None else (
        (train + val) if train is not None and val is not None else None
    )
    out["source"] = source
    out["sourcePath"] = source_path
    out["dataDir"] = data_dir
    return out


def _dataset_meta_from_stats(stats: dict[str, Any]) -> dict[str, Any] | None:
    train = stats.get("num_train_episodes")
    if train is None:
        train = stats.get("num_train")
    if train is None:
        train = stats.get("train_episodes")
    if not isinstance(train, int):
        return None
    val = stats.get("num_val_episodes")
    if val is None:
        val = stats.get("num_val")
    if val is None:
        val = stats.get("val_episodes")
    total = stats.get("num_total_episodes")
    if total is None:
        total = stats.get("num_total")
    if not isinstance(val, int):
        val = None
    if not isinstance(total, int):
        total = None
    return _dataset_meta_payload(
        train=train,
        val=val,
        total=total,
        source="dataset_stats",
    )


def _dataset_info_candidates(ckpt_dir: Path) -> list[Path]:
    names = ("", "hdf5", "data", "dataset", "episodes", "converted")
    candidates: list[Path] = []
    seen: set[str] = set()
    for depth in range(5):
        base = ckpt_dir.resolve()
        for _ in range(depth):
            base = base.parent
        for name in names:
            for root in (base, base.parent):
                info_dir = root if not name else root / name
                candidate = info_dir / "dataset_info.json"
                key = str(candidate)
                if key in seen:
                    continue
                seen.add(key)
                candidates.append(candidate)
    return candidates


def _dataset_meta_from_info(
    info_path: Path,
    stats: dict[str, Any] | None,
    data_dir: str | None = None,
) -> dict[str, Any] | None:
    try:
        with info_path.open(encoding="utf-8") as f:
            info = json.load(f)
    except Exception:
        return None
    if not isinstance(info, dict):
        return None

    train = info.get("num_train")
    if train is None and isinstance(info.get("train_indices"), list):
        train = len(info["train_indices"])
    val = info.get("num_val")
    if val is None and isinstance(info.get("val_indices"), list):
        val = len(info["val_indices"])
    total = info.get("num_total")
    if not isinstance(train, int):
        return None

    if stats and info.get("max_episode_len") is not None:
        stats_max = stats.get("max_episode_len")
        info_max = info.get("max_episode_len")
        if isinstance(stats_max, (int, float)) and isinstance(info_max, (int, float)):
            # train-only stats can have a lower max than the full converted dataset.
            if float(stats_max) > float(info_max) + 1:
                return None

    if not isinstance(val, int):
        val = None
    if not isinstance(total, int):
        total = None
    return _dataset_meta_payload(
        train=train,
        val=val,
        total=total,
        source="dataset_info",
        source_path=str(info_path),
        data_dir=data_dir or str(info_path.parent),
    )


def _dataset_meta_from_train_logs(ckpt_dir: Path) -> dict[str, Any] | None:
    logs = sorted(ckpt_dir.glob("train*.log"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not logs and (ckpt_dir / "train.log").is_file():
        logs = [ckpt_dir / "train.log"]

    for log_path in logs:
        try:
            text = log_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        match = _DATASET_LINE_RE.search(text)
        if not match:
            continue
        total, train, val = (int(match.group(i)) for i in range(1, 4))
        data_dir_match = _DATA_DIR_RE.search(text)
        data_dir = data_dir_match.group(1) if data_dir_match else None
        return _dataset_meta_payload(
            train=train,
            val=val,
            total=total,
            source="train_log",
            source_path=str(log_path),
            data_dir=data_dir,
        )
    return None


def _count_hdf5_episodes(data_dir: Path) -> int | None:
    if not data_dir.is_dir():
        return None
    count = sum(1 for _ in data_dir.glob("episode_*.hdf5"))
    return count or None


def _resolve_dataset_meta(
    ckpt_dir: Path,
    stats: dict[str, Any] | None,
    config: dict[str, Any] | None,
) -> dict[str, Any]:
    del config  # reserved for future policy_config hints
    if stats:
        from_stats = _dataset_meta_from_stats(stats)
        if from_stats:
            return from_stats

    log_meta = _dataset_meta_from_train_logs(ckpt_dir)
    data_dir: Path | None = None
    if log_meta and log_meta.get("dataDir"):
        data_dir = Path(str(log_meta["dataDir"])).expanduser()

    for candidate in _dataset_info_candidates(ckpt_dir):
        if not candidate.is_file():
            continue
        meta = _dataset_meta_from_info(candidate, stats, data_dir=str(candidate.parent))
        if meta:
            return meta

    if log_meta:
        return log_meta

    if data_dir:
        total = _count_hdf5_episodes(data_dir)
        if total is not None:
            return _dataset_meta_payload(
                train=None,
                val=None,
                total=total,
                source="hdf5_count",
                source_path=str(data_dir),
                data_dir=str(data_dir),
            )

    return _empty_dataset_meta()


def _values_close(a: Any, b: Any, rtol: float = 1e-5, atol: float = 1e-8) -> bool:
    if a is None and b is None:
        return True
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if a == b:
            return True
        return abs(a - b) <= atol + rtol * max(abs(a), abs(b))
    return a == b


def _compare_dataset_stats(runs: list[dict[str, Any]]) -> dict[str, Any]:
    labels = [r["label"] for r in runs]
    scalar_rows: list[dict[str, Any]] = []
    for key in EPISODE_SCALAR_KEYS + STATS_SCALAR_KEYS:
        values = []
        present = True
        for run in runs:
            if key in EPISODE_SCALAR_KEYS:
                meta = run.get("datasetMeta") or {}
                field = {
                    "train_episodes": "trainEpisodes",
                    "val_episodes": "valEpisodes",
                    "total_episodes": "totalEpisodes",
                }[key]
                val = meta.get(field)
                if val is None:
                    present = False
                    values.append(None)
                else:
                    values.append(val)
                continue
            art = run["artifacts"].get("dataset_stats") or {}
            if not art.get("ok"):
                present = False
                values.append(None)
                continue
            values.append((art.get("data") or {}).get(key))
        same = present and len({json.dumps(v, sort_keys=True) for v in values if v is not None}) <= 1
        if key in EPISODE_SCALAR_KEYS and not any(v is not None for v in values):
            continue
        scalar_rows.append({"key": key, "values": values, "same": same, "present": present})

    vector_rows: list[dict[str, Any]] = []
    for key in STATS_VECTOR_KEYS:
        dim_rows: list[dict[str, Any]] = []
        max_delta = 0.0
        all_same = True
        present = True
        dim_count = 0
        for dim in range(32):
            values: list[float | None] = []
            for run in runs:
                art = run["artifacts"].get("dataset_stats") or {}
                if not art.get("ok"):
                    present = False
                    values.append(None)
                    continue
                arr = (art.get("data") or {}).get(key)
                if not isinstance(arr, list) or dim >= len(arr):
                    present = False
                    values.append(None)
                    continue
                values.append(float(arr[dim]))
            nums = [v for v in values if v is not None]
            if not nums:
                break
            dim_count = dim + 1
            delta = max(nums) - min(nums) if len(nums) > 1 else 0.0
            max_delta = max(max_delta, delta)
            dim_same = len({round(v, 8) for v in nums}) <= 1
            if not dim_same:
                all_same = False
            dim_rows.append(
                {
                    "dim": dim,
                    "values": values,
                    "delta": delta,
                    "same": dim_same,
                    "pctFromBaseline": _pct_from_baseline(values),
                }
            )
        if dim_count == 0:
            continue
        vector_rows.append(
            {
                "key": key,
                "dims": dim_count,
                "rows": dim_rows,
                "maxDelta": max_delta,
                "same": all_same and present,
                "present": present,
                "diffCount": sum(1 for r in dim_rows if not r["same"]),
            }
        )

    dim_labels = _infer_dim_labels(runs, max((v["dims"] for v in vector_rows), default=0))
    scalar_diff = sum(1 for r in scalar_rows if r["present"] and not r["same"])
    vector_diff = sum(1 for v in vector_rows if v["present"] and not v["same"])

    return {
        "labels": labels,
        "dimLabels": dim_labels,
        "scalarRows": scalar_rows,
        "vectorRows": vector_rows,
        "scalarDiffCount": scalar_diff,
        "vectorDiffCount": vector_diff,
    }


def _json_equal(a: Any, b: Any) -> bool:
    return json.dumps(a, sort_keys=True, ensure_ascii=False) == json.dumps(
        b, sort_keys=True, ensure_ascii=False
    )


def _compare_policy_config(runs: list[dict[str, Any]]) -> dict[str, Any]:
    labels = [r["label"] for r in runs]
    all_keys: set[str] = set()
    per_run: list[dict[str, Any] | None] = []
    for run in runs:
        art = run["artifacts"].get("policy_config") or {}
        if not art.get("ok"):
            per_run.append(None)
            continue
        data = art.get("data") or {}
        if isinstance(data, dict):
            all_keys.update(data.keys())
            per_run.append(data)
        else:
            per_run.append(None)

    rows: list[dict[str, Any]] = []
    for key in sorted(all_keys):
        values = [(cfg or {}).get(key) if cfg else None for cfg in per_run]
        present = all(v is not None for v in values)
        same = present and all(_json_equal(values[0], v) for v in values[1:])
        group = "other"
        for g, keys in CONFIG_GROUPS.items():
            if key in keys:
                group = g
                break
        rows.append({"key": key, "values": values, "same": same, "present": present, "group": group})

    consistency: list[dict[str, Any]] = []
    for i, run in enumerate(runs):
        cfg_art = run["artifacts"].get("policy_config") or {}
        stats_art = run["artifacts"].get("dataset_stats") or {}
        if not cfg_art.get("ok") or not stats_art.get("ok"):
            continue
        cfg = cfg_art.get("data") or {}
        stats = stats_art.get("data") or {}
        checks = []
        for field in ("state_dim", "chunk_size", "num_queries"):
            cfg_val = cfg.get(field)
            if field == "chunk_size" and cfg_val is None:
                cfg_val = cfg.get("num_queries")
            stats_val = stats.get("state_dim") if field == "state_dim" else stats.get("chunk_size_for_delta")
            if cfg_val is None and stats_val is None:
                continue
            checks.append(
                {
                    "field": field,
                    "config": cfg_val,
                    "stats": stats_val,
                    "match": cfg_val == stats_val,
                }
            )
        consistency.append({"label": run["label"], "checks": checks})

    diff_count = sum(1 for row in rows if row["present"] and not row["same"])
    return {
        "labels": labels,
        "rows": rows,
        "diffCount": diff_count,
        "consistency": consistency,
    }


def _history_points(records: list[dict[str, Any]] | None, metric: str) -> list[float | None]:
    if not records:
        return []
    out: list[float | None] = []
    for row in records:
        val = row.get(metric)
        out.append(float(val) if isinstance(val, (int, float)) else None)
    return out


def _best_epoch(records: list[dict[str, Any]] | None, metric: str = "loss") -> dict[str, Any] | None:
    if not records:
        return None
    best_i = None
    best_v = None
    for i, row in enumerate(records):
        val = row.get(metric)
        if not isinstance(val, (int, float)):
            continue
        if best_v is None or val < best_v:
            best_v = float(val)
            best_i = i
    if best_i is None:
        return None
    row = records[best_i]
    return {
        "epoch": best_i + 1,
        "loss": row.get("loss"),
        "l1": row.get("l1"),
        "kl": row.get("kl"),
    }


def _compare_train_history(runs: list[dict[str, Any]]) -> dict[str, Any]:
    labels = [r["label"] for r in runs]
    summaries: list[dict[str, Any]] = []
    max_epochs = 0
    series: dict[str, list[list[float | None]]] = {
        "train_loss": [],
        "val_loss": [],
        "train_l1": [],
        "val_l1": [],
        "train_kl": [],
        "val_kl": [],
    }

    for run in runs:
        art = run["artifacts"].get("train_history") or {}
        if not art.get("ok"):
            summaries.append(
                {
                    "label": run["label"],
                    "ok": False,
                    "error": art.get("error", "missing"),
                }
            )
            for key in series:
                series[key].append([])
            continue
        data = art.get("data") or {}
        train = data.get("train") if isinstance(data.get("train"), list) else []
        val = data.get("val") if isinstance(data.get("val"), list) else []
        max_epochs = max(max_epochs, len(train), len(val))
        train_loss = _history_points(train, "loss")
        val_loss = _history_points(val, "loss")
        train_l1 = _history_points(train, "l1")
        val_l1 = _history_points(val, "l1")
        train_kl = _history_points(train, "kl")
        val_kl = _history_points(val, "kl")
        series["train_loss"].append(train_loss)
        series["val_loss"].append(val_loss)
        series["train_l1"].append(train_l1)
        series["val_l1"].append(val_l1)
        series["train_kl"].append(train_kl)
        series["val_kl"].append(val_kl)
        summaries.append(
            {
                "label": run["label"],
                "ok": True,
                "epochsTrain": len(train),
                "epochsVal": len(val),
                "bestVal": _best_epoch(val, "loss"),
                "finalTrain": train[-1] if train else None,
                "finalVal": val[-1] if val else None,
            }
        )

    chart_series: list[dict[str, Any]] = []
    for metric in ("train_loss", "val_loss", "train_kl", "val_kl"):
        for i, label in enumerate(labels):
            pts = series[metric][i] if i < len(series[metric]) else []
            chart_series.append({"metric": metric, "label": label, "values": pts})

    best_vals = [
        s.get("bestVal", {}).get("loss")
        for s in summaries
        if s.get("ok") and isinstance(s.get("bestVal"), dict)
    ]
    best_spread = (max(best_vals) - min(best_vals)) if len(best_vals) >= 2 else 0.0
    best_run_index = None
    if best_vals:
        best_run_index = int(
            min(
                range(len(best_vals)),
                key=lambda i: best_vals[i] if best_vals[i] is not None else float("inf"),
            )
        )

    return {
        "labels": labels,
        "maxEpochs": max_epochs,
        "summaries": summaries,
        "chartSeries": chart_series,
        "bestValSpread": best_spread,
        "bestRunIndex": best_run_index,
    }


def get_gpu_status() -> dict[str, Any]:
    try:
        import torch
    except ImportError:
        return {
            "ok": True,
            "available": False,
            "torchInstalled": False,
            "error": "torch not installed",
        }

    cuda = bool(torch.cuda.is_available())
    device_name = None
    if cuda:
        try:
            device_name = torch.cuda.get_device_name(0)
        except Exception:  # noqa: BLE001
            device_name = "cuda:0"
    return {
        "ok": True,
        "available": cuda,
        "torchInstalled": True,
        "torchVersion": torch.__version__,
        "deviceName": device_name,
        "deviceCount": int(torch.cuda.device_count()) if cuda else 0,
    }


def _tensor_summary(name: str, tensor: Any) -> dict[str, Any]:
    import torch

    if not isinstance(tensor, torch.Tensor):
        return {"name": name, "kind": type(tensor).__name__}
    numel = int(tensor.numel())
    return {
        "name": name,
        "shape": list(tensor.shape),
        "dtype": str(tensor.dtype).replace("torch.", ""),
        "numel": numel,
        "bytes": numel * tensor.element_size(),
    }


def _module_prefix(name: str) -> str:
    parts = name.split(".")
    if len(parts) <= 2:
        return parts[0]
    return ".".join(parts[:3])


def _tensor_float_stats(tensor: Any) -> dict[str, float]:
    import torch

    t = tensor.detach().float().cpu()
    return {
        "min": float(t.min().item()),
        "max": float(t.max().item()),
        "mean": float(t.mean().item()),
        "std": float(t.std(unbiased=False).item()),
        "absMean": float(t.abs().mean().item()),
        "norm": float(t.norm().item()),
    }


def _detect_optimizer_type(state_map: dict[Any, Any]) -> str:
    slot_keys: set[str] = set()
    for slot in state_map.values():
        if isinstance(slot, dict):
            slot_keys.update(slot.keys())
    if "exp_avg_sq" in slot_keys and "exp_avg" in slot_keys:
        return "Adam"
    if "exp_avg" in slot_keys and "momentum_buffer" in slot_keys:
        return "SGD"
    if "momentum_buffer" in slot_keys:
        return "SGD"
    if "square_exp_avg" in slot_keys:
        return "RMSprop"
    if slot_keys:
        return "+".join(sorted(k for k in slot_keys if k != "step")[:4]) or "unknown"
    return "unknown"


def _tensor_to_2d(tensor: Any) -> Any:
    import torch

    t = tensor.detach().float().cpu()
    while t.dim() > 2:
        if t.shape[0] == 1:
            t = t[0]
        else:
            t = t.reshape(-1, t.shape[-1])
    if t.dim() == 1:
        t = t.unsqueeze(0)
    return t


def _downsample_heatmap(tensor: Any, max_h: int = 48, max_w: int = 48) -> dict[str, Any]:
    import torch
    import torch.nn.functional as F

    t = _tensor_to_2d(tensor)
    h, w = int(t.shape[0]), int(t.shape[1])
    t4 = t.unsqueeze(0).unsqueeze(0)
    pooled = F.adaptive_max_pool2d(t4, (min(max_h, h), min(max_w, w)))[0, 0]
    vmin = float(t.min().item())
    vmax = float(t.max().item())
    span = vmax - vmin or 1.0
    values = [float((v - vmin) / span) for v in pooled.reshape(-1).tolist()]
    return {
        "height": int(pooled.shape[0]),
        "width": int(pooled.shape[1]),
        "sourceShape": [h, w],
        "min": vmin,
        "max": vmax,
        "values": values,
    }


def _build_weight_histogram(tensors: list[Any], *, bins: int = 64, max_samples: int = 80_000) -> dict[str, Any]:
    import torch

    samples: list[float] = []
    total = 0
    for tensor in tensors:
        if not isinstance(tensor, torch.Tensor) or not tensor.is_floating_point():
            continue
        flat = tensor.detach().float().cpu().reshape(-1)
        total += int(flat.numel())
        if len(samples) >= max_samples:
            continue
        need = max_samples - len(samples)
        if flat.numel() <= need:
            samples.extend(float(x) for x in flat.tolist())
        else:
            idx = torch.linspace(0, flat.numel() - 1, need).long()
            samples.extend(float(x) for x in flat.index_select(0, idx).tolist())
    if not samples:
        return {"bins": bins, "counts": [], "min": None, "max": None, "sampleSize": 0, "totalElements": total}
    t = torch.tensor(samples)
    lo = float(t.min().item())
    hi = float(t.max().item())
    if lo == hi:
        hi = lo + 1e-12
    hist = torch.histc(t, bins=bins, min=lo, max=hi)
    return {
        "bins": bins,
        "counts": [int(x) for x in hist.tolist()],
        "min": lo,
        "max": hi,
        "sampleSize": len(samples),
        "totalElements": total,
    }


def _model_graph_group(name: str) -> str:
    parts = name.split(".")
    if not parts or parts[0] != "model":
        return "other"
    path = ".".join(parts[1:])
    if path.startswith("backbones"):
        return "backbone"
    if path.startswith("transformer.decoder"):
        return "decoder"
    if path.startswith("transformer.encoder") or path.startswith("encoder"):
        return "encoder"
    if path.startswith(("action_head", "is_pad_head", "latent_out_proj")):
        return "heads"
    return "embed"


def _collect_layer_blocks(state_dict: dict[str, Any], block_prefix: str) -> list[dict[str, Any]]:
    import torch

    layers: dict[str, dict[str, int]] = {}
    needle = block_prefix if block_prefix.endswith(".") else f"{block_prefix}."
    for name, tensor in state_dict.items():
        if not isinstance(tensor, torch.Tensor) or not name.startswith(needle):
            continue
        rest = name[len(needle) :]
        layer_id = rest.split(".", 1)[0]
        if not layer_id.isdigit():
            continue
        bucket = layers.setdefault(layer_id, {"params": 0, "elements": 0})
        bucket["params"] += 1
        bucket["elements"] += int(tensor.numel())
    out: list[dict[str, Any]] = []
    for layer_id in sorted(layers, key=lambda x: int(x)):
        stats = layers[layer_id]
        out.append(
            {
                "id": f"{block_prefix}.{layer_id}",
                "label": f"layers.{layer_id}",
                "params": stats["params"],
                "elements": stats["elements"],
            }
        )
    return out


def _build_model_graph(state_dict: dict[str, Any]) -> dict[str, Any]:
    import torch

    stage_defs = [
        ("embed", "Embed / Input"),
        ("backbone", "Backbone"),
        ("encoder", "Encoder"),
        ("decoder", "Decoder"),
        ("heads", "Output Heads"),
    ]
    stage_index = {sid: i for i, (sid, _) in enumerate(stage_defs)}
    buckets: dict[str, dict[str, Any]] = {
        sid: {"id": sid, "label": label, "column": stage_index[sid], "row": 0, "params": 0, "elements": 0, "children": []}
        for sid, label in stage_defs
    }
    other = {"params": 0, "elements": 0}

    for name, tensor in state_dict.items():
        if not isinstance(tensor, torch.Tensor):
            continue
        group = _model_graph_group(name)
        if group == "other":
            other["params"] += 1
            other["elements"] += int(tensor.numel())
            continue
        bucket = buckets[group]
        bucket["params"] += 1
        bucket["elements"] += int(tensor.numel())

    for sid in ("encoder", "decoder"):
        if sid == "encoder":
            blocks = _collect_layer_blocks(state_dict, "model.transformer.encoder.layers")
            if not blocks:
                blocks = _collect_layer_blocks(state_dict, "model.encoder.layers")
        else:
            blocks = _collect_layer_blocks(state_dict, "model.transformer.decoder.layers")
        buckets[sid]["children"] = blocks[:12]

    nodes = [buckets[sid] for sid, _ in stage_defs if buckets[sid]["params"] > 0]
    if other["params"]:
        nodes.append(
            {
                "id": "other",
                "label": "Other",
                "column": len(stage_defs),
                "row": 0,
                "params": other["params"],
                "elements": other["elements"],
                "children": [],
            }
        )

    edges: list[dict[str, str]] = []
    ordered = [n["id"] for n in sorted(nodes, key=lambda n: n["column"])]
    for i in range(len(ordered) - 1):
        edges.append({"from": ordered[i], "to": ordered[i + 1]})

    return {"nodes": nodes, "edges": edges}


def _summarize_state_dict(state_dict: dict[str, Any], *, top_n: int = 24) -> dict[str, Any]:
    import torch

    tensors: list[tuple[str, torch.Tensor]] = []
    total_params = 0
    total_bytes = 0
    module_stats: dict[str, dict[str, int]] = {}

    for name, value in state_dict.items():
        if not isinstance(value, torch.Tensor):
            continue
        numel = int(value.numel())
        total_params += numel
        total_bytes += numel * value.element_size()
        prefix = _module_prefix(name)
        bucket = module_stats.setdefault(prefix, {"params": 0, "elements": 0})
        bucket["params"] += 1
        bucket["elements"] += numel
        tensors.append((name, value))

    tensors.sort(key=lambda item: item[1].numel(), reverse=True)
    modules = [
        {"prefix": prefix, "params": stats["params"], "elements": stats["elements"]}
        for prefix, stats in sorted(module_stats.items(), key=lambda item: item[1]["elements"], reverse=True)
    ]

    float_tensors = [t for _, t in tensors if t.is_floating_point()]
    weight_stats = None
    if float_tensors:
        import torch

        sample_stats = [_tensor_float_stats(t) for t in float_tensors[: min(32, len(float_tensors))]]
        weight_stats = {
            "min": min(s["min"] for s in sample_stats),
            "max": max(s["max"] for s in sample_stats),
            "mean": float(sum(s["mean"] for s in sample_stats) / len(sample_stats)),
            "absMean": float(sum(s["absMean"] for s in sample_stats) / len(sample_stats)),
            "sampledTensors": len(sample_stats),
        }

    dtype_breakdown: dict[str, int] = {}
    for _, tensor in tensors:
        key = str(tensor.dtype).replace("torch.", "")
        dtype_breakdown[key] = dtype_breakdown.get(key, 0) + 1

    module_bars = []
    for mod in modules[:16]:
        module_bars.append(
            {
                "label": mod["prefix"],
                "elements": mod["elements"],
                "pct": round(mod["elements"] / total_params * 100, 2) if total_params else 0,
            }
        )

    heatmaps = []
    for name, tensor in tensors:
        if tensor.dim() < 2 or not tensor.is_floating_point():
            continue
        heatmaps.append({"name": name, **_downsample_heatmap(tensor)})
        if len(heatmaps) >= 4:
            break

    return {
        "paramCount": len(tensors),
        "totalParams": total_params,
        "totalBytes": total_bytes,
        "modules": modules,
        "topTensors": [_tensor_summary(name, tensor) for name, tensor in tensors[:top_n]],
        "weightStats": weight_stats,
        "dtypeBreakdown": [{"dtype": k, "count": v} for k, v in sorted(dtype_breakdown.items())],
        "visualization": {
            "modelGraph": _build_model_graph(state_dict),
            "moduleBars": module_bars,
            "histogram": _build_weight_histogram(float_tensors),
            "heatmaps": heatmaps,
        },
    }


def _summarize_optimizer_payload(raw: dict[str, Any]) -> dict[str, Any]:
    import torch

    state = raw.get("optimizer_state_dict") if isinstance(raw.get("optimizer_state_dict"), dict) else {}
    param_groups = state.get("param_groups") if isinstance(state.get("param_groups"), list) else []
    state_map = state.get("state") if isinstance(state.get("state"), dict) else {}

    groups: list[dict[str, Any]] = []
    for group in param_groups:
        if not isinstance(group, dict):
            continue
        groups.append(
            {
                "lr": group.get("lr"),
                "initialLr": group.get("initial_lr"),
                "weightDecay": group.get("weight_decay"),
                "betas": group.get("betas"),
                "eps": group.get("eps"),
                "amsgrad": group.get("amsgrad"),
                "maximize": group.get("maximize"),
                "foreach": group.get("foreach"),
                "capturable": group.get("capturable"),
                "fused": group.get("fused"),
                "decoupledWeightDecay": group.get("decoupled_weight_decay"),
                "paramCount": len(group.get("params") or []),
            }
        )

    scheduler = raw.get("scheduler_state_dict")
    scheduler_out: dict[str, Any] | None = None
    if isinstance(scheduler, dict):
        scheduler_out = {
            "lastEpoch": scheduler.get("last_epoch"),
            "TMax": scheduler.get("T_max"),
            "etaMin": scheduler.get("eta_min"),
            "lastLr": scheduler.get("_last_lr"),
            "baseLrs": scheduler.get("base_lrs"),
            "stepCount": scheduler.get("_step_count"),
            "isInitial": scheduler.get("_is_initial"),
        }

    state_bytes = 0
    state_tensor_count = 0
    buffer_types: dict[str, int] = {}
    steps: list[int] = []
    slot_entries: list[dict[str, Any]] = []

    for param_idx, slot in state_map.items():
        if not isinstance(slot, dict):
            continue
        slot_bytes = 0
        buffers: list[dict[str, Any]] = []
        step_val = None
        for key, value in slot.items():
            if isinstance(value, torch.Tensor):
                state_tensor_count += 1
                nbytes = int(value.numel()) * value.element_size()
                state_bytes += nbytes
                slot_bytes += nbytes
                buffer_types[key] = buffer_types.get(key, 0) + 1
                entry: dict[str, Any] = {
                    "name": key,
                    "shape": list(value.shape),
                    "dtype": str(value.dtype).replace("torch.", ""),
                    "bytes": nbytes,
                }
                if key == "step":
                    step_val = int(value.item())
                    entry["value"] = step_val
                elif value.is_floating_point() and value.numel() <= 2_000_000:
                    entry["stats"] = _tensor_float_stats(value)
                buffers.append(entry)
            elif key == "step":
                step_val = int(value)
        if step_val is not None:
            steps.append(step_val)
        slot_entries.append(
            {
                "paramIndex": param_idx,
                "step": step_val,
                "bytes": slot_bytes,
                "buffers": buffers,
            }
        )

    slot_entries.sort(key=lambda item: item["bytes"], reverse=True)
    step_min = min(steps) if steps else None
    step_max = max(steps) if steps else None
    step_uniform = step_min == step_max if steps else True

    exp_avg_stats = None
    exp_avg_sq_stats = None
    exp_avg_tensors = []
    exp_avg_sq_tensors = []
    for slot in state_map.values():
        if not isinstance(slot, dict):
            continue
        if isinstance(slot.get("exp_avg"), torch.Tensor):
            exp_avg_tensors.append(slot["exp_avg"])
        if isinstance(slot.get("exp_avg_sq"), torch.Tensor):
            exp_avg_sq_tensors.append(slot["exp_avg_sq"])
    if exp_avg_tensors:
        exp_avg_stats = _tensor_float_stats(torch.cat([t.detach().float().reshape(-1) for t in exp_avg_tensors[:12]]))
    if exp_avg_sq_tensors:
        exp_avg_sq_stats = _tensor_float_stats(torch.cat([t.detach().float().reshape(-1) for t in exp_avg_sq_tensors[:12]]))

    return {
        "epoch": raw.get("epoch"),
        "optimizerType": _detect_optimizer_type(state_map),
        "paramGroups": groups,
        "scheduler": scheduler_out,
        "stateTensorCount": state_tensor_count,
        "stateBytes": state_bytes,
        "slotCount": len(state_map),
        "bufferTypes": [{"name": k, "count": v} for k, v in sorted(buffer_types.items())],
        "stateSummary": {
            "globalStep": step_max,
            "stepMin": step_min,
            "stepMax": step_max,
            "stepUniform": step_uniform,
            "expAvg": exp_avg_stats,
            "expAvgSq": exp_avg_sq_stats,
        },
        "topStateSlots": slot_entries[:20],
    }


def _load_gpu_artifact(path: Path, artifact_key: str) -> dict[str, Any]:
    filename = GPU_ARTIFACT_FILES[artifact_key]
    fp = path / filename
    if not fp.is_file():
        return {"ok": False, "error": "missing", "filename": filename}

    try:
        import torch
    except ImportError as e:
        return {"ok": False, "filename": filename, "error": str(e)}

    try:
        payload = torch.load(fp, map_location="cpu", weights_only=False)
        size_bytes = fp.stat().st_size
        if artifact_key == "optimizer":
            if not isinstance(payload, dict):
                return {"ok": False, "filename": filename, "error": "optimizer.pt must be a dict checkpoint"}
            data = _summarize_optimizer_payload(payload)
        else:
            if not isinstance(payload, dict):
                return {"ok": False, "filename": filename, "error": "policy_best.ckpt must be a state_dict mapping"}
            data = _summarize_state_dict(payload)
        return {
            "ok": True,
            "filename": filename,
            "sizeBytes": size_bytes,
            "data": data,
        }
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "filename": filename, "error": str(e)}


def _compare_optimizer(runs: list[dict[str, Any]]) -> dict[str, Any]:
    labels = [r["label"] for r in runs]
    scalar_rows: list[dict[str, Any]] = []

    def values_for(getter) -> list[Any]:
        out: list[Any] = []
        for run in runs:
            art = run["artifacts"].get("optimizer") or {}
            if not art.get("ok"):
                out.append(None)
                continue
            out.append(getter((art.get("data") or {})))
        return out

    for key, getter in (
        ("epoch", lambda data: data.get("epoch")),
        ("optimizerType", lambda data: data.get("optimizerType")),
        ("slotCount", lambda data: data.get("slotCount")),
        ("stateTensorCount", lambda data: data.get("stateTensorCount")),
        ("stateBytes", lambda data: data.get("stateBytes")),
        ("globalStep", lambda data: (data.get("stateSummary") or {}).get("globalStep")),
    ):
        values = values_for(getter)
        present = all(v is not None for v in values)
        same = present and len({json.dumps(v, sort_keys=True) for v in values}) <= 1
        scalar_rows.append({"key": key, "values": values, "same": same, "present": present})

    group_rows: list[dict[str, Any]] = []
    max_groups = max(
        (
            len(((run["artifacts"].get("optimizer") or {}).get("data") or {}).get("paramGroups") or [])
            for run in runs
        ),
        default=0,
    )
    for group_idx in range(max_groups):
        lr_values: list[Any] = []
        wd_values: list[Any] = []
        count_values: list[Any] = []
        present = True
        for run in runs:
            art = run["artifacts"].get("optimizer") or {}
            if not art.get("ok"):
                present = False
                lr_values.append(None)
                wd_values.append(None)
                count_values.append(None)
                continue
            groups = (art.get("data") or {}).get("paramGroups") or []
            if group_idx >= len(groups):
                present = False
                lr_values.append(None)
                wd_values.append(None)
                count_values.append(None)
                continue
            group = groups[group_idx]
            lr_values.append(group.get("lr"))
            wd_values.append(group.get("weightDecay"))
            count_values.append(group.get("paramCount"))
        group_rows.append(
            {
                "groupIndex": group_idx,
                "lr": {
                    "values": lr_values,
                    "same": present and len({json.dumps(v, sort_keys=True) for v in lr_values}) <= 1,
                    "present": present,
                },
                "weightDecay": {
                    "values": wd_values,
                    "same": present and len({json.dumps(v, sort_keys=True) for v in wd_values}) <= 1,
                    "present": present,
                },
                "paramCount": {
                    "values": count_values,
                    "same": present and len({json.dumps(v, sort_keys=True) for v in count_values}) <= 1,
                    "present": present,
                },
            }
        )

    scheduler_rows: list[dict[str, Any]] = []
    for key in ("lastEpoch", "TMax", "etaMin", "stepCount"):
        values = []
        present = True
        for run in runs:
            art = run["artifacts"].get("optimizer") or {}
            if not art.get("ok"):
                present = False
                values.append(None)
                continue
            sched = (art.get("data") or {}).get("scheduler") or {}
            values.append(sched.get(key))
        same = present and len({json.dumps(v, sort_keys=True) for v in values}) <= 1
        scheduler_rows.append({"key": key, "values": values, "same": same, "present": present})

    diff_count = sum(1 for row in scalar_rows if row["present"] and not row["same"])
    diff_count += sum(
        1
        for row in group_rows
        for field in ("lr", "weightDecay", "paramCount")
        if row[field]["present"] and not row[field]["same"]
    )
    diff_count += sum(1 for row in scheduler_rows if row["present"] and not row["same"])

    return {
        "labels": labels,
        "scalarRows": scalar_rows,
        "groupRows": group_rows,
        "schedulerRows": scheduler_rows,
        "diffCount": diff_count,
    }


def _compare_policy_best(runs: list[dict[str, Any]]) -> dict[str, Any]:
    import torch

    labels = [r["label"] for r in runs]
    summaries: list[dict[str, Any]] = []
    for run in runs:
        art = run["artifacts"].get("policy_best") or {}
        if not art.get("ok"):
            summaries.append({"label": run["label"], "ok": False, "error": art.get("error", "missing")})
            continue
        data = art.get("data") or {}
        summaries.append(
            {
                "label": run["label"],
                "ok": True,
                "paramCount": data.get("paramCount"),
                "totalParams": data.get("totalParams"),
                "totalBytes": data.get("totalBytes"),
            }
        )

    scalar_rows: list[dict[str, Any]] = []
    for key in ("paramCount", "totalParams", "totalBytes"):
        values = [s.get(key) if s.get("ok") else None for s in summaries]
        present = all(v is not None for v in values)
        same = present and len({json.dumps(v, sort_keys=True) for v in values}) <= 1
        scalar_rows.append({"key": key, "values": values, "same": same, "present": present})

    state_dicts: list[dict[str, Any] | None] = []
    for run in runs:
        art = run["artifacts"].get("policy_best") or {}
        if not art.get("ok"):
            state_dicts.append(None)
            continue
        fp = Path(run["path"]) / GPU_ARTIFACT_FILES["policy_best"]
        try:
            payload = torch.load(fp, map_location="cpu", weights_only=False)
            state_dicts.append(payload if isinstance(payload, dict) else None)
        except Exception:  # noqa: BLE001
            state_dicts.append(None)

    baseline = state_dicts[0] if state_dicts else None
    shape_rows: list[dict[str, Any]] = []
    weight_rows: list[dict[str, Any]] = []
    if baseline:
        all_keys = set(baseline.keys())
        for sd in state_dicts[1:]:
            if sd:
                all_keys.update(sd.keys())

        for key in sorted(all_keys):
            shapes = []
            present = True
            for sd in state_dicts:
                if not sd or key not in sd or not isinstance(sd[key], torch.Tensor):
                    present = False
                    shapes.append(None)
                    continue
                shapes.append(list(sd[key].shape))
            same = present and len({json.dumps(s) for s in shapes if s is not None}) <= 1
            if not same:
                shape_rows.append({"key": key, "shapes": shapes, "same": same, "present": present})

        if baseline and all(isinstance(sd, dict) for sd in state_dicts if sd is not None):
            for key in sorted(baseline.keys()):
                diffs: list[dict[str, Any] | None] = [None]
                base_tensor = baseline.get(key)
                if not isinstance(base_tensor, torch.Tensor):
                    continue
                max_abs = 0.0
                mean_abs = 0.0
                rel_l2 = 0.0
                comparable = True
                for sd in state_dicts[1:]:
                    if not sd or key not in sd or not isinstance(sd[key], torch.Tensor):
                        comparable = False
                        diffs.append(None)
                        continue
                    other = sd[key]
                    if list(other.shape) != list(base_tensor.shape):
                        comparable = False
                        diffs.append(None)
                        continue
                    delta = (other.float() - base_tensor.float()).abs()
                    max_v = float(delta.max().item())
                    mean_v = float(delta.mean().item())
                    denom = float(base_tensor.float().norm().item())
                    rel = float(delta.norm().item() / denom) if denom > 0 else 0.0
                    max_abs = max(max_abs, max_v)
                    mean_abs = max(mean_abs, mean_v)
                    rel_l2 = max(rel_l2, rel)
                    diffs.append({"maxAbs": max_v, "meanAbs": mean_v, "relL2": rel})
                if comparable and len(diffs) > 1 and any(d is not None for d in diffs[1:]):
                    weight_rows.append(
                        {
                            "key": key,
                            "maxAbsDiff": max_abs,
                            "meanAbsDiff": mean_abs,
                            "relL2": rel_l2,
                            "perRun": diffs,
                        }
                    )

    weight_rows.sort(key=lambda row: row["maxAbsDiff"], reverse=True)
    weight_rows = weight_rows[:40]

    diff_count = sum(1 for row in scalar_rows if row["present"] and not row["same"])
    diff_count += len(shape_rows)
    diff_count += sum(1 for row in weight_rows if row["maxAbsDiff"] > 0)

    return {
        "labels": labels,
        "summaries": summaries,
        "scalarRows": scalar_rows,
        "shapeRows": shape_rows,
        "weightRows": weight_rows,
        "diffCount": diff_count,
    }


def analyze_gpu_artifacts(dirs: list[str]) -> dict[str, Any]:
    status = get_gpu_status()
    if not status.get("available"):
        raise ValueError(status.get("error") or "GPU / CUDA not available")

    if not dirs:
        raise ValueError("ckptDirs required")
    if len(dirs) > 8:
        raise ValueError("at most 8 checkpoint directories")

    runs: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in dirs:
        path = validate_ckpt_dir(raw)
        key = str(path)
        if key in seen:
            continue
        seen.add(key)
        artifacts: dict[str, Any] = {}
        for artifact_key in GPU_ARTIFACT_FILES:
            artifacts[artifact_key] = _load_gpu_artifact(path, artifact_key)
        runs.append({"label": _run_label(path), "path": key, "artifacts": artifacts})

    if not runs:
        raise ValueError("no valid checkpoint directories")

    return {
        "ok": True,
        "gpu": status,
        "runs": runs,
        "compare": {
            "optimizer": _compare_optimizer(runs),
            "policy_best": _compare_policy_best(runs),
        },
    }


def compare_ckpt_dirs(dirs: list[str]) -> dict[str, Any]:
    if not dirs:
        raise ValueError("ckptDirs required")
    if len(dirs) > 8:
        raise ValueError("at most 8 checkpoint directories")

    runs: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in dirs:
        path = validate_ckpt_dir(raw)
        key = str(path)
        if key in seen:
            continue
        seen.add(key)
        artifacts: dict[str, Any] = {}
        for artifact_key in ARTIFACT_FILES:
            artifacts[artifact_key] = _load_artifact(path, artifact_key)
        stats_data = (artifacts.get("dataset_stats") or {}).get("data")
        config_data = (artifacts.get("policy_config") or {}).get("data")
        stats_dict = stats_data if isinstance(stats_data, dict) else None
        config_dict = config_data if isinstance(config_data, dict) else None
        runs.append(
            {
                "label": _run_label(path),
                "path": key,
                "artifacts": artifacts,
                "datasetMeta": _resolve_dataset_meta(path, stats_dict, config_dict),
            }
        )

    if not runs:
        raise ValueError("no valid checkpoint directories")

    return {
        "ok": True,
        "runs": runs,
        "compare": {
            "dataset_stats": _compare_dataset_stats(runs),
            "policy_config": _compare_policy_config(runs),
            "train_history": _compare_train_history(runs),
        },
    }
