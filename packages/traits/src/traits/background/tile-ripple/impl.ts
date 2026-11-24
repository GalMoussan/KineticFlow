/**
 * Idle mosaic (see meta). The grout fills `layer.under`; every cell the letter tiles do not occupy is a div in
 * `layer.back`. Each frame asks `lib/mosaic` for that cell's look and resizes the div — the same state machine the
 * letter tiles use, so a tile's back face matches its neighbours until the reveal claims it.
 */
import type { SoundCue } from '@reel/core';
import { defineBackground, type Layer } from '../../../contract.ts';
import { drawTile, idleCell, mosaicOf, type Mosaic } from '../../../lib/mosaic.ts';
import { meta } from './meta.ts';

interface Cell {
  el: HTMLElement;
  col: number;
  row: number;
}

const boards = new WeakMap<Layer, { m: Mosaic; cells: Cell[] }>();

export default defineBackground({
  meta,
  mount({ host, layer, params }) {
    const m = mosaicOf(host, layer, params);
    if (!m) return;
    const g = m.grid;
    host.el('div', 'mosaic-grout', layer.under, { background: layer.palette.bg });
    const skip = new Set<number>();
    for (let i = 0; i < g.occ.length; i += 2) skip.add(g.occ[i]! * 100000 + g.occ[i + 1]!);
    const cells: Cell[] = [];
    for (let row = g.r0; row <= g.r1; row++) {
      for (let col = g.c0; col <= g.c1; col++) {
        if (skip.has(col * 100000 + row)) continue;
        const el = host.el('div', 'mosaic-tile', layer.back, { 'border-radius': `${g.r}px` });
        cells.push({ el, col, row });
      }
    }
    boards.set(layer, { m, cells });
  },
  frame({ layer }, t) {
    const b = boards.get(layer);
    if (!b) return;
    const g = b.m.grid;
    for (const c of b.cells) {
      drawTile(c.el, g, g.ox + c.col * g.p, g.oy + c.row * g.p, 1, 1, idleCell(b.m, c.col, c.row, t));
    }
  },
  /** One quiet shimmer as each ripple leaves its origin. Nothing in the music's fade-in. */
  sounds({ host, layer, params }) {
    const m = mosaicOf(host, layer, params);
    if (!m || params.sound <= 0) return [];
    const out: SoundCue[] = [];
    for (const r of m.ripples) {
      if (r.t < 0.6) continue;
      out.push({ t: r.t, kind: 'shimmer', weight: params.sound, pan: (r.x / host.W) * 1.2 - 0.6 });
    }
    return out;
  },
});
