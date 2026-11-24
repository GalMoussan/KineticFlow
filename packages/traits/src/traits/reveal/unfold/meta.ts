import { defineMeta } from '../../../contract.ts';

/**
 * Words (and pins, badges) exist only while their panel is flat and not yet closing. The open finishes before
 * the hold, so the fidelity sample sees the real text. Ink is dark: the sheet is the palette's light text colour.
 */
export const meta = defineMeta({
  id: 'unfold',
  axis: 'reveal',
  layer: 'dom',
  label: 'Unfold',
  requires: { layout: ['paper-sheet'] },
  params: {
    swipe: { min: 0, max: 1, default: 0.4, label: 'Paper swipe as the panel opens' },
    lock: { min: 0, max: 1, default: 0.32, label: 'Soft pop when the panel locks flat' },
  },
});
