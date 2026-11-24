import { defineMaterial } from '../../../contract.ts';
import { inkOn } from '../../../lib/rowset.ts';
import type { BeatData, BeatSection } from '../../../lib/beat.ts';
import { meta } from './meta.ts';

/** Grid beats in (from, t] (beats are sorted). */
function beatsSince(beats: readonly number[], from: number, t: number): number {
  let n = 0;
  for (const b of beats) {
    if (b > t) break;
    if (b > from + 1e-3) n++;
  }
  return n;
}

export default defineMaterial({
  meta,
  prepare({ host, section }, u) {
    const d = u.data.layout as BeatData | undefined;
    if (d?.kind === 'row' || d?.kind === 'solo') u.color = inkOn(section, host.accent(d.k, section));
  },
  frame({ host, section, params }, t) {
    const st = section.data.layout as BeatSection | undefined;
    if (!st) return;
    const shift = params.cycle > 0 && t >= st.stackT ? beatsSince(host.reel.cues.beats, st.stackT, t) : 0;
    // the panel takes the colour of the latest landed solo (the first one's before any lands)
    let cur = -1;
    for (const u of section.units) {
      const d = u.data.layout as BeatData | undefined;
      if (d?.kind !== 'solo') continue;
      if (cur < 0 || u.at <= t) cur = d.k;
    }
    for (const u of section.units) {
      const d = u.data.layout as BeatData | undefined;
      if (!d) continue;
      if (d.kind === 'panel') u.ch.color = host.accent(Math.max(0, cur), section);
      else if (d.kind === 'band') u.ch.color = host.accent(d.k + shift, section);
      else if (d.kind === 'row' && shift) u.ch.color = inkOn(section, host.accent(d.k + shift, section));
    }
  },
});
