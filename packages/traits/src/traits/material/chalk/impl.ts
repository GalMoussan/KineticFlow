import type { SoundCue } from '@reel/core';
import { clamp01, hash } from '@reel/runtime';
import { defineMaterial, type Host, type Section, type Unit } from '../../../contract.ts';
import { glossFrame, glossMount, speckle, type Gloss, type GlossLayer } from '../../../lib/gloss.ts';
import { rgba } from '../../../lib/neon.ts';
import { meta } from './meta.ts';

/** `unit.data.material` of a dust puff: when it bursts and which way it drifts. */
interface Puff {
  at: number;
  dir: number;
}
interface Coat {
  g: Gloss;
  layers: GlossLayer[];
}
const coats = new WeakMap<Section, Coat[]>();
const halos = new WeakMap<Unit, string>();
const PUFF = 1.1;
const GRAINS = 7;

const chalkOf = (host: Host, s: Section, u: Unit): string =>
  u.tags.hero ? host.accent(0, s) : u.tags.ordinal >= 0 ? host.accent(u.tags.ordinal % 3, s) : u.tags.numeric ? host.accent(0, s) : s.palette.text;

export default defineMaterial({
  meta,
  prepare({ host, section }, u) {
    if (u.item < 0 || u.kind === 'logos') return;
    u.color = chalkOf(host, section, u);
  },
  setup({ host, section, params }) {
    if (!params.puffs) return;
    for (const u of [...section.units]) {
      if (u.item < 0 || !u.inkBox || !u.text || !Number.isFinite(u.at)) continue;
      const S = u.font.size;
      const end = (section.dir === 'rtl') === !u.ltr;
      const x = u.box.x + u.textAt.x + u.inkBox.x + (end ? 0 : u.inkBox.w);
      const y = u.box.y + u.textAt.y + u.inkBox.y + u.inkBox.h;
      const r = 0.55 * S;
      const col = rgba(section.palette.text, 0.55);
      let dots = '';
      for (let i = 0; i < GRAINS; i++) {
        const h = (k: number) => hash(u.item * 17 + section.index * 5 + i * 3 + k);
        dots += `<circle cx="${(50 + (h(1) - 0.5) * 70).toFixed(1)}" cy="${(55 + (h(2) - 0.5) * 40).toFixed(1)}" r="${(6 + 10 * h(3)).toFixed(1)}" fill="${col}" opacity="${(0.25 + 0.5 * h(4)).toFixed(2)}"/>`;
      }
      const p = host.deco(section, {
        deco: 'puff',
        box: { x: x - r, y: y - r, w: 2 * r, h: 2 * r },
        html: `<svg width="100%" height="100%" viewBox="0 0 100 100" style="display:block">${dots}</svg>`,
        z: 1,
        at: u.at,
      });
      p.data.material = { at: u.at, dir: end ? -1 : 1 } satisfies Puff;
    }
  },
  mount({ host, section, params }) {
    const list: Coat[] = [];
    const tile = Math.max(24, Math.round(host.H * 0.05));
    const holes = params.grain > 0 ? speckle(tile, section.palette.bg, 0.2 * params.grain, 0.9, section.index + 3) : null;
    const fine = params.grain > 0 ? speckle(Math.round(tile * 0.6), section.palette.bg, 0.12 * params.grain, 0.6, section.index + 11) : null;
    for (const u of section.units) {
      if (u.item < 0) continue;
      const g = glossMount(host, u, 0.3);
      if (!g) continue;
      const c = chalkOf(host, section, u);
      const layers: GlossLayer[] = [];
      if (holes) layers.push({ image: holes, tile: [tile, tile] });
      if (fine) layers.push({ image: fine, tile: [Math.round(tile * 0.6), Math.round(tile * 0.6)] });
      // a faint vertical pressure change, as a stick pressed harder at the bottom of a stroke
      layers.push({ image: `linear-gradient(180deg, ${rgba(c, 0.86)}, ${c})` });
      list.push({ g, layers });
      if (params.halo > 0) halos.set(u, `0 0 ${(params.halo * u.font.size).toFixed(1)}px ${rgba(c, 0.4)}`);
    }
    coats.set(section, list);
  },
  frame({ section }, t) {
    for (const u of section.units) {
      const h = halos.get(u);
      if (h) {
        if (u.parts.length) for (const p of u.parts) p.ch.shadow = p.ch.shadow ? `${p.ch.shadow}, ${h}` : h;
        else u.ch.shadow = u.ch.shadow ? `${u.ch.shadow}, ${h}` : h;
      }
      if (u.deco !== 'puff') continue;
      const d = u.data.material as Puff;
      const k = (t - d.at) / PUFF;
      u.ch.visible &&= k >= 0 && k < 1;
      if (!u.ch.visible) continue;
      const e = 1 - (1 - k) * (1 - k);
      const s = 0.5 + 0.9 * e;
      u.ch.sx *= s;
      u.ch.sy *= s;
      u.ch.tx += d.dir * e * 0.25 * u.box.w;
      u.ch.ty -= e * 0.35 * u.box.h;
      u.ch.opacity *= clamp01(k * 8) * (1 - k);
    }
    for (const c of coats.get(section)!) glossFrame(c.g, c.layers);
  },
  /** A soft dusty tap as each puff bursts. */
  sounds({ host, section }) {
    return section.units
      .filter((u) => u.deco === 'puff')
      .map((u): SoundCue => ({ t: (u.data.material as Puff).at, kind: 'tick', weight: 0.18, pitch: -3, pan: host.pan(u) }))
      .filter((c) => c.t >= 0.6);
  },
});
