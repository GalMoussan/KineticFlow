/**
 * Equalizer rhythm. Every letter is the foot of an EQ bar: an owned bar element stands on the letter's own ink top
 * and grows by `amp · v` × the unit's ink ascent (whole px), in the letter's spectrum colour sunk into the
 * background; v = the smoothed band level at the letter's spectrum position (`spectrumPos`, sub → bass → mid → high
 * linearly interpolated) × its gain (0.7…1, hashed). The letters themselves never move: translated part spans left
 * stale ink behind depending on the seek history (`dev/stills.ts` check (c)). A bar only follows the music `SETTLE` s
 * after its unit lands, and settles to `hold` × its height while the section holds. Peak caps ride the slow-release
 * table above every bar. Bars and caps live inside the unit's outer element (they hide and move with it) and are
 * off from the section's exit window on. The layout must leave `amp × ascent` of headroom above each row (fit-stack
 * `headroom`).
 */
import type { Band } from '@reel/core';
import { clamp01, hash } from '@reel/runtime';
import { defineRhythm, type Part, type Section, type SectionCtx, type Unit } from '../../../contract.ts';
import { innerBaseline, spectrumColor, spectrumPos } from '../../../lib/eq.ts';
import { exitWindow, mixHex } from '../../../lib/neon.ts';
import { level, reactive, slice, type Reactive } from '../../../lib/reactive.ts';
import { meta } from './meta.ts';

type Params = { amp: number; decay: number; peak: number; kick: number; caps: number; hold: number };
type Ctx = SectionCtx<Params>;

const SETTLE = 0.35;
/** Gap between a letter's ink top and its bar (em). */
const GAP = 0.06;
const BANDS: Band[] = ['sub', 'bass', 'mid', 'high'];

interface Bar {
  u: Unit;
  p: Part;
  /** Spectrum position 0..1 and fixed gain. */
  f: number;
  g: number;
  /** The letter's own ink ascent (px): its bar stands on it. */
  ia: number;
  /** The EQ bar standing on the letter (inside the unit's outer element). */
  bar: HTMLDivElement;
  cap: HTMLDivElement | null;
}
const bars = new WeakMap<Section, Bar[]>();

/** Band energy at spectrum position f (0 = sub … 1 = high). */
function energy(r: Reactive, f: number, t: number): number {
  const x = Math.max(0, Math.min(1, f)) * (BANDS.length - 1);
  const i = Math.min(BANDS.length - 2, Math.floor(x));
  const a = level(r, BANDS[i]!, t);
  const b = level(r, BANDS[i + 1]!, t);
  return a + (b - a) * (x - i);
}

const owns = (s: Section, t: number) => t >= (s.prev?.timing.out ?? -Infinity) && (t < s.timing.out || !s.next);
const fast = ({ host, params }: Ctx) => reactive(host.reel.cues, params.decay);
const slow = ({ host, params }: Ctx) => reactive(host.reel.cues, params.peak);

export default defineRhythm({
  meta,
  headroom: ({ params }) => 1 + params.kick,
  pulse: (c, t) => level(fast(c), 'bass', t),
  mount({ host, section, params }) {
    const pos = spectrumPos(section);
    const out: Bar[] = [];
    for (const u of section.units) {
      if (u.item < 0 || !u.el) continue;
      for (const p of u.parts) {
        const S = u.font.size;
        const f = pos.get(p) ?? 0;
        const bar = host.el('div', 'eq-bar', u.el, {
          left: `${(u.textAt.x + p.x + p.w * 0.14).toFixed(2)}px`,
          width: `${(p.w * 0.72).toFixed(2)}px`,
          background: mixHex(spectrumColor(host, section, f), section.palette.bg, 0.55),
        });
        let cap: HTMLDivElement | null = null;
        if (params.caps > 0) {
          cap = host.el('div', 'eq-cap', u.el, {
            left: `${(u.textAt.x + p.x + p.w * 0.12).toFixed(2)}px`,
            width: `${(p.w * 0.76).toFixed(2)}px`,
            height: `${Math.max(3, 0.05 * S).toFixed(2)}px`,
            background: section.palette.text,
          });
        }
        const ia = host.metrics(p.text, u.font.weight, u.ltr, u.font.family).ia * S;
        out.push({ u, p, f, g: 0.7 + 0.3 * hash(u.item * 31 + p.index * 7 + section.index), ia, bar, cap });
      }
    }
    bars.set(section, out);
  },
  frame(c, t) {
    const { host, section, params } = c;
    const r = fast(c);
    const rp = slow(c);
    if (params.kick && owns(section, t)) host.stageCh.kick += params.kick * level(r, 'sub', t);
    const ex = exitWindow(section);
    // settle into the hold (and back out of it before the exit) so the hold reads calmly
    const T = section.timing;
    const calm = Math.min(clamp01((t - T.holdStart + 0.3) / 0.3), clamp01((T.holdEnd + 0.3 - t) / 0.3));
    const amp = params.amp * (1 - (1 - params.hold) * section.motion.inOut(calm));
    for (const b of bars.get(section) ?? []) {
      const { u, p } = b;
      const land = Number.isFinite(u.at) ? clamp01((t - u.at) / SETTLE) : 1;
      const yb = innerBaseline(u);
      const S = u.font.size;
      /** The unit's ink ascent (px): a full-energy bar is `amp` of it. */
      const ia = yb - u.inkBox!.y;
      const foot = u.textAt.y + yb - b.ia - GAP * S;
      const v = Math.min(1, energy(r, b.f, t) * b.g) * land;
      // the glyph rides up by whole pixels (a pure translation: crisp, history-free) on its column
      const out = !!ex && t >= ex.t0;
      // the letter stays put (moved part spans leave stale ink behind with the seek history); its bar grows from
      // just above its ink, whole pixels
      const h = out ? 0 : Math.round(amp * v * ia);
      const bs = b.bar.style;
      bs.display = h >= 2 ? 'block' : 'none';
      bs.top = `${(foot - h).toFixed(2)}px`;
      bs.height = `${h}px`;
      if (!b.cap) continue;
      const shown = land >= 1 && !out;
      const st = b.cap.style;
      st.display = shown ? 'block' : 'none';
      // the cap rides on whichever is higher: the bar now or the slowly falling peak
      const vp = Math.max(v, Math.min(1, energy(rp, b.f, t) * b.g));
      const top = foot - Math.round(amp * vp * ia) - 0.04 * S - Math.max(3, 0.05 * S);
      st.transform = `translateY(${top.toFixed(2)}px)`;
    }
  },
  /** The smoothed band frames (bars and caps) this section reads while its layer is drawn. */
  fingerprint(c, t0, t1) {
    const { section, params } = c;
    const a = Math.max(t0, section.layer.start);
    const b = Math.min(t1, section.layer.end);
    if (a > b) return null;
    const r = fast(c);
    return { source: r.source, bars: slice(r, BANDS, a, b), ...(params.caps > 0 ? { caps: slice(slow(c), BANDS, a, b) } : {}) };
  },
});
