import { defineMeta } from '../../../contract.ts';

/**
 * A café menu board: slate in the palette background with eraser smudges, old chalk ghosts and dust (a canvas drawn
 * once and frozen), a wooden frame around the whole picture in the palette's wood accent (accent 3) with grain and
 * corner joints, and a chalk-dust tray along the bottom rail. Static: nothing moves per frame.
 */
export const meta = defineMeta({
  id: 'chalkboard',
  axis: 'background',
  layer: 'canvas',
  label: 'Chalkboard + wood frame',
  params: {
    smudge: { min: 0, max: 1, default: 0.7, label: 'Eraser smudges and chalk ghosts' },
    dust: { min: 0, max: 0.3, default: 0.12, label: 'Chalk dust specks' },
    frame: { min: 0, max: 0.06, default: 0.028, label: 'Wood frame width (× short frame side; 0 = none)' },
  },
});
