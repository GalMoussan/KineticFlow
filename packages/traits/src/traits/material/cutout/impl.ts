import type { SoundCue } from '@reel/core';
import { clamp01, hash } from '@reel/runtime';
import { defineMaterial, type Section, type Unit } from '../../../contract.ts';
import { setStyle, transformOf } from '../../../lib/gloss.ts';
import { mixHex, rgba } from '../../../lib/neon.ts';
import { luminance, torn } from '../../../lib/paper.ts';
import { meta } from './meta.ts';

/** One letter's scrap: its element, the part it backs, the letter's ink and its resting tilt. */
interface Scrap {
  el: HTMLElement;
  part: number;
  ink: string;
  rot: number;
}
interface Sheet {
  u: Unit;
  box: HTMLElement;
  scraps: Scrap[];
}
/** `unit.data.material` of a tape strip: its word (index in `section.units`), landing time and tilt. */
interface Tape {
  of: number;
  at: number;
  rot: number;
}

const sheets = new WeakMap<Section, Sheet[]>();
const TAPE_LAG = 0.22;
const px = (v: number) => `${v.toFixed(2)}px`;

export default defineMaterial({
  meta,
  prepare({ section }, u) {
    if (u.item < 0 || u.kind === 'logos') return;
    u.color = section.palette.text;
  },
  setup({ host, section, params }) {
    if (!params.tape) return;
    const tape = rgba(mixHex(section.palette.bg, '#FFFFFF', 0.6), 0.72);
    for (const u of [...section.units]) {
      // the small line under the big words is pasted without tape (its landing is the reveal's light tick)
      if (u.item < 0 || !u.inkBox || !u.text || !Number.isFinite(u.at) || u.kind === 'sub') continue;
      const S = u.font.size;
      const end = hash(u.item * 3 + section.index * 11) < 0.5;
      const x = u.box.x + u.textAt.x + u.inkBox.x + (end ? u.inkBox.w : 0);
      const y = u.box.y + u.textAt.y + u.inkBox.y;
      const w = Math.min(0.75 * S, 0.5 * u.inkBox.w + 0.2 * S);
      const h = 0.2 * S;
      const t = host.deco(section, {
        deco: 'tape',
        box: { x: x - w / 2, y: y - h * 0.6, w, h },
        style: { background: tape, 'clip-path': torn(u.item * 5 + section.index, 3, 6) },
        z: 2,
        at: u.at + TAPE_LAG,
      });
      t.data.material = { of: section.units.indexOf(u), at: u.at + TAPE_LAG, rot: (end ? 1 : -1) * (28 + 14 * hash(u.item + 7)) } satisfies Tape;
    }
  },
  mount({ host, section, params }) {
    const { bg, text } = section.palette;
    const list: Sheet[] = [];
    for (const u of section.units) {
      if (u.item < 0 || !u.parts.length || !u.el || !u.inner) continue;
      // the inner box's twin, so `innerOrigin` and the inner transform mean the same thing here
      const box = host.el('div', 'cut-sheet', null, {
        left: px(u.textAt.x),
        top: px(u.textAt.y),
        width: px(u.inner.offsetWidth),
        height: px(u.inner.offsetHeight),
        'transform-origin': u.innerOrigin,
      });
      u.el.insertBefore(box, u.inner);
      const S = u.font.size;
      const scraps = u.parts.map((p, i): Scrap => {
        const h = (k: number) => hash(u.item * 131 + section.index * 17 + i * 7 + k);
        const sp = p.span;
        const pad = (k: number) => params.pad * S * (0.6 + 0.9 * h(k));
        const l = sp.offsetLeft - pad(1);
        const tp = sp.offsetTop + 0.04 * S - pad(2);
        const w = sp.offsetWidth + pad(1) + pad(3);
        const ht = sp.offsetHeight - 0.08 * S + pad(2) + pad(4);
        // letters alternate between the palette's paper colours (accents) and a newsprint scrap with ruled lines
        const pick = Math.floor(h(5) * 7);
        const news = pick === 0;
        const c = news ? mixHex(bg, '#FFFFFF', 0.8) : host.accent(Math.floor(h(6) * 8), section);
        const ink = luminance(c) < 0.25 ? mixHex(bg, '#FFFFFF', 0.85) : text;
        const el = host.el('div', 'cut-scrap', box, {
          left: px(l),
          top: px(tp),
          width: px(w),
          height: px(ht),
          'transform-origin': `${px(sp.offsetLeft + sp.offsetWidth / 2 - l)} ${px(sp.offsetTop + sp.offsetHeight / 2 - tp)}`,
          background: news
            ? `repeating-linear-gradient(180deg, ${rgba(text, 0)} 0px, ${rgba(text, 0)} ${px(0.09 * S)}, ${rgba(text, 0.16)} ${px(0.09 * S)}, ${rgba(text, 0.16)} ${px(0.1 * S)}), ${c}`
            : c,
          'clip-path': torn(u.item * 97 + i * 13 + section.index, 4, 5),
        });
        return { el, part: i, ink, rot: (h(7) - 0.5) * 2 * params.tilt };
      });
      list.push({ u, box, scraps });
    }
    sheets.set(section, list);
  },
  frame({ section }, t) {
    const m = section.motion;
    for (const u of section.units) {
      const tilt = (u.data.layout as { tilt?: number } | undefined)?.tilt;
      if (tilt && u.item >= 0) u.ch.rot += tilt;
    }
    for (const sh of sheets.get(section)!) {
      const c = sh.u.ch;
      setStyle(sh.box, 'transform', transformOf(c.itx, c.ity, c.irot, c.isx, c.isy, c.iskx));
      for (const s of sh.scraps) {
        const pc = sh.u.parts[s.part]!.ch;
        pc.rot += s.rot;
        pc.color = s.ink;
        const flat = Math.abs(pc.sx) <= 1e-4 || Math.abs(pc.sy) <= 1e-4;
        setStyle(s.el, 'transform', flat ? 'none' : transformOf(pc.tx, pc.ty, pc.rot, pc.sx, pc.sy, pc.skx));
        setStyle(s.el, 'opacity', flat || pc.opacity <= 0 ? '0' : pc.opacity >= 1 ? '1' : pc.opacity.toFixed(3));
      }
    }
    for (const u of section.units) {
      if (u.deco !== 'tape') continue;
      const d = u.data.material as Tape;
      const src = section.units[d.of]!.ch;
      const k = clamp01((t - (d.at - 0.12)) / 0.24);
      const e = 1 + 0.6 * (1 - Math.max(0, m.bounce(k, 1.6)));
      u.ch.visible &&= k > 0 && src.visible;
      u.ch.opacity *= clamp01(k * 4) * src.opacity;
      u.ch.sx *= e;
      u.ch.sy *= e;
      u.ch.rot += d.rot + src.rot;
      u.ch.tx += src.tx;
      u.ch.ty += src.ty;
    }
  },
  /** A short rip-and-slap for every strip of tape. */
  sounds({ host, section }) {
    return section.units
      .filter((u) => u.deco === 'tape')
      .map((u): SoundCue => ({ t: (u.data.material as Tape).at, kind: 'swipe', weight: 0.3, pan: host.pan(u) }));
  },
});
