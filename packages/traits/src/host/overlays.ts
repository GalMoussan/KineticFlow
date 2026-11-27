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
 * - Word sketches (P5) are not in either: they live beside their word, in the section's group inside the camera, in
 *   two wrappers that mirror the word's unit (its box, origin and this frame's transform; `over` = after the
 *   section's units, `under` = just before its word). The camera's turns, the section's placement and the unit's
 *   motion carry the drawing exactly as they carry the word; per-letter styles refit it to the letters each frame.
 *   It shows only while its word is drawn and on screen (never at a stale position), from the word's landing until
 *   the word leaves (the timing engine's word rule).
 *
 * Draw-on by arc length (README §1: a pure function of t; every property this module ever sets is rewritten on every
 * frame; no CSS animation/transition, canvas, `will-change`, blend modes or 3D transforms):
 * - Line: one fixed path, `stroke-dasharray` / `stroke-dashoffset` per frame, optional pen-tip dot.
 * - Sketch: perfect-freehand outlines precomputed at `ready()` (only the one partial stroke is rebuilt per frame),
 *   plus a faint jitter pass when `rough > 0`; `boil` moves each stroke's faint pass with an SVG `translate` that
 *   changes every 4 frames. Pen width scales down with stroke density so dense hatching stays hatching.
 *
 * Material carry-over (P2): the owning section's material treats the strokes as it treats text.
 * - Glow: the material's text-shadow glow (same radius pair, falloff and colour, `look.glow` = the share of it), drawn
 *   without filters as stacked translucent rings of the drawn centreline (`glowRings`): an SVG filter made Chromium
 *   composite the drawing, and promote what was painted above it (measured with `out/sketch/P2/layers.ts`).
 * - Faint pass: risograph prints it as the second ink plate (off-register), chalk as dust, others as a pale ghost.
 */
import { getStroke, type StrokeOptions } from 'perfect-freehand';
// value imports from core must avoid its index: the schemas would bring zod (and its CSP-blocked eval probe) into the page
import { sketchGlow, type GlowKind } from '@reel/core/glow.ts';
import { seedOf } from '@reel/core/seed.ts';
import type { OverlayBox, SketchDoc, SketchLook, SketchRef, SoundCue, TextBox } from '@reel/core';
import { clamp01, easeInOut, hash } from '@reel/runtime';
import type { Host, Layer, Part, Section, Unit } from '../contract.ts';
import { clampFit, FIT_VARIANTS, fitWord, keepOf, partBox, trimOf, unionBox, wordRange, type Fitted, type FitVariant, type PartMove } from '../lib/anchor.ts';
import { autoCap, autoPlacement, framePlacement, overlapArea, rotatedBounds, TEXT_MARGIN, type Rect } from '../lib/placement.ts';
import { drawn } from './commit.ts';

/** Bump when overlay drawing changes pixels for the same inputs (it is part of every fingerprint with a sketch). */
const OVERLAY_VERSION = 'overlays@2';
/** House pen width as a share of the frame's short side (≈ 8 px at 1080). */
const PEN = 0.0075;
/** Ink coverage of the drawing's box above which the pen thins (SK12), and the thinnest it gets. */
const MAX_COVERAGE = 0.14;
const MIN_THIN = 0.3;
/** Opacity of an auto-placed sketch that found no free space and went under the text. */
const FALLBACK_OPACITY = 0.35;
/** Neon's reference font size (its glow is `glow · (18 + 20·pulse) · size / EM`, as in `material/neon-glow`). */
const NEON_EM = 280;

/**
 * How the owning section's material treats the strokes, fixed at `ready()` (part of the fingerprint). `glow` carries
 * what the material's text glow is computed from: `S` (the section's largest content font size), `p` (the material's
 * glow param), `k` (`look.glow`).
 */
interface Treat {
  material: string;
  glow: { kind: GlowKind; S: number; p: number; k: number; pulse: boolean } | null;
  faint: 'plate' | 'dust' | 'ghost';
}

/** One frame's glow: a narrow and a wide shadow (`r` = CSS blur radius in screen px, `a` = alpha), in `color`. */
interface GlowFrame {
  r1: number;
  a1: number;
  r2: number;
  a2: number;
  color: string;
}

/** The material's text glow for a sketch (same formulas as the material traits), `null` when nothing glows. */
function glowAt(g: NonNullable<Treat['glow']>, pulse: number, color: string): GlowFrame | null {
  const { kind, S, p, k } = g;
  let r = 0;
  if (kind === 'neon') r = k * p * (18 + 20 * pulse) * (S / NEON_EM);
  else if (kind === 'spectrum') r = Math.round(k * p * 0.07 * S * pulse);
  else if (kind === 'tint') r = k * p * 0.06 * S;
  else r = k * p * S;
  if (r < 0.01) return null;
  if (kind === 'neon' || kind === 'spectrum') return { r1: r, a1: 1, r2: 3 * r, a2: 1, color };
  if (kind === 'tint') return { r1: r, a1: 0.55, r2: 2.6 * r, a2: 0.22, color };
  return { r1: r, a1: kind === 'chalk' ? 0.4 : 0.5, r2: 0, a2: 0, color };
}

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
  /** A word sketch's anchor unit as laid out before the split (`measureWords`); undefined for other units. */
  words(u: Unit): WordBoxes | undefined;
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
  /** Where the drawing's box goes: screen px, or (word sketches) the word's inner coordinates at rest. */
  rect: Rect;
  rot: number;
  mirror: boolean;
  layer: 'under' | 'over';
  fallback: boolean;
  opacity: number;
  /** Pen width in screen px after density thinning (word sketches: in the word's layout px). */
  pen: number;
  /** Arc-length tables of the strokes, built once (density thinning and drawing share them). */
  arcs: Arc[];
  sessions: Session[];
  treat: Treat;
  /** Word attachment (P5); null for auto and frame placements. */
  word: WordAttachment | null;
  /** Drawn at the last frame. */
  shown: boolean;
}

/**
 * A word sketch (P5) lives inside the word's own transforms: two wrappers mirror the unit's outer element and its
 * inner text element (same box, same origin, the transform the host committed this frame), so the camera, the
 * section's placement and the unit's motion move the drawing exactly as they move the word. Inside them, the drawing
 * is fitted to the word's ink box each frame (letter parts move on their own in per-letter styles).
 */
interface WordAttachment {
  unit: Unit;
  /** The anchor's letter or word parts (split units) with their laid-out box and ink band; null: the measured word box. */
  parts: { part: Part; box: Rect; band: [number, number] }[] | null;
  /** The word's ink box at rest (inner coordinates). */
  rest: Rect;
  /** Ink band of the word (inner y): replaces each part's font box when the parts are unioned. */
  band: [number, number];
  baseline: number;
  rtl: boolean;
  /** Screen px per layout px at the hold (the camera's zoom): the glow's screen radius is converted with it. */
  scale: number;
  outer: HTMLDivElement;
  inner: HTMLDivElement;
  /** The unit's outer and inner boxes as laid out: left, top, width, height, transform-origin (px). */
  geometry: { el: string[]; inner: string[] };
  /** How the fit gave way to stay in the safe area (`FIT_VARIANTS`); the per-frame refit uses the same. */
  variant: FitVariant;
  /** Screen boxes of the drawing at its section's hold samples (auto placement avoids them; the sound pans by them). */
  holds: Rect[];
  /** Whether the word is on screen at the last frame inside the sketch's window (QA); null outside it. */
  state: 'shown' | 'hidden' | 'offscreen' | null;
}

interface Frame {
  visible: boolean;
  p: number;
  opacity: number;
  color: string;
  /** Fill of the faint pass (ghost, dust or the second riso plate). */
  faint: string;
  glow: GlowFrame | null;
  /** Boil bucket (`floor(t·fps/4)`), 0 without boil. */
  bucket: number;
  /** This frame's box of the drawing (word sketches: fitted to the word's current ink box); default: `Placed.rect`. */
  rect?: Rect;
}

interface Session {
  svg: SVGSVGElement;
  update(f: Frame): void;
}

const NS = 'http://www.w3.org/2000/svg';
const written = new WeakMap<Element, Map<string, string>>();

/** Writes only when the value differs from what this module last wrote (only this module writes these elements). */
function put(el: SVGElement | HTMLElement, name: string, value: string): void {
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

/**
 * Share of a shadow's alpha that a Gaussian blur of radius r (σ = r / 2, as CSS `text-shadow`) leaves beyond a stroke's
 * edge, at the middle of each of three equal bands out to r: ½·erfc(d / σ√2) at d = r/6, r/2, 5r/6.
 */
const GLOW_PROFILE = [0.37, 0.16, 0.048] as const;

/**
 * The material's glow without filters (an SVG filter made Chromium composite the drawing and promote what was painted
 * above it, against README §1): for each shadow, three rings of the drawing's centreline, each wider by a band of the
 * blur radius, stacked so their alpha falls off as the blur does. Wide shadow first, then the narrow one, then the
 * strokes. A single `<path>` paints its self-overlaps once, so a ring is an even halo. Returns the per-frame writer
 * (every attribute it ever sets, every frame); `d` is the drawn centreline, `dash` the line mode's dash state.
 */
function glowRings(g: SVGElement): (gl: GlowFrame | null, d: string, width: number, scale: number, dash: [string, string] | null) => void {
  // created before any stroke, so they paint first: wide outer ring → narrow inner ring
  const rings = (['wide', 'narrow'] as const).flatMap((kind) => [3, 2, 1].map((band) => ({ kind, band, el: g.appendChild(document.createElementNS(NS, 'path')) })));
  return (gl, d, width, scale, dash) => {
    for (const { kind, band, el } of rings) {
      const r = !gl ? 0 : kind === 'wide' ? gl.r2 : gl.r1;
      const a = !gl ? 0 : kind === 'wide' ? gl.a2 : gl.a1;
      // band alphas from the outside in: the outer ring alone gives the outer band's share, each inner ring adds the rest
      const t = (k: number) => a * (GLOW_PROFILE[k - 1] ?? 0);
      const alpha = band === 3 ? t(3) : 1 - (1 - t(band)) / (1 - t(band + 1));
      const on = r > 0.01 && alpha > 0.001 && d !== '';
      put(el, 'd', on ? d : '');
      put(el, 'fill', 'none');
      put(el, 'stroke', gl?.color ?? '#000000');
      put(el, 'stroke-opacity', alpha.toFixed(3));
      put(el, 'stroke-width', num(width + (2 * r * band) / 3 / scale));
      put(el, 'stroke-linecap', 'round');
      put(el, 'stroke-linejoin', 'round');
      put(el, 'stroke-dasharray', dash ? dash[0] : 'none');
      put(el, 'stroke-dashoffset', dash ? dash[1] : '0');
      put(el, 'visibility', on ? 'visible' : 'hidden');
    }
  };
}

/** A polyline as path data (`M x y L x y …`). */
function polyline(pts: readonly Point[]): string {
  return ['M', num(pts[0]![0]), ' ', num(pts[0]![1]), ...pts.slice(1).flatMap((p) => ['L', num(p[0]), ' ', num(p[1])])].join('');
}

/** One drawing in one mount: an `<svg>` at `rect` (or the frame's own rect), its strokes in the doc's box. */
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
  // box units → screen px (word sketches: their box is in layout px, which the camera then zooms)
  const scale = o.word ? o.word.scale : rect.w / bw;
  const glow = o.treat.glow ? glowRings(g) : null;
  const frameSvg = (f: Frame) => {
    const r = f.rect ?? rect;
    put(svg, 'viewBox', `0 0 ${bw} ${bh}`);
    // a word sketch's box is already the word's shape (fitted per frame; `none` absorbs the per-frame difference)
    put(svg, 'preserveAspectRatio', o.word ? 'none' : 'xMidYMid meet');
    put(svg, 'style:position', 'absolute');
    put(svg, 'style:overflow', 'visible');
    put(svg, 'style:left', `${num(r.x)}px`);
    put(svg, 'style:top', `${num(r.y)}px`);
    put(svg, 'style:width', `${num(r.w)}px`);
    put(svg, 'style:height', `${num(r.h)}px`);
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
    const d = polyline(a.pts);
    const len = a.len.toFixed(3);
    return {
      svg,
      update(f) {
        frameSvg(f);
        const dist = f.p * a.len;
        const offset = (a.len - dist).toFixed(3);
        glow?.(f.glow, f.p > 0 ? d : '', sizeBox, scale, [`${len} ${len}`, offset]);
        put(path, 'd', d);
        put(path, 'fill', 'none');
        put(path, 'stroke', f.color);
        put(path, 'stroke-width', num(sizeBox));
        put(path, 'stroke-linecap', 'round');
        put(path, 'stroke-linejoin', 'round');
        put(path, 'stroke-dasharray', `${len} ${len}`);
        put(path, 'stroke-dashoffset', offset);
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
    return { a, size, main, fp, mainD: outline(a.pts, size), faintD: fp ? outline(a.pts, size * 0.7) : '', centre: glow ? polyline(a.pts) : '', i };
  });
  if (pen) g.appendChild(pen);
  return {
    svg,
    update(f) {
      frameSvg(f);
      let left = f.p * total;
      let tip: { x: number; y: number } | null = null;
      const centre: string[] = [];
      for (const s of strokes) {
        put(s.main, 'fill', f.color);
        let mainD = '';
        let faintD = '';
        if (left > 0 && s.a.len > 0) {
          if (left >= s.a.len) {
            mainD = s.mainD;
            faintD = s.faintD;
            tip = pointAt(s.a, s.a.len);
            if (glow) centre.push(s.centre);
          } else {
            const part = prefix(s.a, left);
            mainD = outline(part, s.size);
            faintD = s.fp ? outline(part, s.size * 0.7) : '';
            tip = pointAt(s.a, left);
            if (glow) centre.push(polyline(part));
          }
          left -= s.a.len;
        }
        put(s.main, 'd', mainD);
        if (s.fp) {
          const j = jitter(seed, s.i, f.bucket, amp);
          put(s.fp, 'fill', f.faint);
          put(s.fp, 'transform', `translate(${num(j.x)} ${num(j.y)})`);
          put(s.fp, 'd', faintD);
        }
      }
      glow?.(f.glow, centre.join(''), sizeBox, scale, null);
      drawPen(f.p > 0 && f.p < 1 ? tip : null, f.color);
    },
  };
}

const EASE: Record<SketchLook['ease'], (k: number) => number> = {
  smooth: easeInOut,
  functional: (k) => k * (2 - k),
  snap: (k) => k,
};

/** How the owning section's material treats the strokes (see the module doc); the glow predicate is shared with the Mixer. */
function treatOf(section: Section, look: SketchLook): Treat {
  const material = section.style.traits.material;
  const g = sketchGlow(material, section.style.params, look.glow);
  const S = Math.max(0, ...section.units.filter((u) => u.item >= 0 && u.text).map((u) => u.font.size));
  return {
    material,
    glow: g && S > 0 ? { ...g, S, pulse: g.kind === 'neon' || g.kind === 'spectrum' } : null,
    faint: material === 'riso' ? 'plate' : material === 'chalk' ? 'dust' : 'ghost',
  };
}

/** A word sketch's unit as laid out before any split or transform: Range rects (font boxes) relative to its inner element. */
export interface WordBoxes {
  /** The whole text. */
  all: Rect;
  /** Each whitespace-separated word, in logical order (`lib/anchor.ts` `wordRange`). */
  words: Rect[];
}

/**
 * Measures `inner`'s text the way `splitMeasured` does (Range rects relative to the element's box), before the host
 * splits it and before any transform: the whole text and every word. Called by the host for anchor units only.
 */
export function measureWords(inner: HTMLElement): WordBoxes {
  const nodes: { node: Text; start: number }[] = [];
  let text = '';
  const walker = document.createTreeWalker(inner, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!(n instanceof Text)) continue;
    nodes.push({ node: n, start: text.length });
    text += n.data;
  }
  const box = inner.getBoundingClientRect();
  const range = document.createRange();
  // offset → (text node, local offset); an end prefers the earlier node, as in `splitMeasured`
  const locate = (offset: number, isEnd: boolean) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const p = nodes[i]!;
      if (isEnd ? offset > p.start : offset >= p.start) return { node: p.node, off: offset - p.start };
    }
    return { node: nodes[0]!.node, off: 0 };
  };
  const measure = (a: number, b: number): Rect => {
    const s = locate(a, false);
    const e = locate(b, true);
    range.setStart(s.node, s.off);
    range.setEnd(e.node, e.off);
    const r = range.getBoundingClientRect();
    return { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height };
  };
  const words: Rect[] = [];
  for (let k = 0, w = wordRange(text, 0); w; w = wordRange(text, ++k)) words.push(measure(w[0], w[1]));
  return { all: measure(0, text.length), words };
}

const REST: PartMove = { tx: 0, ty: 0, rot: 0, skx: 0, sx: 1, sy: 1 };

/**
 * A drawing scaled (mirrored, or turned a quarter clockwise) into its fitted word box: a word sketch takes the word's
 * shape (an ellipse, a line).
 */
function warp(doc: SketchDoc, f: Fitted): SketchDoc {
  const [bw, bh] = doc.box;
  const { rect: r, flip, turn } = f;
  return {
    ...doc,
    box: [r.w, r.h],
    strokes: doc.strokes.map((s) => ({
      ...s,
      pts: s.pts.map((p): SketchDoc['strokes'][number]['pts'][number] => {
        const px = flip ? bw - p[0] : p[0];
        // turned: (x, y) in [bw, bh] → (bh − y, x) in [bh, bw]
        const x = turn ? ((bh - p[1]) / bh) * r.w : (px / bw) * r.w;
        const y = turn ? (px / bw) * r.h : (p[1] / bh) * r.h;
        return p[2] === undefined ? [x, y] : [x, y, p[2]];
      }),
    })),
  };
}

export function mountOverlays(host: Host, probe: HostProbe): Overlays | null {
  const refs = host.reel.sketches ?? [];
  if (!refs.length) return null;
  const { cues, fps } = host.reel.cues;
  const sectionIndex = new Map(host.sections.map((s, i) => [s.id, i]));

  // text boxes at every hold a sketch spans (cached per time; seeking here is pure, the first real seek redraws all)
  const boxesAt = new Map<number, TextBox[]>();
  const holdTimes = (s: Section) => [s.timing.holdStart, Math.max(s.timing.holdStart, s.timing.holdEnd - 1 / fps)];
  const holdBoxes = (s: Section): TextBox[] => {
    const out: TextBox[] = [];
    for (const t of holdTimes(s)) {
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
  const housePen = (ref: SketchRef, doc: SketchDoc) => ref.look.width * PEN * Math.min(host.W, host.H) * (doc.mode === 'line' ? 0.8 : 1);
  const spanOf = (ref: SketchRef) => host.sections.slice(sectionIndex.get(ref.section)!, sectionIndex.get(ref.until)! + 1);
  const timesOf = (ref: SketchRef): Times => {
    const cue = (type: 'sketch-in' | 'sketch-out') => {
      const c = cues.find((x) => x.type === type && x.sketch === ref.id);
      if (!c || c.until === undefined) throw new Error(`sketch "${ref.id}": the cue sheet has no ${type} cue`);
      return c;
    };
    const cin = cue('sketch-in');
    const cout = cue('sketch-out');
    return { tIn: cin.t, drawEnd: cin.until!, exitStart: cout.t, tOut: cout.until! };
  };
  /**
   * A word sketch's times: the cue sheet lets it ride the move after its section (until the next section's `in`);
   * that holds only inside a world chain (the next section in the same layer, a camera move). Otherwise the next
   * section's entry is its word's exit window (wipes, mask slides, whips), so it leaves with its section's `out`.
   */
  const wordTimes = (ref: SketchRef, section: Section): Times => {
    const t = timesOf(ref);
    if (section.next && section.next.layer === section.layer) return t;
    const out = Math.max(t.drawEnd, section.timing.out);
    return { ...t, tOut: out, exitStart: Math.max(t.drawEnd, out - (t.tOut - t.exitStart)) };
  };
  const arcsOf = (doc: SketchDoc) => {
    const maxW = Math.max(...doc.strokes.map((s) => s.w ?? 1));
    return doc.strokes.map((s) => arcOf(s, maxW));
  };

  // ── word sketches (P5): placed first, so the free placements below avoid them ──
  /** The word's ink box now (inner coordinates): its letter/word parts as moved this frame, or the measured box. */
  const anchorAt = (w: WordAttachment): Rect => (w.parts ? (unionBox(w.parts.map((p) => partBox(p.box, p.band, p.part.ch))) ?? w.rest) : w.rest);
  const layerShown = (w: WordAttachment) => w.unit.section.layer.ch.visible && w.unit.section.layer.el.style.display !== 'none';
  /** Whether the word is drawn: its layer and unit are (as `boxes()` decides) and a letter of it shows. */
  const stateOf = (w: WordAttachment): 'shown' | 'hidden' => {
    const u = w.unit;
    if (!layerShown(w) || !drawn(u.ch)) return 'hidden';
    if (w.parts && !w.parts.some(({ part: p }) => p.ch.opacity > 0 && Math.abs(p.ch.sx) > 1e-4 && Math.abs(p.ch.sy) > 1e-4)) return 'hidden';
    return 'shown';
  };
  /**
   * How much of the word shows this frame, 0..1: the unit's opacity, its letters' (the most opaque), a reveal's clip,
   * and for a masked unit the share of the word inside its mask (a mask-slide exit slides the text out of it).
   */
  const presence = (w: WordAttachment, a: Rect): number => {
    const c = w.unit.ch;
    let k = clamp01(c.opacity) * (c.clip < 1 ? clamp01(c.clip) : 1);
    if (w.parts) k *= clamp01(Math.max(...w.parts.map(({ part: p }) => p.ch.opacity)));
    if (w.unit.masked && a.w > 0 && a.h > 0) {
      // the word in the unit's box: inner offset + the inner's own translate (its mask is the unit box)
      const x = a.x + parseFloat(w.geometry.inner[0]!) + c.itx;
      const y = a.y + parseFloat(w.geometry.inner[1]!) + c.ity;
      k *= overlapArea({ x, y, w: a.w, h: a.h }, { x: 0, y: 0, w: w.unit.box.w, h: w.unit.box.h }) / (a.w * a.h);
    }
    return k;
  };
  /** The wrappers copy the unit's outer and inner boxes and this frame's transforms (identity while its layer is hidden). */
  const mirror = (w: WordAttachment) => {
    const live = layerShown(w);
    for (const [el, [left, top, width, height, origin], src] of [
      [w.outer, w.geometry.el, w.unit.el!],
      [w.inner, w.geometry.inner, w.unit.inner!],
    ] as const) {
      put(el, 'style:position', 'absolute');
      put(el, 'style:pointer-events', 'none');
      put(el, 'style:left', left!);
      put(el, 'style:top', top!);
      put(el, 'style:width', width!);
      put(el, 'style:height', height!);
      put(el, 'style:transform-origin', origin!);
      put(el, 'style:transform', live ? src.style.transform || 'none' : 'none');
    }
  };
  const placeWord = (ref: SketchRef, place: Extract<SketchRef['place'], { mode: 'word' }>): Placed => {
    const span = spanOf(ref);
    const section = span[0]!;
    const unit = section.units.find((u) => u.item === place.item);
    if (!unit?.el?.parentElement || !unit.inner) throw new Error(`sketch "${ref.id}": section "${section.id}" has no word at item ${place.item}`);
    const range = place.part === undefined ? null : wordRange(unit.text, place.part);
    const measured = probe.words(unit);
    const fb = unit.inkBox ?? { x: 0, y: 0, w: unit.inner.offsetWidth, h: unit.inner.offsetHeight };
    const font = measured ? ((place.part === undefined ? measured.all : measured.words[place.part]) ?? measured.all) : fb;
    // the word's ink band from its font box: the box spans the font's ascent + descent around the baseline
    const m = host.metrics(range ? unit.text.slice(range[0], range[1]) : unit.text, unit.font.weight, unit.ltr, unit.font.family);
    const S = font.h / Math.max(1e-6, m.fa + m.fd);
    const baseline0 = measured ? font.y + m.fa * S : fb.y + 0.8 * fb.h;
    const band: [number, number] = measured ? [baseline0 - m.ia * S, baseline0 + m.id * S] : [fb.y, fb.y + fb.h];
    // the anchor's parts as laid out after every trait's mount (a drop cap re-places and re-sizes its letters): each
    // span's own box, and its ink band at its own font size
    const own = measured && unit.parts.length ? unit.parts.filter((p) => !range || (p.start >= range[0] && p.end <= range[1])) : [];
    const parts = own.length
      ? own.map((part) => {
          // layout box in the inner element (offsets ignore transforms; RTL spans are anchored by `right`)
          const s = part.span;
          const box = s.offsetParent === unit.inner ? { x: s.offsetLeft, y: s.offsetTop, w: s.offsetWidth, h: s.offsetHeight } : { x: part.x, y: part.y, w: part.w, h: part.h };
          const Sp = parseFloat(getComputedStyle(s).fontSize) || S;
          const base = box.y + (box.h - (m.fa + m.fd) * Sp) / 2 + m.fa * Sp;
          return { part, box, band: [base - m.ia * Sp, base + m.id * Sp] as [number, number], base };
        })
      : null;
    const baseline = parts ? Math.max(...parts.map((p) => p.base)) : baseline0;
    const rest = parts ? unionBox(parts.map((p) => partBox(p.box, p.band, REST)))! : { x: font.x, y: band[0], w: font.w, h: band[1] - band[0] };
    const rtl = section.dir === 'rtl';
    // the camera's zoom at the hold: the pen keeps the house width on screen there (and stays light on small words)
    probe.seek(section.timing.holdStart);
    const scale = Math.abs(section.layer.view.s) || 1;
    const outer = document.createElement('div');
    const inner = document.createElement('div');
    outer.className = 'ov-word';
    outer.appendChild(inner);
    // under: just below its word; over: above every unit of the section
    if (ref.look.layer === 'under') unit.el.parentElement.insertBefore(outer, unit.el);
    else unit.el.parentElement.appendChild(outer);
    const ce = getComputedStyle(unit.el);
    const ci = getComputedStyle(unit.inner);
    const px = (v: string, d: string) => `${(parseFloat(v) || 0) + (parseFloat(d) || 0)}px`;
    const word: WordAttachment = {
      unit,
      parts,
      rest,
      band,
      baseline,
      rtl,
      scale,
      outer,
      inner,
      geometry: {
        el: [ce.left, ce.top, ce.width, ce.height, ce.transformOrigin],
        // the inner element sits in the unit's padding box; the wrapper has no border
        inner: [px(ci.left, ce.borderLeftWidth), px(ci.top, ce.borderTopWidth), ci.width, ci.height, ci.transformOrigin],
      },
      variant: {},
      holds: [],
      state: null,
    };
    // the first variant of the fit that stays inside the safe area and off the other words at both hold samples, else
    // the one that leaves the safe area (px) and covers other words (area ÷ their height) least: measured with a
    // throwaway box in the word's own coordinates
    const variants = FIT_VARIANTS[place.fit].map((v) => ({ v, fitted: fitWord(rest, baseline, place.fit, place.pad, rtl, ref.doc.box, v), score: 0 }));
    const test = inner.appendChild(document.createElement('div'));
    test.style.position = 'absolute';
    const screenOf = (r: Rect): Rect => {
      Object.assign(test.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
      const b = test.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    };
    /** Screen px a box leaves the safe area by: left, right, top, bottom. */
    const overflow = (r: Rect): [number, number, number, number] => [
      Math.max(0, safe.x - r.x),
      Math.max(0, r.x + r.w - safe.x - safe.w),
      Math.max(0, safe.y - r.y),
      Math.max(0, r.y + r.h - safe.y - safe.h),
    ];
    if (variants.length > 1) {
      for (const t of holdTimes(section)) {
        probe.seek(t);
        mirror(word);
        const others = probe.boxes().filter((b) => !(b.section === section.id && b.unit === unit.item));
        for (const c of variants) {
          const r = screenOf(c.fitted.rect);
          c.score += overflow(r).reduce((s, x) => s + x, 0);
          for (const o of others) c.score += overlapArea(r, o) / Math.max(1, o.h);
        }
      }
    }
    const best = variants.find((c) => c.score < 1) ?? variants.reduce((a, b) => (b.score < a.score ? b : a));
    // whatever still leaves the safe area at a hold sample is cut off, side by side about the word (`clampFit`): each
    // side's overflow in screen px over the local → screen scale, measured again once after the first cut
    let variant: FitVariant = best.v;
    let fitted: Fitted = best.fitted;
    for (let pass = 0; pass < 2; pass++) {
      const r = fitted.rect;
      let [minX, maxX, minY, maxY] = [r.x, r.x + r.w, r.y, r.y + r.h];
      let over = false;
      for (const t of holdTimes(section)) {
        probe.seek(t);
        mirror(word);
        const s = screenOf(r);
        const [l, rr, tp, b] = overflow(s);
        if (l + rr + tp + b <= 0.01) continue;
        over = true;
        const kx = s.w / Math.max(1e-9, r.w);
        const ky = s.h / Math.max(1e-9, r.h);
        minX = Math.max(minX, r.x + l / kx);
        maxX = Math.min(maxX, r.x + r.w - rr / kx);
        minY = Math.max(minY, r.y + tp / ky);
        maxY = Math.min(maxY, r.y + r.h - b / ky);
      }
      if (!over) break;
      variant = { ...best.v, trim: trimOf(best.fitted.rect, clampFit(r, keepOf(fitted, place.fit, rest), minX, maxX, minY, maxY)) };
      fitted = fitWord(rest, baseline, place.fit, place.pad, rtl, ref.doc.box, variant);
    }
    test.remove();
    word.variant = variant;
    const doc = warp(ref.doc, fitted);
    const pen = Math.min(housePen(ref, doc) / scale, 0.12 * rest.h);
    const o: Placed = {
      ref,
      doc,
      section,
      span,
      times: wordTimes(ref, section),
      rect: fitted.rect,
      rot: 0,
      mirror: false,
      layer: ref.look.layer,
      fallback: false,
      opacity: 1,
      pen,
      arcs: arcsOf(doc),
      treat: treatOf(section, ref.look),
      sessions: [],
      shown: false,
      word,
    };
    o.sessions = [session(inner, o, o.arcs, pen)];
    // where it sits on screen at the hold (drawn in full), for the free placements and the sound's pan
    for (const t of holdTimes(section)) {
      probe.seek(t);
      draw(o, t, true);
      const r = o.sessions[0]!.svg.getBoundingClientRect();
      word.holds.push({ x: r.x, y: r.y, w: r.width, h: r.height });
    }
    return o;
  };

  /** The spanned section on screen at t: the last one whose `in` ≤ t. Its palette colours the drawing. */
  const onScreen = (o: Placed, t: number): Section => {
    let s = o.span[0]!;
    for (const x of o.span) if (x.timing.in <= t) s = x;
    return s;
  };
  /** Glow at t: the owning section's pulse (neon and spectrum breathe with it, as their text does). */
  const glowOf = (o: Placed, s: Section, color: string, t: number): GlowFrame | null => {
    const g = o.treat.glow;
    if (!g) return null;
    // neon's text glows in its accent around a white core; chrome's glow is always its accent
    const c = (g.kind === 'neon' && o.ref.look.color === 'text') || g.kind === 'chrome' ? host.accent(0, s) : color;
    const pulse = !g.pulse ? 0 : g.kind === 'spectrum' ? clamp01(o.section.pulse(t)) : o.section.pulse(t);
    return glowAt(g, pulse, c);
  };
  /** Draws one sketch for reel time t; `full` (placement probing only): drawn complete wherever its word is. */
  function draw(o: Placed, t: number, full: boolean): void {
    const { tIn, drawEnd, exitStart, tOut } = o.times;
    const inWindow = full || (t >= tIn && t < tOut);
    const w = o.word;
    let rect: Rect | undefined;
    let shows = 1;
    if (w && o.ref.place.mode === 'word') {
      mirror(w);
      const state = inWindow ? stateOf(w) : null;
      // fitted to the word as it is now; at rest (and whenever hidden) exactly the placed rect
      const a = state === 'shown' ? anchorAt(w) : w.rest;
      const { fit, pad } = o.ref.place;
      rect = a === w.rest ? o.rect : fitWord(a, w.baseline + a.y - w.rest.y, fit, pad, w.rtl, o.ref.doc.box, w.variant).rect;
      if (state === 'shown' && !full) shows = presence(w, a);
      w.state = state === 'shown' && shows <= 0.001 ? 'hidden' : state;
    }
    const visible = inWindow && (full || !w || w.state === 'shown');
    let p = full ? 1 : visible ? EASE[o.ref.look.ease](clamp01((t - tIn) / Math.max(1e-6, drawEnd - tIn))) : 0;
    // a word sketch fades and clips with its word
    let opacity = o.opacity * shows;
    if (!full && visible && t >= exitStart && tOut > exitStart) {
      const e = clamp01((t - exitStart) / (tOut - exitStart));
      if (o.ref.look.exit === 'fade') opacity *= 1 - e;
      else if (o.ref.look.exit === 'undraw') p *= 1 - easeInOut(e);
    }
    const s = onScreen(o, t);
    const c = o.ref.look.color;
    const color = c === 'text' ? s.palette.text : host.accent(Number(c.slice(6)), s);
    const f: Frame = {
      visible,
      p,
      opacity,
      color,
      // risograph: the other ink plate, off-register; chalk: dust; else a pale ghost of the line
      faint: o.treat.faint === 'plate' ? rgba(host.accent(c === 'accent0' ? 1 : 0, s), 0.9) : rgba(color, o.treat.faint === 'dust' ? 0.45 : 0.35),
      glow: visible ? glowOf(o, s, color, t) : null,
      bucket: o.ref.look.boil ? Math.max(0, Math.floor((t * fps) / 4)) : 0,
      ...(rect ? { rect } : {}),
    };
    o.shown = visible;
    for (const x of o.sessions) x.update(f);
    // a word sketch hides once its own box has left the frame (its overhang stays while any of it is in frame)
    if (w && visible && !full) {
      const r = o.sessions[0]!.svg.getBoundingClientRect();
      if (r.right <= 0 || r.bottom <= 0 || r.left >= host.W || r.top >= host.H) {
        w.state = 'offscreen';
        o.shown = false;
        for (const x of o.sessions) x.update({ ...f, visible: false, glow: null });
      }
    }
  }

  const done = new Map<SketchRef, Placed>();
  for (const ref of refs) if (ref.place.mode === 'word') done.set(ref, placeWord(ref, ref.place));

  // ── auto and frame placements, in order ──
  for (const ref of refs) {
    if (ref.place.mode === 'word') continue;
    const doc = ref.doc;
    const span = spanOf(ref);
    const section = span[0]!;
    const times = timesOf(ref);
    let rect: Rect;
    let fallback = false;
    let rot = 0;
    if (ref.place.mode === 'frame') {
      rect = framePlacement(doc.box, ref.place, safe);
      rot = ref.place.rot ?? 0;
    } else {
      // auto: free space beside every text box at the spanned holds, every word sketch and every sketch already
      // placed that is on screen at the same time
      const obstacles: Rect[] = span.flatMap(holdBoxes).map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
      for (const o of done.values()) {
        if (!(o.times.tIn < times.tOut && times.tIn < o.times.tOut)) continue;
        if (o.word) obstacles.push(...o.word.holds);
        else obstacles.push(rotatedBounds(o.rect, o.rot));
      }
      const auto = autoPlacement(doc.box, safe, obstacles, margin, autoCap(safe, doc.meta.source === 'preset'));
      rect = auto.rect;
      fallback = auto.fallback;
    }
    const layer = fallback ? 'under' : ref.look.layer;
    const arcs = arcsOf(doc);
    const ink = arcs.reduce((s, a) => s + a.len, 0);
    // pen width: house pen × look width (line a little finer), thinned when the ink would cover too much of the box
    const scale = rect.w / doc.box[0];
    let pen = housePen(ref, doc);
    const coverage = (ink * scale * pen) / (rect.w * rect.h);
    if (coverage > MAX_COVERAGE) pen *= Math.max(MIN_THIN, MAX_COVERAGE / coverage);
    done.set(ref, {
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
      treat: treatOf(section, ref.look),
      sessions: [],
      word: null,
      shown: false,
    });
  }
  const placed = refs.map((ref) => done.get(ref)!);

  // mounts of the free placements: created only now, after placement probing (the flash overlay may already exist;
  // stay below it)
  const free = placed.filter((o) => !o.word);
  if (free.length) {
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
    for (const o of free) {
      const sizeBox = o.pen / (o.rect.w / o.doc.box[0]);
      const mounts = o.layer === 'over' ? [ovOver] : [...new Set(o.span.map((s) => s.layer))].map(underOf);
      o.sessions = mounts.map((m) => session(m, o, o.arcs, sizeBox));
    }
  }

  const pulseSamples = (o: Placed, a: number, b: number): number[] => {
    const out: number[] = [];
    for (let k = Math.ceil(a * fps - 1e-9); k / fps < b; k++) out.push(Math.round(o.section.pulse(k / fps) * 1e4) / 1e4);
    return out;
  };
  /** Screen box of a rect in a word's inner coordinates (measured with a throwaway box; QA read-back only). */
  const probeBox = (w: WordAttachment, r: Rect): Rect => {
    const test = w.inner.appendChild(document.createElement('div'));
    Object.assign(test.style, { position: 'absolute', left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    const b = test.getBoundingClientRect();
    test.remove();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  };
  /** Screen box of a sketch: placed rect (rotated), or a word sketch's drawing as shown now (else at its hold). */
  const screenBox = (o: Placed): Rect => {
    if (!o.word) return rotatedBounds(o.rect, o.rot);
    if (!o.shown) return o.word.holds[0]!;
    const r = o.sessions[0]!.svg.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  };

  return {
    frame(t) {
      for (const o of placed) draw(o, t, false);
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
        mounts: o.word ? 'word' : o.layer === 'over' ? 'stage' : [...new Set(o.span.map((s) => s.layer.index))],
        fallback: o.fallback,
        opacity: o.opacity,
        pen: o.pen,
        look: o.ref.look,
        colors: o.span.map((s) => ({ in: s.timing.in, palette: s.palette })),
        treat: o.treat,
        // a breathing glow: the owning section's pulse at every frame of the window the sketch is visible in
        pulse: o.treat.glow?.pulse ? pulseSamples(o, Math.max(t0, o.times.tIn), Math.min(t1, o.times.tOut)) : null,
        fps: o.ref.look.boil || o.treat.glow?.pulse ? fps : null,
        // the anchor unit's geometry (hard rule 5): its boxes as laid out, the word's measured ink and parts, the
        // camera zoom the pen follows; its per-frame motion is in the host's own keys for the same window
        ...(o.word
          ? {
              anchor: {
                item: o.word.unit.item,
                text: o.word.unit.text,
                geometry: o.word.geometry,
                rest: o.word.rest,
                band: o.word.band,
                baseline: o.word.baseline,
                parts: o.word.parts?.map(({ part, box, band }) => [part.start, part.end, box.x, box.y, box.w, box.h, band[0], band[1]]) ?? null,
                rtl: o.word.rtl,
                variant: o.word.variant,
                scale: o.word.scale,
              },
            }
          : {}),
      }));
    },
    sounds() {
      const out: SoundCue[] = [];
      for (const o of placed) {
        const { tIn, drawEnd } = o.times;
        if (o.ref.look.sfx === 'none' || tIn < 0.6) continue;
        const cx = o.word ? o.word.holds[0]! : rotatedBounds(o.rect, o.rot);
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
        const b = screenBox(o);
        const place = o.ref.place;
        const word =
          place.mode === 'word'
            ? {
                item: place.item,
                fit: place.fit,
                ...(o.word ? { pen: o.pen * o.word.scale } : {}),
                ...(place.part === undefined ? {} : { part: place.part }),
                ...(o.word?.state ? { anchor: o.word.state } : {}),
                // with `part`, QA exempts only that word of the item: its screen box now (a throwaway box, read once)
                ...(place.part !== undefined && o.word && o.shown ? { word: probeBox(o.word, anchorAt(o.word)) } : {}),
              }
            : {};
        return {
          id: o.ref.id,
          section: o.ref.section,
          place: o.ref.place.mode,
          layer: o.layer,
          fallback: o.fallback,
          ...word,
          visible: o.shown,
          x: b.x,
          y: b.y,
          w: b.w,
          h: b.h,
        };
      });
    },
  };
}
