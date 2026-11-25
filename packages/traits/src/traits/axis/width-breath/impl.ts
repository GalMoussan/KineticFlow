/**
 * Width breath. One breath variable b (0 = the layout's width and weight, 1 = narrowest and lightest) drives
 * `wdth` = 100 − b · (100 − narrow) and `wght` = weight − b · lighten. Per frame: b falls 1 → breath as a word lands
 * (inhale, the motion's in-out curve), then follows a beat-locked cosine of depth `depth` (rows lag a little), and
 * rises to 1 on exits (exhale, fading).
 *
 * Centring: `setup` measures each text unit's width at STEPS breath steps with a hidden DOM probe (same font, size,
 * axes, direction) and fixes unsplit inner elements to their full width with centred text, so a narrower word
 * stays centred and the measured ink box stays where the layout put it. Split units (multi-word parts) keep their
 * measured slots: `mount` measures every part too, and each part is shifted so the words close up around the
 * unit's centre as the whole would.
 */
import { clamp01 } from '@reel/runtime';
import { defineAxis, type Host, type Section, type Unit } from '../../../contract.ts';
import { exitWindow } from '../../../lib/neon.ts';
import { meta } from './meta.ts';

const STEPS = 9;
/** The inhale starts this long before a word's landing (with the reveal's lead). */
const LEAD = 0.15;

interface Table {
  /** Width of the unit's text at each breath step, px. */
  unit: number[];
  /** Same per part (split units only), in `u.parts` order. */
  parts: number[][];
}
const tables = new WeakMap<Unit, Table>();

interface Breath {
  narrow: number;
  lighten: number;
}
const axes = (host: Host, u: Unit, p: Breath, b: number) => {
  const [lo, hi] = host.reel.fonts[u.font.family].weights;
  const w = u.font.weight - b * p.lighten;
  return { wdth: 100 - b * (100 - p.narrow), wght: w < lo ? lo : w > hi ? hi : w };
};

/** Measures `texts` of unit `u` at every breath step with a hidden probe span. */
function measure(host: Host, s: Section, u: Unit, p: Breath, texts: string[]): number[][] {
  const probe = host.el('span', 'wb-probe', host.stage, {
    position: 'absolute',
    left: '0',
    top: '0',
    visibility: 'hidden',
    'white-space': 'pre',
    'line-height': '1',
    'font-kerning': 'normal',
    'unicode-bidi': 'isolate',
    'font-family': `${u.font.family === 'text' ? 'var(--textfont)' : 'var(--display)'}, sans-serif`,
    'font-size': `${u.font.size.toFixed(2)}px`,
  });
  probe.dir = u.ltr ? 'ltr' : s.dir;
  const out = texts.map(() => [] as number[]);
  for (let i = 0; i < STEPS; i++) {
    const { wdth, wght } = axes(host, u, p, i / (STEPS - 1));
    probe.style.fontWeight = String(wght);
    // Match commit: a set wdth replaces the whole axis set, so wght has to be named too.
    probe.style.fontVariationSettings = `"wdth" ${wdth.toFixed(2)}, "wght" ${wght.toFixed(2)}`;
    texts.forEach((text, j) => {
      probe.textContent = text;
      out[j]!.push(probe.getBoundingClientRect().width);
    });
  }
  probe.remove();
  return out;
}

/** Width at breath b from a step table (linear between steps). */
function widthAt(table: number[], b: number): number {
  const x = clamp01(b) * (STEPS - 1);
  const i = Math.min(STEPS - 2, Math.floor(x));
  return table[i]! + (table[i + 1]! - table[i]!) * (x - i);
}

const breathing = (u: Unit) => !!u.text && u.font.size > 0;

export default defineAxis({
  meta,
  setup({ host, section, params }) {
    for (const u of section.units) {
      if (!breathing(u)) continue;
      const [unit] = measure(host, section, u, params, [u.text]);
      tables.set(u, { unit: unit!, parts: [] });
      if (u.split === 'none') u.innerStyle = { ...u.innerStyle, width: `${unit![0]!.toFixed(3)}px`, 'text-align': 'center' };
    }
  },
  mount({ host, section, params }) {
    for (const u of section.units) {
      const tb = tables.get(u);
      if (tb && u.parts.length) tb.parts = measure(host, section, u, params, u.parts.map((p) => p.text));
    }
  },
  frame({ host, section, params }, t) {
    const m = section.motion;
    const beats = host.reel.cues.beats;
    const beat = beats.length > 1 ? (beats.at(-1)! - beats[0]!) / (beats.length - 1) : 0.5;
    const period = params.period * beat;
    const t0 = beats[0] ?? 0;
    const ex = exitWindow(section);
    const out = ex && t >= ex.t0 ? m.inOut(clamp01((t - ex.t0) / (ex.t1 - ex.t0))) : 0;
    for (const u of section.units) {
      const tb = tables.get(u);
      if (!tb) continue;
      const e = m.inOut(clamp01((t - (u.at - LEAD)) / params.entry));
      const phase = (t - t0) / period - params.lag * Math.max(0, u.tags.line);
      // the small line under the big words inhales from half-narrow and breathes at a third of the depth
      const sub = u.kind === 'sub';
      const held = (sub ? 0.35 : 1) * params.depth * (0.5 - 0.5 * Math.cos(2 * Math.PI * phase));
      let b = (sub ? 0.5 : 1) * (1 - e) + e * held;
      b += (1 - b) * out;
      if (out > 0) u.ch.opacity *= 1 - out;
      if (b < 1e-3) continue;
      const { wdth, wght } = axes(host, u, params, b);
      u.ch.wdth = wdth;
      if (wght !== u.font.weight) u.ch.wght = wght;
      if (!u.parts.length || tb.parts.length !== u.parts.length) continue;
      // split units: every part narrows in its slot; slots close up around the unit's centre like the whole line
      const W0 = tb.unit[0]!;
      const rho = widthAt(tb.unit, b) / W0;
      const C = W0 / 2;
      u.parts.forEach((p, j) => {
        const pt = tb.parts[j]!;
        const w = p.w * (widthAt(pt, b) / pt[0]!);
        const anchored = p.span.dir === 'rtl' ? p.x + p.w - w / 2 : p.x + w / 2;
        p.ch.tx += C + (p.x + p.w / 2 - C) * rho - anchored;
      });
    }
  },
  /** The exhale depends on the next section's window. */
  fingerprint({ section }, t0, t1) {
    const ex = exitWindow(section);
    return ex && ex.t0 < t1 && ex.t1 >= t0 ? ex : null;
  },
});
