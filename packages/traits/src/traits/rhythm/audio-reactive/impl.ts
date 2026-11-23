import type { Band } from '@reel/core';
import { clamp01 } from '@reel/runtime';
import { defineRhythm, type Section, type SectionCtx, type Unit } from '../../../contract.ts';
import { level, reactive, slice } from '../../../lib/reactive.ts';
import { meta } from './meta.ts';

type Params = { kick: number; decay: number; bass: number; mid: number; high: number };
type Ctx = SectionCtx<Params>;

const EM = 280; // reference font size for px effects (glow, split), as in the neon traits
/** Weights move in whole steps (fewer distinct shapes) down to SWING below the layout's weight at zero mids. */
const STEP = 50;
const SWING = 300;
/** Effects fade in over this long after a unit lands, so they never fight its reveal. */
const SETTLE = 0.3;

/**
 * Per unsplit text unit on a variable font: the inner x shift per weight step n (weight = layout weight − n·STEP)
 * that keeps the ink centre where the layout measured it. Derived only from fingerprinted unit fields and the font.
 */
const shifts = new WeakMap<Unit, number[]>();

/** How strongly a unit follows the bass: the hero fully, emphasised units at 65 %, the rest not at all. */
const strength = (u: Unit) => (u.item < 0 || !u.text ? 0 : u.tags.hero ? 1 : u.emphasis || u.tags.ordinal >= 0 ? 0.65 : 0);

/** The section that owns t for the stage kick: [prev.out, out), the last one to the end. */
const owns = (s: Section, t: number) => t >= (s.prev?.timing.out ?? -Infinity) && (t < s.timing.out || !s.next);

const tables = ({ host, params }: Ctx) => reactive(host.reel.cues, params.decay);

export default defineRhythm({
  meta,
  headroom: ({ params }) => (1 + params.kick) * (1 + params.bass),
  pulse: (c, t) => level(tables(c), 'bass', t),
  mount({ host, section, params }) {
    if (!params.mid) return;
    for (const u of section.units) {
      if (u.item < 0 || !u.text || u.parts.length || u.html !== null || u.mount || !u.font.size || u.kind === 'logos') continue;
      const [lo, hi] = (u.font.family === 'text' ? host.reel.fonts.text : host.reel.fonts.display).weights;
      if (lo === hi) continue;
      const w0 = u.font.weight;
      const m0 = host.metrics(u.text, w0, u.ltr, u.font.family);
      const dx: number[] = [];
      for (let n = 0; n * STEP <= SWING && w0 - n * STEP >= lo; n++) {
        const m = host.metrics(u.text, w0 - n * STEP, u.ltr, u.font.family);
        dx.push((((m.br - m.bl) - (m0.br - m0.bl)) / 2) * u.font.size);
      }
      if (dx.length > 1) shifts.set(u, dx);
    }
  },
  frame(c, t) {
    const { host, section, params } = c;
    const r = tables(c);
    if (params.kick && owns(section, t)) host.stageCh.kick += params.kick * level(r, 'sub', t);
    const bass = level(r, 'bass', t);
    const mid = level(r, 'mid', t);
    const high = level(r, 'high', t);
    for (const u of section.units) {
      const land = Number.isFinite(u.at) ? clamp01((t - u.at) / SETTLE) : 1;
      const dx = shifts.get(u);
      if (dx) {
        const n = Math.min(dx.length - 1, Math.round((params.mid * (1 - mid) * SWING) / STEP));
        u.ch.wght = u.font.weight - n * STEP;
        u.ch.itx -= dx[n]!;
      }
      const k = strength(u) * land;
      if (!k) continue;
      const b = bass * k;
      const s = 1 + params.bass * b;
      u.ch.isx *= s;
      u.ch.isy *= s;
      const px = u.font.size / EM;
      const glow = 200 * params.bass * b * px;
      // whole pixels: fractional split shadows raster differently with the GPU tile state (seek order)
      const split = Math.round(params.high * high * k * 8 * px);
      if (u.parts.length) {
        for (const p of u.parts) {
          p.ch.glow += glow;
          p.ch.split += split;
        }
      } else {
        u.ch.glow += glow;
        u.ch.split += split;
      }
    }
  },
  /** The smoothed band frames this section can read while its layer is drawn (they fully determine its output). */
  fingerprint(c, t0, t1) {
    const { section, params } = c;
    const a = Math.max(t0, section.layer.start);
    const b = Math.min(t1, section.layer.end);
    if (a > b) return null;
    const bands: Band[] = ['bass'];
    if (params.kick) bands.push('sub');
    if (params.mid && section.units.some((u) => shifts.has(u))) bands.push('mid');
    if (params.high) bands.push('high');
    const r = tables(c);
    return { source: r.source, ...slice(r, bands, a, b) };
  },
});
