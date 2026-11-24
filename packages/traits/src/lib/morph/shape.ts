/**
 * harfbuzzjs shaping → positioned glyph outlines, grouped by cluster (a grapheme: a letter with its niqqud).
 * Environment-agnostic (ported from `spikes/morph/hb.ts`): pass an `hbjs` instance (the page loads it in `page.ts`,
 * the unit test in Node). Output is CSS px, y down, baseline at y = 0, x = 0 at the run's left edge (harfbuzz emits
 * RTL runs in visual left-to-right order). M0d: niqqud within 0.77 px and advances within 0.2 px of Chromium.
 */
import { flatten, glyphContours, linkHoles, unionContours, type Cmd, type Contour } from './geom.ts';

// Minimal structural types for the parts of the hbjs wrapper used here.
export interface HbFont {
  glyphToPath(g: number): string;
  setVariations(v: Record<string, number>): void;
}
export interface HbBuffer {
  addText(t: string): void;
  setDirection(d: 'ltr' | 'rtl'): void;
  guessSegmentProperties(): void;
  json(): { g: number; cl: number; ax: number; ay: number; dx: number; dy: number }[];
  destroy(): void;
}
export interface Hb {
  createBlob(b: Uint8Array | ArrayBuffer): unknown;
  createFace(blob: unknown, i: number): { upem: number; getAxisInfos(): Record<string, { min: number; default: number; max: number }> };
  createFont(face: unknown): HbFont;
  createBuffer(): HbBuffer;
  shape(font: HbFont, buf: HbBuffer, features?: string): void;
}

export interface LoadedFont {
  hb: Hb;
  font: HbFont;
  upem: number;
  axes: Record<string, { min: number; default: number; max: number }>;
  /** Parsed glyph outlines in font units, per `glyph@wght`. */
  paths: Map<string, Cmd[]>;
}

export function loadFont(hb: Hb, bytes: Uint8Array): LoadedFont {
  const face = hb.createFace(hb.createBlob(bytes), 0);
  return { hb, font: hb.createFont(face), upem: face.upem, axes: face.getAxisInfos(), paths: new Map() };
}

/** Parses the path string of hbjs `glyphToPath` (absolute M/L/Q/C/Z, `x,y` pairs). */
function parseHbPath(d: string): Cmd[] {
  const out: Cmd[] = [];
  const re = /([MLQCZ])([^MLQCZ]*)/g;
  for (let m = re.exec(d); m; m = re.exec(d)) {
    const body = (m[2] ?? '').trim();
    out.push({ c: m[1] as Cmd['c'], p: body ? body.split(/[ ,]+/).map(Number) : [] });
  }
  return out;
}

export interface ShapedGlyph {
  /** Cluster: UTF-16 index of the cluster start (marks share their base letter's cluster). */
  cl: number;
  /** Outline in px, positioned in the run. */
  cmds: Cmd[];
}

export interface Shaped {
  /** Advance width of the run in px. */
  width: number;
  glyphs: ShapedGlyph[];
}

/** Shapes `text` at `size` px and weight `wght` (clamped to the font's `wght` axis; ignored by static fonts). */
export function shapeText(f: LoadedFont, text: string, size: number, wght: number, dir: 'ltr' | 'rtl'): Shaped {
  const { hb, font, upem, axes } = f;
  const ax = axes.wght;
  const w = ax ? Math.min(ax.max, Math.max(ax.min, wght)) : 0;
  if (ax) font.setVariations({ wght: w });
  const buf = hb.createBuffer();
  buf.addText(text);
  buf.setDirection(dir);
  buf.guessSegmentProperties();
  hb.shape(font, buf);
  const info = buf.json();
  buf.destroy();
  const s = size / upem;
  let pen = 0;
  const glyphs: ShapedGlyph[] = [];
  for (const gi of info) {
    const key = `${gi.g}@${w}`;
    let raw = f.paths.get(key);
    if (!raw) f.paths.set(key, (raw = parseHbPath(font.glyphToPath(gi.g))));
    const ox = (pen + gi.dx) * s;
    const oy = -gi.dy * s;
    // font units y-up → px y-down
    const cmds = raw.map(({ c, p }) => ({ c, p: p.map((v, i) => (i % 2 === 0 ? ox + v * s : oy - v * s)) }));
    glyphs.push({ cl: gi.cl, cmds });
    pen += gi.ax;
  }
  return { width: pen * s, glyphs };
}

export interface Outline {
  /** Advance width (px). */
  width: number;
  /** The whole run after a nonzero union (clean outers + holes), placed at (x0, baseline). */
  all: Contour[];
  /** Per cluster (grapheme), in visual order left to right, each after its own union. */
  clusters: Contour[][];
}

/** Outline of a shaped run with its left edge at x0 and its baseline at y0. */
export function outline(sh: Shaped, x0: number, y0: number): Outline {
  const byCluster = new Map<number, Contour[]>();
  const order: number[] = [];
  const raw: Contour[] = [];
  for (const g of sh.glyphs) {
    const cs = glyphContours(flatten(g.cmds.map(({ c, p }) => ({ c, p: p.map((v, i) => v + (i % 2 === 0 ? x0 : y0)) }))));
    if (!cs.length) continue;
    let list = byCluster.get(g.cl);
    if (!list) {
      byCluster.set(g.cl, (list = []));
      order.push(g.cl);
    }
    list.push(...cs);
    raw.push(...cs);
  }
  // per-glyph contours are linked inside their own glyph list first so holes never attach to a neighbour
  const link = (cs: Contour[]) => linkHoles(cs.map((c) => ({ ...c, parent: -1, holes: [] })));
  const clusters = order.map((cl) => unionContours(link(byCluster.get(cl)!)));
  return { width: sh.width, all: unionContours(link(raw)), clusters: clusters.filter((c) => c.length) };
}
