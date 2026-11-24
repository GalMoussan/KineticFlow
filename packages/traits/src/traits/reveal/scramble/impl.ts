/**
 * Scramble decode: cells appear one after another showing stand-in glyphs (`lib/glyphs.ts`, re-drawn `rate` times a
 * second from `hash`), then resolve in logical (reading) order; the cell about to lock is the bright decoding head
 * and each locked cell flares once. Stand-ins keep their natural size (scaled text rasters differently by seek
 * history). The schedule (start, length fitted before the section hold) is kept in `unit.data.reveal`.
 */
import type { SoundCue } from '@reel/core';
import { hash } from '@reel/runtime';
import { defineReveal, type Part } from '../../../contract.ts';
import { scriptOf, standIn } from '../../../lib/glyphs.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import { meta } from './meta.ts';

interface Data {
  st: number;
  /** Start to fully decoded; scramble-only prelude; per-cell appearance step. */
  R: number;
  pre: number;
  spill: number;
}
/** Seconds a locked cell flares. */
const FLARE = 0.25;

/** When cell `i` of `n` locks onto its grapheme. */
const lockAt = (d: Data, i: number, n: number) => d.st + d.pre + ((d.R - d.pre) * (i + 1)) / n;

export default defineReveal({
  meta,
  prepare(_c, u) {
    if (u.item >= 0 && u.text) u.split = 'grapheme';
  },
  mount({ section, params }) {
    for (const u of section.units) {
      if (u.item < 0 || !u.revealed) continue;
      const st = u.at - params.lead;
      const R = Math.max(0.12, Math.min(params.resolve, section.timing.holdStart - 0.05 - st));
      const n = Math.max(1, u.parts.length);
      u.data.reveal = { st, R, pre: 0.35 * R, spill: Math.min(params.spill, (0.25 * R) / n) } satisfies Data;
    }
  },
  frame({ host, section, params }, t) {
    const scrambleColor = host.accent(1, section);
    for (const u of section.units) {
      const d = u.data.reveal as Data | undefined;
      if (!d || u.item < 0) continue;
      const c = u.ch;
      c.visible &&= t >= d.st;
      if (t < d.st) continue;
      const n = u.parts.length;
      if (!n) {
        // logos: flicker on during the prelude
        c.opacity *= t >= d.st + d.pre ? 1 : hash(Math.floor(t * params.rate) + u.id) < 0.5 ? 0.25 : 0.7;
        continue;
      }
      const S = u.font.size;
      const flare = u.color === host.accent(0, section) ? section.palette.text : host.accent(0, section);
      const q = Math.floor(t * params.rate);
      u.parts.forEach((p: Part, i) => {
        const lock = lockAt(d, i, n);
        if (t < d.st + i * d.spill) {
          p.ch.opacity = 0;
          return;
        }
        if (t >= lock) {
          const k = (t - lock) / FLARE;
          if (k < 1) {
            p.ch.color = flare;
            p.ch.glow += 0.05 * S * (1 - k);
            p.ch.glowColor = flare;
          }
          return;
        }
        // the decoding head: the next cell to lock (cell 0 once the prelude is over)
        const head = t >= lockAt(d, i - 1, n);
        const g = standIn(scriptOf(p.text), hash(u.id * 17.31 + p.index * 3.73 + q * 1.137), p.text);
        p.ch.glyph = g;
        p.ch.color = head ? flare : scrambleColor;
        p.ch.opacity *= head ? 1 : 0.55 + 0.3 * hash(q * 0.71 + p.index);
      });
    }
  },
  /** Up to 4 ticks per unit as cells lock (pitch rising along the word); emphasis and the hero land on a pop. */
  sounds({ host, section }) {
    const out: SoundCue[] = endcardStinger(section);
    for (const u of section.units) {
      const d = u.data.reveal as Data | undefined;
      if (!d || u.item < 0) continue;
      const pan = host.pan(u);
      const n = u.parts.length;
      if (!n) {
        out.push({ t: d.st + d.pre, kind: 'pop', weight: 0.4, pan });
        continue;
      }
      const m = Math.min(4, n);
      const picks = [...new Set(Array.from({ length: m }, (_, j) => Math.round((j * (n - 1)) / Math.max(1, m - 1))))];
      const accent = u.emphasis || u.tags.hero;
      picks.forEach((i, j) => {
        const last = j === picks.length - 1;
        if (last && accent) out.push({ t: lockAt(d, i, n), kind: 'pop', weight: 0.45, pitch: 2 * j, pan });
        else out.push({ t: lockAt(d, i, n), kind: 'tick', weight: 0.3, pitch: 2 * j, pan });
      });
    }
    return out;
  },
});
