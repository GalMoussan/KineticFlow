/**
 * Word-per-beat layout. Per section (one scene layer each):
 *
 * - Solo copies: one `deco: 'solo'` per content unit (same text, its own font size: as wide as the safe width and at
 *   most `solo` × the safe height, ink centred on the safe centre), landing at the unit's `at`. The logo item's solo
 *   is a logo badge as wide as the safe area.
 * - Recap: the content units themselves, one per row, centred. Each row is fitted to the safe width; a common cap,
 *   found by bisection, keeps the whole stack inside the safe height (short words stop growing first).
 * - Colour surfaces (their colour is the material's, through `ch.color` → `background: currentColor`): one full-frame
 *   `panel` behind the solos and one full-width `band` per recap row, split half-way between rows and bled past the
 *   frame edges.
 * - `k` (colour index) runs over the reel's content units in order, so consecutive words and rows never share a
 *   colour; `section.data.layout.stackT` is the recap time: the grid point after the last landing (beat, else
 *   half-beat, else the landing itself) that still leaves `recap` seconds before the hold ends.
 */
import { defineLayout, type Host, type Section, type Unit } from '../../../contract.ts';
import type { BeatData, BeatSection } from '../../../lib/beat.ts';
import { logoBadge } from '../../../lib/deco.ts';
import { BADGE, badgeDims, columnHeight, fitColumn, lightDark, placeTok, safeFit, weightOf } from '../../../lib/rowset.ts';
import { meta } from './meta.ts';

/** Overscan of full-frame surfaces (kicks zoom in; shakes stay inside). */
const OVER = 0.05;

/** The recap time: the latest grid point of {next beat, half-way to it, the last landing} leaving `recap` s of hold. */
function recapTime(s: Section, beats: readonly number[], recap: number): number {
  const T = s.timing;
  if (s.units.filter((u) => u.item >= 0).length < 2) return T.firstLand;
  const nb = beats.find((b) => b > T.lastLand + 0.02) ?? T.lastLand + 0.5;
  const end = T.holdEnd - recap;
  for (const h of [nb, (T.lastLand + nb) / 2]) if (h <= end && h <= T.holdStart + 1e-6) return h;
  return T.lastLand;
}

/** A full-width surface deco whose fill is its inner element's `currentColor`. */
function surface(host: Host, s: Section, box: { x: number; y: number; w: number; h: number }, z: number): Unit {
  return host.deco(s, {
    deco: 'surface',
    box,
    html: '',
    textAt: { x: 0, y: 0 },
    innerStyle: { width: `${box.w.toFixed(2)}px`, height: `${box.h.toFixed(2)}px`, background: 'currentColor' },
    revealed: true,
    z,
  });
}

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const { W, H } = host;
    const fit = safeFit(host);
    const wt = weightOf(host, 900);
    const b1 = badgeDims(host);
    for (const s of layer.sections) {
      const hi = host.zoomRange(s)[1] * 1.005;
      const FW = (fit.x1 - fit.x0) / hi;
      const FH = (fit.y1 - fit.y0) / hi;
      const cx = (fit.x0 + fit.x1) / 2;
      const cy = (fit.y0 + fit.y1) / 2;
      const k0 = host.sections.slice(0, s.index).reduce((a, x) => a + x.units.filter((u) => u.item >= 0).length, 0);
      const content = s.units.filter((u) => u.item >= 0);
      const { light, dark } = lightDark(s);
      const badgeColors = { fill: light, border: dark, shadow: null };
      // per row at size 1: ink width and height (badge: its box)
      const rows = content.map((u) => {
        if (u.kind === 'logos') return { u, w1: b1.w, h1: b1.h, m: null };
        const m = host.metrics(u.text, wt, u.ltr);
        return { u, w1: m.bl + m.br, h1: m.ia + m.id, m };
      });

      // ── solos ──
      content.forEach((u, i) => {
        const r = rows[i]!;
        const S = Math.min(FW / r.w1, (params.solo * FH) / r.h1);
        const solo = host.deco(s, { deco: 'solo', text: u.text, ltr: u.ltr, graphemes: u.graphemes, at: u.at, revealed: true, z: 2 });
        solo.data.layout = { kind: 'solo', of: u.item, k: k0 + i } satisfies BeatData;
        if (!r.m) {
          const b = logoBadge(host, s, host.reel.logos, b1.w * S + 1, {
            logoH: BADGE.logoH * S, pad: BADGE.pad * S, gap: BADGE.gap * S, radius: BADGE.radius * S, ...badgeColors,
          });
          Object.assign(solo, {
            box: { x: cx - b.w / 2, y: cy - b.h / 2, w: b.w, h: b.h },
            innerStyle: { width: `${b.w.toFixed(2)}px`, height: `${b.h.toFixed(2)}px` },
            mount: b.mount,
            mountKey: b.key,
            font: { family: 'display', size: S, weight: wt },
          });
          return;
        }
        const m = r.m;
        placeTok(solo, m, cx - ((m.bl + m.br) * S) / 2, cy + ((m.ia - m.id) * S) / 2, S, wt);
      });

      // ── recap rows: fitted to width, one common cap bisected so the stack fits the height ──
      const L = params.leading;
      const S = fitColumn(rows, FW, FH, L, params.cap * FH);
      let y = cy - columnHeight(rows, S, L) / 2;
      const spans: { top: number; bottom: number }[] = [];
      let x0b = Infinity;
      let x1b = -Infinity;
      const y0b = y;
      rows.forEach((r, i) => {
        if (i) y += (L * (S[i - 1]! + S[i]!)) / 2;
        const u = r.u;
        const Si = S[i]!;
        u.tags.line = i;
        u.data.layout = { kind: 'row', k: k0 + i, row: i } satisfies BeatData;
        const w = r.w1 * Si;
        x0b = Math.min(x0b, cx - w / 2);
        x1b = Math.max(x1b, cx + w / 2);
        if (!r.m) {
          const b = logoBadge(host, s, host.reel.logos, b1.w * Si + 1, {
            logoH: BADGE.logoH * Si, pad: BADGE.pad * Si, gap: BADGE.gap * Si, radius: BADGE.radius * Si, ...badgeColors,
          });
          Object.assign(u, {
            box: { x: cx - b.w / 2, y, w: b.w, h: b.h },
            innerStyle: { width: `${b.w.toFixed(2)}px`, height: `${b.h.toFixed(2)}px` },
            mount: b.mount,
            mountKey: b.key,
            z: 1,
            font: { family: 'display', size: Si, weight: wt },
          });
          spans.push({ top: y, bottom: y + b.h });
          y += b.h;
          return;
        }
        const m = r.m;
        placeTok(u, m, cx - w / 2, y + m.ia * Si, Si, wt);
        spans.push({ top: y, bottom: y + r.h1 * Si });
        y += r.h1 * Si;
      });

      // ── colour surfaces ──
      const panel = surface(host, s, { x: -OVER * W, y: -OVER * H, w: W * (1 + 2 * OVER), h: H * (1 + 2 * OVER) }, -3);
      panel.at = s.timing.in;
      panel.data.layout = { kind: 'panel' } satisfies BeatData;
      spans.forEach((sp, i) => {
        const top = i ? (spans[i - 1]!.bottom + sp.top) / 2 : -OVER * H;
        const bottom = i < spans.length - 1 ? (sp.bottom + spans[i + 1]!.top) / 2 : H * (1 + OVER);
        // a hair of overlap so no seam shows between bands
        const band = surface(host, s, { x: -OVER * W, y: top - 0.5, w: W * (1 + 2 * OVER), h: bottom - top + 1 }, -2);
        band.at = NaN;
        band.data.layout = { kind: 'band', of: rows[i]!.u.item, k: k0 + i, row: i } satisfies BeatData;
      });

      s.place = { x: 0, y: 0, rot: 0 };
      s.frame = { x: host.safe.cx, y: host.safe.cy, r: 0, s: 1 };
      s.bounds = { x0: x0b, y0: y0b, x1: x1b, y1: y };
      s.data.layout = { stackT: recapTime(s, host.reel.cues.beats, params.recap), n: content.length } satisfies BeatSection;
    }
  },
});
