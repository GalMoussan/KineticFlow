import type { SoundCue } from '@reel/core';
import { clamp01, hash, lerp } from '@reel/runtime';
import { defineMaterial, type Section } from '../../../contract.ts';
import { glossFrame, glossMount, speckle, type Gloss } from '../../../lib/gloss.ts';
import { rgba } from '../../../lib/neon.ts';
import { meta } from './meta.ts';

/** `unit.data.material`: a text unit's second plate (ink, slip direction in radians) or the hero's disc. */
type Data = { kind: 'plate'; plate: string; dir: number } | { kind: 'disc'; of: number };

const TILE = 160;
const glosses = new WeakMap<Section, Gloss[]>();
const tiles = new Map<string, string>();

export default defineMaterial({
  meta,
  prepare({ host, section }, u) {
    if (u.item < 0 || u.kind === 'logos') return;
    const pink = u.tags.hero || u.tags.numeric || (u.tags.ordinal >= 0 && u.tags.ordinal % 2 === 0);
    u.color = pink ? host.accent(0, section) : section.palette.text;
    // the plate slips mostly down-and-away, a little differently per word
    const dir = (0.15 + 0.35 * hash(u.item * 7 + section.index * 13 + 1)) * Math.PI * (u.item % 2 ? 1 : 0.6);
    u.data.material = { kind: 'plate', plate: pink ? host.accent(1, section) : host.accent(0, section), dir } satisfies Data;
  },
  setup({ host, section, params }) {
    if (!params.disc) return;
    for (const u of [...section.units]) {
      if (u.item < 0 || !u.tags.hero || !u.inkBox) continue;
      const x = u.box.x + u.textAt.x + u.inkBox.x + u.inkBox.w / 2;
      const y = u.box.y + u.textAt.y + u.inkBox.y + u.inkBox.h / 2;
      const r = Math.max(u.inkBox.h * 0.95, u.inkBox.w * 0.42);
      const pitch = Math.max(6, Math.round(u.font.size * 0.075));
      const c = host.accent(2, section);
      const disc = host.deco(section, {
        deco: 'riso-disc',
        box: { x: x - r, y: y - r, w: 2 * r, h: 2 * r },
        style: {
          'border-radius': '50%',
          background: `radial-gradient(circle, ${c} ${(pitch * 0.34).toFixed(2)}px, ${rgba(c, 0)} ${(pitch * 0.34 + 0.8).toFixed(2)}px) 0 0 / ${pitch}px ${pitch}px`,
        },
        z: -1,
        at: u.at,
      });
      disc.data.material = { kind: 'disc', of: section.units.indexOf(u) } satisfies Data;
    }
  },
  mount({ host, section, params }) {
    const list: Gloss[] = [];
    for (const u of section.units) {
      if (u.item < 0) continue;
      const g = glossMount(host, u, 0.3);
      if (g) list.push(g);
    }
    glosses.set(section, list);
    const key = `${section.palette.bg}:${params.grain}`;
    if (params.grain > 0 && !tiles.has(key)) tiles.set(key, speckle(TILE, section.palette.bg, 0.16 * params.grain, 0.95, 3));
  },
  frame({ section, params }, t) {
    const m = section.motion;
    const pulse = clamp01(section.pulse(t));
    for (const u of section.units) {
      const d = u.data.material as Data | undefined;
      if (!d) continue;
      if (d.kind === 'disc') {
        const src = section.units[d.of]!;
        const k = clamp01((t - (u.at - 0.08)) / 0.4);
        const e = Math.max(0, m.bounce(k, 1.8));
        u.ch.visible &&= k > 0 && src.ch.visible;
        u.ch.sx *= e;
        u.ch.sy *= e;
        u.ch.opacity *= src.ch.opacity;
        u.ch.tx += src.ch.tx + 0.06 * u.box.w * pulse;
        u.ch.ty += src.ch.ty;
        continue;
      }
      const S = u.font.size;
      if (!S) continue;
      const e = m.enter(clamp01((t - (u.at - 0.12)) / 0.55));
      const off = (lerp(params.entry, params.offset, e) + params.kick * pulse) * S;
      const sh = `${(Math.cos(d.dir) * off).toFixed(2)}px ${(Math.sin(d.dir) * off).toFixed(2)}px 0 ${d.plate}`;
      if (u.parts.length) for (const p of u.parts) p.ch.shadow = p.ch.shadow ? `${p.ch.shadow}, ${sh}` : sh;
      else u.ch.shadow = u.ch.shadow ? `${u.ch.shadow}, ${sh}` : sh;
    }
    const tile = tiles.get(`${section.palette.bg}:${params.grain}`);
    const layers = tile ? [{ image: tile, tile: [TILE, TILE] as [number, number] }] : [{ image: 'none' }];
    for (const g of glosses.get(section)!) glossFrame(g, layers);
  },
  /** The hero's halftone disc lands with a soft pop. */
  sounds({ host, section }) {
    return section.units
      .filter((u) => (u.data.material as Data | undefined)?.kind === 'disc')
      .map((u): SoundCue => ({ t: u.at + 0.1, kind: 'pop', weight: 0.3, pitch: -3, pan: host.pan(u) }));
  },
});
