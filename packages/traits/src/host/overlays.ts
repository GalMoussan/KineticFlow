/**
 * Sketch overlays (SKETCH-PLAN.md P1, SK12): the section sketches of `REEL.sketches`, drawn on in SVG over or under
 * the scene. Not a trait: sketches belong to sections, their timing comes from the cue sheet's `sketch-in` /
 * `sketch-out` cues and their look is resolved in Node (`resolveSketchLook`).
 *
 * Mounts (back to front):
 * - `ovUnder`: one screen-space `div.ov-under` per scene layer, between the layer's background (`.under`) and its
 *   camera (`.cam`). Backgrounds are opaque and live inside each layer, so a stage-level mount below the layers would
 *   be invisible; a sketch on the under layer is drawn in every layer its sections use, and each copy wipes, fades
 *   and hides with its layer.
 * - `ovOver`: one stage-level `div.ov-over` above every layer and trait-owned stage element, below the transition
 *   flash. It spans section and layer boundaries.
 *
 * Draw-on by arc length (README §1: a pure function of t; every property this module ever sets is rewritten on every
 * frame; no CSS animation/transition, canvas, `will-change`, blend modes or 3D transforms):
 * - Line: one fixed path, `stroke-dasharray` / `stroke-dashoffset` per frame, optional pen-tip dot.
 * - Sketch: perfect-freehand outlines precomputed at `ready()` (only the one partial stroke is rebuilt per frame),
 *   plus a faint jitter pass when `rough > 0`; `boil` moves each stroke's faint pass with an SVG `translate` that
 *   changes every 4 frames. Pen width scales down with stroke density so dense hatching stays hatching.
 */
import { getStroke, type StrokeOptions } from 'perfect-freehand';
// value imports from core must avoid its index: the schemas would bring zod (and its CSP-blocked eval probe) into the page
import { seedOf } from '@reel/core/seed.ts';
import type { OverlayBox, SketchDoc, SketchLook, SketchRef, SoundCue, TextBox } from '@reel/core';
import { clamp01, easeInOut, hash } from '@reel/runtime';
import type { Host, Layer, Section } from '../contract.ts';
import { autoCap, autoPlacement, framePlacement, rotatedBounds, TEXT_MARGIN, type Rect } from '../lib/placement.ts';

/** Bump when overlay drawing changes pixels for the same inputs (it is part of every fingerprint with a sketch). */
const OVERLAY_VERSION = 'overlays@1';
/** House pen width as a share of the frame's short side (≈ 8 px at 1080). */
const PEN = 0.0075;
/** Ink coverage of the drawing's box above which the pen thins (SK12), and the thinnest it gets. */
const MAX_COVERAGE = 0.14;
const MIN_THIN = 0.3;
/** Opacity of an auto-placed sketch that found no free space and went under the text. */
const FALLBACK_OPACITY = 0.35;

export interface Overlays {
  /** Draws every sketch for reel time t (last step of `seek`). */
  frame(t: number): void;
  /** Sketches that can be visible in [t0, t1): drawing hash, times, placement and look. `null` when none. */
  fingerprint(t0: number, t1: number): unknown[] | null;
  /** Scribble / pop cues of every sketch (before the host's thinning pass). */
  sounds(): SoundCue[];
  /** Placement of every sketch; `visible` for the last frame drawn. */
  boxes(): OverlayBox[];
}

/** What the overlays need from the host while they solve placement inside `ready()`. */
export interface HostProbe {
  seek(t: number): void;
  boxes(): TextBox[];
}

type Point = readonly [number, number, number?];

interface Arc {
  pts: Point[];
  cum: Float64Array;
  len: number;
  /** Relative width of the stroke (the doc's widest = 1). */
  rel: number;
}

interface Times {
  tIn: number;
  drawEnd: number;
  exitStart: number;
  tOut: number;
}

interface Placed {
  ref: SketchRef;
  doc: SketchDoc;
  section: Section;
  /** Owning section … `until`, in reel order. */
  span: Section[];
  times: Times;
  rect: Rect;
  rot: number;
  mirror: boolean;
  layer: 'under' | 'over';
  fallback: boolean;
  opacity: number;
  /** Pen width in screen px after density thinning. */
  pen: number;
  /** Arc-length tables of the strokes, built once (density thinning and drawing share them). */
  arcs: Arc[];
  sessions: Session[];
}

interface Frame {
  visible: boolean;
  p: number;
  opacity: number;
  color: string;
  /** Boil bucket (`floor(t·fps/4)`), 0 without boil. */
  bucket: number;
}

interface Session {
  update(f: Frame): void;
}

const NS = 'http://www.w3.org/2000/svg';
const written = new WeakMap<Element, Map<string, string>>();

/** Writes only when the value differs from what this module last wrote (only this module writes these elements). */
function put(el: SVGElement, name: string, value: string): void {
  let m = written.get(el);
  if (!m) written.set(el, (m = new Map()));
  if (m.get(name) === value) return;
  m.set(name, value);
  if (name.startsWith('style:')) el.style.setProperty(name.slice(6), value);
  else el.setAttribute(name, value);
}

function num(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

function arcOf(s: SketchDoc['strokes'][number], maxW: number): Arc {
  const src = s.pts;
  const first = src[0]!;
  const last = src[src.length - 1]!;
  const closed = !!s.closed && src.length > 2 && (first[0] !== last[0] || first[1] !== last[1]);
  const pts: Point[] = closed ? [...src, first] : src.slice();
  const cum = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  return { pts, cum, len: cum[pts.length - 1]!, rel: Math.max(0.35, (s.w ?? 1) / maxW) };
}

/** Point at arc length `d` and the index of the first point past it. */
function pointAt(a: Arc, d: number): { x: number; y: number; i: number } {
  const n = a.pts.length;
  if (d <= 0) return { x: a.pts[0]![0], y: a.pts[0]![1], i: 1 };
  if (d >= a.len) return { x: a.pts[n - 1]![0], y: a.pts[n - 1]![1], i: n };
  let lo = 1;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a.cum[mid]! < d) lo = mid + 1;
    else hi = mid;
  }
  const p = a.pts[lo - 1]!;
  const q = a.pts[lo]!;
  const seg = a.cum[lo]! - a.cum[lo - 1]!;
  const k = seg > 0 ? (d - a.cum[lo - 1]!) / seg : 0;
  return { x: p[0] + (q[0] - p[0]) * k, y: p[1] + (q[1] - p[1]) * k, i: lo };
}

/** The drawn prefix of a stroke up to arc length `d`. */
function prefix(a: Arc, d: number): Point[] {
  if (d >= a.len) return a.pts;
  const tip = pointAt(a, d);
  return [...a.pts.slice(0, tip.i), [tip.x, tip.y]];
}

const strokeOpts = (size: number, pressure: boolean): StrokeOptions => ({
  size,
  thinning: 0.55,
  smoothing: 0.5,
  streamline: 0.45,
  simulatePressure: !pressure,
  easing: (v) => v,
  start: { cap: true, taper: 0 },
  end: { cap: true, taper: 0 },
  last: true,
});

/** perfect-freehand outline as a closed quadratic path (the library's midpoint form). */
function outline(pts: readonly Point[], size: number): string {
  if (pts.length < 2) return '';
  const pressure = pts.every((p) => p[2] !== undefined);
  const o = getStroke(pts.map((p) => (pressure ? [p[0], p[1], p[2]!] : [p[0], p[1]])), strokeOpts(size, pressure));
  const n = o.length;
  if (n < 2) return '';
  const parts = ['M', num(o[0]![0]!), ' ', num(o[0]![1]!), 'Q'];
  for (let i = 0; i < n; i++) {
    const a = o[i]!;
    const b = o[(i + 1) % n]!;
    parts.push(num(a[0]!), ' ', num(a[1]!), ' ', num((a[0]! + b[0]!) / 2), ' ', num((a[1]! + b[1]!) / 2), ' ');
  }
  parts.push('Z');
  return parts.join('');
}

function rgba(hex: string, a: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Faint-pass offset of stroke `i` (box units): fixed per (sketch, stroke), or per boil bucket. */
function jitter(seed: number, i: number, bucket: number, amp: number): { x: number; y: number } {
  const n = (seed + i * 7919 + bucket * 104729) % 1_000_003;
  return { x: (hash(n) * 2 - 1) * amp, y: (hash(n + 97) * 2 - 1) * amp };
}

/** One drawing in one mount: an `<svg>` at `rect`, its strokes in the doc's box. */
function session(mount: Element, o: Placed, arcs: Arc[], sizeBox: number): Session {
  const { doc, ref, rect, rot, mirror } = o;
  const [bw, bh] = doc.box;
  const look: SketchLook = ref.look;
  const svg = document.createElementNS(NS, 'svg');
  mount.appendChild(svg);
  const g = document.createElementNS(NS, 'g');
  svg.appendChild(g);
  const transform = [rot ? `rotate(${num(rot)} ${num(bw / 2)} ${num(bh / 2)})` : '', mirror ? `translate(${bw} 0) scale(-1 1)` : '']
    .filter(Boolean)
    .join(' ');
  const total = arcs.reduce((s, a) => s + a.len, 0);
  const frameSvg = (f: Frame) => {
    put(svg, 'viewBox', `0 0 ${bw} ${bh}`);
    put(svg, 'preserveAspectRatio', 'xMidYMid meet');
    put(svg, 'style:position', 'absolute');
    put(svg, 'style:overflow', 'visible');
    put(svg, 'style:left', `${num(rect.x)}px`);
    put(svg, 'style:top', `${num(rect.y)}px`);
    put(svg, 'style:width', `${num(rect.w)}px`);
    put(svg, 'style:height', `${num(rect.h)}px`);
    put(svg, 'style:display', f.visible ? 'block' : 'none');
    put(svg, 'style:opacity', f.opacity.toFixed(3));
    put(g, 'transform', transform);
  };
  const pen = look.pen ? document.createElementNS(NS, 'circle') : null;
  const drawPen = (tip: { x: number; y: number } | null, color: string) => {
    if (!pen) return;
    put(pen, 'r', num(sizeBox * 0.9));
    put(pen, 'fill', color);
    put(pen, 'cx', num(tip?.x ?? 0));
    put(pen, 'cy', num(tip?.y ?? 0));
    put(pen, 'visibility', tip ? 'visible' : 'hidden');
  };

  if (doc.mode === 'line') {
    const a = arcs[0]!;
    const path = document.createElementNS(NS, 'path');
    g.appendChild(path);
    if (pen) g.appendChild(pen);
    const d = ['M', num(a.pts[0]![0]), ' ', num(a.pts[0]![1]), ...a.pts.slice(1).flatMap((p) => ['L', num(p[0]), ' ', num(p[1])])].join('');
    const len = a.len.toFixed(3);
    return {
      update(f) {
        frameSvg(f);
        const dist = f.p * a.len;
        put(path, 'd', d);
        put(path, 'fill', 'none');
        put(path, 'stroke', f.color);
        put(path, 'stroke-width', num(sizeBox));
        put(path, 'stroke-linecap', 'round');
        put(path, 'stroke-linejoin', 'round');
        put(path, 'stroke-dasharray', `${len} ${len}`);
        put(path, 'stroke-dashoffset', (a.len - dist).toFixed(3));
        put(path, 'visibility', f.p > 0 ? 'visible' : 'hidden');
        drawPen(f.p > 0 && f.p < 1 ? pointAt(a, dist) : null, f.color);
      },
    };
  }

  const amp = look.rough * 0.015 * Math.max(bw, bh);
  const faint = amp > 0;
  const seed = seedOf(ref.id) % 1_000_003;
  const strokes = arcs.map((a, i) => {
    const size = sizeBox * a.rel;
    const fp = faint ? document.createElementNS(NS, 'path') : null;
    if (fp) g.appendChild(fp);
    const main = document.createElementNS(NS, 'path');
    g.appendChild(main);
    return { a, size, main, fp, mainD: outline(a.pts, size), faintD: fp ? outline(a.pts, size * 0.7) : '', i };
  });
  if (pen) g.appendChild(pen);
  return {
    update(f) {
      frameSvg(f);
      let left = f.p * total;
      let tip: { x: number; y: number } | null = null;
      for (const s of strokes) {
        put(s.main, 'fill', f.color);
        let mainD = '';
        let faintD = '';
        if (left > 0 && s.a.len > 0) {
          if (left >= s.a.len) {
            mainD = s.mainD;
            faintD = s.faintD;
            tip = pointAt(s.a, s.a.len);
          } else {
            const part = prefix(s.a, left);
            mainD = outline(part, s.size);
            faintD = s.fp ? outline(part, s.size * 0.7) : '';
            tip = pointAt(s.a, left);
          }
          left -= s.a.len;
        }
        put(s.main, 'd', mainD);
        if (s.fp) {
          const j = jitter(seed, s.i, f.bucket, amp);
          put(s.fp, 'fill', rgba(f.color, 0.35));
          put(s.fp, 'transform', `translate(${num(j.x)} ${num(j.y)})`);
          put(s.fp, 'd', faintD);
        }
      }
      drawPen(f.p > 0 && f.p < 1 ? tip : null, f.color);
    },
  };
}

const EASE: Record<SketchLook['ease'], (k: number) => number> = {
  smooth: easeInOut,
  functional: (k) => k * (2 - k),
  snap: (k) => k,
};

export function mountOverlays(host: Host, probe: HostProbe): Overlays | null {
  const refs = host.reel.sketches ?? [];
  if (!refs.length) return null;
  const { cues, fps } = host.reel.cues;
  const sectionIndex = new Map(host.sections.map((s, i) => [s.id, i]));

  // text boxes at every hold a sketch spans (cached per time; seeking here is pure, the first real seek redraws all)
  const boxesAt = new Map<number, TextBox[]>();
  const holdBoxes = (s: Section): TextBox[] => {
    const out: TextBox[] = [];
    for (const t of [s.timing.holdStart, Math.max(s.timing.holdStart, s.timing.holdEnd - 1 / fps)]) {
      let b = boxesAt.get(t);
      if (!b) {
        probe.seek(t);
        boxesAt.set(t, (b = probe.boxes()));
      }
      out.push(...b);
    }
    return out;
  };

  const safe: Rect = { x: host.safe.left, y: host.safe.top, w: host.safe.w, h: host.safe.h };
  const margin = TEXT_MARGIN * Math.min(host.W, host.H);
  const placed: Placed[] = [];
  for (const ref of refs) {
    const doc = ref.doc;
    const i0 = sectionIndex.get(ref.section)!;
    const i1 = sectionIndex.get(ref.until)!;
    const span = host.sections.slice(i0, i1 + 1);
    const section = span[0]!;
    const cue = (type: 'sketch-in' | 'sketch-out') => {
      const c = cues.find((x) => x.type === type && x.sketch === ref.id);
      if (!c || c.until === undefined) throw new Error(`sketch "${ref.id}": the cue sheet has no ${type} cue`);
      return c;
    };
    const cin = cue('sketch-in');
    const cout = cue('sketch-out');
    const times: Times = { tIn: cin.t, drawEnd: cin.until!, exitStart: cout.t, tOut: cout.until! };
    let rect: Rect;
    let fallback = false;
    let rot = 0;
    if (ref.place.mode === 'frame') {
      rect = framePlacement(doc.box, ref.place, safe);
      rot = ref.place.rot ?? 0;
    } else {
      // auto (and `word` until word attachment lands): free space beside every text box at the spanned holds and
      // every sketch already placed that is on screen at the same time
      const obstacles: Rect[] = span.flatMap(holdBoxes).map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
      for (const o of placed) if (o.times.tIn < times.tOut && times.tIn < o.times.tOut) obstacles.push(rotatedBounds(o.rect, o.rot));
      const auto = autoPlacement(doc.box, safe, obstacles, margin, autoCap(safe, doc.meta.source === 'preset'));
      rect = auto.rect;
      fallback = auto.fallback;
    }
    const layer = fallback ? 'under' : ref.look.layer;
    const maxW = Math.max(...doc.strokes.map((s) => s.w ?? 1));
    const arcs = doc.strokes.map((s) => arcOf(s, maxW));
    const ink = arcs.reduce((s, a) => s + a.len, 0);
    // pen width: house pen × look width (line a little finer), thinned when the ink would cover too much of the box
    const scale = rect.w / doc.box[0];
    let pen = ref.look.width * PEN * Math.min(host.W, host.H) * (doc.mode === 'line' ? 0.8 : 1);
    const coverage = (ink * scale * pen) / (rect.w * rect.h);
    if (coverage > MAX_COVERAGE) pen *= Math.max(MIN_THIN, MAX_COVERAGE / coverage);
    placed.push({
      ref,
      doc,
      section,
      span,
      times,
      rect,
      rot,
      mirror: ref.look.mirrorRtl && section.dir === 'rtl',
      layer,
      fallback,
      opacity: fallback ? FALLBACK_OPACITY : 1,
      pen,
      arcs,
      sessions: [],
    });
  }

  // mounts: created only now, after placement probing (the flash overlay may already exist; stay below it)
  const stage = host.stage;
  const ovOver = document.createElement('div');
  ovOver.className = 'ov-over';
  stage.insertBefore(ovOver, stage.querySelector(':scope > .flash'));
  const ovUnder = new Map<Layer, HTMLElement>();
  const underOf = (L: Layer) => {
    let m = ovUnder.get(L);
    if (!m) {
      m = document.createElement('div');
      m.className = 'ov-under';
      L.el.insertBefore(m, L.cam);
      ovUnder.set(L, m);
    }
    return m;
  };
  for (const o of placed) {
    const sizeBox = o.pen / (o.rect.w / o.doc.box[0]);
    const mounts = o.layer === 'over' ? [ovOver] : [...new Set(o.span.map((s) => s.layer))].map(underOf);
    o.sessions = mounts.map((m) => session(m, o, o.arcs, sizeBox));
  }

  const colorOf = (o: Placed, t: number): string => {
    let s = o.span[0]!;
    for (const x of o.span) if (x.timing.in <= t) s = x;
    const c = o.ref.look.color;
    return c === 'text' ? s.palette.text : host.accent(Number(c.slice(6)), s);
  };
  let lastT = NaN;

  return {
    frame(t) {
      lastT = t;
      for (const o of placed) {
        const { tIn, drawEnd, exitStart, tOut } = o.times;
        const visible = t >= tIn && t < tOut;
        let p = visible ? EASE[o.ref.look.ease](clamp01((t - tIn) / Math.max(1e-6, drawEnd - tIn))) : 0;
        let opacity = o.opacity;
        if (visible && t >= exitStart && tOut > exitStart) {
          const e = clamp01((t - exitStart) / (tOut - exitStart));
          if (o.ref.look.exit === 'fade') opacity *= 1 - e;
          else if (o.ref.look.exit === 'undraw') p *= 1 - easeInOut(e);
        }
        const f: Frame = {
          visible,
          p,
          opacity,
          color: colorOf(o, t),
          bucket: o.ref.look.boil ? Math.max(0, Math.floor((t * fps) / 4)) : 0,
        };
        for (const s of o.sessions) s.update(f);
      }
    },
    fingerprint(t0, t1) {
      const on = placed.filter((o) => o.times.tIn < t1 && o.times.tOut > t0);
      if (!on.length) return null;
      return on.map((o) => ({
        v: OVERLAY_VERSION,
        id: o.ref.id,
        section: o.ref.section,
        until: o.ref.until,
        hash: o.ref.hash,
        times: o.times,
        place: o.ref.place,
        rect: o.rect,
        rot: o.rot,
        mirror: o.mirror,
        layer: o.layer,
        mounts: o.layer === 'over' ? 'stage' : [...new Set(o.span.map((s) => s.layer.index))],
        fallback: o.fallback,
        opacity: o.opacity,
        pen: o.pen,
        look: o.ref.look,
        colors: o.span.map((s) => ({ in: s.timing.in, palette: s.palette })),
        fps: o.ref.look.boil ? fps : null,
      }));
    },
    sounds() {
      const out: SoundCue[] = [];
      for (const o of placed) {
        const { tIn, drawEnd } = o.times;
        if (o.ref.look.sfx === 'none' || tIn < 0.6) continue;
        const cx = rotatedBounds(o.rect, o.rot);
        const pan = Math.max(-0.7, Math.min(0.7, ((cx.x + cx.w / 2 - host.W / 2) / (host.W / 2)) * 0.7));
        out.push(
          o.ref.look.sfx === 'scribble'
            ? { t: tIn, kind: 'scribble', weight: 0.45, until: drawEnd, pan, section: o.ref.section }
            : { t: tIn, kind: 'pop', weight: 0.5, pan, section: o.ref.section },
        );
      }
      return out;
    },
    boxes() {
      return placed.map((o) => {
        const b = rotatedBounds(o.rect, o.rot);
        const word = o.ref.place.mode === 'word' ? { item: o.ref.place.item } : {};
        return {
          id: o.ref.id,
          section: o.ref.section,
          place: o.ref.place.mode,
          layer: o.layer,
          fallback: o.fallback,
          ...word,
          visible: lastT >= o.times.tIn && lastT < o.times.tOut,
          x: b.x,
          y: b.y,
          w: b.w,
          h: b.h,
        };
      });
    },
  };
}
