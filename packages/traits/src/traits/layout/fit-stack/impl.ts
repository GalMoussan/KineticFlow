/**
 * Fit-stack layout: rows from center-stack's role rules (`roleBlocks`), k words per packed row chosen as
 * center-stack does (from `words` up), fitted to the safe area at the largest hold zoom with `headroom` em above
 * every row, centred. With `tilt`, each text unit gets a rotation (alternating sign, hashed magnitude) shrunk in
 * 0.25° steps until its rotated ink box keeps half the free gap to every neighbour and stays inside the fit box;
 * it is kept in `unit.data.layout.tilt` for the material/reveal to apply.
 */
import { hash } from '@reel/runtime';
import { defineLayout, type Unit } from '../../../contract.ts';
import { chooseRows, inkRect, lightDark, placeRows, roleBlocks, safeFit, type StackOpts } from '../../../lib/rowset.ts';
import { meta } from './meta.ts';

/** Largest tilt (deg) ≤ `max` whose rotated AABB keeps clear of the neighbours and the box. */
function clearTilt(u: Unit, others: Unit[], box: { x0: number; y0: number; x1: number; y1: number }, max: number): number {
  const r = inkRect(u);
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  let room = { x: Math.min(r.x0 - box.x0, box.x1 - r.x1), y: Math.min(r.y0 - box.y0, box.y1 - r.y1) };
  for (const v of others) {
    const q = inkRect(v);
    const gx = Math.max(q.x0 - r.x1, r.x0 - q.x1);
    const gy = Math.max(q.y0 - r.y1, r.y0 - q.y1);
    if (gx < 0 && gy >= 0) room = { ...room, y: Math.min(room.y, gy / 2 - 1) };
    else if (gy < 0 && gx >= 0) room = { ...room, x: Math.min(room.x, gx / 2 - 1) };
  }
  for (let a = max; a > 0; a -= 0.25) {
    const th = (a * Math.PI) / 180;
    const dx = (w * Math.cos(th) + h * Math.sin(th) - w) / 2;
    const dy = (w * Math.sin(th) + h * Math.cos(th) - h) / 2;
    if (dx <= room.x && dy <= room.y) return a;
  }
  return 0;
}

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const { safe } = host;
    const fit = safeFit(host);
    const cap = Math.min(params.cap * safe.w, params.cap * 0.88 * safe.h);
    const wide = safe.w > 1.3 * safe.h;
    for (const s of layer.sections) {
      const hi = host.zoomRange(s)[1] * 1.005;
      const blocks = roleBlocks(host, s, { plain: params.plain, wt: 900, pin: params.pin > 0 });
      const o: StackOpts = { gap: 0.26, leading: params.leading, headroom: params.headroom, fit, cap, hi, align: 'center' };
      const { rows, size } = chooseRows(host, blocks, o, wide, Math.round(params.words));
      const { light, dark } = lightDark(s);
      placeRows(host, s, rows, size, o, { fill: light, border: dark, shadow: null });
      s.data.layout = { size, rows: rows.length };
      if (!params.tilt) continue;
      const texts = s.units.filter((u) => u.item >= 0 && u.inkBox && u.kind !== 'logos');
      const box = { x0: safe.cx - (safe.cx - fit.x0) / hi, x1: safe.cx + (fit.x1 - safe.cx) / hi, y0: safe.cy - (safe.cy - fit.y0) / hi, y1: safe.cy + (fit.y1 - safe.cy) / hi };
      texts.forEach((u, i) => {
        const want = params.tilt * (0.55 + 0.45 * hash(u.item * 7 + s.index * 13 + 1));
        const a = clearTilt(u, texts.filter((v) => v !== u), box, want);
        u.data.layout = { tilt: (i % 2 ? 1 : -1) * a };
      });
    }
  },
});
