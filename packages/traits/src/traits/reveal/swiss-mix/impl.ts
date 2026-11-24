import type { SoundCue } from '@reel/core';
import { clamp01, quart } from '@reel/runtime';
import { defineReveal, type Part, type Section, type Unit } from '../../../contract.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import { subLanding } from '../../../lib/subline.ts';
import { meta } from './meta.ts';

type Anim = 'rise' | 'fall' | 'slide' | 'grow' | 'pop' | 'odometer' | 'rule' | 'drop' | 'shape';
interface Data {
  anim: Anim;
  /** Slide: +1 = from the right, −1 = from the left. */
  side: number;
}

const SPLIT: Partial<Record<Anim, true>> = { rise: true, fall: true, grow: true, pop: true, odometer: true };
const MASKED: Partial<Record<Anim, true>> = { rise: true, fall: true, slide: true, grow: true, odometer: true };
const DIGIT = /^[0-9]$/;

function choose(u: Unit, s: Section): Anim {
  if (u.kind === 'sub') return 'rise';
  if (u.deco === 'rule' || u.deco === 'bar') return 'rule';
  if (u.deco === 'pin') return 'drop';
  if (u.item < 0) return 'shape';
  if (u.tags.numeric) return 'odometer';
  if (u.tags.ordinal >= 0) return u.tags.ordinal % 2 === 0 ? 'grow' : 'pop';
  if (u.tags.hero) return 'rise';
  if (u.tags.align === 'end') return 'slide';
  const content = s.units.filter((x) => x.item >= 0);
  if (u.tags.align === 'start' && content.some((x) => x.tags.align === 'end')) return u.tags.line % 3 === 2 ? 'rise' : 'slide';
  if (u.kind === 'weekday' || u.kind === 'city') return 'slide';
  const last = Math.max(...content.map((x) => x.tags.line));
  if (u.tags.align === 'start' && u.tags.line === last && last > 0 && u.kind === 'word' && s.role !== 'title') return 'fall';
  return 'rise';
}

/** Odometer columns appended to `u.el` over each digit part (strip of digits ending on the real one). */
interface Column {
  part: Part;
  col: HTMLDivElement;
  strip: HTMLDivElement;
  n: number;
  /** Order among the unit's digits (later digits land later). */
  j: number;
}
const columns = new WeakMap<Unit, Column[]>();

export default defineReveal({
  meta,
  prepare({ section }, u) {
    const anim = choose(u, section);
    const startSide = section.dir === 'rtl' ? 1 : -1;
    const data: Data = { anim, side: u.tags.align === 'end' ? -startSide : startSide };
    u.data.reveal = data;
    if (!u.text) return;
    u.masked = !!MASKED[anim];
    if (SPLIT[anim]) u.split = 'grapheme';
    u.innerOrigin = '50% 60%';
  },
  mount({ host, section }) {
    for (const u of section.units) {
      const d = u.data.reveal as Data | undefined;
      if (d?.anim !== 'odometer' || !u.el || !u.inner) continue;
      const cols: Column[] = [];
      const fs = u.inner.style;
      for (const p of u.parts) {
        if (!DIGIT.test(p.text)) continue;
        const j = cols.length;
        const n = 12 + j * 3;
        const col = host.el('div', 'odo', u.el, {
          left: `${(u.textAt.x + p.x).toFixed(2)}px`,
          top: `${(u.textAt.y + p.y).toFixed(2)}px`,
          width: `${p.w.toFixed(2)}px`,
          height: `${p.h.toFixed(2)}px`,
        });
        const strip = host.el('div', 'odo-strip', col, {
          'font-family': fs.fontFamily,
          'font-size': fs.fontSize,
          'font-weight': fs.fontWeight,
          color: u.color,
          'line-height': `${p.h.toFixed(2)}px`,
        });
        const d0 = Number(p.text);
        for (let k = 0; k <= n; k++) {
          host.el('div', '', strip, { height: `${p.h.toFixed(2)}px` }).textContent = String((((d0 - n + k) % 10) + 10) % 10);
        }
        cols.push({ part: p, col, strip, n, j });
      }
      columns.set(u, cols);
    }
  },
  frame({ host, section, params }, t) {
    const m = section.motion;
    const D = params.duration;
    const B = params.blur;
    const exits = section.role === 'cta' && !!section.next && section.next.layer !== section.layer;
    for (const u of section.units) {
      if (!u.revealed) continue;
      const d = u.data.reveal as Data;
      const c = u.ch;
      const S = u.font.size || u.box.h;
      const st = u.at - (u.item < 0 ? 0 : params.lead);
      c.visible &&= t >= st;
      const n = u.parts.length;
      const stg = n > 1 ? Math.min(params.stagger, 0.35 / (n - 1)) : 0;
      /** Letters rise from behind the baseline mask (−1: fall from above with a bounce). */
      const rise = (p: Part, at: number, from: number): number => {
        const k = clamp01((t - at - p.index * stg) / D);
        const e = from > 0 ? m.enter(k) : m.bounce(k, 1.9);
        if (k > 0 && k < 1) p.ch.blur += (1 - m.enter(k)) * 8 * B;
        return (1 - e) * from * S;
      };
      switch (d.anim) {
        case 'rise':
        case 'fall': {
          const from = d.anim === 'rise' ? 1.3 : -1.35;
          if (n) for (const p of u.parts) p.ch.ty += rise(p, st, from);
          else c.ity += (1 - m.enter(clamp01((t - st) / D))) * u.box.h;
          break;
        }
        case 'grow': {
          c.clip = Math.min(c.clip, m.inOut(clamp01((t - st) / 0.28)));
          c.clipFrom = 'start';
          for (const p of u.parts) p.ch.ty += rise(p, st + 0.12, 1.3);
          break;
        }
        case 'slide': {
          const k = clamp01((t - st) / D);
          const e = m.enter(k);
          c.itx += (1 - e) * d.side * u.box.w * 1.12;
          if (k > 0 && k < 1) c.blur += (1 - e) * 16 * B;
          break;
        }
        case 'pop':
          for (const p of u.parts) {
            const k = clamp01((t - st - p.index * stg) / 0.4);
            const de = m.bounce(k, 2);
            const s = Math.max(0, de);
            p.ch.sx *= s;
            p.ch.sy *= s;
            p.ch.ty -= (1 - de) * 0.5 * S;
            p.ch.rot += (1 - de) * (p.index % 2 ? 25 : -25);
            if (k > 0 && k < 1) p.ch.blur += (1 - m.enter(k)) * 6 * B;
            if (k <= 0) p.ch.opacity = 0;
          }
          break;
        case 'odometer': {
          const cols = columns.get(u) ?? [];
          for (const p of u.parts) if (!DIGIT.test(p.text)) p.ch.ty += rise(p, st, 1.3);
          for (const q of cols) {
            const land = st + D + q.j * 0.1;
            const k = clamp01((t - st) / (land - st));
            const spinning = k < 1;
            const ty = rise(q.part, st, 1.3);
            q.part.ch.blur = 0;
            if (spinning) q.part.ch.opacity = 0;
            const cs = q.col.style;
            // display, not visibility: a visible child would show through a hidden unit
            cs.display = spinning && t >= st ? 'block' : 'none';
            cs.transform = `translateY(${ty.toFixed(2)}px)`;
            q.strip.style.transform = `translateY(${(-quart(k) * q.n * q.part.h).toFixed(2)}px)`;
            const b = 12 * Math.pow(1 - k, 3) * B;
            q.strip.style.filter = spinning && b > 0.3 ? `blur(${b.toFixed(2)}px)` : 'none';
          }
          break;
        }
        case 'rule': {
          const k = clamp01((t - st) / 0.45);
          c.visible &&= k > 0;
          c.sx *= m.inOut(k);
          break;
        }
        case 'drop': {
          // falls (expo-in) onto its baseline, then squashes
          const k = clamp01((t - st) / 0.4);
          const e = m.exit(k);
          c.ty -= (1 - e) * (u.box.y + u.box.h + 0.1 * host.H);
          if (k > 0 && k < 1) c.blur += e * 14 * B;
          const a = t - (st + 0.4);
          if (a > 0) {
            const sq = Math.exp(-a * 9) * Math.cos(a * 30);
            c.sx *= 1 + 0.12 * sq;
            c.sy *= 1 - 0.16 * sq;
          }
          break;
        }
        case 'shape': {
          const s = Math.max(0, m.bounce(clamp01((t - st) / 0.45), 1.7));
          c.sx *= s;
          c.sy *= s;
          break;
        }
      }
      // the call to action splits apart while the next panel wipes in
      if (exits && u.item >= 0) {
        const xk = m.inOut(clamp01((t - section.timing.out) / 0.38));
        c.tx += xk * (u.tags.line % 2 ? -1 : 1) * host.W * 1.1;
        c.blur += xk * 26 * B;
      }
    }
  },
  /** Pops for pop/grow emphasis, the hero and the pin's landing; one tick per odometer digit as it settles. */
  sounds({ host, section, params }) {
    const out: SoundCue[] = endcardStinger(section);
    let k = 0;
    let si = 0;
    for (const u of section.units) {
      if (!u.revealed || !Number.isFinite(u.at)) continue;
      const d = u.data.reveal as Data;
      const st = u.at - (u.item < 0 ? 0 : params.lead);
      const pan = host.pan(u);
      if (u.kind === 'sub') {
        const c = subLanding(u.at, si++, pan);
        if (c) out.push(c);
        continue;
      }
      if (d.anim === 'odometer') {
        for (const q of columns.get(u) ?? []) out.push({ t: st + params.duration + q.j * 0.1, kind: 'tick', weight: 0.5, pitch: 2 * q.j, pan });
      } else if (d.anim === 'drop') out.push({ t: st + 0.4, kind: 'pop', weight: 0.6, pitch: -3, pan });
      else if (d.anim === 'pop' || d.anim === 'grow' || (d.anim === 'rise' && u.tags.hero)) {
        out.push({ t: u.at, kind: 'pop', weight: d.anim === 'pop' ? 0.55 : 0.45, pitch: Math.min(7, 2 * k++), pan });
      }
    }
    return out;
  },
});
