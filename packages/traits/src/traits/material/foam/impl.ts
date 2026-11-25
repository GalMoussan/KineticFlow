import type { SoundCue } from '@reel/core';
import { clamp01 } from '@reel/runtime';
import { defineMaterial, type Unit } from '../../../contract.ts';
import { blob } from '../../../lib/morph/goo.ts';
import { meta } from './meta.ts';

/** `unit.data.material` of a foam blob: its word's landing and size (px). */
interface Foam {
  at: number;
  w: number;
  h: number;
  seed: number;
}

/** Key words get a foam blob; the small line under the big words never does (calm, one tick per sub word). */
const foamed = (u: Unit) =>
  u.item >= 0 && !!u.inkBox && !!u.text && Number.isFinite(u.at) && u.kind !== 'sub' && (u.tags.hero || u.emphasis || u.tags.numeric);

export default defineMaterial({
  meta,
  prepare({ host, section }, u) {
    if (u.item < 0 || u.kind === 'logos') return;
    u.color = u.emphasis && !u.tags.hero ? host.accent(0, section) : section.palette.text;
  },
  setup({ host, section, params }) {
    const foam = host.accent(2, section);
    const crema = host.accent(3, section);
    for (const u of [...section.units]) {
      if (!foamed(u)) continue;
      const S = u.font.size;
      const ib = u.inkBox!;
      const P = params.pad * S;
      const w = ib.w + 2 * P;
      const h = ib.h + 2 * P;
      const x = u.box.x + u.textAt.x + ib.x - P;
      const y = u.box.y + u.textAt.y + ib.y - P;
      const f = host.deco(section, {
        deco: 'foam',
        box: { x, y, w, h },
        html:
          `<svg width="${w.toFixed(1)}" height="${h.toFixed(1)}" viewBox="0 0 ${w.toFixed(1)} ${h.toFixed(1)}" style="display:block;overflow:visible">` +
          `<path fill="${crema}"/><path fill="${foam}"/><path fill="none" stroke="${crema}" stroke-opacity="0.35" stroke-width="${(0.03 * S).toFixed(1)}"/></svg>`,
        z: -1,
        at: u.at,
      });
      f.data.material = { at: u.at, w, h, seed: u.item + section.index * 7 } satisfies Foam;
    }
  },
  frame({ section, params }, t) {
    const m = section.motion;
    for (const u of section.units) {
      if (u.deco !== 'foam') continue;
      const d = u.data.material as Foam;
      const k = clamp01((t - (d.at - 0.6 * params.pour)) / params.pour);
      u.ch.visible &&= k > 0;
      if (!u.ch.visible || !u.inner) continue;
      const e = m.enter(k);
      const R = Math.min(d.w, d.h) / 2;
      const sx = d.w / 2 / R;
      const sy = d.h / 2 / R;
      const c: [number, number] = [d.w / 2, d.h / 2];
      // pouring wobbles hard, the settled foam only breathes
      const wob = params.wobble + 0.12 * (1 - e);
      const ph = t * 0.9 + d.seed;
      const [rim, body, ring] = [...u.inner.querySelectorAll('path')] as [SVGPathElement, SVGPathElement, SVGPathElement];
      rim.setAttribute('d', blob(c, R * e * 1.06, wob, ph, sx, sy));
      body.setAttribute('d', blob(c, R * e * 0.98, wob, ph + 0.4, sx, sy));
      // a latte-art ring swirling inside the foam
      ring.setAttribute('d', blob(c, R * e * 0.72, wob * 1.6, -ph * 1.3, sx * 1.05, sy * 0.95));
      u.ch.opacity *= clamp01(k * 3);
    }
  },
  /** A low soft pop as each pour starts to settle. */
  sounds({ host, section, params }) {
    return section.units
      .filter((u) => u.deco === 'foam')
      .map((u): SoundCue => ({ t: (u.data.material as Foam).at - 0.1 * params.pour, kind: 'pop', weight: 0.28, pitch: -4, pan: host.pan(u) }))
      .filter((c) => c.t >= 0.6);
  },
});
