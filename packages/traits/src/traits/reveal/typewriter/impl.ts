/**
 * Typewriter reveal: units are typed in item order, each grapheme part in logical order (`part.index`), so an RTL or
 * mixed line types in reading order while its parts keep their measured bidi positions. The schedule is fixed at
 * mount (keystroke step shortened so a unit finishes before the next one starts and every glitch ends before the
 * hold) and kept in `unit.data.reveal`. One block cursor per section (a decoration) follows the last typed
 * grapheme on its run's reading side; it is solid while typing and blinks from t at rest.
 */
import type { SoundCue } from '@reel/core';
import { clamp01, hash } from '@reel/runtime';
import { defineReveal, type Part, type Section, type Unit } from '../../../contract.ts';
import { scriptOf, standIn } from '../../../lib/glyphs.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import { subLanding } from '../../../lib/subline.ts';
import { meta } from './meta.ts';

interface Typed {
  kind: 'type';
  /** First keystroke, seconds per keystroke, keystrokes. */
  st: number;
  step: number;
  n: number;
  /** Glitch window [g0, g1) (empty when g1 ≤ g0). */
  g0: number;
  g1: number;
}
type Data = Typed | { kind: 'print' | 'show'; st: number };
type TypedUnit = Unit & { data: { reveal: Typed } };

/** Cursor block relative to a line box of font size 1 (top, height, width) and its gap after a grapheme. */
const CURSOR = { top: 0.1, h: 0.8, w: 0.56, gap: 0.06 };
/** The cursor stays solid this long after a keystroke. */
const SOLID = 0.3;
/** Seconds a logo badge takes to print (top to bottom, in steps). */
const PRINT = 0.4;
const GLITCH_FPS = 24;

/** The section's cursor decoration and its reference font size (its box is drawn at that size and scaled). */
const cursors = new WeakMap<Section, { u: Unit; S0: number }>();

const typedUnits = (s: Section) =>
  s.units.filter((u): u is TypedUnit => u.item >= 0 && (u.data.reveal as Data | undefined)?.kind === 'type' && u.parts.length > 0);
/** The new screen (prompt, blinking cursor) is up from the start of the section's incoming window. */
const screenOn = (s: Section) => s.window?.t0 ?? s.timing.in;
const endOf = (d: Typed) => d.st + d.n * d.step;

/** Where the cursor stands at t: group-coordinate top-left and the font size of the line it is on. */
function cursorAt(units: TypedUnit[], t: number): { x: number; y: number; S: number } {
  let u = units[0]!;
  for (const v of units) if (t >= v.data.reveal.st) u = v;
  const d = u.data.reveal;
  const S = u.font.size;
  const w = CURSOR.w * S;
  const gap = CURSOR.gap * S;
  const ox = u.box.x + u.textAt.x;
  const oy = u.box.y + u.textAt.y;
  const y = (p: Part) => oy + p.y + CURSOR.top * p.h;
  if (t < d.st) {
    // waiting on the first grapheme's cell
    const p = u.parts[0]!;
    return { x: p.span.dir === 'rtl' ? ox + p.x + p.w - w : ox + p.x, y: y(p), S };
  }
  const p = u.parts[Math.min(d.n - 1, Math.floor((t - d.st) / d.step))]!;
  return { x: p.span.dir === 'rtl' ? ox + p.x - gap - w : ox + p.x + p.w + gap, y: y(p), S };
}

export default defineReveal({
  meta,
  prepare(_c, u) {
    if (u.item >= 0 && u.text) u.split = 'grapheme';
  },
  /** The block cursor: a decoration below the text (z −1), drawn at the largest font size and scaled per line. */
  setup({ host, section }) {
    const S0 = Math.max(0, ...section.units.filter((u) => u.item >= 0 && u.text).map((u) => u.font.size));
    if (!S0) return;
    const u = host.deco(section, {
      deco: 'cursor',
      box: { x: 0, y: 0, w: CURSOR.w * S0, h: CURSOR.h * S0 },
      origin: '0 0',
      style: { background: section.palette.text },
      z: -1,
    });
    cursors.set(section, { u, S0 });
  },
  /** Keystroke schedule (needs the measured parts): fits each unit before the next one and its glitch before the hold. */
  mount({ section, params }) {
    const hold = section.timing.holdStart;
    const content = section.units.filter((u) => u.item >= 0);
    const starts = content.map((u) => u.at - params.lead);
    content.forEach((u, i) => {
      const st = starts[i]!;
      if (!u.parts.length) {
        u.data.reveal = { kind: u.kind === 'logos' ? 'print' : 'show', st } satisfies Data;
        return;
      }
      const n = u.parts.length;
      const glitch = u.kind === 'sub' ? 0 : (u.emphasis || u.tags.hero) && params.glitch > 0 ? params.glitch : 0;
      const limit = Math.min(starts.slice(i + 1).find((x) => x > st) ?? Infinity, hold - glitch - 0.05);
      const step = Math.min(params.rate, Math.max(0.004, (limit - st) / n));
      const end = st + n * step;
      u.data.reveal = { kind: 'type', st, step, n, g0: end, g1: glitch ? Math.max(end, Math.min(end + glitch, hold - 0.02)) : end } satisfies Data;
    });
    for (const u of section.units) if (u.deco === 'prompt') u.data.reveal = { kind: 'show', st: screenOn(section) } satisfies Data;
  },
  frame({ section, params }, t) {
    for (const u of section.units) {
      const d = u.data.reveal as Data | undefined;
      if (!d) continue;
      const c = u.ch;
      c.visible &&= t >= d.st;
      if (t < d.st) continue;
      if (d.kind === 'print') {
        c.clip = Math.min(c.clip, Math.floor(clamp01((t - d.st) / PRINT) * 8) / 8);
        c.clipFrom = 'top';
        continue;
      }
      if (d.kind !== 'type') continue;
      const typed = Math.floor((t - d.st) / d.step);
      for (const p of u.parts) if (p.index > typed) p.ch.opacity = 0;
      if (t < d.g0 || t >= d.g1) continue;
      // glitch: decaying bursts of stand-in glyphs, RGB split and sliced offsets (no skew: skewed text rasters
      // differently by seek history)
      const S = u.font.size;
      const amp = 1 - (t - d.g0) / (d.g1 - d.g0);
      const q = Math.floor((t - d.g0) * GLITCH_FPS);
      const seed = u.id * 13.7 + q * 3.1;
      for (const p of u.parts) {
        if (hash(seed + p.index * 1.93) < 0.2 + 0.45 * amp) p.ch.glyph = standIn(scriptOf(p.text), hash(seed + p.index * 7.7 + 0.5), p.text);
        p.ch.split += 0.06 * S * amp;
        if (hash(seed + p.index * 0.61 + 9) < 0.35) p.ch.tx += (hash(seed + 4.2) - 0.5) * 0.3 * S * amp;
      }
      c.itx += (hash(seed + 1.3) - 0.5) * 0.12 * S * amp;
    }

    const cur = cursors.get(section);
    const units = typedUnits(section);
    if (!cur) return;
    const c = cur.u.ch;
    if (!units.length || t < screenOn(section)) {
      c.visible = false;
      return;
    }
    const at = cursorAt(units, t);
    c.tx += at.x;
    c.ty += at.y;
    c.sx *= at.S / cur.S0;
    c.sy *= at.S / cur.S0;
    // solid while typing (and SOLID after a keystroke); at rest it blinks, starting "on" after the last keystroke
    let rest = screenOn(section);
    for (const u of units) {
      const d = u.data.reveal;
      if (t >= d.st) rest = Math.min(t, endOf(d) - d.step) + SOLID;
    }
    if (t >= rest) c.opacity *= Math.floor((t - rest) / params.blink) % 2 === 0 ? 0.92 : 0;
    else c.opacity *= 0.92;
  },
  /** Up to 4 key clicks per typed unit, a glitch shimmer per emphasis, a print pop per logo badge. */
  sounds({ host, section }) {
    const out: SoundCue[] = endcardStinger(section);
    let si = 0;
    for (const u of section.units) {
      const d = u.data.reveal as Data | undefined;
      if (!d || u.item < 0) continue;
      const pan = host.pan(u);
      if (d.kind === 'print') out.push({ t: d.st, kind: 'pop', weight: 0.4, pan });
      if (u.kind === 'sub') {
        const c = subLanding(d.st, si++, pan);
        if (c) out.push(c);
        continue;
      }
      if (d.kind !== 'type') continue;
      const m = Math.min(4, d.n);
      const picks = [...new Set(Array.from({ length: m }, (_, j) => Math.round((j * (d.n - 1)) / Math.max(1, m - 1))))];
      picks.forEach((i, j) =>
        out.push({ t: d.st + i * d.step, kind: 'tick', weight: 0.3 + 0.12 * hash(u.id * 3.3 + j), pitch: (hash(u.id * 5.1 + j * 2.7) - 0.5) * 5, pan }),
      );
      if (d.g1 > d.g0) out.push({ t: d.g0, until: d.g1, kind: 'shimmer', weight: 0.4, pan });
    }
    return out;
  },
});
