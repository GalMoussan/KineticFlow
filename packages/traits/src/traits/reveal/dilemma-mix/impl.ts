/**
 * Dilemma mix (see meta). Reads the staging that `layout/dilemma-cards` stored in `unit.data.layout` and writes
 * channels only (no own elements). The heartbeat is `section.pulse(t)`.
 */
import type { SoundCue } from '@reel/core';
import { clamp01, lerp } from '@reel/runtime';
import { defineReveal, type Section, type Unit } from '../../../contract.ts';
import { dilemmaOf, type DilemmaSection } from '../../../lib/dilemma.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import { meta } from './meta.ts';

type Anim = 'rise' | 'unseal' | 'answer' | 'pop' | 'deco';
/** Seal opening / card flip half / card entrance lengths (s); a seal starts opening OPEN_LEAD before its word lands. */
const OPEN = 0.42;
const OPEN_LEAD = 0.12;
const HALF_FLIP = 0.25;
const SETTLE = 0.4;
/** Seals pop onto their card this long after it starts settling in. */
const SEAL_DELAY = 0.18;
const FLASH_LEN = 0.45;
const FLASH_DECAY = 8;
/** The dub of `rhythm/heartbeat` (its default gap, in beats) for the thump sounds. */
const DUB = 0.28;
const QUIET = 0.6;

const stage = (s: Section) => s.data.layout as DilemmaSection | undefined;
const sealOf = (s: Section, item: number) => s.units.filter((x) => {
  const d = dilemmaOf(x);
  return d?.kind === 'seal' && d.of === item;
});

export default defineReveal({
  meta,
  prepare({ section }, u) {
    const d = dilemmaOf(u);
    let anim: Anim = u.item < 0 ? (d ? 'deco' : 'pop') : 'rise';
    if (u.kind === 'logos' || (d?.kind === 'text' && d.connector)) anim = 'pop';
    else if (u.item >= 0 && sealOf(section, u.item).length) anim = 'unseal';
    else if (u.item >= 0 && stage(section)?.stage === 'answer') anim = 'answer';
    u.data.reveal = { anim };
  },
  frame({ host, section, params }, t) {
    const m = section.motion;
    const pulse = section.pulse(t);
    const D = params.duration;
    const flip = stage(section)?.flip ?? -1;
    for (const u of section.units) {
      if (!u.revealed) continue;
      const c = u.ch;
      const S = u.font.size || u.box.h;
      const anim = (u.data.reveal as { anim: Anim }).anim;
      if (anim === 'rise' || anim === 'answer') {
        const st = Math.max(u.at - 0.12, anim === 'answer' ? flip + 0.2 : -Infinity);
        const k = clamp01((t - st) / D);
        const e = m.enter(k);
        c.visible &&= t >= st;
        c.ity += (1 - e) * params.rise * S;
        c.opacity *= clamp01(k * 2.2);
        if (k < 1) c.blur += (1 - e) * 5;
      } else if (anim === 'unseal') {
        const st = u.at - OPEN_LEAD;
        const k = clamp01((t - st) / D);
        c.visible &&= t >= st;
        const s = lerp(0.82, 1, m.enter(k));
        c.isx *= s;
        c.isy *= s;
        c.opacity *= clamp01(k * 2.5);
      } else if (anim === 'pop') {
        const st = u.at - 0.1;
        c.visible &&= t >= st;
        const s = Math.max(0.001, m.bounce(clamp01((t - st) / 0.4), 1.6));
        c.sx *= s;
        c.sy *= s;
      } else {
        const d = dilemmaOf(u)!;
        switch (d.kind) {
          case 'card': {
            if (d.card === 'back') {
              c.visible &&= t >= d.at && t < flip;
              const k = clamp01((t - d.at) / SETTLE);
              const s = lerp(0.92, 1, m.enter(k)) * (1 + 0.3 * params.beat * pulse);
              c.sx *= s * (1 - m.inOut(clamp01((t - (flip - HALF_FLIP)) / HALF_FLIP)));
              c.sy *= s;
              c.opacity *= clamp01(k * 2);
            } else if (d.card === 'answer') {
              c.visible &&= t >= d.at;
              const k = clamp01((t - d.at) / HALF_FLIP);
              c.sx *= Math.max(0.001, m.inOut(k));
              if (t >= d.at + HALF_FLIP && t < d.at + HALF_FLIP + FLASH_LEN && params.flash > 0) {
                host.stageCh.flash = Math.max(host.stageCh.flash, params.flash * Math.exp(-(t - d.at - HALF_FLIP) * FLASH_DECAY));
                host.stageCh.flashColor = host.accent(0, section);
              }
            } else {
              c.visible &&= t >= d.at;
              const k = clamp01((t - d.at) / SETTLE);
              const e = m.enter(k);
              c.opacity *= clamp01(k * 2.5);
              if (d.card === 'b') {
                c.tx -= (1 - e) * d.dx;
                c.ty -= (1 - e) * d.dy;
              } else {
                const s = lerp(0.94, 1, e);
                c.sx *= s;
                c.sy *= s;
              }
            }
            break;
          }
          case 'seal': {
            const word = section.units[d.of]!;
            const st = word.at - OPEN_LEAD;
            const k = clamp01((t - st) / OPEN);
            // seals land on the card once it has settled in
            c.visible &&= t >= d.from + SEAL_DELAY && k < 1;
            const pop = Math.max(0.001, m.bounce(clamp01((t - d.from - SEAL_DELAY) / 0.35), 1.4));
            const beat = t < st ? 1 + params.beat * pulse : 1;
            const e = m.enter(k);
            c.sx *= pop * beat;
            c.sy *= pop * beat;
            c.tx += d.side * e * 0.55 * u.box.w * 2;
            c.ty += e * e * 0.2 * u.box.h;
            c.rot += d.side * 18 * e;
            c.opacity *= 1 - k * k;
            break;
          }
          case 'disc': {
            c.visible &&= t >= d.at;
            const s = Math.max(0.001, m.bounce(clamp01((t - d.at) / 0.4), 1.8));
            const beat = 1 + params.beat * 1.2 * pulse;
            c.sx *= s * beat;
            c.sy *= s * beat;
            break;
          }
          case 'mark': {
            c.visible &&= t >= d.at;
            const k = clamp01((t - d.at) / (2 * SETTLE));
            const s = lerp(0.85, 1, m.enter(k)) * (1 + 0.4 * params.beat * pulse);
            c.sx *= s;
            c.sy *= s;
            c.opacity *= k;
            break;
          }
          case 'text':
            break;
        }
      }
    }
  },
  /** The answer's flash reaches the stage (it counts even while the section is off screen in the snapshot). */
  fingerprint({ section }, t0, t1) {
    const f = (stage(section)?.flip ?? -1) + HALF_FLIP;
    return f > 0 && f < t1 && f + FLASH_LEN >= t0 ? { flash: f } : null;
  },
  /**
   * Heartbeat thumps (a low impact on the beat, a softer pop on the dub) while seals, the face-down answer or the
   * two options wait; a riser into every reveal that waited ≥ 0.9 s; pop + shimmer when a seal opens, impact + shimmer
   * when the answer flips; a whoosh as option B slides out, a pop for the disc, calm rising pops for words.
   */
  sounds({ host, section, params }) {
    const out: SoundCue[] = endcardStinger(section);
    const spans: [number, number][] = [];
    const beats = host.reel.cues.beats;
    const flip = stage(section)?.flip ?? -1;
    let k = 0;
    for (const u of section.units) {
      if (!u.revealed || !Number.isFinite(u.at)) continue;
      const anim = (u.data.reveal as { anim: Anim }).anim;
      const d = dilemmaOf(u);
      const pan = host.pan(u);
      if (anim === 'unseal') {
        const from = dilemmaOf(sealOf(section, u.item)[0]!)!;
        const st = u.at - OPEN_LEAD;
        if (from.kind === 'seal') {
          spans.push([from.from, st]);
          if (st - from.from >= 0.9) out.push({ t: Math.max(from.from, st - 1), until: u.at, kind: 'riser', weight: 0.3 });
        }
        out.push({ t: u.at, kind: 'pop', weight: 0.5, pitch: 3, pan }, { t: u.at, kind: 'shimmer', weight: 0.35, pan });
      } else if (anim === 'rise' || anim === 'answer') out.push({ t: u.at, kind: 'pop', weight: 0.28, pitch: Math.min(7, k++), pan });
      else if (anim === 'pop') out.push({ t: u.at, kind: 'pop', weight: 0.42, pan });
      else if (d?.kind === 'card' && d.card === 'b') out.push({ t: d.at, until: d.at + SETTLE, kind: 'whoosh', weight: 0.25, pan });
      else if (d?.kind === 'disc') out.push({ t: d.at + 0.12, kind: 'pop', weight: 0.45, pitch: -2 });
      else if (d?.kind === 'card' && d.card === 'back') {
        spans.push([d.at, flip - HALF_FLIP]);
        out.push({ t: Math.max(d.at, flip - 1.4), until: flip + HALF_FLIP, kind: 'riser', weight: 0.4 });
        out.push({ t: flip + HALF_FLIP, kind: 'impact', weight: 0.7 }, { t: flip + HALF_FLIP, kind: 'shimmer', weight: 0.5 });
      }
    }
    if (stage(section)?.stage === 'split') spans.push([section.timing.lastLand + 0.3, section.timing.out]);
    if (params.thump > 0) {
      beats.forEach((b, i) => {
        if (!spans.some(([a, z]) => b >= a && b < z)) return;
        const len = (beats[i + 1] ?? b + 0.6) - b;
        out.push({ t: b, kind: 'impact', weight: params.thump, pitch: -14 }, { t: b + DUB * len, kind: 'pop', weight: params.thump * 0.8, pitch: -12 });
      });
    }
    return out.filter((c) => c.t >= QUIET);
  },
});
