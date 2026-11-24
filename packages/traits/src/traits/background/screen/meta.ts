import { defineMeta } from '../../../contract.ts';

/**
 * A dark screen: the palette background with an optional accent bloom, vignette and fine grid behind the text, a
 * soft band rolling down the screen (rewritten from t every frame), and CRT scanlines over everything. DOM gradients
 * only (no canvas): the scanlines on top are a plain element, so nothing composites.
 */
export const meta = defineMeta({
  id: 'screen',
  axis: 'background',
  layer: 'dom',
  label: 'Screen (scanlines, grid, vignette)',
  params: {
    lines: { min: 0, max: 1, default: 0.5, label: 'Scanline strength over the frame (0 = none)' },
    vignette: { min: 0, max: 1, default: 0.6, label: 'Vignette strength' },
    bloom: { min: 0, max: 1, default: 0.3, label: 'Accent bloom behind the text' },
    grid: { min: 0, max: 1, default: 0, label: 'Grid line strength (0 = none)' },
    sweep: { min: 0, max: 1, default: 0.4, label: 'Rolling band strength (0 = none)' },
  },
});
