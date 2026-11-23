import { defineMeta } from '../../../contract.ts';

/**
 * Solid panels wipe the next layer in (dilemma-reel `reel12.js`): 1–2 accent panels lead, then the layer itself
 * (clip), while the outgoing content is pushed away and blurred. Geometry per section index (up · rtl · down · diag
 * · ltr · iris; the end card opens as doors; rtl/ltr mirror for LTR reels) or fixed by `geom`.
 */
export const meta = defineMeta({
  id: 'panel-wipe',
  axis: 'transition',
  layer: 'dom',
  label: 'Panel wipe',
  scope: 'layer',
  params: {
    geom: { min: 0, max: 7, default: 0, label: 'Geometry: 0 auto, 1 up, 2 down, 3 rtl, 4 ltr, 5 doors, 6 iris, 7 diag' },
    panels: { min: 0, max: 2, default: 2, label: 'Accent panels leading' },
    push: { min: 0, max: 0.5, default: 0.24, label: 'Outgoing push (× frame width)' },
    blur: { min: 0, max: 40, default: 14, label: 'Outgoing blur (px)' },
  },
});
