import { clamp01 } from '@reel/runtime';
import { defineMaterial, type Channels, type Unit } from '../../../contract.ts';
import { bases, surface } from '../../../lib/bauhaus.ts';
import { meta } from './meta.ts';

/** Material-owned decorations (`unit.data.material`); `of` is the source content unit's index in `section.units`. */
type Deco =
  | { kind: 'fill'; of: number; sweep: number; kick: number }
  | { kind: 'hl'; of: number; sweep: number }
  | { kind: 'block'; of: number; at: number }
  | { kind: 'pill'; of: number; at: number };

/** Emphasis treatments rotate with swiss-mix (grow · pop): the grown ones sit on a block. */
const blocked = (u: Unit) => u.tags.ordinal >= 0 && u.tags.ordinal % 2 === 0;
const SWEEP = 0.38;
const LEAD = 0.12;

const OUTER: (keyof Channels)[] = ['tx', 'ty', 'sx', 'sy', 'rot', 'opacity', 'blur', 'itx', 'ity', 'isx', 'isy', 'irot', 'clip', 'visible'];

export default defineMaterial({
  meta,
  prepare({ host, layer, section, params }, u) {
    if (u.item < 0 || u.kind === 'logos') return;
    const sf = surface(host, layer);
    const { dark, light } = bases(layer.palette);
    const accent = u.tags.hero || (u.tags.ordinal >= 0 && !blocked(u));
    let color = accent ? sf.hero : sf.ink;
    if (u.kind === 'time' && params.blocks) color = sf.ink === dark ? light : dark;
    u.color = color;
    if (section.role === 'title' && params.outline > 0 && u.kind === 'word') {
      const stroke = color === sf.hero ? sf.ink : sf.hero;
      u.color = 'transparent';
      u.innerStyle = { ...u.innerStyle, '-webkit-text-stroke': `${params.outline}em ${stroke}` };
      u.data.material = { fillColor: color };
    }
  },
  setup({ host, layer, section, params }) {
    const sf = surface(host, layer);
    const rtl = section.dir === 'rtl';
    const startOrigin = rtl ? '100% 50%' : '0 50%';
    const T = section.timing;
    const sweep0 = Math.max(T.firstLand, Math.min(T.lastLand + 0.45, T.out - 1.3));
    const ink = (u: Unit) => {
      const x = u.box.x + u.textAt.x + u.inkBox!.x;
      const y = u.box.y + u.textAt.y + u.inkBox!.y;
      return { x0: x, y0: y, x1: x + u.inkBox!.w, y1: y + u.inkBox!.h };
    };
    const texts = section.units.filter((v) => v.item >= 0 && v.inkBox);
    /** Padding around u's ink, at most `want` × size on each side and half the free gap to any neighbouring ink. */
    const room = (u: Unit, wantX: number, wantY: number) => {
      const r = ink(u);
      const S = u.font.size;
      const p = { l: wantX * S, r: wantX * S, t: wantY * S, b: wantY * S };
      for (const v of texts) {
        if (v === u) continue;
        const q = ink(v);
        if (q.x0 < r.x1 && r.x0 < q.x1) {
          if (q.y1 <= r.y0) p.t = Math.min(p.t, (r.y0 - q.y1) / 2);
          else if (q.y0 >= r.y1) p.b = Math.min(p.b, (q.y0 - r.y1) / 2);
        } else if (q.y0 < r.y1 && r.y0 < q.y1) {
          if (q.x1 <= r.x0) p.l = Math.min(p.l, (r.x0 - q.x1) / 2);
          else if (q.x0 >= r.x1) p.r = Math.min(p.r, (q.x0 - r.x1) / 2);
        }
      }
      return { x: r.x0 - p.l, y: r.y0 - p.t, w: r.x1 - r.x0 + p.l + p.r, h: r.y1 - r.y0 + p.t + p.b };
    };
    for (const u of [...section.units]) {
      if (u.item < 0 || !u.inkBox) continue;
      const S = u.font.size;
      const inkY = u.box.y + u.textAt.y + u.inkBox.y;
      const of = section.units.indexOf(u);
      const fill = u.data.material as { fillColor: string } | undefined;
      if (fill) {
        const line = Math.max(0, u.tags.line);
        const sweep = sweep0 + line * 0.125;
        const f = host.deco(section, {
          deco: 'fill',
          text: u.text,
          ltr: u.ltr,
          graphemes: u.graphemes,
          font: { ...u.font },
          box: { ...u.box },
          textAt: { ...u.textAt },
          split: u.split,
          masked: u.masked,
          origin: u.origin,
          innerOrigin: u.innerOrigin,
          color: fill.fillColor,
          z: u.z + 0.5,
        });
        f.data.material = { kind: 'fill', of, sweep, kick: sweep0 + 0.9 + line * 0.06 } satisfies Deco;
        const hl = host.deco(section, {
          deco: 'hl',
          box: { x: u.box.x - 0.055 * S, y: inkY - 0.06 * S, w: 0.11 * S, h: u.inkBox.h + 0.12 * S },
          // reel12's peach marker edge: the first of peach, pink, sage… that is neither the panel nor the fill
          style: { background: [2, 0, 3, 1, 4].map((i) => host.accent(i, section)).find((a) => a !== sf.panel && a !== fill.fillColor) ?? sf.block },
          z: u.z + 0.6,
        });
        hl.data.material = { kind: 'hl', of, sweep } satisfies Deco;
      }
      if (!params.blocks) continue;
      if (blocked(u)) {
        const b = host.deco(section, {
          deco: 'block',
          box: room(u, 0.2, 0.1),
          style: { background: sf.block },
          z: u.z - 0.5,
        });
        b.data.material = { kind: 'block', of, at: u.at - LEAD } satisfies Deco;
      }
      if (u.kind === 'time') {
        const box = room(u, 0.42, 0.25);
        const p = host.deco(section, {
          deco: 'pill',
          box,
          style: { background: sf.ink, 'border-radius': `${(box.h / 2).toFixed(2)}px` },
          origin: startOrigin,
          z: u.z - 0.5,
        });
        p.data.material = { kind: 'pill', of, at: u.at - LEAD - 0.25 } satisfies Deco;
      }
    }
  },
  frame({ section, params }, t) {
    const m = section.motion;
    const rtl = section.dir === 'rtl';
    for (const u of section.units) {
      if (u.item >= 0) continue;
      const d = u.data.material as Deco | undefined;
      if (!d) continue;
      const c = u.ch;
      if (d.kind === 'block' || d.kind === 'pill') {
        // behind its word: moves, fades and blurs with the word's outer box (slides, exits)
        const s = section.units[d.of]!.ch;
        c.tx += s.tx;
        c.ty += s.ty;
        c.blur += s.blur;
        c.opacity *= s.opacity;
        c.visible &&= s.visible;
      }
      switch (d.kind) {
        case 'fill': {
          // follow the outline's reveal exactly, then sweep the fill in from the start edge and kick it off-register
          const src = section.units[d.of]!;
          const sc = src.ch as unknown as Record<string, unknown>;
          for (const k of OUTER) (c as unknown as Record<string, unknown>)[k] = sc[k];
          u.parts.forEach((p, i) => {
            const q = src.parts[i];
            if (q) Object.assign(p.ch, q.ch, { color: null });
          });
          const e = m.inOut(clamp01((t - d.sweep) / SWEEP));
          c.clip = Math.min(c.clip, e);
          c.clipFrom = 'start';
          const ok = clamp01((t - d.kick) / 0.4);
          if (ok > 0) {
            const off = -params.offset * u.font.size * m.bounce(ok, 2.2);
            c.itx += off;
            c.ity += off;
          }
          break;
        }
        case 'hl': {
          const src = section.units[d.of]!;
          const k = clamp01((t - d.sweep) / SWEEP);
          const e = m.inOut(k);
          c.visible &&= k > 0 && k < 1 && src.ch.visible;
          const edge = rtl ? src.box.x + src.box.w * (1 - e) : src.box.x + src.box.w * e;
          c.tx += edge - (u.box.x + u.box.w / 2) + src.ch.tx;
          c.ty += src.ch.ty;
          break;
        }
        case 'block': {
          const e = m.inOut(clamp01((t - d.at) / 0.28));
          c.visible &&= e > 0;
          c.clip = Math.min(c.clip, e);
          c.clipFrom = 'start';
          break;
        }
        case 'pill': {
          const e = m.inOut(clamp01((t - d.at) / 0.32));
          c.visible &&= e > 0;
          c.sx *= e;
          break;
        }
      }
    }
  },
});
