"""Parse and compare ACT checkpoint artifacts (no GPU / torch required for JSON/pickle)."""

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
