/**
 * Flow drift. `mount` traces, for every grapheme part, the field's streamline upstream of its resting centre and
 * downstream of it (`lib/flow.ts`, screen px; the style's camera is static, so group + placement = screen). A letter
 * enters at the far end of its upstream line and rides it into place (arc position eased through the section's
 * motion), tilting with the flow's turn; at k = 1 it sits exactly on its measured place. Exits ride downstream.
 */
import type { SoundCue } from '@reel/core';
import { clamp01 } from '@reel/runtime';
import { defineReveal, type Unit } from '../../../contract.ts';
import { along, fieldOf, streamline } from '../../../lib/flow.ts';
import { exitWindow } from '../../../lib/neon.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import { meta } from './meta.ts';

interface Data {
  anim: 'drift' | 'fade';
}
interface Lines {
  steps: number;
  /** Per part (array order = `u.parts`): upstream and downstream streamlines from its centre. */
  back: Float64Array[];
  fwd: Float64Array[];
}
const lines = new WeakMap<Unit, Lines>();
const DEG = 180 / Math.PI;

/** Letter stagger inside a unit: at most `stagger`, at most 0.5 s from first to last letter. */
const staggerOf = (n: number, stagger: number) => (n > 1 ? Math.min(stagger, 0.5 / (n - 1)) : 0);

export default defineReveal({
  meta,
  prepare(_c, u) {
    const drift = !!u.text && u.font.size > 0;
    if (drift) u.split = 'grapheme';
    u.data.reveal = { anim: drift ? 'drift' : 'fade' } satisfies Data;
  },
  mount({ host, section, params }) {
    const f = fieldOf(host.W, host.H);
    const short = Math.min(host.W, host.H);
    const h = (6 * short) / 1080;
    const steps = Math.max(4, Math.round((params.distance * short) / h));
    for (const u of section.units) {
      if (!u.revealed || (u.data.reveal as Data).anim !== 'drift' || !u.parts.length) continue;
      const ox = section.place.x + u.box.x + u.textAt.x;
      const oy = section.place.y + u.box.y + u.textAt.y;
      const back: Float64Array[] = [];
      const fwd: Float64Array[] = [];
      for (const p of u.parts) {
        const cx = ox + p.x + p.w / 2;
        const cy = oy + p.y + p.h / 2;
        back.push(streamline(f, cx, cy, steps, h, -1));
        fwd.push(streamline(f, cx, cy, steps, h, 1));
      }
      lines.set(u, { steps, back, fwd });
    }
  },
  frame({ host, section, params }, t) {
    const m = section.motion;
    const D = params.duration;
    const bias = fieldOf(host.W, host.H).bias;
    const ex = exitWindow(section);
    const exDur = ex ? Math.min(params.exit, ex.t1 - ex.t0) : 0;
    for (const u of section.units) {
      if (!u.revealed) continue;
      const c = u.ch;
      const L = lines.get(u);
      if (!L) {
        // logos and text-less decorations: a slow fade up
        const k = clamp01((t - (u.at - 0.45)) / 0.7);
        c.visible &&= k > 0;
        c.opacity *= k;
        c.ity += (1 - m.enter(k)) * 0.12 * u.box.h;
        if (ex && t >= ex.t0) c.opacity *= 1 - m.exit(clamp01((t - ex.t0) / exDur));
        continue;
      }
      const n = u.parts.length;
      const stg = staggerOf(n, params.stagger);
      const land0 = u.at + params.lead - (n - 1) * stg;
      c.visible &&= t >= land0 - D;
      const stgx = n > 1 ? Math.min(0.03, (0.4 * exDur) / (n - 1)) : 0;
      u.parts.forEach((p, j) => {
        const i = p.index;
        const pc = p.ch;
        const k = clamp01((t - (land0 + i * stg - D)) / D);
        const e = k >= 1 ? 1 : 0.55 * m.enter(k) + 0.45 * m.inOut(k);
        let along1: { x: number; y: number; a: number } | null = null;
        let dx = 0;
        let dy = 0;
        if (e < 1) {
          const back = L.back[j]!;
          along1 = along(back, (1 - e) * L.steps);
          dx = along1.x - back[0]!;
          dy = along1.y - back[1]!;
          // heading downstream = upstream tangent turned around; tilt by how far the flow turns from its mean
          let turn = along1.a + Math.PI - bias;
          turn -= Math.round(turn / (2 * Math.PI)) * 2 * Math.PI;
          pc.rot += Math.max(-params.tilt, Math.min(params.tilt, turn * DEG * 0.5)) * (1 - e);
          pc.opacity *= clamp01(k * 3);
          pc.blur += (1 - e) * 2.5;
        }
        if (ex && t >= ex.t0) {
          const kx = clamp01((t - ex.t0 - (n - 1 - i) * stgx) / Math.max(1e-3, exDur - (n - 1) * stgx));
          const q = m.exit(kx);
          const fwd = L.fwd[j]!;
          const pt = along(fwd, q * 0.75 * L.steps);
          dx += pt.x - fwd[0]!;
          dy += pt.y - fwd[1]!;
          pc.opacity *= 1 - q;
          pc.blur += q * 3;
        }
        pc.tx += dx;
        pc.ty += dy;
      });
    }
  },
  /** The exit is drawn by the section's own units, but its window starts at the section's `out`. */
  fingerprint({ section, params }, t0, t1) {
    const ex = exitWindow(section);
    return ex && ex.t0 < t1 && ex.t1 >= t0 ? { ...ex, d: Math.min(params.exit, ex.t1 - ex.t0) } : null;
  },
  /** A soft shimmer per landing (pitch rising through the section), a breath of wind on exits. */
  sounds({ host, section, params }) {
    const out: SoundCue[] = endcardStinger(section, 0.7);
    let k = 0;
    for (const u of section.units) {
      if (!u.revealed || u.item < 0 || !Number.isFinite(u.at)) continue;
      const accent = u.tags.hero || u.emphasis;
      out.push({ t: u.at + params.lead, kind: 'shimmer', weight: accent ? 0.42 : 0.28, pitch: Math.min(7, k++), pan: host.pan(u) });
    }
    const ex = exitWindow(section);
    if (ex) out.push({ t: ex.t0, until: ex.t0 + Math.min(params.exit, ex.t1 - ex.t0), kind: 'whoosh', weight: 0.3 });
    return out;
  },
});
