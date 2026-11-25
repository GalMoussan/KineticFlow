#!/usr/bin/env python3
"""P0 spike bench for sketch.py: runs every (image, mode, detail) twice as a fresh process, checks the
two outputs are byte-identical, and records wall time with and without interpreter start-up.

    uv run --project sidecar/sketch python sidecar/sketch/bench.py

Writes SketchDocs to out/sketch/S3 and out/sketch/S2, timings to <dir>/sidecar-timings.json, and
prints Markdown tables. Timing lives only here, never in a SketchDoc.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKETCH = ROOT / "sidecar/sketch/sketch.py"
PY = ROOT / "sidecar/sketch/.venv/bin/python"
IMAGES = ROOT / "out/sketch/images"
IDS = {"logo": "logo.png", "portrait": "portrait.jpg", "product": "product.jpg", "drawing": "drawing.jpg", "landscape": "landscape.jpg"}
# Line engines run at the detail that looked best on the preview sheets (see the report).
CHAIN_DETAIL = {"logo": 3, "portrait": 4, "product": 3, "drawing": 3, "landscape": 3}
STIPPLE_DETAIL = 5

JOBS = []
for name in IDS:
    for d in (2, 3, 5):
        JOBS.append(("S3", f"{name}-d{d}", name, ["--mode", "sketch", "--detail", str(d)]))
    JOBS.append(("S3/canny", f"{name}-d3", name, ["--mode", "sketch", "--detail", "3", "--edges", "canny"]))
    JOBS.append(("S2", f"{name}-stipple", name, ["--mode", "line", "--detail", str(STIPPLE_DETAIL)]))
    JOBS.append(("S2", f"{name}-chain", name, ["--mode", "line", "--line-engine", "chain", "--detail", str(CHAIN_DETAIL[name])]))


def run(cmd: list[str]) -> tuple[float, dict]:
    t = time.perf_counter()
    done = subprocess.run(cmd, capture_output=True, text=True, check=False)
    wall = (time.perf_counter() - t) * 1000.0
    if done.returncode != 0:
        raise SystemExit(f"{' '.join(cmd)} failed:\n{done.stderr}")
    return wall, json.loads(done.stderr.strip().splitlines()[-1])


def main() -> int:
    rows = []
    for folder, stem, name, args in JOBS:
        out = ROOT / "out/sketch" / folder / f"{stem}.sketch.json"
        tmp = Path("/tmp") / f"reel-sketch-bench-{stem}-{folder.replace('/', '_')}.json"
        image = str(IMAGES / IDS[name])
        # 1) through uv, as the CLI documents it (uv resolve + interpreter start + imports + pipeline)
        wall_uv, first = run(["uv", "run", "--project", str(SKETCH.parent), "python", str(SKETCH), image, *args, "--seed", "1", "--out", str(out)])
        # 2) the venv interpreter directly (interpreter start + imports + pipeline), second output for the hash check
        wall_py, second = run([str(PY), str(SKETCH), image, *args, "--seed", "1", "--out", str(tmp)])
        same = out.read_bytes() == tmp.read_bytes()
        tmp.unlink()
        rows.append({
            "set": folder, "id": stem, "model": first["model"], "detail": first["detail"],
            "strokes": first["strokes"], "points": first["points"], "box": first["box"],
            "wall_uv_ms": round(wall_uv), "wall_python_ms": round(wall_py),
            "import_ms": second["import_ms"], "pipeline_ms": second["pipeline_ms"],
            "sha256": hashlib.sha256(out.read_bytes()).hexdigest(), "identical": same,
            **({"travel_share": first["travel_share"]} if "travel_share" in first else {}),
        })
        print(f"{folder:9} {stem:18} {first['points']:5} pts  uv {wall_uv:6.0f} ms  py {wall_py:6.0f} ms  pipe {second['pipeline_ms']:6.0f} ms  same={same}", file=sys.stderr)
    for folder in ("S3", "S2"):
        mine = [r for r in rows if r["set"].split("/")[0] == folder]
        (ROOT / "out/sketch" / folder / "sidecar-timings.json").write_text(json.dumps(mine, indent=2) + "\n")
    print("| set | result | model | d | strokes | points | box | wall via uv (ms) | wall python (ms) | imports (ms) | pipeline (ms) | 2 runs identical |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        print(f"| {r['set']} | {r['id']} | {r['model']} | {r['detail']} | {r['strokes']} | {r['points']} | {r['box'][0]}×{r['box'][1]} | {r['wall_uv_ms']} | {r['wall_python_ms']} | {r['import_ms']:.0f} | {r['pipeline_ms']:.0f} | {'yes' if r['identical'] else 'NO'} |")
    return 0 if all(r["identical"] for r in rows) else 2


if __name__ == "__main__":
    raise SystemExit(main())
