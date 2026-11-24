import { defineMaterial, type Channels } from '../../../contract.ts';
import { mixHex } from '../../../lib/neon.ts';
import { meta } from './meta.ts';

/** Channels the unsung copy takes from its word every frame (everything but the sweep clip and the colour). */
const FOLLOW: (keyof Channels)[] = ['tx', 'ty', 'sx', 'sy', 'rot', 'skx', 'opacity', 'blur', 'itx', 'ity', 'isx', 'isy', 'irot', 'iskx', 'visible'];

const OPPOSITE: Record<Channels['clipFrom'], Channels['clipFrom']> = { start: 'end', end: 'start', top: 'bottom', bottom: 'top' };

export default defineMaterial({
  meta,
  prepare({ host, section }, u) {
    if (u.item < 0 || u.kind === 'logos') return;
    u.color = u.emphasis || u.tags.hero || u.tags.numeric ? host.accent(2, section) : host.accent(0, section);
  },
  setup({ host, section, params }) {
    const dim = mixHex(section.palette.text, section.palette.bg, params.dim);
    for (const u of [...section.units]) {
      if (u.item < 0 || !u.text || !u.font.size) continue;
      const g = host.deco(section, {
        deco: 'unsung',
        text: u.text,
        ltr: u.ltr,
        graphemes: u.graphemes,
        font: { ...u.font },
        box: { ...u.box },
        textAt: { ...u.textAt },
        origin: u.origin,
        innerOrigin: u.innerOrigin,
        color: dim,
        z: u.z - 0.5,
      });
      g.data.material = { of: section.units.indexOf(u) };
    }
  },
  frame({ section }) {
    for (const u of section.units) {
      const d = u.data.material as { of: number } | undefined;
      if (u.item >= 0 || !d) continue;
      const src = section.units[d.of]!.ch;
      for (const k of FOLLOW) (u.ch as unknown as Record<string, unknown>)[k] = (src as unknown as Record<string, unknown>)[k];
      // the copy shows only where the word is not sung yet (complementary clip): the two inks never overlap, and a
      // fully sung word has no copy under it
      u.ch.clip = 1 - src.clip;
      u.ch.clipFrom = OPPOSITE[src.clipFrom];
    }
  },
});
