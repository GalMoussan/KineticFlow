/**
 * Tile flip (see meta). Occupied cells are not drawn by `tile-ripple`, so this reveal draws them: the idle look
 * until the flip, then a planar turn onto the letter face (palette text, dark ink from the layout). Glyphs are
 * shifted by a constant whole-pixel translate onto their cell centres — translate only, so the hold raster matches
 * a still seek. The logo is one tile outside its unit; the unit's opacity hides the badge until that tile is flat.
 */
import type { SoundCue } from '@reel/core';
import { defineReveal, type Part, type Section, type Unit } from '../../../contract.ts';
import { drawTile, idleCell, mosaicOf, rippleParams, shade, type TileRun } from '../../../lib/mosaic.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import { meta } from './meta.ts';

interface Letter {
  el: HTMLElement;
  unit: Unit;
  col: number;
  row: number;
  cols: number;
  rows: number;
  part: Part | null;
  /** Whole-pixel shift that parks the glyph on the cell centre. */
  tx: number;
  ty: number;
  /** Flip start. The face is flat at t0 + flip. */
  t0: number;
}

const letters = new WeakMap<Section, Letter[]>();

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
    const add = (u: Unit, col: number, row: number, cols: number, rows: number, part: Part | null, tx: number, ty: number, i: number, n: number) => {
      const el = host.el('div', 'mosaic-tile', null, { 'border-radius': `${g.r}px` });
      section.group.prepend(el);
      list.push({ el, unit: u, col, row, cols, rows, part, tx, ty, t0: startAt(u, i, n, hold, m.flip) });
    };
    for (const u of section.units) {
      const run = runOf(u);
      if (!run || u.item < 0 || !u.el) continue;
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
  },
  frame({ host, section, params }, t) {
    const m = mosaicOf(host, section.layer, rippleParams(section.style.params));
    const list = letters.get(section);
    if (!m || !list) return;
    const g = m.grid;
    const face = section.palette.text;
    const hold = t >= section.timing.holdStart;
    for (const L of list) {
      const x = g.ox + L.col * g.p;
      const y = g.oy + L.row * g.p;
      const done = hold || t >= L.t0 + m.flip;
      if (!done && t < L.t0) {
        drawTile(L.el, g, x, y, L.cols, L.rows, idleCell(m, L.col, L.row, t));
        showGlyph(L, false);
      } else if (!done) {
        const ph = (t - L.t0) / m.flip;
        const w = Math.abs(Math.cos(Math.PI * ph));
        const back = idleCell(m, L.col, L.row, L.t0).fill;
        drawTile(L.el, g, x, y, L.cols, L.rows, { w, fill: shade(m, ph < 0.5 ? back : face, w) });
        showGlyph(L, ph >= 0.5 && w >= params.flat);
      } else {
        drawTile(L.el, g, x, y, L.cols, L.rows, { w: 1, fill: face });
        showGlyph(L, true);
      }
      // The logo badge has no parts. Hide that unit until its tile is open; letter units stay drawn so QA
      // measures their cell ink, and only the glyphs blink.
      if (!L.part && L.unit.kind === 'logos' && !done) L.unit.ch.opacity = 0;
    }
  },
  /** One pop per word as its tiles land, plus the end-card stinger. */
  sounds({ host, section }) {
    const out: SoundCue[] = endcardStinger(section, 0.7);
    let k = 0;
    for (const u of section.units) {
      if (u.item < 0 || !u.revealed || !Number.isFinite(u.at)) continue;
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
