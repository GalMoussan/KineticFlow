import { defineMeta } from '../../../contract.ts';

/**
 * Die-cut stickers: every word filled in the next palette accent with a thick rim in the palette's text colour
 * (a ring of `shadow` offsets) and a hard drop shadow (the background darkened), tilted by the layout's
 * `data.layout.tilt` when it gives one.
 */
export const meta = defineMeta({
  id: 'sticker',
  axis: 'material',
  layer: 'dom',
  label: 'Sticker (rim + drop shadow)',
  params: {
    rim: { min: 0, max: 0.2, default: 0.075, label: 'Rim width (em)' },
    drop: { min: 0, max: 0.2, default: 0.07, label: 'Drop shadow offset (em)' },
  },
});
