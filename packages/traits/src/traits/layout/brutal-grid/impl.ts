/**
 * Brutalist grid layout. Per section (one scene layer each), top to bottom inside the safe area:
 *
 * - slug line: `0N/0M` at the start edge and the section's time code at the end edge, mono (`text` font), over a
 *   heavy bar bled across the frame (both cut in when the section's window opens);
 * - rows: consecutive content units, 1–3 per row (the count whose smallest row is largest: one per row in tall
 *   formats, pairs/triples in wide ones), start-aligned, each row as wide as the safe width allows under a common
 *   cap (`fitColumn`), top-aligned under the bar; full-bleed rules between rows and under the last one;
 * - behind: the section number set giant at the end/bottom corner and cropped by the frame, in a faint tint;
 * - per content text unit: a giant copy (`giant`) at least 1.2 × the frame width and `giant` × the frame height,
 *   its start edge just inside the frame start (the end crops off), on its own full-frame `flash` panel that
 *   alternates ink black / signal accent.
 * The fit box is shrunk around the safe centre by the hold zoom so kicks cannot push the top-aligned rows out.
 */
import { visualOrder } from '@reel/runtime';
import { defineLayout, type Unit } from '../../../contract.ts';
import type { BrutalData } from '../../../lib/brutal.ts';
import { logoBadge } from '../../../lib/deco.ts';
import { mixHex } from '../../../lib/neon.ts';
import { BADGE, badgeDims, fitColumn, placeTok, safeFit, weightOf } from '../../../lib/rowset.ts';
import { meta } from './meta.ts';

const OVER = 0.05;
const two = (n: number) => String(n).padStart(2, '0');

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const { W, H, safe } = host;
    const rtl = host.dir === 'rtl';
    const wt = weightOf(host, 900);
    const wtT = weightOf(host, 700, 'text');
    const b1 = badgeDims(host);
    const m0 = Math.min(safe.w, safe.h);
    const count = host.sections.length;
    for (const s of layer.sections) {
      const hi = host.zoomRange(s)[1] * 1.005;
      const f0 = safeFit(host);
      const { cx, cy } = safe;
      const fit = { x0: cx - (cx - f0.x0) / hi, x1: cx + (f0.x1 - cx) / hi, y0: cy - (cy - f0.y0) / hi, y1: cy + (f0.y1 - cy) / hi };
      const FW = fit.x1 - fit.x0;
      const ink = s.palette.text;
      const startX = (w: number) => (rtl ? fit.x1 - w : fit.x0);
      const bleed = { x: -OVER * W, w: W * (1 + 2 * OVER) };
      const T = s.timing;

      // ── slug line + bar ──
      const LS = 0.05 * m0;
      const slug = (text: string, end: boolean): Unit => {
        const u = host.deco(s, { deco: 'label', text, ltr: true, graphemes: text.length, color: ink, revealed: true, z: 1 });
        u.font = { family: 'text', size: LS, weight: wtT };
        const m = host.metrics(text, wtT, true, 'text');
        const w = (m.bl + m.br) * LS;
        placeTok(u, m, end !== rtl ? fit.x1 - w : fit.x0, fit.y0 + m.ia * LS, LS, wtT);
        u.at = s.window?.t0 ?? 0;
        u.data.layout = { kind: 'label' } satisfies BrutalData;
        return u;
      };
      slug(`${two(s.index + 1)}/${two(count)}`, false);
      const sec = Math.floor(T.firstLand);
      slug(`${two(Math.floor(sec / 60))}:${two(sec % 60)}`, true);
      const barY = fit.y0 + 1.15 * LS;
      const tb = Math.max(4, 0.024 * m0) * params.rule;
      const rule = (y: number, h: number, at: number) => {
        if (h <= 0) return;
        const r = host.deco(s, { deco: 'rule', box: { x: bleed.x, y, w: bleed.w, h }, style: { background: ink }, origin: rtl ? '100% 50%' : '0 50%', revealed: true, z: -1 });
        r.at = at;
        r.data.layout = { kind: 'rule', at } satisfies BrutalData;
      };
      rule(barY, tb, s.window?.t0 ?? 0);

      // ── rows: k consecutive units per row (k = 1…3), the k whose smallest row is largest ──
      const content = s.units.filter((u) => u.item >= 0);
      const items = content.map((u) => {
        if (u.kind === 'logos') return { u, w1: b1.w, ia: b1.h, id: 0, m: null };
        const m = host.metrics(u.text, wt, u.ltr);
        return { u, w1: m.bl + m.br, ia: m.ia, id: m.id, m };
      });
      type Item = (typeof items)[number];
      const GAP = 0.22;
      const group = (k: number): Item[][] => {
        const out: Item[][] = [];
        let run: Item[] = [];
        const flush = () => {
          const n = Math.ceil(run.length / k);
          for (let i = 0, j = 0; i < n; i++) {
            const len = Math.floor(run.length / n) + (i < run.length % n ? 1 : 0);
            out.push(run.slice(j, j + len));
            j += len;
          }
          run = [];
        };
        for (const it of items) {
          if (it.m) run.push(it);
          else {
            flush();
            out.push([it]);
          }
        }
        flush();
        return out;
      };
      const dimsOf = (g: Item[]) => ({
        w1: g.reduce((a, it) => a + it.w1, 0) + GAP * (g.length - 1),
        h1: Math.max(...g.map((it) => it.ia)) + Math.max(...g.map((it) => it.id)),
      });
      const top = barY + tb + 0.55 * LS;
      const L = params.leading;
      const capPx = params.cap * (fit.y1 - fit.y0);
      let best: { rows: Item[][]; S: number[]; score: number } | null = null;
      for (let k = 1; k <= 3; k++) {
        const rows = group(k);
        const S = fitColumn(rows.map(dimsOf), FW, fit.y1 - top, L, capPx);
        const score = Math.min(...S);
        if (!best || score > best.score * 1.08) best = { rows, S, score };
      }
      const { rows, S } = best!;
      const tr = Math.max(3, 0.007 * m0) * params.rule;
      let y = top;
      let x0b = Infinity;
      let x1b = -Infinity;
      let landing = 0;
      rows.forEach((g, i) => {
        const Si = S[i]!;
        if (i) {
          const gap = (L * (S[i - 1]! + Si)) / 2;
          rule(y + gap / 2 - tr / 2, tr, T.firstLand + 0.06 * i);
          y += gap;
        }
        const d = dimsOf(g);
        const w = d.w1 * Si;
        x0b = Math.min(x0b, startX(w));
        x1b = Math.max(x1b, startX(w) + w);
        const solo = g[0]!;
        if (!solo.m) {
          const u = solo.u;
          u.tags.line = i;
          u.data.layout = { kind: 'row', row: i } satisfies BrutalData;
          const b = logoBadge(host, s, host.reel.logos, b1.w * Si + 1, {
            logoH: BADGE.logoH * Si, pad: BADGE.pad * Si, gap: BADGE.gap * Si, radius: 0, fill: s.palette.bg, border: ink, shadow: null,
          });
          Object.assign(u, {
            box: { x: startX(b.w), y, w: b.w, h: b.h },
            innerStyle: { width: `${b.w.toFixed(2)}px`, height: `${b.h.toFixed(2)}px` },
            mount: b.mount,
            mountKey: b.key,
            z: 1,
            font: { family: 'display', size: Si, weight: wt },
          });
          y += b.h;
          return;
        }
        const base = y + Math.max(...g.map((it) => it.ia)) * Si;
        let x = startX(w);
        for (const it of visualOrder(g.map((it) => it.u.text), s.dir).map((j) => g[j]!)) {
          const u = it.u;
          u.tags.line = i;
          u.data.layout = { kind: 'row', row: i } satisfies BrutalData;
          placeTok(u, it.m!, x, base, Si, wt);
          x += (it.w1 + GAP) * Si;
        }
        y += d.h1 * Si;

        // giant cropped copies + their flash panels, in landing order
        for (const it of g) {
          const u = it.u;
          const m = it.m!;
          const n = landing++;
          const h1 = m.ia + m.id;
          const G = Math.max((params.giant * H) / h1, (1.2 * W) / it.w1);
          const gw = it.w1 * G;
          const flash = host.deco(s, {
            deco: 'flash',
            box: { x: -OVER * W, y: -OVER * H, w: W * (1 + 2 * OVER), h: H * (1 + 2 * OVER) },
            style: { background: n % 2 ? host.accent(0, s) : ink },
            revealed: true,
            z: 3,
          });
          flash.at = u.at;
          flash.data.layout = { kind: 'flash', of: u.item, i: n } satisfies BrutalData;
          const gu = host.deco(s, { deco: 'giant', text: u.text, ltr: u.ltr, graphemes: u.graphemes, at: u.at, revealed: true, z: 4 });
          gu.color = n % 2 ? ink : s.palette.bg;
          placeTok(gu, m, rtl ? W * 0.97 - gw : W * 0.03, H / 2 + ((m.ia - m.id) * G) / 2, G, wt);
          gu.data.layout = { kind: 'giant', of: u.item, i: n } satisfies BrutalData;
        }
      });
      rule(y + (L * S.at(-1)!) / 2 - tr / 2, tr, T.firstLand + 0.06 * rows.length);

      // ── giant cropped section number ──
      const num = two(s.index + 1);
      const mm = host.metrics(num, wt, true);
      const MS = (0.5 * H) / (mm.ia + mm.id);
      const mark = host.deco(s, { deco: 'mark', text: num, ltr: true, graphemes: 2, color: mixHex(s.palette.bg, host.accent(2, s), 0.14), revealed: true, z: -5 });
      const mw = (mm.bl + mm.br) * MS;
      placeTok(mark, mm, rtl ? -0.14 * mw : W - 0.86 * mw, H + 0.12 * (mm.ia + mm.id) * MS - mm.id * MS, MS, wt);
      mark.at = T.firstLand;
      mark.data.layout = { kind: 'mark' } satisfies BrutalData;

      s.place = { x: 0, y: 0, rot: 0 };
      s.frame = { x: cx, y: cy, r: 0, s: 1 };
      s.bounds = { x0: x0b, y0: fit.y0, x1: x1b, y1: y };
    }
  },
});
