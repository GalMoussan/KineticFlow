/**
 * Weight wave. `mount` lists the section's grapheme parts with their reading position q (0 at the section's start
 * edge, 1 at its end, rows weighing in a little) and their place r inside their word. Per frame, each letter's
 * weight is: hairline → layout weight as its word lands (a sweep in reading order through the motion's in-out
 * curve), minus a Gaussian dip for every beat wave crossing the section (fading out before the hold), drained back
 * to hairline on exits. Weights snap to steps of 10.
 *
 * Holds are the measured split at the layout weight: no per-letter shift, so kerning is the line the splitter
 * measured. While a letter's weight differs, its advance (DOM, same face and size) replaces that slot and the
 * word is repacked — neighbours stay tight, the line stays centred on the measured word.
 */
import type { SoundCue } from '@reel/core';
import { clamp01 } from '@reel/runtime';
import { defineAxis, type Part, type Section, type Unit } from '../../../contract.ts';
import { exitWindow } from '../../../lib/neon.ts';
import { meta } from './meta.ts';

interface Letter {
  u: Unit;
  p: Part;
  /** Reading position across the section, 0..1. */
  q: number;
  /** Place inside its word in reading order, 0..1. */
  r: number;
}
const letters = new WeakMap<Section, Letter[]>();
/** Weight swell starts this long before a word's landing (with the reveal's lead). */
const LEAD = 0.15;
/** Sweep spread: how much later the word's last letter swells than its first (share of the swell). */
const SPREAD = 1.2;
/** Waves fade out over this long before the hold. */
const SETTLE = 0.3;
/** The exit drains the weight over this share of the exit window (the transition fades the layer meanwhile). */
const EXIT = 0.8;

const widths = new Map<string, number>();
/** Border-box width of one grapheme at `weight`, in px. Isolated, so the delta from the layout weight is the advance change. */
function glyphWidth(stage: HTMLElement, family: string, size: number, weight: number, text: string, rtl: boolean): number {
  const key = `${family}|${size}|${weight}|${rtl ? 1 : 0}|${text}`;
  const hit = widths.get(key);
  if (hit !== undefined) return hit;
  const probe = document.createElement('span');
  probe.textContent = text;
  probe.dir = rtl ? 'rtl' : 'ltr';
  probe.style.cssText = [
    'position:absolute',
    'left:0',
    'top:0',
    'visibility:hidden',
    'white-space:pre',
    'line-height:1',
    'font-kerning:normal',
    'unicode-bidi:isolate',
    `font-family:"${family}",sans-serif`,
    `font-size:${size}px`,
    `font-weight:${weight}`,
  ].join(';');
  stage.appendChild(probe);
  const w = probe.getBoundingClientRect().width;
  probe.remove();
  widths.set(key, w);
  return w;
}

/** Beat length of the cue sheet's grid (s). */
function beatOf(beats: readonly number[]): number {
  return beats.length > 1 ? (beats.at(-1)! - beats[0]!) / (beats.length - 1) : 0.5;
}

/**
 * Repack one visual line. Each letter's box becomes its layout width plus the advance change at its current
 * weight; the gaps the splitter measured (kerning, overlaps) stay. The line's centre stays put. At the layout
 * weight every shift is 0.
 */
function pack(
  line: { p: Part; w: number; base: number }[],
  widthOf: (p: Part, weight: number) => number,
): void {
  const n = line.length;
  if (n === 0) return;
  const order = line.map((it, i) => i).sort((a, b) => line[a]!.p.x - line[b]!.p.x);
  const cur = order.map((i) => {
    const it = line[i]!;
    if (it.w === it.base) return it.p.w;
    const delta = widthOf(it.p, it.w) - widthOf(it.p, it.base);
    return Math.max(0, it.p.w + delta);
  });
  const lefts: number[] = [];
  let x = 0;
  for (let i = 0; i < n; i++) {
    lefts.push(x);
    const a = line[order[i]!]!.p;
    const b = line[order[i + 1]!]?.p;
    const gap = b ? b.x - (a.x + a.w) : 0;
    x += cur[i]! + gap;
  }
  let oL = Infinity;
  let oR = -Infinity;
  for (const it of line) {
    oL = Math.min(oL, it.p.x);
    oR = Math.max(oR, it.p.x + it.p.w);
  }
  const shift = (oL + oR) / 2 - (lefts[n - 1]! + cur[n - 1]!) / 2;
  for (let i = 0; i < n; i++) {
    const p = line[order[i]!]!.p;
    const desiredLeft = lefts[i]! + shift;
    const rtl = p.span.dir === 'rtl';
    const tx = rtl ? desiredLeft - (p.x + p.w - cur[i]!) : desiredLeft - p.x;
    if (tx !== 0) p.ch.tx += tx;
  }
}

/** Start times of the beat waves that can reach the section (every n-th beat of the grid, before its hold). */
function waves(beats: readonly number[], s: Section, every: number): number[] {
  const n = Math.max(1, Math.round(every));
  return beats.filter((b, i) => i % n === 0 && b >= s.timing.in - 2 && b < s.timing.holdStart);
}

export default defineAxis({
  meta,
  mount({ section }) {
    const list: Letter[] = [];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const at = (u: Unit, p: Part) => ({ x: u.box.x + u.textAt.x + p.x + p.w / 2, y: u.box.y + u.textAt.y + p.y + p.h / 2 });
    for (const u of section.units) {
      if (!u.text || !u.font.size || !u.parts.length) continue;
      for (const p of u.parts) {
        const c = at(u, p);
        x0 = Math.min(x0, c.x);
        x1 = Math.max(x1, c.x);
        y0 = Math.min(y0, c.y);
        y1 = Math.max(y1, c.y);
      }
    }
    const rtl = section.dir === 'rtl';
    for (const u of section.units) {
      if (!u.text || !u.font.size || !u.parts.length) continue;
      const n = u.parts.length;
      for (const p of u.parts) {
        const c = at(u, p);
        const qx = x1 > x0 ? (c.x - x0) / (x1 - x0) : 0.5;
        const qy = y1 > y0 ? (c.y - y0) / (y1 - y0) : 0.5;
        list.push({ u, p, q: 0.8 * (rtl ? 1 - qx : qx) + 0.2 * qy, r: n > 1 ? p.index / (n - 1) : 0 });
      }
    }
    letters.set(section, list);
  },
  frame({ host, section, params }, t) {
    const list = letters.get(section);
    if (!list?.length) return;
    const m = section.motion;
    const beats = host.reel.cues.beats;
    const travel = params.travel * beatOf(beats);
    const sigma = params.width;
    const hold = section.timing.holdStart;
    const amp = clamp01((hold - t) / SETTLE);
    // wave fronts c(t) crossing the reading span (from −σ to 1 + σ), only those alive now
    const fronts: number[] = [];
    if (amp > 0) {
      for (const b of waves(beats, section, params.every)) {
        const k = (t - b) / travel;
        if (k >= 0 && k <= 1) fronts.push(-2 * sigma + k * (1 + 4 * sigma));
      }
    }
    const ex = exitWindow(section);
    const kx = ex && t >= ex.t0 ? clamp01((t - ex.t0) / (EXIT * (ex.t1 - ex.t0))) : 0;
    // At the hold every letter is the layout weight in the measured split.
    if (kx === 0 && t >= hold) return;
    const pending = new Map<Unit, { p: Part; w: number; base: number }[]>();
    for (const { u, p, q, r } of list) {
      const [lo, hi] = host.reel.fonts[u.font.family].weights;
      const clampW = (w: number) => (w < lo ? lo : w > hi ? hi : w);
      const base = clampW(u.font.weight);
      const floor = clampW(Math.min(params.floor, base));
      const k = clamp01((t - (u.at - LEAD)) / params.entry);
      const swell = m.inOut(clamp01(k * (1 + SPREAD) - r * SPREAD));
      let w = floor + (base - floor) * swell;
      let dip = 0;
      for (const c of fronts) dip += Math.exp(-(((q - c) / sigma) ** 2));
      // the small line under the big words only swells in; the beat waves run through the big words
      if (u.kind !== 'sub') w -= params.depth * Math.min(1, dip) * amp * swell;
      if (kx > 0) {
        const drain = m.inOut(clamp01(kx * (1 + SPREAD) - q * SPREAD));
        w -= (w - floor) * drain;
        p.ch.opacity *= 1 - drain * drain;
      }
      w = clampW(Math.round(w / 10) * 10);
      if (Math.abs(w - base) >= 1) p.ch.wght = w;
      const row = pending.get(u);
      if (row) row.push({ p, w, base });
      else pending.set(u, [{ p, w, base }]);
    }
    for (const [u, row] of pending) {
      if (row.every((it) => it.w === it.base)) continue;
      const fam = host.families[u.font.family];
      const widthOf = (p: Part, weight: number) => glyphWidth(host.stage, fam, u.font.size, weight, p.text, p.span.dir === 'rtl');
      // One visual line at a time, so a wrapped word does not pack across rows.
      const lines: { p: Part; w: number; base: number }[][] = [];
      for (const it of [...row].sort((a, b) => a.p.y - b.p.y || a.p.x - b.p.x)) {
        const line = lines.at(-1);
        if (!line || Math.abs(it.p.y - line[0]!.p.y) > it.p.h * 0.5) lines.push([it]);
        else line.push(it);
      }
      for (const line of lines) pack(line, widthOf);
    }
  },
  /** The exit drain depends on the next section's window. */
  fingerprint({ section }, t0, t1) {
    const ex = exitWindow(section);
    return ex && ex.t0 < t1 && ex.t1 >= t0 ? ex : null;
  },
  /** A soft swipe as each beat wave runs across the letters (not inside the music's fade-in). */
  sounds({ host, section, params }) {
    if (!letters.get(section)?.length) return [];
    const travel = params.travel * beatOf(host.reel.cues.beats);
    const first = section.timing.firstLand;
    return waves(host.reel.cues.beats, section, params.every)
      .filter((b) => b >= Math.max(0.6, first) && b + 0.1 < section.timing.holdStart)
      .map((b): SoundCue => ({ t: b, until: b + travel, kind: 'swipe', weight: 0.18, pan: section.dir === 'rtl' ? 0.3 : -0.3 }));
  },
});
