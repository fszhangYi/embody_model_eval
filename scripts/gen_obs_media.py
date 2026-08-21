#!/usr/bin/env python3
"""Generate demo RGB / depth / attention media and patch episode JSON (F25–F27)."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def _font(size: int = 14):
    try:
        return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", size)
    except OSError:
        return ImageFont.load_default()


def make_rgb(path: Path, w: int, h: int, frame_i: int, n: int, cam: str, box):
    img = Image.new("RGB", (w, h), (18, 28, 42))
    draw = ImageDraw.Draw(img)
    # background gradient strips
    for y in range(h):
        c = 28 + int(40 * y / h)
        draw.line([(0, y), (w, y)], fill=(c, c + 8, c + 18))
    # moving circle
    cx = int(40 + (w - 80) * (frame_i / max(1, n - 1)))
    cy = h // 2 + int(18 * math.sin(frame_i * 0.7))
    draw.ellipse([cx - 22, cy - 22, cx + 22, cy + 22], fill=(61, 214, 198), outline=(230, 236, 243))
    # target box region tint
    x0, y0, x1, y1 = box
    draw.rectangle([x0, y0, x1, y1], outline=(248, 113, 113), width=2)
    draw.text((8, 8), f"{cam}  f={frame_i}", fill=(231, 236, 243), font=_font(13))
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format="PNG", optimize=True)


def make_depth(path: Path, w: int, h: int, frame_i: int, n: int):
    img = Image.new("L", (w, h), 40)
    px = img.load()
    cx = int(w * (0.2 + 0.6 * frame_i / max(1, n - 1)))
    cy = h // 2
    for y in range(h):
        for x in range(w):
            d = math.hypot(x - cx, y - cy)
            v = int(max(0, 255 - d * 2.2))
            px[x, y] = v
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format="PNG", optimize=True)


def make_attention(path: Path, w: int, h: int, frame_i: int, n: int, box):
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    for r in range(70, 0, -4):
        a = int(160 * (1 - r / 70))
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(251, 191, 36, a))
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format="PNG", optimize=True)


def box_for_frame(w: int, h: int, i: int, n: int):
    t = i / max(1, n - 1)
    bw, bh = 56, 42
    x0 = int(30 + (w - bw - 60) * t)
    y0 = int(h * 0.35 + 12 * math.sin(i * 0.9))
    return [x0, y0, x0 + bw, y0 + bh]


def patch_episode(ep_path: Path, media_root: Path, rel_prefix: str) -> None:
    data = json.loads(ep_path.read_text(encoding="utf-8"))
    meta = data.setdefault("meta", {})
    frames = data.get("frames") or []
    n = len(frames)
    if n == 0:
        raise SystemExit(f"empty frames: {ep_path}")

    w, h = 320, 180
    meta["cameras"] = [
        {"id": "wrist", "stream": "rgb", "width": w, "height": h, "fps": meta.get("fps", 20), "mount": "wrist"},
        {"id": "front", "stream": "rgb", "width": w, "height": h, "fps": meta.get("fps", 20), "mount": "base"},
        {"id": "wrist_depth", "stream": "depth", "width": w, "height": h, "fps": meta.get("fps", 20), "mount": "wrist"},
    ]
    meta["obs_alignment"] = {
        "mode": "frame_index",
        "max_skew_ms": 50,
        "action_time_field": "timestamp",
    }

    ep_stem = ep_path.stem  # episode_1
    out_dir = media_root / ep_stem
    out_dir.mkdir(parents=True, exist_ok=True)

    for i, fr in enumerate(frames):
        ts = float(fr.get("timestamp", i / float(meta.get("fps") or 20)))
        # intentional tiny skew on last 2 frames of wrist for audit demo
        skew = 0.0
        if i >= n - 2:
            skew = 0.08  # 80ms > 50ms threshold

        box = box_for_frame(w, h, i, n)
        wrist_p = out_dir / f"wrist_{i:03d}.png"
        front_p = out_dir / f"front_{i:03d}.png"
        depth_p = out_dir / f"depth_{i:03d}.png"
        attn_p = out_dir / f"attn_{i:03d}.png"

        make_rgb(wrist_p, w, h, i, n, "wrist", box)
        make_rgb(front_p, w, h, i, n, "front", box)
        make_depth(depth_p, w, h, i, n)
        make_attention(attn_p, w, h, i, n, box)

        kp = [[box[0] + 8, box[1] + 10], [box[2] - 8, box[1] + 10], [(box[0] + box[2]) / 2, box[3] - 6]]

        fr["obs"] = {
            "wrist": {
                "path": f"{rel_prefix}/{ep_stem}/wrist_{i:03d}.png",
                "t": ts + skew,
                "overlays": [
                    {"type": "box", "label": "object", "xyxy": box, "color": "#3dd6c6", "score": 0.7 + 0.25 * (i / max(1, n - 1))},
                    {"type": "keypoints", "points": kp, "color": "#fbbf24"},
                    {"type": "heatmap", "path": f"{rel_prefix}/{ep_stem}/attn_{i:03d}.png"},
                ],
            },
            "front": {
                "path": f"{rel_prefix}/{ep_stem}/front_{i:03d}.png",
                "t": ts,
                "overlays": [
                    {"type": "box", "label": "goal", "xyxy": [w // 2 - 30, h // 2 - 24, w // 2 + 30, h // 2 + 24], "color": "#60a5fa", "score": 0.9},
                ],
            },
            "wrist_depth": {
                "path": f"{rel_prefix}/{ep_stem}/depth_{i:03d}.png",
                "t": ts,
                "overlays": [],
            },
        }

    ep_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"patched {ep_path} → media {out_dir} ({n} frames)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--suite",
        action="append",
        dest="suites",
        default=None,
        help="data/<suite>/；可重复。默认 short；与 --all 互斥",
    )
    ap.add_argument(
        "--all",
        action="store_true",
        help="为 data/ 下所有含 episode_*.json 的套件生成观测媒体",
    )
    ap.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    ap.add_argument("--episodes", nargs="*", default=None, help="episode_1.json … default all")
    args = ap.parse_args()

    data_root = args.root / "data"
    if args.all:
        suites = sorted(
            p.name
            for p in data_root.iterdir()
            if p.is_dir() and any(p.glob("episode_*.json"))
        )
    elif args.suites:
        suites = args.suites
    else:
        suites = ["short"]

    if not suites:
        raise SystemExit(f"no suites under {data_root}")

    for suite in suites:
        suite_dir = data_root / suite
        media_root = suite_dir / "media"
        rel_prefix = f"./data/{suite}/media"
        files = sorted(suite_dir.glob("episode_*.json"))
        if args.episodes:
            want = set(args.episodes)
            files = [p for p in files if p.name in want]
        if not files:
            print(f"skip {suite}: no episode_*.json")
            continue
        for p in files:
            patch_episode(p, media_root, rel_prefix)


if __name__ == "__main__":
    main()
