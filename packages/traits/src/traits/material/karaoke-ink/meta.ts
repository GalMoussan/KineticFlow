import { defineMeta } from '../../../contract.ts';

/**
 * Karaoke inks: every content word is drawn twice, a dim "unsung" copy (the text colour sunk `dim` of the way into
 * the background) under the "sung" word itself (first accent; emphasis, hero and numbers in the third). The reveal
 * sweeps the sung word open while the copy is clipped to the rest (they never overlap); the copy follows every
 * other move of its word.
 */
export const meta = defineMeta({
  id: 'karaoke-ink',
  axis: 'material',
  layer: 'dom',
  label: 'Karaoke inks (unsung copy + sung colour)',
  params: {
    dim: { min: 0.2, max: 0.85, default: 0.58, label: 'Unsung dimming (share of the way to the background)' },
  },
});
