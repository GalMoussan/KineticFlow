#!/usr/bin/env python3
"""Image → SketchDoc (P0 spikes S3 "sketch" and S2 "line").

    uv run --project sidecar/sketch python sidecar/sketch/sketch.py <image> \
        --mode sketch|line --detail 1..5 --seed N --out x.sketch.json \
        [--edges xdog|canny] [--line-engine stipple|chain]

Writes one SketchDoc (compact JSON, stable key order) and prints one JSON timing object to stderr.
Deterministic: the only randomness is numpy's PCG64 seeded from --seed; no wall clock reaches the doc.

Sketch: resize ≤ 768 px → bilateral blur → XDoG line ink with hysteresis (or Canny) → skeleton →
own graph tracer with junction continuation → RDP → importance caps → outline-first order → box.
Line (stipple): darkness-weighted Lloyd stippling → nearest-neighbour tour → 2-opt → light smoothing.
Line (chain): the sketch strokes in drawing order, joined end to start by straight pen travel.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

_T_IMPORT = time.perf_counter()

import cv2
import numpy as np
from scipy.spatial import cKDTree
from skimage.morphology import skeletonize

IMPORT_MS = (time.perf_counter() - _T_IMPORT) * 1000.0

VERSION = {"sketch": "s3-sketch-2", "stipple": "s2-stipple-2", "chain": "s2-chain-1"}
LONG_SIDE = 768
BOX_MAX = 1000
BOX_PAD = 6
MAX_STROKES = 400
MAX_POINTS = 6000

# Per-detail knobs for the sketch. sigma: DoG scale in px at 768. hi/lo: hysteresis thresholds on the
# DoG response (gray units 0..1; a hard step edge of contrast C peaks at ≈ 0.11·C). min_len: shortest
# kept stroke as a fraction of the diagonal. rdp: Douglas–Peucker tolerance in px.
SKETCH = {
    1: {"sigma": 2.6, "hi": 0.060, "lo": 0.030, "min_len": 0.060, "rdp": 2.4, "strokes": 28, "points": 900},
    2: {"sigma": 2.0, "hi": 0.048, "lo": 0.022, "min_len": 0.035, "rdp": 1.8, "strokes": 70, "points": 1800},
    3: {"sigma": 1.6, "hi": 0.038, "lo": 0.017, "min_len": 0.020, "rdp": 1.4, "strokes": 150, "points": 3200},
    4: {"sigma": 1.3, "hi": 0.030, "lo": 0.013, "min_len": 0.012, "rdp": 1.1, "strokes": 260, "points": 4600},
    5: {"sigma": 1.1, "hi": 0.024, "lo": 0.010, "min_len": 0.007, "rdp": 0.9, "strokes": 400, "points": 6000},
}
# Canny variant: share of pixels above the high threshold (by gradient), per detail.
CANNY_TOP = {1: 0.025, 2: 0.04, 3: 0.06, 4: 0.085, 5: 0.11}
# Stipple sites per detail (one point per site in the tour).
STIPPLES = {1: 900, 2: 1600, 3: 2600, 4: 3800, 5: 5200}
STIPPLE_GRID = 512
LLOYD_ITERS = 14
NEIGHBOURS = ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1))


# ------------------------------------------------------------------ input


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_rgb(path: Path) -> np.ndarray:
    """RGB uint8 with alpha composited over white, so a transparent logo is marks on paper."""
    raw = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if raw is None:
        raise SystemExit(f"cannot read image: {path}")
    if raw.ndim == 2:
        return cv2.cvtColor(raw, cv2.COLOR_GRAY2RGB)
    if raw.shape[2] == 4:
        alpha = raw[:, :, 3:4].astype(np.float32) / 255.0
        bgr = raw[:, :, :3].astype(np.float32) * alpha + 255.0 * (1.0 - alpha)
        return cv2.cvtColor(np.clip(np.rint(bgr), 0, 255).astype(np.uint8), cv2.COLOR_BGR2RGB)
    return cv2.cvtColor(raw, cv2.COLOR_BGR2RGB)


def resize_long(rgb: np.ndarray, long_side: int) -> np.ndarray:
    h, w = rgb.shape[:2]
    scale = long_side / max(h, w)
    if scale >= 1.0:
        return rgb
    return cv2.resize(rgb, (max(1, round(w * scale)), max(1, round(h * scale))), interpolation=cv2.INTER_AREA)


def ink_gray(rgb: np.ndarray) -> np.ndarray:
    """0..1 float gray, 0 = ink. On a flat light paper (a logo) use the distance from the paper colour,
    so a yellow mark is as dark as a black one. Contrast is stretched to the 1st..99th percentile."""
    luma = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    h, w = luma.shape
    band = max(2, round(0.03 * min(h, w)))
    border = np.concatenate(
        [rgb[:band].reshape(-1, 3), rgb[-band:].reshape(-1, 3), rgb[:, :band].reshape(-1, 3), rgb[:, -band:].reshape(-1, 3)]
    ).astype(np.float32)
    paper = np.median(border, axis=0)
    if float(paper.min()) > 225.0 and float(border.std()) < 12.0:
        gray = 1.0 - np.max(np.abs(rgb.astype(np.float32) - paper), axis=2) / 255.0
    else:
        gray = luma
    lo, hi = np.percentile(gray, [1.0, 99.0])
    if hi - lo < 1e-3:
        return gray
    return np.clip((gray - lo) / (hi - lo), 0.0, 1.0).astype(np.float32)


def bilateral(gray: np.ndarray, detail: int) -> np.ndarray:
    u8 = np.clip(np.rint(gray * 255.0), 0, 255).astype(np.uint8)
    sigma_color = 40.0 - 4.0 * detail
    passes = 2 if detail <= 2 else 1
    for _ in range(passes):
        u8 = cv2.bilateralFilter(u8, d=7, sigmaColor=sigma_color, sigmaSpace=5.0)
    return u8.astype(np.float32) / 255.0


# ------------------------------------------------------------------ line ink


def hysteresis(weak: np.ndarray, strong: np.ndarray) -> np.ndarray:
    count, labels = cv2.connectedComponents(weak.astype(np.uint8), connectivity=8)
    keep = np.zeros(count, dtype=bool)
    keep[np.unique(labels[strong & weak])] = True
    keep[0] = False
    return keep[labels]


def xdog_ink(soft: np.ndarray, detail: int) -> tuple[np.ndarray, np.ndarray]:
    """Line ink from the difference of Gaussians (XDoG with τ → 1, thresholded with hysteresis).
    Positive response = the dark side of an edge or a dark thin line; flat dark fills stay empty.
    The high threshold is the per-detail absolute one, lowered for a soft photo to the response that
    the top CANNY_TOP share of pixels reach (never below 0.01, so flat noise stays out)."""
    k = SKETCH[detail]
    g1 = cv2.GaussianBlur(soft, (0, 0), k["sigma"], borderType=cv2.BORDER_REPLICATE)
    g2 = cv2.GaussianBlur(soft, (0, 0), k["sigma"] * 1.6, borderType=cv2.BORDER_REPLICATE)
    dog = g2 - g1
    hi = min(k["hi"], max(0.010, float(np.percentile(dog, 100.0 * (1.0 - CANNY_TOP[detail])))))
    return hysteresis(dog > hi * k["lo"] / k["hi"], dog > hi), dog


def canny_ink(soft: np.ndarray, detail: int) -> tuple[np.ndarray, np.ndarray]:
    k = SKETCH[detail]
    blurred = cv2.GaussianBlur(soft, (0, 0), k["sigma"] * 0.6, borderType=cv2.BORDER_REPLICATE)
    u8 = np.clip(np.rint(blurred * 255.0), 0, 255).astype(np.uint8)
    gx = cv2.Sobel(u8, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(u8, cv2.CV_32F, 0, 1, ksize=3)
    mag = np.hypot(gx, gy)
    hi = max(float(np.percentile(mag, 100.0 * (1.0 - CANNY_TOP[detail]))), 40.0)
    edges = cv2.Canny(u8, hi * 0.4, hi, apertureSize=3, L2gradient=True) > 0
    return edges, mag / 1020.0


def prune_corners(skel: np.ndarray) -> np.ndarray:
    """Drop staircase corner pixels (p with two orthogonal neighbours that touch diagonally), so every
    interior skeleton pixel has exactly two neighbours and junctions are real junctions."""
    s = np.pad(skel.astype(bool), 1)
    for (ay, ax), (by, bx) in (((-1, 0), (0, 1)), ((0, 1), (1, 0)), ((1, 0), (0, -1)), ((0, -1), (-1, 0))):
        c = s[1:-1, 1:-1]
        a = s[1 + ay : s.shape[0] - 1 + ay, 1 + ax : s.shape[1] - 1 + ax]
        b = s[1 + by : s.shape[0] - 1 + by, 1 + bx : s.shape[1] - 1 + bx]
        # the opposite orthogonal neighbours and the opposite diagonal must be empty
        oy, ox = -(ay + by), -(ax + bx)
        o1 = s[1 - ay : s.shape[0] - 1 - ay, 1 - ax : s.shape[1] - 1 - ax]
        o2 = s[1 - by : s.shape[0] - 1 - by, 1 - bx : s.shape[1] - 1 - bx]
        o3 = s[1 + oy : s.shape[0] - 1 + oy, 1 + ox : s.shape[1] - 1 + ox]
        corner = c & a & b & ~o1 & ~o2 & ~o3
        s[1:-1, 1:-1] = c & ~corner
    return s[1:-1, 1:-1]


# ------------------------------------------------------------------ tracing


def trace(skel: np.ndarray) -> tuple[list[np.ndarray], list[bool]]:
    """Walk the 8-connected skeleton graph: one polyline per edge between nodes (degree ≠ 2), plus
    pure cycles. Points are (x, y) float arrays."""
    h, w = skel.shape
    ys, xs = np.nonzero(skel)
    n = len(xs)
    if n == 0:
        return [], []
    index = np.full((h + 2, w + 2), -1, dtype=np.int64)
    index[ys + 1, xs + 1] = np.arange(n)
    nbr = np.stack([index[ys + 1 + dy, xs + 1 + dx] for dy, dx in NEIGHBOURS], axis=1)
    adj = [[int(v) for v in row if v >= 0] for row in nbr.tolist()]
    deg = [len(a) for a in adj]
    used = bytearray(n)  # interior (degree-2) pixels already on a path
    node_pairs: set[tuple[int, int]] = set()
    paths: list[list[int]] = []
    closed: list[bool] = []

    def walk(start: int, nxt: int) -> list[int]:
        path = [start, nxt]
        prev, cur = start, nxt
        while deg[cur] == 2 and not used[cur]:
            used[cur] = 1
            a, b = adj[cur]
            step = b if a == prev else a
            path.append(step)
            prev, cur = cur, step
            if cur == start:
                break
        return path

    for p in range(n):
        if deg[p] == 2:
            continue
        for q in adj[p]:
            if deg[q] == 2:
                if used[q]:
                    continue
            else:
                key = (p, q) if p < q else (q, p)
                if key in node_pairs:
                    continue
                node_pairs.add(key)
            paths.append(walk(p, q))
            closed.append(False)
    for p in range(n):
        if deg[p] == 2 and not used[p]:
            start = adj[p][0]
            used[start] = 1
            path = walk(start, p)
            if path[-1] == path[0]:
                path.pop()
            paths.append(path)
            closed.append(True)
    xy = np.column_stack([xs, ys]).astype(np.float64)
    return [xy[np.asarray(p)] for p in paths], closed


def end_tangent(pts: np.ndarray, at_end: bool, reach: float = 6.0) -> np.ndarray:
    """Unit vector pointing out of the stroke at one end, measured over ~reach px."""
    seq = pts[::-1] if not at_end else pts
    tip = seq[-1]
    d = np.hypot(seq[:, 0] - tip[0], seq[:, 1] - tip[1])
    far = np.nonzero(d >= reach)[0]
    base = seq[far[-1]] if len(far) else seq[0]
    v = tip - base
    norm = float(np.hypot(v[0], v[1]))
    return v / norm if norm > 1e-9 else np.zeros(2)


def join_ends(strokes: list[np.ndarray], closed: list[bool], radius: float) -> tuple[list[np.ndarray], list[bool]]:
    """Merge open strokes whose ends meet (at a junction or across a small crack) and continue each
    other's heading. Greedy by cost, each end used once; deterministic tie-breaks by index."""
    open_ids = [i for i, c in enumerate(closed) if not c and len(strokes[i]) >= 2]
    if len(open_ids) < 2:
        return strokes, closed
    ends = []  # (stroke, which) — which 0 = start, 1 = end
    pos = []
    tan = []
    for i in open_ids:
        for which in (0, 1):
            ends.append((i, which))
            pos.append(strokes[i][-1 if which else 0])
            tan.append(end_tangent(strokes[i], bool(which)))
    pos_a = np.asarray(pos)
    tan_a = np.asarray(tan)
    pairs = cKDTree(pos_a).query_pairs(radius, output_type="ndarray")
    if len(pairs) == 0:
        return strokes, closed
    a, b = pairs[:, 0], pairs[:, 1]
    gap = pos_a[b] - pos_a[a]
    dist = np.hypot(gap[:, 0], gap[:, 1])
    cont = -np.einsum("ij,ij->i", tan_a[a], tan_a[b])  # 1 = b carries straight on from a
    unit = gap / np.maximum(dist, 1e-9)[:, None]
    lead_a = np.einsum("ij,ij->i", tan_a[a], unit)
    lead_b = -np.einsum("ij,ij->i", tan_a[b], unit)
    near = dist <= 2.0
    ok = (cont >= 0.35) & (near | ((lead_a >= 0.5) & (lead_b >= 0.5)))
    cost = dist / radius + (1.0 - cont)
    sel = np.nonzero(ok)[0]
    sel = sel[np.lexsort((b[sel], a[sel], cost[sel]))]

    m = len(ends)
    link = [-1] * m
    parent = list(range(len(strokes)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for k in sel.tolist():
        ea, eb = int(a[k]), int(b[k])
        if link[ea] >= 0 or link[eb] >= 0:
            continue
        sa, sb = ends[ea][0], ends[eb][0]
        ra, rb = find(sa), find(sb)
        if ra == rb:
            continue  # would close a chain into a loop; keep it open (cleaner pen path)
        parent[ra] = rb
        link[ea], link[eb] = eb, ea

    end_of = {}
    for e, (i, which) in enumerate(ends):
        end_of[(i, which)] = e
    seen = set()
    out: list[np.ndarray] = []
    out_closed: list[bool] = []
    for i, c in enumerate(closed):
        if c or len(strokes[i]) < 2:
            out.append(strokes[i])
            out_closed.append(c)
    for e0 in range(m):
        i, which = ends[e0]
        if i in seen or link[e0] >= 0:
            continue
        # e0 is a free end: walk the chain from here
        parts = []
        e_in = e0
        while True:
            i, which = ends[e_in]
            seen.add(i)
            seg = strokes[i] if which == 0 else strokes[i][::-1]
            parts.append(seg if not parts else seg[1:] if np.array_equal(seg[0], parts[-1][-1]) else seg)
            e_out = end_of[(i, 1 - which)]
            nxt = link[e_out]
            if nxt < 0:
                break
            e_in = nxt
        out.append(np.vstack(parts))
        out_closed.append(False)
    return out, out_closed


# ------------------------------------------------------------------ simplify / order / fit


def rdp(pts: np.ndarray, eps: float) -> np.ndarray:
    n = len(pts)
    if n < 3:
        return pts
    keep = np.zeros(n, dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        a, b = pts[i], pts[j]
        seg = pts[i + 1 : j]
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dy)
        if length < 1e-9:
            d = np.hypot(seg[:, 0] - a[0], seg[:, 1] - a[1])
        else:
            d = np.abs((seg[:, 0] - a[0]) * dy - (seg[:, 1] - a[1]) * dx) / length
        k = int(np.argmax(d))
        if d[k] > eps:
            m = i + 1 + k
            keep[m] = True
            stack.append((i, m))
            stack.append((m, j))
    return pts[keep]


def length_of(pts: np.ndarray, closed: bool = False) -> float:
    if len(pts) < 2:
        return 0.0
    d = np.diff(pts, axis=0)
    total = float(np.hypot(d[:, 0], d[:, 1]).sum())
    if closed:
        total += float(np.hypot(*(pts[0] - pts[-1])))
    return total


def sample_at(field: np.ndarray, pts: np.ndarray) -> np.ndarray:
    h, w = field.shape
    xi = np.clip(np.rint(pts[:, 0]).astype(np.int64), 0, w - 1)
    yi = np.clip(np.rint(pts[:, 1]).astype(np.int64), 0, h - 1)
    return field[yi, xi]


def select(strokes, closed, raw_len, strength, detail):
    """Simplify, drop short strokes, keep the most important under the per-detail caps. A short
    stroke on a hard edge (a small letter, an eye) survives down to 40 % of the length floor."""
    k = SKETCH[detail]
    min_len = k["min_len"] * raw_len
    lengths = [length_of(s, c) for s, c in zip(strokes, closed)]
    contrast = [float(np.mean(sample_at(strength, s))) for s in strokes]
    seen = [c for c, L in zip(contrast, lengths) if L >= 0.4 * min_len]
    ref = float(np.percentile(seen, 90.0)) + 1e-9 if seen else 1.0
    cand = []
    for s, c, L, con in zip(strokes, closed, lengths, contrast):
        floor = min_len * (0.4 if con >= 0.75 * ref else 1.0)
        if L < floor:
            continue
        pts = rdp(np.vstack([s, s[:1]]), k["rdp"])[:-1] if c and len(s) >= 3 else rdp(s, k["rdp"])
        if c and len(pts) < 3:
            c = False
        if len(pts) < 2:
            continue
        cand.append((pts, c, L, con))
    if not cand:
        return [], [], []
    importance = [x[2] * (0.35 + min(1.0, x[3] / ref)) for x in cand]
    order = sorted(range(len(cand)), key=lambda i: (-importance[i], i))
    chosen, budget = [], 0
    for i in order:
        n = len(cand[i][0])
        if len(chosen) >= k["strokes"]:
            break
        if budget + n > k["points"]:
            continue
        chosen.append(i)
        budget += n
    chosen.sort()
    return [cand[i][0] for i in chosen], [cand[i][1] for i in chosen], [importance[i] for i in chosen]


def roll_to(pts: np.ndarray, at: int) -> np.ndarray:
    return np.vstack([pts[at:], pts[:at]])


def order_outline_first(strokes, closed, importance, shape):
    """Outline first: the strongest long strokes that ride the outside of the drawing, chained by
    nearest neighbour from the top; then every remaining stroke by greedy nearest neighbour."""
    n = len(strokes)
    if n == 0:
        return [], [], []
    cloud = np.vstack(strokes).astype(np.float32)
    hull = cv2.convexHull(cloud.reshape(-1, 1, 2))
    diag = math.hypot(*shape)
    outer = []
    for s in strokes:
        sample = s[:: max(1, len(s) // 12)]
        d = [abs(cv2.pointPolygonTest(hull, (float(p[0]), float(p[1])), True)) for p in sample]
        outer.append(1.0 - min(1.0, float(np.median(d)) / (0.18 * diag)))
    score = [imp * (0.6 + 0.8 * o) for imp, o in zip(importance, outer)]
    k = max(2, min(n, round(0.12 * n), 24)) if n > 2 else n
    group = sorted(range(n), key=lambda i: (-score[i], i))[:k]
    rest = sorted(set(range(n)) - set(group))
    result, flags, is_outline = [], [], []

    def take(i: int, pen: np.ndarray | None) -> np.ndarray:
        s = strokes[i]
        if closed[i]:
            at = int(np.argmin(s[:, 1] * 4096 + s[:, 0])) if pen is None else int(np.argmin(np.hypot(s[:, 0] - pen[0], s[:, 1] - pen[1])))
            return roll_to(s, at)
        if pen is None:
            return s if (s[0, 1], s[0, 0]) <= (s[-1, 1], s[-1, 0]) else s[::-1]
        return s if math.hypot(*(s[0] - pen)) <= math.hypot(*(s[-1] - pen)) else s[::-1]

    def chain(pool: list[int], pen: np.ndarray | None, outline: bool) -> np.ndarray | None:
        pool = list(pool)
        if pen is None and pool:
            first = pool.pop(0)  # pool is sorted by score for the outline group
            s = take(first, None)
            result.append(s); flags.append(closed[first]); is_outline.append(outline)
            pen = s[0] if closed[first] else s[-1]
        while pool:
            best, best_d = 0, math.inf
            for j, i in enumerate(pool):
                s = strokes[i]
                if closed[i]:
                    d = float(np.min(np.hypot(s[:, 0] - pen[0], s[:, 1] - pen[1])))
                else:
                    d = min(math.hypot(*(s[0] - pen)), math.hypot(*(s[-1] - pen)))
                if d < best_d:
                    best, best_d = j, d
            i = pool.pop(best)
            s = take(i, pen)
            result.append(s); flags.append(closed[i]); is_outline.append(outline)
            pen = s[0] if closed[i] else s[-1]
        return pen

    pen = chain(group, None, True)
    chain(rest, pen, False)
    return result, flags, is_outline


def fit_box(strokes: list[np.ndarray]) -> tuple[float, np.ndarray, list[int]]:
    cloud = np.vstack(strokes)
    lo = cloud.min(axis=0)
    span = np.maximum(cloud.max(axis=0) - lo, 1.0)
    scale = (BOX_MAX - 2 * BOX_PAD) / float(span.max())
    box = [int(math.ceil(float(span[0]) * scale)) + 2 * BOX_PAD, int(math.ceil(float(span[1]) * scale)) + 2 * BOX_PAD]
    box = [min(BOX_MAX, b) for b in box]
    return scale, lo, box


def quantise(pts: np.ndarray, scale: float, lo: np.ndarray, box: list[int]) -> list[list[int]]:
    q = np.rint((pts - lo) * scale + BOX_PAD).astype(np.int64)
    q[:, 0] = np.clip(q[:, 0], 0, box[0])
    q[:, 1] = np.clip(q[:, 1], 0, box[1])
    keep = np.ones(len(q), dtype=bool)
    keep[1:] = np.any(q[1:] != q[:-1], axis=1)
    return q[keep].tolist()


# ------------------------------------------------------------------ sketch


def sketch_strokes(gray: np.ndarray, detail: int, edges: str) -> tuple[list[np.ndarray], list[bool], list[bool], dict]:
    t = time.perf_counter()
    soft = bilateral(gray, detail)
    ink, strength = xdog_ink(soft, detail) if edges == "xdog" else canny_ink(soft, detail)
    t_ink = time.perf_counter()
    skel = prune_corners(skeletonize(ink))
    strokes, closed = trace(skel)
    t_trace = time.perf_counter()
    raw_len = math.hypot(*gray.shape)
    strokes, closed = join_ends(strokes, closed, radius=max(3.0, 0.008 * raw_len))
    kept, kept_closed, importance = select(strokes, closed, raw_len, np.abs(strength), detail)
    t_sel = time.perf_counter()
    ordered, flags, outline = order_outline_first(kept, kept_closed, importance, gray.shape)
    info = {
        "edges": edges,
        "ink_px": int(np.count_nonzero(ink)),
        "skeleton_px": int(np.count_nonzero(skel)),
        "traced": len(strokes),
        "ms": {
            "ink": round((t_ink - t) * 1000.0, 1),
            "trace": round((t_trace - t_ink) * 1000.0, 1),
            "join_select": round((t_sel - t_trace) * 1000.0, 1),
            "order": round((time.perf_counter() - t_sel) * 1000.0, 1),
        },
    }
    return ordered, flags, outline, info


def build_sketch(gray: np.ndarray, detail: int, edges: str) -> tuple[list[dict], list[int], dict]:
    ordered, flags, outline, info = sketch_strokes(gray, detail, edges)
    if not ordered:
        raise SystemExit("no strokes survived; try a higher --detail")
    scale, lo, box = fit_box(ordered)
    bold = {1: 2.0, 2: 1.7, 3: 1.5, 4: 1.35, 5: 1.25}[detail]
    out = []
    for s, c, o in zip(ordered, flags, outline):
        pts = quantise(s, scale, lo, box)
        if len(pts) < 2:
            continue
        stroke: dict = {"pts": pts, "w": bold if o else 1}
        if c and len(pts) >= 3:
            stroke["closed"] = True
        out.append(stroke)
    return out, box, info


# ------------------------------------------------------------------ line: stipple tour


def stipple_weight(gray: np.ndarray, detail: int) -> np.ndarray:
    """Darkness after local contrast (CLAHE), steepened so mid-tones thin out, plus edges so outlines
    get a denser line than flat areas. Light tones (paper) get no sites at all."""
    u8 = np.clip(np.rint(gray * 255.0), 0, 255).astype(np.uint8)
    local = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(6, 6)).apply(u8).astype(np.float32) / 255.0
    soft = cv2.GaussianBlur(local, (0, 0), 1.0)
    tone = np.clip((0.85 - soft) / 0.85, 0.0, 1.0) ** 2.4
    gx = cv2.Sobel(soft, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(soft, cv2.CV_32F, 0, 1, ksize=3)
    mag = np.hypot(gx, gy)
    mag = np.clip(mag / (float(np.percentile(mag, 98.0)) + 1e-6), 0.0, 1.0)
    w = 0.6 * tone + 0.4 * mag**1.5
    w[w < 0.04] = 0.0
    return w.astype(np.float64)


def stipple(weight: np.ndarray, count: int, rng: np.random.Generator) -> np.ndarray:
    """Weighted Lloyd (Secord) stippling: seeded weighted sampling, then centroid relaxation."""
    ys, xs = np.nonzero(weight > 0)
    if len(xs) == 0:
        raise SystemExit("image has no dark pixels to stipple")
    wv = weight[ys, xs]
    count = min(count, len(xs))
    pick = rng.choice(len(xs), size=count, replace=False, p=wv / wv.sum())
    sites = np.column_stack([xs[pick], ys[pick]]).astype(np.float64) + rng.random((count, 2))
    coords = np.column_stack([xs, ys]).astype(np.float64) + 0.5
    wx, wy = wv * coords[:, 0], wv * coords[:, 1]
    for _ in range(LLOYD_ITERS):
        _, lab = cKDTree(sites).query(coords, workers=-1)
        mass = np.bincount(lab, wv, count)
        has = mass > 0
        sites[has, 0] = np.bincount(lab, wx, count)[has] / mass[has]
        sites[has, 1] = np.bincount(lab, wy, count)[has] / mass[has]
    return sites


def nn_tour(p: np.ndarray) -> np.ndarray:
    n = len(p)
    start = int(np.argmin(p[:, 0] + p[:, 1]))  # nearest the top-left corner
    left = np.ones(n, dtype=bool)
    order = np.empty(n, dtype=np.int64)
    cur = start
    x, y = p[:, 0], p[:, 1]
    for k in range(n):
        order[k] = cur
        left[cur] = False
        if k == n - 1:
            break
        d = (x - x[cur]) ** 2 + (y - y[cur]) ** 2
        d[~left] = np.inf
        cur = int(np.argmin(d))
    return order


def two_opt(p: np.ndarray, order: np.ndarray, k: int = 10, passes: int = 8) -> tuple[np.ndarray, int]:
    """Neighbour-list 2-opt on an open path. Fixed pass cap, no clock: deterministic."""
    n = len(order)
    nbrs = cKDTree(p).query(p, k + 1)[1][:, 1:].tolist()
    X, Y = p[:, 0].tolist(), p[:, 1].tolist()
    o = order.copy()
    pos = np.empty(n, dtype=np.int64)
    pos[o] = np.arange(n)
    hyp = math.hypot
    moves = 0
    for _ in range(passes):
        improved = False
        ol = o.tolist()
        for a in range(n - 1):
            i, i2 = ol[a], ol[a + 1]
            d0 = hyp(X[i] - X[i2], Y[i] - Y[i2])
            for j in nbrs[i]:
                dij = hyp(X[i] - X[j], Y[i] - Y[j])
                if dij >= d0:
                    break
                b = int(pos[j])
                lo, hi = (a, b) if a < b else (b, a)
                if hi - lo < 2 and not (hi == n - 1 and hi - lo >= 1):
                    continue
                p1, p2 = ol[lo], ol[lo + 1]
                q1 = ol[hi]
                removed = hyp(X[p1] - X[p2], Y[p1] - Y[p2])
                added = hyp(X[p1] - X[q1], Y[p1] - Y[q1])
                if hi + 1 < n:
                    q2 = ol[hi + 1]
                    removed += hyp(X[q1] - X[q2], Y[q1] - Y[q2])
                    added += hyp(X[p2] - X[q2], Y[p2] - Y[q2])
                if added + 1e-9 < removed:
                    ol[lo + 1 : hi + 1] = ol[lo + 1 : hi + 1][::-1]
                    pos[ol[lo + 1 : hi + 1]] = np.arange(lo + 1, hi + 1)
                    moves += 1
                    improved = True
                    i, i2 = ol[a], ol[a + 1]
                    d0 = hyp(X[i] - X[i2], Y[i] - Y[i2])
        o = np.asarray(ol, dtype=np.int64)
        if not improved:
            break
    return o, moves


def smooth_path(pts: np.ndarray, limit: float) -> np.ndarray:
    """One light Laplacian pass, skipped where a step is a long pen travel (keeps jumps straight)."""
    if len(pts) < 3:
        return pts
    d = np.hypot(*np.diff(pts, axis=0).T)
    ok = (d[:-1] < limit) & (d[1:] < limit)
    out = pts.copy()
    mid = 0.5 * pts[1:-1] + 0.25 * (pts[:-2] + pts[2:])
    out[1:-1][ok] = mid[ok]
    return out


def build_stipple(gray: np.ndarray, detail: int, seed: int) -> tuple[list[dict], list[int], dict]:
    t0 = time.perf_counter()
    h, w = gray.shape
    scale = STIPPLE_GRID / max(h, w)
    small = cv2.resize(gray, (max(1, round(w * scale)), max(1, round(h * scale))), interpolation=cv2.INTER_AREA) if scale < 1 else gray
    weight = stipple_weight(small, detail)
    rng = np.random.Generator(np.random.PCG64(seed))
    sites = stipple(weight, STIPPLES[detail], rng)
    t1 = time.perf_counter()
    order = nn_tour(sites)
    t2 = time.perf_counter()
    order, moves = two_opt(sites, order)
    t3 = time.perf_counter()
    path = sites[order]
    steps = np.hypot(*np.diff(path, axis=0).T)
    path = smooth_path(path, 2.5 * float(np.median(steps)))
    sx, lo, box = fit_box([path])
    pts = quantise(path, sx, lo, box)
    info = {
        "sites": len(sites),
        "two_opt_moves": moves,
        "tour_len_px": round(float(steps.sum()), 1),
        "ms": {
            "stipple": round((t1 - t0) * 1000.0, 1),
            "nn_tour": round((t2 - t1) * 1000.0, 1),
            "two_opt": round((t3 - t2) * 1000.0, 1),
        },
    }
    # A tour shows tone by line density, so it wants a fine nib: ½ of the house width.
    return [{"pts": pts, "w": 0.5}], box, info


def chain_travel(parts: list[np.ndarray], passes: int = 6) -> list[np.ndarray]:
    """Shorten the pen travel between strokes: 2-opt over the stroke sequence (reversing a run also
    reverses each stroke in it), keeping the first (outline) stroke first. Then drop strokes that
    cost more travel than ink. Fixed pass caps, index tie-breaks: deterministic."""
    seq = [p.copy() for p in parts]
    hyp = math.hypot

    def gap(a: np.ndarray, b: np.ndarray) -> float:
        return hyp(float(b[0, 0] - a[-1, 0]), float(b[0, 1] - a[-1, 1]))

    for _ in range(passes):
        improved = False
        n = len(seq)
        for i in range(1, n - 1):
            for j in range(i + 1, n):
                before = gap(seq[i - 1], seq[i]) + (gap(seq[j], seq[j + 1]) if j + 1 < n else 0.0)
                a, b = seq[i - 1][-1], seq[j][-1]
                after = hyp(float(b[0] - a[0]), float(b[1] - a[1]))
                if j + 1 < n:
                    c, d = seq[i][0], seq[j + 1][0]
                    after += hyp(float(d[0] - c[0]), float(d[1] - c[1]))
                if after + 1e-6 < before:
                    seq[i : j + 1] = [s[::-1] for s in reversed(seq[i : j + 1])]
                    improved = True
        if not improved:
            break
    for _ in range(3):
        keep = [seq[0]]
        for k in range(1, len(seq)):
            s = seq[k]
            nxt = seq[k + 1] if k + 1 < len(seq) else None
            detour = gap(keep[-1], s) + (gap(s, nxt) if nxt is not None else 0.0)
            if nxt is not None:
                a, b = keep[-1][-1], nxt[0]
                detour -= hyp(float(b[0] - a[0]), float(b[1] - a[1]))
            if length_of(s) >= 0.5 * detour:
                keep.append(s)
        if len(keep) == len(seq):
            break
        seq = keep
    return seq


def build_chain(gray: np.ndarray, detail: int, edges: str) -> tuple[list[dict], list[int], dict]:
    """Hybrid line: the sketch's strokes, re-ordered for short pen travel, joined by straight travel."""
    ordered, flags, _outline, info = sketch_strokes(gray, detail, edges)
    if not ordered:
        raise SystemExit("no strokes survived; try a higher --detail")
    parts = [np.vstack([s, s[:1]]) if c else s for s, c in zip(ordered, flags)]
    t = time.perf_counter()
    parts = chain_travel(parts)
    info["ms"]["chain"] = round((time.perf_counter() - t) * 1000.0, 1)
    path = np.vstack(parts)
    scale, lo, box = fit_box([path])
    pts = quantise(path, scale, lo, box)
    travel = sum(math.hypot(*(parts[i + 1][0] - parts[i][-1])) for i in range(len(parts) - 1))
    info = {**info, "joined": len(parts), "travel_share": round(travel / max(1e-9, length_of(path)), 3)}
    return [{"pts": pts, "w": 1}], box, info


# ------------------------------------------------------------------ doc


def problems(doc: dict) -> list[str]:
    w, h = doc["box"]
    found = []
    if not (isinstance(w, int) and isinstance(h, int) and 0 < w <= BOX_MAX and 0 < h <= BOX_MAX):
        found.append(f"box {w}x{h}")
    strokes = doc["strokes"]
    if not strokes or len(strokes) > MAX_STROKES:
        found.append(f"{len(strokes)} strokes")
    if doc["mode"] == "line" and len(strokes) != 1:
        found.append(f"line mode has {len(strokes)} strokes")
    total = 0
    for i, s in enumerate(strokes):
        total += len(s["pts"])
        if any(type(x) is not int or type(y) is not int or not (0 <= x <= w and 0 <= y <= h) for x, y in s["pts"]):
            found.append(f"stroke {i} has a point outside the box")
    if total > MAX_POINTS:
        found.append(f"{total} points")
    return found


def build_doc(image: Path, mode: str, detail: int, seed: int, edges: str, engine: str) -> tuple[dict, dict]:
    rgb = resize_long(load_rgb(image), LONG_SIDE)
    gray = ink_gray(rgb)
    if mode == "sketch":
        strokes, box, info = build_sketch(gray, detail, edges)
        model, version = f"{edges}-trace", VERSION["sketch"]
    elif engine == "stipple":
        strokes, box, info = build_stipple(gray, detail, seed)
        model, version = "stipple-tour", VERSION["stipple"]
    else:
        strokes, box, info = build_chain(gray, detail, edges)
        model, version = f"{edges}-chain", VERSION["chain"]
    doc = {
        "v": 1,
        "box": box,
        "mode": mode,
        "strokes": strokes,
        "meta": {
            "source": "image",
            "imageHash": file_sha256(image),
            "provider": "sidecar-sketch",
            "model": model,
            "detail": detail,
            "seed": seed,
            "version": version,
        },
    }
    bad = problems(doc)
    if bad:
        raise SystemExit("invalid SketchDoc: " + "; ".join(bad))
    info["work_px"] = [int(gray.shape[1]), int(gray.shape[0])]
    return doc, info


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Image to SketchDoc (sketch strokes or one continuous line)")
    ap.add_argument("image", type=Path)
    ap.add_argument("--mode", required=True, choices=("sketch", "line"))
    ap.add_argument("--detail", type=int, default=3, choices=(1, 2, 3, 4, 5))
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--edges", default="xdog", choices=("xdog", "canny"), help="line extractor (spike comparison)")
    ap.add_argument("--line-engine", default="stipple", choices=("stipple", "chain"), help="line mode engine")
    args = ap.parse_args(argv)
    started = time.perf_counter()
    doc, info = build_doc(args.image, args.mode, args.detail, args.seed, args.edges, args.line_engine)
    pipeline_ms = (time.perf_counter() - started) * 1000.0
    text = json.dumps(doc, separators=(",", ":"), allow_nan=False) + "\n"
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(text, encoding="utf-8")
    timing = {
        "image": args.image.name,
        "mode": args.mode,
        "model": doc["meta"]["model"],
        "detail": args.detail,
        "seed": args.seed,
        "import_ms": round(IMPORT_MS, 1),
        "pipeline_ms": round(pipeline_ms, 1),
        "strokes": len(doc["strokes"]),
        "points": sum(len(s["pts"]) for s in doc["strokes"]),
        "box": doc["box"],
        "sha256": hashlib.sha256(text.encode()).hexdigest(),
        **info,
    }
    print(json.dumps(timing), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
