import { clamp01 } from '@reel/runtime';
import { defineRhythm, type Section, type SectionCtx } from '../../../contract.ts';
import { meta } from './meta.ts';

type Ctx = SectionCtx<{ kick: number; decay: number }>;

/** Pulses start once the section's content has landed (they accent the hold, not the entrances). */
const pulse = ({ host, section, params }: Ctx, t: number) =>
  t < section.timing.lastLand ? 0 : host.beatPulse(t, params.decay) * clamp01((t - section.timing.lastLand) / 0.2);

const owns = (s: Section, t: number) => t >= s.timing.in && (t < s.timing.out || !s.next);

export default defineRhythm({
  meta,
  headroom: ({ params }) => 1 + params.kick,
  pulse,
  frame(c, t) {
    if (c.params.kick && owns(c.section, t)) c.host.stageCh.kick += c.params.kick * pulse(c, t);
  },
});
