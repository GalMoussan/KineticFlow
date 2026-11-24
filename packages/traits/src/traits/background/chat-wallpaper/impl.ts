import { defineBackground } from '../../../contract.ts';
import { chatColours } from '../../../lib/chat.ts';
import { rgba } from '../../../lib/neon.ts';
import { meta } from './meta.ts';

/** One doodle tile (100 × 100 user units): bubble, heart, star, squiggle, dots, stroked in `c`. */
const tile = (c: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">` +
  '<path d="M10 14h22a6 6 0 0 1 6 6v8a6 6 0 0 1-6 6h-14l-6 5v-5h-2a6 6 0 0 1-6-6v-8a6 6 0 0 1 6-6z"/>' +
  '<path d="M70 22c-3-5-11-4-11 3 0 6 11 11 11 11s11-5 11-11c0-7-8-8-11-3z"/>' +
  '<path d="M26 66l3.5 7 7.5 1-5.5 5 1.5 7.5-7-3.8-7 3.8 1.5-7.5-5.5-5 7.5-1z"/>' +
  '<path d="M56 74c5-8 10 8 15 0s10 8 15 0"/>' +
  '<circle cx="84" cy="52" r="2.5"/><circle cx="48" cy="48" r="4"/><path d="M8 50h8M12 46v8"/></svg>';

export default defineBackground({
  meta,
  setup({ host, layer, params }) {
    const { bg, text } = layer.palette;
    const C = chatColours(host, layer);
    const tileUrl = `url("data:image/svg+xml,${encodeURIComponent(tile(rgba(text, 0.07 * params.doodles)))}")`;
    const size = Math.round(Math.min(host.W, host.H) * 0.24);
    host.el('div', 'chat-wall', layer.under, {
      background: params.doodles > 0 ? `${tileUrl} 0 0 / ${size}px ${size}px repeat, ${bg}` : bg,
    });
    const sf = host.safe;
    // old messages fade out under the top margin
    host.el('div', 'chat-fade', layer.over, {
      top: '0px',
      height: `${Math.round(sf.top + 0.04 * host.H)}px`,
      background: `linear-gradient(${bg} 0%, ${bg} 55%, ${rgba(bg, 0)} 100%)`,
    });
    if (!params.footer) return;
    const bottomGap = host.H - (sf.top + sf.h);
    const h = Math.round(Math.min(0.075 * Math.min(host.W, host.H), bottomGap * 0.42));
    if (h < 24) return;
    const y = Math.round(sf.top + sf.h + Math.min(bottomGap * 0.18, 0.4 * h));
    const x0 = Math.round(sf.left);
    const x1 = Math.round(sf.left + sf.w);
    const rtl = host.dir === 'rtl';
    host.el('div', 'chat-footer', layer.over, {
      top: `${y - Math.round(0.25 * h)}px`,
      height: `${host.H - y + Math.round(0.25 * h)}px`,
      background: C.footer,
    });
    const btn = h;
    const fieldX = rtl ? x0 + btn + Math.round(0.2 * h) : x0;
    const fieldW = x1 - x0 - btn - Math.round(0.2 * h);
    host.el('div', 'chat-field', layer.over, {
      left: `${fieldX}px`, top: `${y}px`, width: `${fieldW}px`, height: `${h}px`,
      background: C.field, 'border-radius': `${h / 2}px`,
    });
    const send = host.el('div', 'chat-send', layer.over, {
      left: `${rtl ? x0 : x1 - btn}px`, top: `${y}px`, width: `${btn}px`, height: `${btn}px`,
      background: C.fill('out'), 'border-radius': '50%',
    });
    const s = Math.round(btn * 0.5);
    send.innerHTML =
      `<svg width="${s}" height="${s}" viewBox="0 0 24 24" style="position:absolute;left:${(btn - s) / 2}px;top:${(btn - s) / 2}px;${rtl ? 'transform:scaleX(-1)' : ''}">` +
      `<path d="M3 11.5 21 3l-6.5 18-3-7.5z" fill="${C.text('out')}"/></svg>`;
  },
});
