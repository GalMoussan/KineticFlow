/**
 * harfbuzzjs shaping → positioned glyph outlines. Environment-agnostic: pass an `hbjs` instance
 * (Node: `node-hb.ts`, browser: `page.ts`). Output coordinates are CSS px, y down, baseline at y=0,
 * x=0 at the left edge of the shaped run (harfbuzz emits RTL runs in visual left-to-right order).
 */

export type Cmd = { c: 'M' | 'L' | 'Q' | 'C' | 'Z'; p: number[] };

export type ShapedGlyph = {
  g: number; // glyph id
  cl: number; // cluster (UTF-16 index of the cluster start in the input string)
  mark: boolean; // zero-advance glyph (niqqud / combining mark)
  x: number; // px, pen + dx
  y: number; // px, -dy (y down)
  ax: number; // px advance
  cmds: Cmd[]; // outline in px, already positioned
  d: string; // SVG path data of `cmds`
};

export type Shaped = { text: string; size: number; wght: number; width: number; glyphs: ShapedGlyph[]; d: string };

// Minimal structural types for the parts of the hbjs wrapper used here.
export type HbFont = {
  glyphToPath(g: number): string;
  setVariations(v: Record<string, number>): void;
  destroy(): void;
};
export type HbBuffer = {
  addText(t: string): void;
  guessSegmentProperties(): void;
  json(): { g: number; cl: number; ax: number; ay: number; dx: number; dy: number }[];
  destroy(): void;
};
export type Hb = {
  createBlob(b: Uint8Array | ArrayBuffer): { destroy(): void };
  createFace(blob: unknown, i: number): { upem: number; getAxisInfos(): Record<string, { min: number; default: number; max: number }>; destroy(): void };
  createFont(face: unknown): HbFont;
  createBuffer(): HbBuffer;
  shape(font: HbFont, buf: HbBuffer, features?: string): void;
  version_string(): string;
};

export type LoadedFont = { hb: Hb; font: HbFont; upem: number; axes: Record<string, { min: number; default: number; max: number }> };

export function loadFont(hb: Hb, bytes: Uint8Array): LoadedFont {
  const blob = hb.createBlob(bytes);
  const face = hb.createFace(blob, 0);
  return { hb, font: hb.createFont(face), upem: face.upem, axes: face.getAxisInfos() };
}

/** Parses the path string emitted by hbjs `glyphToPath` (absolute M/L/Q/C/Z, `x,y` pairs). */
export function parseHbPath(d: string): Cmd[] {
  const out: Cmd[] = [];
  const re = /([MLQCZ])([^MLQCZ]*)/g;
  for (let m = re.exec(d); m; m = re.exec(d)) {
    const body = (m[2] ?? '').trim();
    out.push({ c: m[1] as Cmd['c'], p: body ? body.split(/[ ,]+/).map(Number) : [] });
  }
  return out;
}

/** Applies x' = ox + x*s, y' = oy - y*s (font units y-up → px y-down). */
export function transformCmds(cmds: Cmd[], s: number, ox: number, oy: number): Cmd[] {
  return cmds.map(({ c, p }) => ({ c, p: p.map((v, i) => (i % 2 === 0 ? ox + v * s : oy - v * s)) }));
}

export function fmt(v: number): string {
  return String(Math.round(v * 100) / 100);
}

export function cmdsToD(cmds: Cmd[]): string {
  let d = '';
  for (const { c, p } of cmds) {
    d += c;
    for (let i = 0; i < p.length; i += 2) d += (i ? ' ' : '') + fmt(p[i]!) + ',' + fmt(p[i + 1]!);
  }
  return d;
}

const pathCache = new WeakMap<HbFont, Map<string, Cmd[]>>();

/**
 * Shapes `text` at `size` px with the given wght. `cache` memoises glyph outlines per (glyph, wght);
 * disable it to measure the true per-frame cost of re-drawing outlines.
 */
export function shapeText(f: LoadedFont, text: string, size: number, wght: number, cache = true): Shaped {
  const { hb, font, upem } = f;
  font.setVariations({ wght });
  const buf = hb.createBuffer();
  buf.addText(text);
  buf.guessSegmentProperties();
  hb.shape(font, buf);
  const info = buf.json();
  buf.destroy();
  const s = size / upem;
  let cmap = pathCache.get(font);
  if (!cmap) pathCache.set(font, (cmap = new Map()));
  let pen = 0;
  const glyphs: ShapedGlyph[] = [];
  for (const gi of info) {
    const key = gi.g + '@' + wght;
    let raw = cache ? cmap.get(key) : undefined;
    if (!raw) {
      raw = parseHbPath(font.glyphToPath(gi.g));
      if (cache) cmap.set(key, raw);
    }
    const x = (pen + gi.dx) * s;
    const y = -gi.dy * s;
    const cmds = transformCmds(raw, s, x, y);
    glyphs.push({ g: gi.g, cl: gi.cl, mark: gi.ax === 0, x, y, ax: gi.ax * s, cmds, d: cmdsToD(cmds) });
    pen += gi.ax;
  }
  return { text, size, wght, width: pen * s, glyphs, d: glyphs.map((g) => g.d).join('') };
}

/** Translates a shaped run's outlines by (ox, oy) px. */
export function placeShaped(sh: Shaped, ox: number, oy: number): { d: string; marksD: string; basesD: string } {
  const move = (cmds: Cmd[]) => cmds.map(({ c, p }) => ({ c, p: p.map((v, i) => v + (i % 2 === 0 ? ox : oy)) }));
  const parts = sh.glyphs.map((g) => ({ mark: g.mark, d: cmdsToD(move(g.cmds)) }));
  return {
    d: parts.map((p) => p.d).join(''),
    marksD: parts.filter((p) => p.mark).map((p) => p.d).join(''),
    basesD: parts.filter((p) => !p.mark).map((p) => p.d).join(''),
  };
}
