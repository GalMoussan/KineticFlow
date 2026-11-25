/**
 * Split-flap reveal. At mount every grapheme part gets a board cell (inserted in its unit before the text, so it
 * moves with the unit) holding a leaf; each row (`tags.line`) is padded with blank cells to the board's width on
 * the row's own character pitch, a housing goes behind the board and a hinge line across every row (above the
 * text, like the split of real flaps). Board elements are static; leaves are rewritten every frame.
 *
 * A cell flips every `period` s: its leaf (a lighter flap) folds down onto the hinge over the top half, then unfolds
 * from the hinge over the bottom half, and the glyph swaps to the next one at the fold, hidden while the leaf is
 * nearly edge-on. The fold is the planar map of a flap turning on a horizontal hinge under parallel projection, a
 * scaleY, applied by resizing the leaf in whole px: scaled/skewed text and boxes raster differently by seek history
 * (Δ up to 153/255 measured over full reels), resized boxes and unscaled text do not. The glyph sequence counts
 * down to the real grapheme (stand-ins of its script from `hash`, blank before the first flip). Cells settle in
 * logical (reading) order; the schedule, fitted before the hold, is in `unit.data.reveal`.
 */
import type { SoundCue } from '@reel/core';
import { clamp01, hash } from '@reel/runtime';
import { defineReveal, type Unit } from '../../../contract.ts';
import { scriptOf, standIn } from '../../../lib/glyphs.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import { subLanding } from '../../../lib/subline.ts';
import { meta } from './meta.ts';

interface Data {
  /** First flip; cell i settles at st + a + i·b; seconds per flip. */
  st: number;
  a: number;
  b: number;
  period: number;
}
/** Group-coordinate cell rect of one grapheme part. */
interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Cell inset (× pitch), vertical padding around the line box and corner radius (em). */
const INSET = 0.06;
const PAD_Y = 0.1;
const RADIUS = 0.07;
/** Seconds of the settle clack (a small vertical bounce). */
const CLACK = 0.12;
const BADGE_FLIP = 0.3;
/** A flipping glyph hides while its leaf is closer to edge-on than this (fold = |scaleY| of the flap). */
const EDGE = 0.4;

const leaves = new WeakMap<Unit, HTMLElement[]>();
const px = (v: number) => `${v.toFixed(2)}px`;

export default defineReveal({
  meta,
  prepare(_c, u) {
    if (u.item >= 0 && u.text) u.split = 'grapheme';
  },
  mount({ host, section, params }) {
    const hold = section.timing.holdStart;
    const rows = new Map<number, Cell[]>();
    for (const u of section.units) {
      if (u.item < 0 || !u.revealed) continue;
      const st = u.at - params.lead;
      const n = u.parts.length;
      let a = params.flips * params.period;
      let b = params.wave;
      const need = a + Math.max(0, n - 1) * b;
      const room = hold - 0.06 - st;
      if (need > room) {
        const k = Math.max(0.15, room) / need;
        a *= k;
        b *= k;
      }
      u.data.reveal = { st, a, b, period: params.period } satisfies Data;
      if (!n || !u.el || !u.inner) continue;
      const S = u.font.size;
      const row = rows.get(u.tags.line) ?? [];
      rows.set(u.tags.line, row);
      leaves.set(
        u,
        u.parts.map((p) => {
          const ins = INSET * p.w;
          const cell = host.el('div', 'flap-cell', null, {
            left: px(u.textAt.x + p.x + ins),
            top: px(u.textAt.y + p.y - PAD_Y * S),
            width: px(p.w - 2 * ins),
            height: px(p.h + 2 * PAD_Y * S),
            'border-radius': px(RADIUS * S),
          });
          u.el!.insertBefore(cell, u.inner);
          row.push({ x: u.box.x + u.textAt.x + p.x, y: u.box.y + u.textAt.y + p.y - PAD_Y * S, w: p.w, h: p.h + 2 * PAD_Y * S });
          return host.el('div', 'flap-leaf', cell);
        }),
      );
    }

    // blank cells to the board's width on each row's pitch, a hinge across each row, the housing behind it all
    const all = [...rows.values()].flat();
    if (!all.length) return;
    const g = section.group;
    const bx0 = Math.min(...all.map((c) => c.x));
    const bx1 = Math.max(...all.map((c) => c.x + c.w));
    const rtl = section.dir === 'rtl';
    let by0 = Infinity;
    let by1 = -Infinity;
    let pitch = 0;
    for (const cells of rows.values()) {
      const ws = cells.map((c) => c.w).sort((x, y) => x - y);
      const p = ws[ws.length >> 1]!;
      pitch = Math.max(pitch, p);
      const y = Math.min(...cells.map((c) => c.y));
      const h = Math.max(...cells.map((c) => c.h));
      by0 = Math.min(by0, y);
      by1 = Math.max(by1, y + h);
      const anchor = rtl ? Math.max(...cells.map((c) => c.x + c.w)) - p : Math.min(...cells.map((c) => c.x));
      const k0 = Math.ceil((bx0 - 0.3 * p - anchor) / p);
      const k1 = Math.floor((bx1 + 0.3 * p - anchor - p) / p);
      let x0 = Infinity;
      let x1 = -Infinity;
      for (let k = k0; k <= k1; k++) {
        const x = anchor + k * p;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x + p);
        if (cells.some((c) => Math.abs(c.x - x) < p / 2)) continue;
        const blank = host.el('div', 'flap-cell', null, {
          left: px(x + INSET * p),
          top: px(y),
          width: px(p - 2 * INSET * p),
          height: px(h),
          'border-radius': px((RADIUS / 0.6) * p),
        });
        g.insertBefore(blank, g.firstChild);
      }
      for (const c of cells) {
        x0 = Math.min(x0, c.x);
        x1 = Math.max(x1, c.x + c.w);
      }
      host.el('div', 'flap-hinge', g, { left: px(x0), top: px(y + h / 2 - Math.max(1, 0.012 * h)), width: px(x1 - x0), height: px(Math.max(2, 0.024 * h)) });
    }
    const m = 0.35 * pitch;
    const housing = host.el('div', 'flap-housing', null, {
      left: px(bx0 - m),
      top: px(by0 - m),
      width: px(bx1 - bx0 + 2 * m),
      height: px(by1 - by0 + 2 * m),
      'border-radius': px(0.3 * pitch),
    });
    g.insertBefore(housing, g.firstChild);
  },
  frame({ section }, t) {
    for (const u of section.units) {
      const d = u.data.reveal as Data | undefined;
      if (!d || u.item < 0) continue;
      const els = leaves.get(u);
      if (!els) {
        // the logo badge rolls down once (clip, not scale: see the leaves below)
        u.ch.visible &&= t >= d.st;
        u.ch.clip = Math.min(u.ch.clip, clamp01((t - d.st) / BADGE_FLIP));
        u.ch.clipFrom = 'top';
        continue;
      }
      const S = u.font.size;
      u.parts.forEach((p, i) => {
        const leaf = els[i]!.style;
        const half = (p.h + 2 * PAD_Y * S) / 2;
        const settle = d.st + d.a + i * d.b;
        let fold = -1;
        let upper = true;
        if (t < d.st) p.ch.opacity = 0;
        else if (t < settle) {
          const tau = (settle - t) / d.period;
          const m = Math.ceil(tau);
          const phi = m - tau;
          upper = phi < 0.5;
          // glyph `shown` flips remaining before the real one: 0 = real, ≥ M = blank (before the first flip)
          const shown = upper ? m : m - 1;
          const M = Math.ceil((settle - d.st) / d.period);
          fold = upper ? 1 - 2 * phi : 2 * phi - 1;
          if (shown >= M || fold < EDGE) p.ch.opacity = 0;
          else if (shown > 0) p.ch.glyph = standIn(scriptOf(p.text), hash(u.id * 31.7 + p.index * 7.31 + shown * 1.71), p.text);
        } else {
          const k = (t - settle) / CLACK;
          if (k < 1) p.ch.ty -= Math.round(0.05 * p.h * Math.sin(Math.PI * k) * (1 - k));
        }
        // the leaf folds on the hinge by resizing (whole px): scaled or squashed boxes and text raster differently
        // by seek history (Δ ≤ 64/255 measured over a full reel), resized ones do not
        const h = Math.round(Math.max(0, fold) * half);
        leaf.display = fold < 0 ? 'none' : 'block';
        leaf.top = px(upper ? Math.round(half) - h : Math.round(half));
        leaf.height = px(h);
      });
    }
  },
  /** One flutter per section while the first wave runs, then up to 4 mechanical clacks per unit as cells settle. */
  sounds({ host, section }) {
    const out: SoundCue[] = endcardStinger(section);
    let flutter = false;
    let si = 0;
    for (const u of section.units) {
      const d = u.data.reveal as Data | undefined;
      if (!d || u.item < 0) continue;
      const pan = host.pan(u);
      if (u.kind === 'sub') {
        const c = subLanding(d.st, si++, pan);
        if (c) out.push(c);
        continue;
      }
      const n = u.parts.length;
      if (!n) {
        out.push({ t: d.st + BADGE_FLIP, kind: 'pop', weight: 0.4, pan });
        continue;
      }
      if (!flutter) {
        flutter = true;
        out.push({ t: d.st, until: d.st + d.a, kind: 'shimmer', weight: 0.22, pan });
      }
      const m = Math.min(4, n);
      const picks = [...new Set(Array.from({ length: m }, (_, j) => Math.round((j * (n - 1)) / Math.max(1, m - 1))))];
      picks.forEach((i, j) => out.push({ t: d.st + d.a + i * d.b, kind: 'tick', weight: 0.42, pitch: -3 + 1.5 * j, pan }));
    }
    return out;
  },
});
