import type { SoundCue } from '@reel/core';
import { defineRhythm, type Section } from '../../../contract.ts';
import { meta } from './meta.ts';

/** Flash length after an emphasis cue (s); exp(−14 · 0.35) ≈ 0.7 % is invisible. */
const FLASH_LEN = 0.35;
const FLASH_DECAY = 14;
const PULSE_DECAY = 9;

interface Cues {
  /** Landings with their cue weight (emphasis 1, others 0.6). */
  lands: { t: number; w: number }[];
  flashes: number[];
}
const cuesOf = new WeakMap<Section, Cues>();

/** The section that owns t for stage-wide effects (beat punch): [prev.out, out), the last one to the end. */
const owns = (s: Section, t: number) => t >= (s.prev?.timing.out ?? -Infinity) && (t < s.timing.out || !s.next);

export default defineRhythm({
  meta,
  setup({ host, section }) {
    const cues = host.reel.cues.cues.filter((c) => c.section === section.id);
    cuesOf.set(section, {
      lands: cues.filter((c) => c.type === 'land').map((c) => ({ t: c.t, w: c.weight })),
      flashes: cues.filter((c) => c.type === 'emphasis').map((c) => c.t),
    });
  },
  headroom({ section, params }) {
    const { lands } = cuesOf.get(section)!;
    let max = 0;
    for (const { t } of lands) {
      let k = 0;
      for (const a of lands) if (t - a.t >= 0 && t - a.t < params.length) k += params.kick * a.w * Math.exp(-(t - a.t) * params.decay);
      max = Math.max(max, k);
    }
    return 1 + max + params.punch;
  },
  pulse: ({ host }, t) => host.beatPulse(t, PULSE_DECAY),
  frame({ host, section, params }, t) {
    const sc = host.stageCh;
    const { lands, flashes } = cuesOf.get(section)!;
    for (const a of lands) {
      const d = t - a.t;
      if (d >= 0 && d < params.length) sc.kick += params.kick * a.w * Math.exp(-d * params.decay);
    }
    for (const f of flashes) {
      const d = t - f;
      if (d >= 0 && d < FLASH_LEN) sc.flash = Math.max(sc.flash, params.flash * Math.exp(-d * FLASH_DECAY));
    }
    if (owns(section, t)) sc.kick += params.punch * host.beatPulse(t, PULSE_DECAY);
  },
  /** Landings and flashes that reach the window, and whether the section owns part of it (beat punch). */
  fingerprint({ section, params }, t0, t1) {
    const { lands, flashes } = cuesOf.get(section)!;
    return {
      lands: lands.filter((a) => a.t < t1 && a.t + params.length >= t0),
      flashes: flashes.filter((f) => f < t1 && f + FLASH_LEN >= t0),
      owns: (section.prev?.timing.out ?? -Infinity) < t1 && (section.timing.out >= t0 || !section.next),
    };
  },
  /** A shimmer on every white flash (emphasis cues), as loud as the flash is bright. */
  sounds({ section, params }) {
    if (!params.flash) return [];
    return cuesOf.get(section)!.flashes.map((t): SoundCue => ({ t, kind: 'shimmer', weight: 0.25 + 0.5 * params.flash }));
  },
});
