/**
 * Glitch slices. `mount` gives every text unit `slices` + 2 copies of its text in the section group (same font and
 * place as its inner element, padded so no ink is cut), and the section a full-frame canvas in `layer.over`.
 *
 * `stateAt` is the whole timeline (pure in t): hidden before the glitch-in; glitch-in (stutter steps of 1/`stutter`
 * s: every value is drawn from the step index, so a step holds its picture, flickering blanks); a landing shock;
 * after-shock bursts on chosen beats that end before the hold; nothing inside the hold; a tear-out exit. While a
 * unit glitches its real text is hidden and the copies show horizontal bands of it shifted sideways (translate
 * only: glyphs are never skewed or squashed), RGB-split by text-shadow, some recoloured, two datamosh blocks of the
 * word jumping out of place; the canvas adds colour macroblocks and tear lines.
 */
import type { SoundCue } from '@reel/core';
import { clamp01, hash } from '@reel/runtime';
import { defineReveal, type Section, type Unit } from '../../../contract.ts';
import { exitWindow } from '../../../lib/neon.ts';
import { frameCanvas, groupToScreen } from '../../../lib/overlay.ts';
import { endcardStinger, sizeWeight } from '../../../lib/sound.ts';
import { meta } from './meta.ts';

interface Data {
  anim: 'glitch' | 'flicker';
}
interface Copies {
  els: HTMLElement[];
  /** Copy box (padding included), px. */
  w: number;
  h: number;
  pad: number;
}
interface State {
  /** Intensity 0..1. */
  I: number;
  /** Stutter step id: every random draw of the frame derives from it. */
  n: number;
  blank: boolean;
}
type P = { lead: number; stutter: number; bursts: number; exit: number };

const copies = new WeakMap<Unit, Copies>();
const ctxs = new WeakMap<Section, CanvasRenderingContext2D>();
const BLOCKS = 2;
/** Landing shock and after-shock burst lengths (s). */
const SHOCK = 0.1;
const BURST = 0.13;

const written = new WeakMap<HTMLElement, Map<string, string>>();
function put(el: HTMLElement, prop: string, value: string): void {
  let m = written.get(el);
  if (!m) written.set(el, (m = new Map()));
  if (m.get(prop) === value) return;
  m.set(prop, value);
  el.style.setProperty(prop, value);
}

/** Beats of the section that carry an after-shock burst: after the first landing, ending before the hold. */
function burstBeats(beats: readonly number[], s: Section, share: number): number[] {
  const from = s.timing.firstLand + SHOCK + 0.05;
  const to = s.timing.holdStart - BURST - 0.05;
  return beats.filter((b) => b >= from && b <= to && hash(b * 7.31 + s.index * 1.7) < share);
}

function stateAt(u: Unit, s: Section, bursts: number[], params: P, t: number): State | 'hidden' | null {
  const rate = params.stutter;
  const st = u.at - params.lead;
  const ex = exitWindow(s);
  if (ex && t >= ex.t0) {
    const d = Math.min(params.exit, ex.t1 - ex.t0);
    const step = Math.floor((t - ex.t0) * rate);
    const kx = step / rate / d;
    if (kx >= 1) return 'hidden';
    const n = 3000 + step;
    return { I: 0.5 + 0.5 * kx, n, blank: hash(n * 5.7 + u.id * 0.3) < 0.12 + 0.55 * kx };
  }
  // Holds are the real text only: no slices, split, stutter or blocks.
  if (t >= s.timing.holdStart) return null;
  if (t < st) return 'hidden';
  if (t < u.at) {
    const step = Math.floor((t - st) * rate);
    const k = step / rate / params.lead;
    const n = 100 + step;
    return { I: 1 - 0.55 * k, n, blank: hash(n * 3.1 + u.id * 0.7) < 0.25 * (1 - k) };
  }
  if (t < u.at + SHOCK) return { I: 0.45, n: 1000 + Math.floor((t - u.at) * rate), blank: false };
  for (const b of bursts) {
    if (t >= b && t < b + BURST && b >= u.at + SHOCK) {
      return { I: 0.3 + 0.3 * hash(b * 3.3), n: 2000 + Math.round(b * 30) * 7 + Math.floor((t - b) * rate), blank: false };
    }
  }
  return null;
}

function hide(cp: Copies, color: string): void {
  for (const el of cp.els) {
    put(el, 'visibility', 'hidden');
    put(el, 'transform', 'none');
    put(el, 'clip-path', 'none');
    put(el, 'color', color);
    put(el, 'text-shadow', 'none');
  }
}

export default defineReveal({
  meta,
  prepare(_c, u) {
    const glitch = !!u.text && u.font.size > 0;
    if (glitch) u.split = 'none';
    u.data.reveal = { anim: glitch ? 'glitch' : 'flicker' } satisfies Data;
  },
  mount({ host, section, params }) {
    ctxs.set(section, frameCanvas(host, 'glitch-fx', section.layer.over));
    const K = Math.round(params.slices);
    for (const u of section.units) {
      if (!u.revealed || (u.data.reveal as Data).anim !== 'glitch') continue;
      const S = u.font.size;
      const pad = Math.ceil(0.35 * S);
      const px = (v: number) => `${v.toFixed(2)}px`;
      const els = Array.from({ length: K + BLOCKS }, () => {
        const el = host.el('div', u.ltr ? 't gl-copy ltr' : 't gl-copy', section.group, {
          left: px(u.box.x + u.textAt.x - pad),
          top: px(u.box.y + u.textAt.y - pad),
          padding: `${pad}px`,
          'font-family': `${u.font.family === 'text' ? 'var(--textfont)' : 'var(--display)'}, sans-serif`,
          'font-size': px(S),
          'font-weight': String(u.font.weight),
          color: u.color,
          visibility: 'hidden',
        });
        el.textContent = u.text;
        return el;
      });
      const r = els[0]!.getBoundingClientRect();
      copies.set(u, { els, w: r.width, h: r.height, pad });
    }
  },
  frame({ host, section, params }, t) {
    const g = ctxs.get(section);
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.clearRect(0, 0, host.W, host.H);
    g.setTransform(...groupToScreen(host, section));
    const K = Math.round(params.slices);
    const bursts = burstBeats(host.reel.cues.beats, section, params.bursts);
    const a0 = host.accent(0, section);
    const a1 = host.accent(1, section);
    const a2 = host.accent(2, section);
    for (const u of section.units) {
      if (!u.revealed) continue;
      const c = u.ch;
      const s = stateAt(u, section, bursts, params, t);
      const cp = copies.get(u);
      if (!cp) {
        // logos and text-less decorations flicker in and out, jumping sideways (translate only)
        if (s === 'hidden') c.visible = false;
        else if (s) {
          c.visible &&= !s.blank && hash(s.n * 1.9 + u.id) > 0.3 * s.I;
          c.itx += Math.round((hash(s.n * 2.7 + u.id) - 0.5) * 0.15 * u.box.w * s.I);
          c.opacity *= 0.55 + 0.45 * (1 - s.I);
        }
        continue;
      }
      const color = c.color ?? u.color;
      if (s === null || s === 'hidden') {
        if (s === 'hidden') c.visible = false;
        hide(cp, color);
        continue;
      }
      c.visible = false;
      const { I, n, blank } = s;
      const S = u.font.size;
      const { w, h, pad } = cp;
      // band edges, jittered per step
      const edges = Array.from({ length: K + 1 }, (_, j) =>
        j === 0 ? 0 : j === K ? h : ((j + (hash(n * 1.7 + j * 9.1 + u.id) - 0.5) * 0.6) / K) * h,
      );
      for (let j = 0; j < K; j++) {
        const el = cp.els[j]!;
        const missing = blank || hash(n * 2.9 + j * 5.3 + u.id * 0.3) < 0.08 * I;
        if (missing) {
          put(el, 'visibility', 'hidden');
          put(el, 'transform', 'none');
          put(el, 'clip-path', 'none');
          put(el, 'color', color);
          put(el, 'text-shadow', 'none');
          continue;
        }
        const moved = hash(n * 13.7 + j * 3.31 + u.id * 0.71) > 0.42;
        const dx = moved ? Math.round((hash(n * 7.3 + j * 1.9 + u.id) - 0.5) * 2 * params.shift * S * I) : 0;
        const rc = hash(n * 4.1 + j * 7.7 + u.id);
        const sp = Math.round(params.split * 0.06 * S * I * (0.5 + hash(n * 8.3 + j * 2.2)));
        put(el, 'visibility', 'visible');
        put(el, 'transform', dx ? `translate(${dx}px, 0px)` : 'none');
        put(el, 'clip-path', `inset(${edges[j]!.toFixed(1)}px 0px ${(h - edges[j + 1]!).toFixed(1)}px 0px)`);
        put(el, 'color', rc < 0.12 * I ? a1 : rc < 0.22 * I ? a2 : color);
        put(el, 'text-shadow', sp >= 1 ? `${sp}px 0 var(--split-a), ${-sp}px 0 var(--split-b)` : 'none');
      }
      for (let b = 0; b < BLOCKS; b++) {
        const el = cp.els[K + b]!;
        const seed = n * 6.1 + b * 3.3 + u.id;
        if (blank || hash(seed) >= params.blocks * I * 0.9) {
          put(el, 'visibility', 'hidden');
          put(el, 'transform', 'none');
          put(el, 'clip-path', 'none');
          put(el, 'color', color);
          put(el, 'text-shadow', 'none');
          continue;
        }
        const bw = (0.12 + 0.3 * hash(seed + 0.1)) * w;
        const bh = (0.18 + 0.35 * hash(seed + 0.2)) * h;
        const x0 = hash(seed + 0.3) * (w - bw);
        const y0 = hash(seed + 0.4) * (h - bh);
        const q = Math.max(4, Math.round(S / 12));
        const dx = Math.round(((hash(seed + 0.5) - 0.5) * 0.9 * S * I) / q) * q;
        const dy = Math.round(((hash(seed + 0.6) - 0.5) * 0.5 * S * I) / q) * q;
        put(el, 'visibility', 'visible');
        put(el, 'transform', `translate(${dx}px, ${dy}px)`);
        put(el, 'clip-path', `inset(${y0.toFixed(1)}px ${(w - x0 - bw).toFixed(1)}px ${(h - y0 - bh).toFixed(1)}px ${x0.toFixed(1)}px)`);
        put(el, 'color', b ? a0 : color);
        put(el, 'text-shadow', 'none');
      }
      if (blank || params.blocks <= 0) continue;
      // colour macroblocks and tear lines over the word
      const q = Math.max(8, Math.round(S / 7));
      const ox = u.box.x + u.textAt.x - pad;
      const oy = u.box.y + u.textAt.y - pad;
      const count = Math.round(2 + 5 * I * params.blocks);
      for (let b = 0; b < count; b++) {
        const seed = n * 9.7 + b * 4.9 + u.id * 0.13;
        const bx = ox + Math.round(((hash(seed) * 1.1 - 0.05) * w) / q) * q;
        const by = oy + Math.round((hash(seed + 0.1) * h) / q) * q;
        const bw = q * (1 + Math.floor(hash(seed + 0.2) * 5));
        const bh = q * (1 + Math.floor(hash(seed + 0.3) * 2));
        g.globalAlpha = (0.3 + 0.5 * hash(seed + 0.4)) * I * params.blocks;
        g.fillStyle = [a0, a1, a2][b % 3]!;
        if (hash(seed + 0.5) < 0.4) {
          for (let y = 0; y < bh; y += 3) g.fillRect(bx, by + y, bw, 1.5);
        } else g.fillRect(bx, by, bw, bh);
      }
      const tear = oy + hash(n * 3.9 + u.id) * h;
      g.globalAlpha = 0.35 * I;
      g.fillStyle = a1;
      g.fillRect(ox - 0.6 * w, tear, 2.2 * w, Math.max(2, S / 40));
    }
    g.globalAlpha = 1;
  },
  /** The exit is drawn by the section's own copies, but its window starts at the section's `out`. */
  fingerprint({ section, params }, t0, t1) {
    const ex = exitWindow(section);
    return ex && ex.t0 < t1 && ex.t1 >= t0 ? { ...ex, d: Math.min(params.exit, ex.t1 - ex.t0) } : null;
  },
  /**
   * Landings hit (impact for heroes, emphasis and titles, a digital tick for the rest); each after-shock burst
   * clicks once; exits whoosh with a tick as the words tear.
   */
  sounds({ host, section, params }) {
    const out: SoundCue[] = endcardStinger(section, 0.85);
    let i = 0;
    for (const u of section.units) {
      if (!u.revealed || u.item < 0 || !Number.isFinite(u.at)) continue;
      const pan = host.pan(u);
      if (u.tags.hero || u.emphasis || section.role === 'title' || section.role === 'cta') {
        out.push({ t: u.at, kind: 'impact', weight: sizeWeight(u, host.H, 0.4), pan });
      } else out.push({ t: u.at, kind: 'tick', weight: 0.45, pitch: (i++ % 4) * 2, pan });
    }
    for (const b of burstBeats(host.reel.cues.beats, section, params.bursts)) out.push({ t: b, kind: 'tick', weight: 0.3, pitch: 7 });
    const ex = exitWindow(section);
    if (ex) {
      out.push({ t: ex.t0, until: ex.t0 + Math.min(params.exit, ex.t1 - ex.t0), kind: 'whoosh', weight: 0.45 });
      out.push({ t: ex.t0 + 0.04, kind: 'tick', weight: 0.4, pitch: -3 });
    }
    return out;
  },
});
