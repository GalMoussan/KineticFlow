import { defineTransition, type Section } from '../../../contract.ts';
import { meta } from './meta.ts';

/** The flash rises over RAMP s before the cut and lasts LEN s after it. */
const RAMP = 0.05;
const LEN = 0.4;

/** Cut time of a section that starts a layer through this transition: its window's end. */
const cutOf = (s: Section) => (s.window && s.layer.sections[0] === s ? s.window.t1 : null);

export default defineTransition({
  meta,
  /** Outgoing layer stays on top of nothing until the cut: the incoming one is hidden through the window. */
  between(_c, w, t) {
    if (t < w.t1) w.incoming.ch.visible = false;
  },
  frame({ host, section, params }, t) {
    const tc = cutOf(section);
    if (tc === null) return;
    const a = t - tc;
    if (a < -RAMP || a >= LEN) return;
    const f = params.flash * (a < 0 ? 1 + a / RAMP : Math.exp(-a * params.decay));
    host.stageCh.flash = Math.max(host.stageCh.flash, f);
    host.stageCh.flashColor = '#FFFFFF';
  },
  fingerprint({ section }, t0, t1) {
    const tc = cutOf(section);
    return tc !== null && tc - RAMP < t1 && tc + LEN >= t0 ? { cut: tc } : null;
  },
});
