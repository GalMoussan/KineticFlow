/**
 * Karaoke sweep. Timeline per section: lines fade in over `IN` s from `timing.in` (all units, whole); word i sweeps
 * linearly over [at − lead, at − lead + d], d = min(sweep, 85 % of the gap to the next landing) (lyric lines: 90 %
 * of the gap, uncapped), clipped from its reading start; when a word completes it gives a small lift. The ball (a
 * `deco: 'ball'` disc) drops onto the first word, hops on a parabola to each next word's start-side quarter,
 * landing as its sweep starts, then fades out before the hold.
 */
import type { SoundCue } from '@reel/core';
import { clamp01 } from '@reel/runtime';
import { defineReveal, type Section, type Unit } from '../../../contract.ts';
import { exitWindow } from '../../../lib/neon.ts';
import { inkRect } from '../../../lib/rowset.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import { subLanding } from '../../../lib/subline.ts';
import { meta } from './meta.ts';

const IN = 0.45;
const DROP = 0.35;

/** Sung units in landing order. */
const sung = (s: Section) => s.units.filter((u) => u.item >= 0 && u.kind !== 'logos' && u.text && Number.isFinite(u.at));

/** Sweep window of unit i of `list`. */
function sweepOf(s: Section, list: Unit[], i: number, lead: number, max: number): { t0: number; d: number } {
  const u = list[i]!;
  const next = list[i + 1]?.at ?? s.timing.holdStart;
  const gap = Math.max(0.1, next - u.at);
  return { t0: u.at - lead, d: u.kind === 'lyric' ? 0.9 * gap : Math.max(0.12, Math.min(max, 0.85 * gap)) };
}

/** Where the ball touches word u: over its reading-start quarter, resting on the ink top. */
function perch(u: Unit, r: number): { x: number; y: number } {
  const k = inkRect(u);
  const fromRight = (u.section.dir === 'rtl') !== u.ltr;
  return { x: fromRight ? k.x1 - 0.22 * (k.x1 - k.x0) : k.x0 + 0.22 * (k.x1 - k.x0), y: k.y0 - 0.12 * u.font.size - r };
}

export default defineReveal({
  meta,
  prepare(_c, u) {
    u.data.reveal = { anim: u.item >= 0 && u.text ? 'sweep' : 'fade' };
    // the sweep clips whole units over their unsplit unsung copies: parts would only shift the ink against the copy
    if (u.item >= 0) u.split = 'none';
  },
  setup({ host, section, params }) {
    const list = sung(section);
    if (!params.ball || !list.length) return;
    const S = Math.max(...list.map((u) => u.font.size));
    const d = Math.max(8, 0.2 * S);
    const ball = host.deco(section, {
      deco: 'ball',
      box: { x: -d / 2, y: -d / 2, w: d, h: d },
      html: '',
      textAt: { x: 0, y: 0 },
      innerStyle: { width: `${d.toFixed(2)}px`, height: `${d.toFixed(2)}px`, background: 'currentColor', 'border-radius': '50%' },
      color: host.accent(0, section),
      revealed: true,
      z: 2,
    });
    ball.data.reveal = { anim: 'ball', r: d / 2 };
  },
  frame({ host, section, params }, t) {
    const m = section.motion;
    const T = section.timing;
    const list = sung(section);
    const fadeIn = m.enter(clamp01((t - T.in) / IN));
    const ex = exitWindow(section);
    const out = ex && t >= ex.t0 ? m.exit(clamp01((t - ex.t0) / (ex.t1 - ex.t0))) : 0;
    for (const u of section.units) {
      if (!u.revealed) continue;
      const anim = (u.data.reveal as { anim: string }).anim;
      const c = u.ch;
      if (anim === 'ball') continue;
      c.visible &&= t >= T.in;
      c.opacity *= fadeIn * (1 - out);
      c.ty += (1 - fadeIn) * 0.12 * (u.font.size || 40) - out * 0.1 * (u.font.size || 40);
      if (anim !== 'sweep') continue;
      const i = list.indexOf(u);
      if (i < 0) continue;
      const w = sweepOf(section, list, i, params.lead, params.sweep);
      const k = clamp01((t - w.t0) / w.d);
      c.clip = Math.min(c.clip, k);
      c.clipFrom = (section.dir === 'rtl') === u.ltr ? 'end' : 'start';
      const lift = clamp01((t - w.t0 - w.d) / 0.3);
      if (lift > 0 && lift < 1) {
        const s = 1 + 0.05 * Math.sin(lift * Math.PI);
        c.isx *= s;
        c.isy *= s;
      }
    }
    // the ball
    const ball = section.units.find((u) => (u.data.reveal as { anim?: string } | undefined)?.anim === 'ball');
    if (!ball || !list.length) return;
    const r = (ball.data.reveal as { r: number }).r;
    const first = list[0]!;
    const t0 = sweepOf(section, list, 0, params.lead, params.sweep).t0;
    const lastT = sweepOf(section, list, list.length - 1, params.lead, params.sweep).t0;
    const gone = Math.min(T.holdStart - 0.05, lastT + 0.6);
    let p: { x: number; y: number };
    let a = 1;
    if (t < t0) {
      // drops in from above onto the first word
      const k = clamp01((t - (t0 - DROP)) / DROP);
      const q = perch(first, r);
      p = { x: q.x, y: q.y - (1 - k * k) * 0.25 * host.H };
      a = k;
    } else {
      let i = 0;
      while (i + 1 < list.length && sweepOf(section, list, i + 1, params.lead, params.sweep).t0 <= t) i++;
      const q0 = perch(list[i]!, r);
      if (i + 1 < list.length) {
        const ta = sweepOf(section, list, i, params.lead, params.sweep).t0;
        const tb = sweepOf(section, list, i + 1, params.lead, params.sweep).t0;
        const k = clamp01((t - ta) / Math.max(0.05, tb - ta));
        const q1 = perch(list[i + 1]!, r);
        const h = params.hop * Math.max(list[i]!.font.size, list[i + 1]!.font.size);
        p = { x: q0.x + (q1.x - q0.x) * k, y: q0.y + (q1.y - q0.y) * k - 4 * h * k * (1 - k) };
      } else p = q0;
      a = 1 - clamp01((t - (gone - 0.25)) / 0.25);
    }
    ball.ch.visible &&= t >= t0 - DROP && t < gone;
    ball.ch.tx += p.x;
    ball.ch.ty += p.y;
    ball.ch.opacity *= a * fadeIn;
    // squash on each touch-down
    const since = t - (list.map((u, i) => sweepOf(section, list, i, params.lead, params.sweep).t0).findLast((x) => x <= t) ?? -1);
    if (since >= 0 && since < 0.12) {
      const q = Math.sin((since / 0.12) * Math.PI);
      ball.ch.sx *= 1 + 0.25 * q;
      ball.ch.sy *= 1 - 0.25 * q;
    }
  },
  fingerprint({ section }, t0, t1) {
    const ex = exitWindow(section);
    return ex && ex.t0 < t1 && ex.t1 >= t0 ? ex : null;
  },
  /** A soft tick as each word starts (the ball's touch-down, pitch walking up the line); a whoosh as lines leave. */
  sounds({ host, section, params }) {
    const out: SoundCue[] = endcardStinger(section);
    const list = sung(section);
    let si = 0;
    list.forEach((u, i) => {
      const w = sweepOf(section, list, i, params.lead, params.sweep);
      if (u.kind === 'sub') {
        const c = subLanding(w.t0, si++, host.pan(u));
        if (c) out.push(c);
        return;
      }
      out.push({ t: w.t0, kind: params.ball ? 'tick' : 'pop', weight: u.emphasis ? 0.4 : 0.28, pitch: (i % 5) * 2, pan: host.pan(u) });
    });
    const ex = exitWindow(section);
    if (ex) out.push({ t: ex.t0, until: ex.t1, kind: 'whoosh', weight: 0.3 });
    return out;
  },
});
