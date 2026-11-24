/**
 * Scroll-stack layout. Per section (one scene layer each):
 *
 * - The content block: center-stack's role rows fitted to the safe area, centred (`lib/scroll.ts` `centredBlock`).
 * - Copies: `deco: 'copy'` per text unit per slot j (same text, font and box, shifted j periods), outlined
 *   (transparent fill + text stroke; odd slots in the first accent). Slots cover [−reach·H − P, H + reach·H + P] in
 *   layer y, which is everything the ramp-scroll camera can show.
 * - `section.data.layout` (`Stack`): period, block height, slots, scroll reach (px) and the beat steps of the drift.
 *
 * Frame: drift δ(t) = Σ over the step beats b ≤ t of step·P·enter((t − b)/stepDur); every copy sits at
 * jmin·P + ((j − jmin)·P − δ) mod (n·P) relative to the block, so the column wraps seamlessly. A copy's opacity is
 * dim · max(clearance, ghost): clearance 0 while it overlaps the real block and 1 one period away; ghost 1 until its
 * word lands (the slot-0 copy is the outline the word stamps onto).
 */
import type { SoundCue } from '@reel/core';
import { clamp01 } from '@reel/runtime';
import { defineLayout, type Section } from '../../../contract.ts';
import { safeFit } from '../../../lib/rowset.ts';
import { centredBlock, extent, type Stack } from '../../../lib/scroll.ts';
import { meta } from './meta.ts';

interface Copy {
  /** Source content unit (item index). */
  of: number;
  j: number;
}

const mod = (a: number, m: number) => ((a % m) + m) % m;

/** Drift of the copies at t (px, upwards). */
function drift(s: Section, d: Stack, step: number, t: number): number {
  let y = 0;
  for (const b of d.steps) {
    if (b > t) break;
    y += step * d.period * s.motion.enter(clamp01((t - b) / d.stepDur));
  }
  return y;
}

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const { safe, H } = host;
    const safeBox = safeFit(host);
    const half = (params.share * (safeBox.y1 - safeBox.y0)) / 2;
    // the block takes `share` of the safe height so copies show above and below it at the hold
    const fit = { ...safeBox, y0: safe.cy - half, y1: safe.cy + half };
    const cap = Math.min(params.cap * safe.w, params.cap * 0.88 * safe.h);
    const beats = host.reel.cues.beats;
    const beat = beats.length > 1 ? beats[1]! - beats[0]! : 0.5;
    for (const s of layer.sections) {
      const { rows, size } = centredBlock(host, s, fit, { cap, plain: params.plain, leading: params.leading });
      const e = extent(rows);
      const h = e.y1 - e.y0;
      const P = h + params.gap * size;
      const reach = params.reach * H;
      const jmin = Math.floor((-reach - P - e.y0) / P);
      const jmax = Math.ceil((H + reach + P - e.y0) / P);
      const end = s.next ? (s.next.window?.t1 ?? s.next.timing.in) : host.reel.cues.duration;
      const stack: Stack = {
        period: P,
        h,
        jmin,
        n: jmax - jmin + 1,
        reach,
        steps: beats.filter((b) => b >= s.timing.holdStart - 1e-6 && b < end),
        stepDur: 0.55 * beat,
      };
      s.data.layout = stack;
      const texts = s.units.filter((u) => u.item >= 0 && u.inkBox && u.text && u.kind !== 'logos');
      for (let j = jmin; j <= jmax; j++) {
        for (const u of texts) {
          const stroke = j % 2 ? host.accent(0, s) : s.palette.text;
          const copy = host.deco(s, {
            deco: 'copy',
            text: u.text,
            ltr: u.ltr,
            graphemes: u.graphemes,
            emphasis: u.emphasis,
            font: { ...u.font },
            box: { ...u.box, y: u.box.y + j * P },
            textAt: { ...u.textAt },
            baseline: u.baseline + j * P,
            innerOrigin: u.innerOrigin,
            color: 'transparent',
            innerStyle: { '-webkit-text-stroke': `${Math.max(1.5, params.stroke * u.font.size).toFixed(2)}px ${stroke}` },
            z: -2,
          });
          copy.data.layout = { of: u.item, j } satisfies Copy;
        }
      }
      // Opaque plate behind the frozen block so a copy sliding through the centre never sits on the real words.
      // padY stays under the inter-copy gap, so the plate does not cover the next period.
      if (rows.length && h > 0 && h < 1e6) {
        const padX = 0.4 * size;
        const padY = Math.min(0.18 * size, params.gap * size * 0.45);
        host.deco(s, {
          deco: 'plate',
          box: {
            x: Math.round(e.x0 - padX),
            y: Math.round(e.y0 - padY),
            w: Math.max(1, Math.round(e.x1 - e.x0 + 2 * padX)),
            h: Math.max(1, Math.round(h + 2 * padY)),
          },
          style: { background: s.palette.bg, 'border-radius': `${Math.round(0.08 * size)}px` },
          z: -1,
        });
      }
    }
  },
  frame({ layer, params }, t) {
    for (const s of layer.sections) {
      const d = s.data.layout as Stack;
      const P = d.period;
      const span = d.n * P;
      const dy = drift(s, d, params.step, t);
      for (const u of s.units) {
        if (u.deco !== 'copy') continue;
        const c = u.data.layout as Copy;
        const off = d.jmin * P + mod((c.j - d.jmin) * P - dy, span);
        u.ch.ty += off - c.j * P;
        const clear = clamp01((Math.abs(off) - d.h) / Math.max(1, P - d.h));
        const ghost = 1 - clamp01((t - (s.units[c.of]!.at - 0.02)) / 0.12);
        const k = Math.max(clear, ghost);
        u.ch.opacity *= params.dim * k;
        u.ch.visible &&= k > 0.002;
      }
    }
  },
  /** A light tick on every drift step, alternating pitch (the column clicks along with the beat). */
  sounds({ layer, params }) {
    if (params.step <= 0) return [];
    return layer.sections.flatMap((s) =>
      (s.data.layout as Stack).steps.filter((t) => t >= 0.62).map((t, i): SoundCue => ({ t, kind: 'tick', weight: 0.18, pitch: i % 2 ? 3 : 0, section: s.id })),
    );
  },
});
