/**
 * Tile flip (see meta). Occupied cells are not drawn by `tile-ripple`, so this reveal draws them: the idle look
 * until the flip, then a planar turn onto the letter face (palette text, dark ink from the layout). Glyphs are
 * shifted by a constant whole-pixel translate onto their cell centres — translate only, so the hold raster matches
 * a still seek. The logo is one tile outside its unit; the unit's opacity hides the badge until that tile is flat.
 */
import type { SoundCue } from '@reel/core';
import { defineReveal, type Part, type Section, type Unit } from '../../../contract.ts';
import { drawTile, idleCell, mosaicOf, rippleParams, shade, type MosaicGrid, type TileRun, type TileStrip } from '../../../lib/mosaic.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import { subLanding } from '../../../lib/subline.ts';
import { meta } from './meta.ts';

interface Letter {
  el: HTMLElement;
  unit: Unit;
  /** Cell run on `grid` (the board, or the sub strip's small tiles). */
  grid: MosaicGrid;
  col: number;
  row: number;
  cols: number;
  rows: number;
  /** Board cell whose idle look the tile's back face shows. */
  pc: number;
  pr: number;
  face: string;
  part: Part | null;
  /** Whole-pixel shift that parks the glyph on the cell centre. */
  tx: number;
  ty: number;
  /** Flip start and length. The face is flat at t0 + flip. */
  t0: number;
  flip: number;
}

/** An idle small tile of the sub strip: it shows its board cell's idle look. */
interface Filler {
  el: HTMLElement;
  x: number;
  y: number;
  pc: number;
  pr: number;
}

/** Sub words flip quicker (share of the board's flip). */
const SUB_FLIP = 0.7;

const letters = new WeakMap<Section, Letter[]>();
const fillers = new WeakMap<Section, { grid: MosaicGrid; cells: Filler[] }>();

const runOf = (u: Unit) => u.data.layout as TileRun | undefined;

/** Last grapheme of a unit is flat by `hold`, staggered back from there so the word finishes as it lands. */
function startAt(u: Unit, i: number, n: number, hold: number, flip: number): number {
  const land = Number.isFinite(u.at) ? u.at : hold;
  const end = Math.min(land, hold - 0.04);
  const first = Math.min(end - flip, land - 0.05);
  const span = Math.max(0, end - flip - first);
  const step = n > 1 ? span / (n - 1) : 0;
  return first + i * step;
}

export default defineReveal({
  meta,
  prepare(_c, u) {
    if (u.item < 0) return;
    if (u.text && u.kind !== 'logos') u.split = 'grapheme';
    else u.origin = '50% 50%';
  },
  mount({ host, section }) {
    const m = mosaicOf(host, section.layer, rippleParams(section.style.params));
    if (!m) return;
    const g = m.grid;
    const hold = section.timing.holdStart;
    const list: Letter[] = [];
    const face = section.palette.text;
    // the sub strip's small tiles (absent without a sub line)
    const strip = (section.data.layout as { strip?: TileStrip } | undefined)?.strip;
    const mini: MosaicGrid | null = strip ? { ...g, p: g.p / strip.k, g: strip.g, r: strip.r } : null;
    const add = (u: Unit, col: number, row: number, cols: number, rows: number, part: Part | null, tx: number, ty: number, i: number, n: number) => {
      const el = host.el('div', 'mosaic-tile', null, { 'border-radius': `${g.r}px` });
      section.group.prepend(el);
      list.push({ el, unit: u, grid: g, col, row, cols, rows, pc: col, pr: row, face, part, tx, ty, t0: startAt(u, i, n, hold, m.flip), flip: m.flip });
    };
    const taken = new Set<number>();
    for (const u of section.units) {
      const run = runOf(u);
      if (!run || u.item < 0 || !u.el) continue;
      if (run.mini && mini) {
        // a sub word: one small tile per grapheme, flipping together, quicker
        const k = run.mini;
        const parts = [...u.parts].sort((a, b) => a.x - b.x);
        const ones: number[] = [];
        for (let i = 0; i < run.mask.length; i++) if (run.mask[i] === '1') ones.push(i);
        const n = Math.min(ones.length, parts.length);
        const flip = SUB_FLIP * m.flip;
        for (let i = 0; i < n; i++) {
          const p = parts[i]!;
          const col = run.col + ones[i]!;
          taken.add(col * 100000 + run.row);
          const el = host.el('div', 'mosaic-tile', null, { 'border-radius': `${mini.r}px` });
          section.group.prepend(el);
          list.push({
            el,
            unit: u,
            grid: mini,
            col,
            row: run.row,
            cols: 1,
            rows: 1,
            pc: Math.floor(col / k),
            pr: Math.floor(run.row / k),
            face: run.face ?? face,
            part: p,
            tx: Math.round((ones[i]! + 0.5) * mini.p - (u.textAt.x + p.x + p.w / 2)),
            ty: Math.round(mini.p / 2 - (u.textAt.y + p.y + p.h / 2)),
            t0: startAt(u, i, n, hold, flip),
            flip,
          });
        }
        continue;
      }
      if (u.kind === 'logos' || !run.mask) {
        add(u, run.col, run.row, run.cols, run.rows, null, 0, 0, 0, 1);
        continue;
      }
      const ones: number[] = [];
      for (let i = 0; i < run.mask.length; i++) if (run.mask[i] === '1') ones.push(i);
      const parts = [...u.parts].sort((a, b) => a.x - b.x);
      const n = Math.min(ones.length, parts.length);
      for (let i = 0; i < n; i++) {
        const p = parts[i]!;
        const cell = ones[i]!;
        add(
          u,
          run.col + cell,
          run.row,
          1,
          1,
          p,
          Math.round((cell + 0.5) * g.p - (u.textAt.x + p.x + p.w / 2)),
          Math.round(g.p / 2 - (u.textAt.y + p.y + p.h / 2)),
          i,
          n,
        );
      }
    }
    letters.set(section, list);
    if (strip && mini) {
      const cells: Filler[] = [];
      for (let r = strip.row * strip.k; r < (strip.row + strip.rows) * strip.k; r++) {
        for (let c = 0; c < strip.cols * strip.k; c++) {
          if (taken.has(c * 100000 + r)) continue;
          const el = host.el('div', 'mosaic-tile', null, { 'border-radius': `${mini.r}px` });
          section.group.prepend(el);
          cells.push({ el, x: g.ox + c * mini.p, y: g.oy + r * mini.p, pc: Math.floor(c / strip.k), pr: Math.floor(r / strip.k) });
        }
      }
      fillers.set(section, { grid: mini, cells });
    }
  },
  frame({ host, section, params }, t) {
    const m = mosaicOf(host, section.layer, rippleParams(section.style.params));
    const list = letters.get(section);
    if (!m || !list) return;
    const hold = t >= section.timing.holdStart;
    for (const L of list) {
      const g = L.grid;
      const x = g.ox + L.col * g.p;
      const y = g.oy + L.row * g.p;
      const done = hold || t >= L.t0 + L.flip;
      if (!done && t < L.t0) {
        drawTile(L.el, g, x, y, L.cols, L.rows, idleCell(m, L.pc, L.pr, t));
        showGlyph(L, false);
      } else if (!done) {
        const ph = (t - L.t0) / L.flip;
        const w = Math.abs(Math.cos(Math.PI * ph));
        const back = idleCell(m, L.pc, L.pr, L.t0).fill;
        drawTile(L.el, g, x, y, L.cols, L.rows, { w, fill: shade(m, ph < 0.5 ? back : L.face, w) });
        showGlyph(L, ph >= 0.5 && w >= params.flat);
      } else {
        drawTile(L.el, g, x, y, L.cols, L.rows, { w: 1, fill: L.face });
        showGlyph(L, true);
      }
      // The logo badge has no parts. Hide that unit until its tile is open; letter units stay drawn so QA
      // measures their cell ink, and only the glyphs blink.
      if (!L.part && L.unit.kind === 'logos' && !done) L.unit.ch.opacity = 0;
    }
    const f = fillers.get(section);
    if (f) for (const c of f.cells) drawTile(c.el, f.grid, c.x, c.y, 1, 1, idleCell(m, c.pc, c.pr, t));
  },
  /** One pop per word as its tiles land, plus the end-card stinger. */
  sounds({ host, section }) {
    const out: SoundCue[] = endcardStinger(section, 0.7);
    let k = 0;
    let s = 0;
    for (const u of section.units) {
      if (u.item < 0 || !u.revealed || !Number.isFinite(u.at)) continue;
      if (u.kind === 'sub') {
        const cue = subLanding(u.at, s++, host.pan(u));
        if (cue) out.push(cue);
        continue;
      }
      out.push({
        t: Math.max(0.6, u.at),
        kind: 'pop',
        weight: u.tags.hero || u.emphasis ? 0.48 : 0.3,
        pitch: Math.min(7, k++),
        pan: host.pan(u),
      });
    }
    return out;
  },
});

/** Parks the glyph on its cell. Hidden glyphs keep the translate so the show frame does not jump. */
function showGlyph(L: Letter, show: boolean): void {
  if (!L.part) return;
  L.part.ch.tx += L.tx;
  L.part.ch.ty += L.ty;
  if (!show) L.part.ch.opacity = 0;
}
