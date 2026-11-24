/**
 * Horizontal hold copy in the centre, two deco bands behind a background-coloured plate.
 * The phrase is this section's own text in logical order (the browser bidi's it once). A logo card with no
 * words gets solid bars. Scroll numbers live on the deco units; the reveal recomputes the same `bandTimes`.
 */
import { defineLayout, type Host, type Section } from '../../../contract.ts';
import { inkOn, safeFit } from '../../../lib/rowset.ts';
import { bandTimes, centerPhrase, centredBlock, easeOut3, smoothstep, span01 } from '../../../lib/scroll.ts';
import { meta } from './meta.ts';

interface Band {
  kind: 'band';
  start: number;
  stop: number;
  sign: number;
  angle: number;
  scroll0: number;
  scroll1: number;
}

interface Plate {
  kind: 'plate';
  fade0: number;
  fade1: number;
}

const ANGLES = [22, -16];

function phraseOf(s: Section): string {
  return s.units
    .filter((u) => u.item >= 0 && u.text)
    .map((u) => u.text)
    .join('   ');
}

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const { safe, W, H } = host;
    const box = safeFit(host);
    const plateW = Math.round(params.plate * safe.w);
    const plateH = Math.round(Math.min(0.56 * safe.h, 0.72 * (box.y1 - box.y0)));
    const plateX = Math.round(safe.cx - plateW / 2);
    const plateY = Math.round(safe.cy - plateH / 2);
    const pad = Math.round(0.05 * Math.min(plateW, plateH));
    const fit = { x0: plateX + pad, y0: plateY + pad, x1: plateX + plateW - pad, y1: plateY + plateH - pad };
    const diag = Math.hypot(W, H);
    const bandW = Math.round(diag * 1.25);
    const bandH = Math.max(28, Math.round(0.062 * Math.min(W, H)));
    for (const s of layer.sections) {
      const cap = Math.min(params.cap * (fit.x1 - fit.x0), 0.7 * (fit.y1 - fit.y0));
      centredBlock(host, s, fit, { cap, plain: params.plain, leading: params.leading });
      for (const u of s.units) if (u.item >= 0) u.z = 2;
      const times = bandTimes(s.timing.in, s.timing.holdStart, s.window);
      const plate = host.deco(s, {
        deco: 'plate',
        box: { x: plateX, y: plateY, w: plateW, h: plateH },
        style: { background: s.palette.bg, 'border-radius': '18px' },
        z: 1,
      });
      plate.data.layout = { kind: 'plate', fade0: times.fade0, fade1: times.fade1 } satisfies Plate;
      placeBands(host, s, bandW, bandH, times);
    }
  },
  frame({ host, layer }, t) {
    const fly = 0.18 * host.H;
    for (const s of layer.sections) {
      const out = s.timing.out;
      const leave = smoothstep(span01(t, out, out + 0.4));
      for (const u of s.units) {
        const d = u.data.layout as Band | Plate | undefined;
        if (!d) continue;
        if (d.kind === 'plate') {
          const fade = smoothstep(span01(t, d.fade0, d.fade1));
          u.ch.opacity *= t >= out ? fade * (1 - leave) : fade;
          u.ch.visible &&= u.ch.opacity > 0.004;
          continue;
        }
        const k = easeOut3(span01(t, d.scroll0, d.scroll1));
        u.ch.itx += Math.round(d.start + (d.stop - d.start) * k);
        u.ch.rot += d.angle;
        const slide = t >= out ? fly + leave * 0.22 * host.H : fly * smoothstep(span01(t, d.scroll1 - 0.32, d.scroll1));
        u.ch.ty += Math.round(d.sign * slide);
        if (t >= out) u.ch.opacity *= 1 - leave;
      }
    }
  },
});

function placeBands(
  host: Host,
  s: Section,
  bandW: number,
  bandH: number,
  times: { scroll0: number; scroll1: number },
): void {
  const { safe, H } = host;
  const phrase = phraseOf(s);
  const ltr = host.dir === 'ltr';
  ANGLES.forEach((angle, i) => {
    const accent = host.accent(i, s);
    const y = Math.round(safe.cy + (i === 0 ? 0.04 : -0.04) * H - bandH / 2);
    const x = Math.round(safe.cx - bandW / 2);
    const sign = i === 0 ? -1 : 1;
    let start = 0;
    let stop = 0;
    let text = '';
    let fontSize = 0;
    let ink = s.palette.bg;
    if (phrase) {
      fontSize = Math.max(16, Math.round(bandH * 0.62));
      const gap = '    ';
      const pm = host.metrics(phrase, 700, ltr);
      const gm = host.metrics(gap, 700, ltr);
      const phraseW = Math.max(1, (pm.bl + pm.br) * fontSize);
      const stride = phraseW + Math.max(8, (gm.bl + gm.br) * fontSize);
      const copies = Math.ceil((bandW * 2 + stride) / stride) + 2;
      text = Array.from({ length: copies }, () => phrase).join(gap);
      stop = centerPhrase(phraseW, stride, bandW, 1);
      start = stop + sign * bandW;
      ink = inkOn(s, accent);
    }
    const band = host.deco(s, {
      deco: 'band',
      text,
      ltr,
      masked: true,
      font: { family: 'display', size: fontSize, weight: 700 },
      box: { x, y, w: bandW, h: bandH },
      textAt: { x: 0, y: fontSize ? Math.round((bandH - fontSize) * 0.18) : 0 },
      color: ink,
      origin: '50% 50%',
      style: { background: accent, 'border-radius': `${Math.round(bandH / 2)}px` },
      z: 0,
    });
    band.data.layout = {
      kind: 'band',
      start,
      stop,
      sign,
      angle,
      scroll0: times.scroll0,
      scroll1: times.scroll1,
    } satisfies Band;
  });
}
