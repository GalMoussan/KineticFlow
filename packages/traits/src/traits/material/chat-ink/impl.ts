import type { SoundCue } from '@reel/core';
import { clamp01 } from '@reel/runtime';
import { defineMaterial, type Section } from '../../../contract.ts';
import { chatColours, chatOf, chatUnit, contrast, type ChatColours, type ChatUnit } from '../../../lib/chat.ts';
import { mixHex, rgba } from '../../../lib/neon.ts';
import { meta } from './meta.ts';

const coloursOf = new WeakMap<Section, ChatColours>();
/** Highlight pills draw over this long from their word's landing. */
const DRAW = 0.35;

export default defineMaterial({
  meta,
  prepare({ host, section }, u) {
    const cu = chatUnit(u);
    if (!cu) return;
    let C = coloursOf.get(section);
    if (!C) coloursOf.set(section, (C = chatColours(host, section)));
    switch (cu.part) {
      case 'body':
      case 'tail':
      case 'typing':
        u.color = C.fill(cu.side);
        break;
      case 'dot':
      case 'stamp':
      case 'rule':
      case 'sep':
      case 'ticks':
        u.color = C.muted(cu.side);
        break;
      case 'icon': {
        const blue = C.fill('out');
        u.color = contrast(blue, C.fill(cu.side)) >= 3 ? blue : C.emph(cu.side);
        break;
      }
      case 'text':
        u.color = u.emphasis ? C.emph(cu.side) : u.kind === 'city' ? C.muted(cu.side) : C.text(cu.side);
        break;
      default:
    }
  },
  /** A soft pill in the emphasis colour behind every emphasised word (not numbers), under the text. */
  setup({ host, section, params }) {
    if (!params.highlight) return;
    const C = coloursOf.get(section)!;
    for (const u of [...section.units]) {
      const cu = chatUnit(u);
      if (u.item < 0 || !cu || cu.part !== 'text' || !u.emphasis || u.tags.numeric || !u.inkBox) continue;
      const S = u.font.size;
      const x = u.box.x + u.textAt.x + u.inkBox.x - 0.12 * S;
      const hl = host.deco(section, {
        deco: 'chat-hl',
        z: -2,
        origin: section.dir === 'rtl' ? '100% 50%' : '0 50%',
        box: { x, y: u.baseline - 0.84 * S, w: u.inkBox.w + 0.24 * S, h: 1.1 * S },
        style: { background: rgba(C.emph(cu.side), 0.16 * params.highlight), 'border-radius': `${(0.22 * S).toFixed(2)}px` },
      });
      hl.data.material = { part: 'hl', b: cu.b, side: cu.side, at: u.at } satisfies ChatUnit;
    }
  },
  frame({ section }, t) {
    const C = coloursOf.get(section)!;
    const cs = chatOf(section);
    for (const u of section.units) {
      const cu = chatUnit(u);
      if (cu?.part === 'hl') {
        const k = section.motion.enter(clamp01((t - cu.at!) / DRAW));
        u.ch.visible &&= k > 0;
        u.ch.sx *= k;
      } else if (cu?.part === 'ticks') {
        const read = cs.bubbles[cu.b]!.read;
        const k = read === null ? 0 : clamp01((t - read) / 0.25);
        if (k > 0) u.ch.color = mixHex(C.muted('out'), C.read, k);
      }
    }
  },
  /** A light marker stroke for each highlight that draws after its bubble has landed. */
  sounds({ host, section }) {
    const cs = chatOf(section);
    const out: SoundCue[] = [];
    for (const u of section.units) {
      const cu = chatUnit(u);
      if (cu?.part !== 'hl' || cu.at! < cs.bubbles[cu.b]!.at + 0.12) continue;
      out.push({ t: cu.at!, until: cu.at! + DRAW, kind: 'swipe', weight: 0.22, pan: host.pan(u, cu.at) });
    }
    return out.filter((c) => c.t >= 0.6);
  },
});
