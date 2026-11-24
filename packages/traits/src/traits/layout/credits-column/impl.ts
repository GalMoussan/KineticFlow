/**
 * One world column of credits. Each section is typeset into a short centred block (`centredBlock`), then the group
 * is parked at `index · pitch`. The camera frame looks at that block. Gold rules and a small role label fade in as
 * the credit reaches the hold; both are decorations (item −1), so QA reads only the real text.
 */
import { clamp01 } from '@reel/runtime';
import { defineLayout } from '../../../contract.ts';
import { safeFit } from '../../../lib/rowset.ts';
import { centredBlock, extent } from '../../../lib/scroll.ts';
import { meta } from './meta.ts';

/** Role chip, [English, Hebrew]. Empty skips the chip (the end card is the logos). */
const ROLES: Record<string, [string, string]> = {
  title: ['TITLE', 'כותרת'],
  tagline: ['TAGLINE', 'שורה'],
  body: ['NOTE', 'הערה'],
  teaser: ['TEASER', 'טיזר'],
  cta: ['NEXT', 'המשך'],
  heading: ['HEADING', 'כותרת'],
  question: ['QUESTION', 'שאלה'],
  answer: ['ANSWER', 'תשובה'],
  quote: ['QUOTE', 'ציטוט'],
  datetime: ['WHEN', 'מתי'],
  location: ['WHERE', 'איפה'],
  list: ['LIST', 'רשימה'],
  stat: ['STAT', 'נתון'],
  countdown: ['COUNT', 'ספירה'],
  endcard: ['', ''],
};

interface Col {
  gone: number;
  fade: number;
}

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const { safe, H } = host;
    const box = safeFit(host);
    const band = Math.min(box.y1 - box.y0, params.share * H);
    const fit = { x0: box.x0, x1: box.x1, y0: safe.cy - band / 2, y1: safe.cy + band / 2 };
    const pitch = params.pitch * H;
    const cap = Math.min(params.cap * (fit.x1 - fit.x0), 0.42 * band);
    layer.sections.forEach((s, i) => {
      const { rows, size } = centredBlock(host, s, fit, { cap, plain: params.plain, leading: params.leading, wt: 650 });
      const y = i * pitch;
      s.place = { x: 0, y, rot: 0 };
      s.frame = { x: safe.cx, y: safe.cy + y, r: 0, s: 1 };
      const b = s.bounds;
      if (b) s.bounds = { x0: b.x0, y0: b.y0 + y, x1: b.x1, y1: b.y1 + y };
      s.data.layout = { gone: params.gone * H, fade: params.fade * H } satisfies Col;
      if (!rows.length) return;
      const e = extent(rows);
      const rw = Math.max(28, Math.round((e.x1 - e.x0) * 0.62));
      const rh = Math.max(2, Math.round(size * 0.035));
      const rx = Math.round((e.x0 + e.x1) / 2 - rw / 2);
      const gap = Math.round(size * 0.18);
      for (const yy of [Math.round(e.y0 - gap - rh), Math.round(e.y1 + gap)]) {
        host.deco(s, {
          deco: 'rule',
          box: { x: rx, y: yy, w: rw, h: rh },
          style: { background: host.accent(0, s), 'border-radius': '2px' },
          z: 2,
        });
      }
      const pair = ROLES[s.role];
      const label = pair ? (host.dir === 'rtl' ? pair[1] : pair[0]) : '';
      const S = Math.max(13, Math.round(size * 0.26));
      if (!label) return;
      const m = host.metrics(label, 500, host.dir === 'ltr');
      const w = Math.ceil((m.bl + m.br) * S + 2);
      const h = Math.ceil((m.ia + m.id) * S + 2);
      const x = Math.round((e.x0 + e.x1) / 2 - w / 2);
      const y0 = Math.round(e.y0 - gap - rh - 0.4 * S - h);
      // Group y matches the screen while this credit is held, so the safe top is the right test.
      if (y0 <= safe.top + 4 || x < safe.left || x + w > safe.left + safe.w) return;
      host.deco(s, {
        deco: 'role',
        text: label,
        ltr: host.dir === 'ltr',
        font: { family: 'display', size: S, weight: 500 },
        box: { x, y: y0, w, h },
        textAt: { x: 0, y: 0 },
        color: host.accent(1, s),
        z: 3,
      });
    });
  },
  /** Hide every credit that is not near the camera. Rules and the role chip also wait for the hold. */
  frame({ layer }, t) {
    const viewY = layer.view.y;
    for (const s of layer.sections) {
      const d = s.data.layout as Col;
      const dist = Math.abs(s.frame.y - viewY);
      const vis = clamp01((d.gone - dist) / Math.max(1, d.fade));
      const lock = clamp01((t - (s.timing.holdStart - 0.18)) / 0.18);
      for (const u of s.units) {
        const k = u.deco === 'rule' || u.deco === 'role' ? vis * lock : vis;
        u.ch.opacity *= k;
        u.ch.visible &&= k > 0.004;
      }
    }
  },
});
