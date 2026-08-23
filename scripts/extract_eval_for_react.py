#!/usr/bin/env python3
"""Extract eval page style/script from legacy/index.html for React."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LEGACY = ROOT / "legacy" / "index.html"
OUT_STYLE = ROOT / "frontend" / "src" / "styles" / "eval.css"
OUT_SCRIPT = ROOT / "frontend" / "src" / "features" / "eval" / "runEval.ts"


def main() -> None:
    text = LEGACY.read_text(encoding="utf-8")

    style_m = re.search(r"<style>(.*?)</style>", text, re.DOTALL)
    if style_m:
        OUT_STYLE.parent.mkdir(parents=True, exist_ok=True)
        OUT_STYLE.write_text(style_m.group(1).strip() + "\n", encoding="utf-8")

    script_m = re.search(r'<script type="module">\s*(import.*?)</script>', text, re.DOTALL)
    if not script_m:
        raise SystemExit("eval script block not found")

    body = script_m.group(1).strip()
    body = re.sub(
        r"import \{ mountPageNav \} from '\./js/nav_pages\.js\?v=\d+';?\s*",
        "",
        body,
    )
    body = re.sub(
        r"mountPageNav\(document\.getElementById\('pageNavRoot'\), \{ currentId: 'eval' \}\);?\s*",
        "",
        body,
    )
    body = re.sub(
        r"from '\./js/([^']+)\.js(\?v=\d+)?'",
        r"from '../../lib/legacy/\1.js'",
        body,
    )

    header = """/** Auto-extracted from legacy/index.html — do not hand-edit lightly. */
export async function bootstrapEval(): Promise<void> {
"""
    footer = "\n}\n"

    OUT_SCRIPT.parent.mkdir(parents=True, exist_ok=True)
    OUT_SCRIPT.write_text(header + body + footer, encoding="utf-8")
    print(f"wrote {OUT_STYLE} ({OUT_STYLE.stat().st_size} bytes)")
    print(f"wrote {OUT_SCRIPT} ({OUT_SCRIPT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
