/**
 * Count board (see meta). Every section: numbers switch to the text font, rows come from `roleBlocks` and are fitted
 * and centred by `chooseRows`/`placeRows`; then each counting number gets a plate decoration behind it, as wide as its
 * widest countdown step (`lib/countdown.ts`), shown from the start of its count (`unit.data.layout.of` = the number's
 * item). The plate is a split-flap-like slab: two tones with a hairline seam, an accent rim.
 */
import { defineLayout, type Unit } from '../../../contract.ts';
import { countSteps } from '../../../lib/countdown.ts';
import { rgba } from '../../../lib/neon.ts';
import { chooseRows, lightDark, placeRows, roleBlocks, safeFit, type StackOpts } from '../../../lib/rowset.ts';
import { meta } from './meta.ts';

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const { safe } = host;
    const fit = safeFit(host);
    const cap = Math.min(params.cap * safe.w, params.cap * 0.88 * safe.h);
    const wide = safe.w > 1.3 * safe.h;
    for (const s of layer.sections) {
      const content = s.units.filter((u) => u.item >= 0);
      for (const u of content) if (u.tags.numeric) u.font = { ...u.font, family: 'text' };
      const hi = host.zoomRange(s)[1] * 1.005;
      const blocks = roleBlocks(host, s, { plain: params.plain, wt: 900, pin: true });
      const o: StackOpts = { gap: 0.26, leading: params.leading, headroom: 0, fit, cap, hi, align: 'center' };
      const { rows, size } = chooseRows(host, blocks, o, wide);
      const { light, dark } = lightDark(s);
      placeRows(host, s, rows, size, o, { fill: light, border: dark, shadow: null });
      s.data.layout = { size, rows: rows.length };
      if (!params.plate) continue;
      const P = s.palette;
      const rim = host.accent(1, s);
      for (const u of content) {
        const steps = countSteps(u);
        if (!steps || !u.inkBox) continue;
        const S = u.font.size;
        const widest = (txt: string) => {
          const m = host.metrics(txt, u.font.weight, true, 'text');
          return (m.bl + m.br) * S;
        };
        const w = Math.max(u.inkBox.w, ...(steps.mode === 'count' ? steps.texts.map(widest) : []));
        const pad = params.plate * S;
        const cx = u.box.x + u.textAt.x + u.inkBox.x + u.inkBox.w / 2;
        const y0 = u.box.y + u.textAt.y + u.inkBox.y;
        const box = { x: cx - w / 2 - pad * 1.3, y: y0 - pad, w: w + 2.6 * pad, h: u.inkBox.h + 2 * pad };
        const top = rgba(P.text, 0.075);
        const bottom = rgba(P.text, 0.04);
        const seam = rgba(P.bg, 0.9);
        const plate: Unit = host.deco(s, {
          deco: 'plate',
          cls: 'count-plate',
          box,
          z: -2,
          at: u.at,
          revealed: true,
          origin: '50% 50%',
          style: {
            background: `linear-gradient(to bottom, ${top} 0%, ${top} 49.4%, ${seam} 49.4%, ${seam} 50.6%, ${bottom} 50.6%, ${bottom} 100%)`,
            border: `${Math.max(2, 0.018 * S).toFixed(1)}px solid ${rgba(rim, 0.55)}`,
            'border-radius': `${(0.12 * S).toFixed(1)}px`,
            'box-sizing': 'border-box',
          },
        });
        plate.data.layout = { of: u.item };
      }
    }
  },
});
