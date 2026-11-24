import { defineMeta } from '../../../contract.ts';

/**
 * Ink for type printed on coloured surfaces (block faces, cards): the layout records each text unit's surface colour
 * (`unit.data.layout.surface`); plain words take the palette text colour or white, whichever reads better, and the
 * hero, emphasis and numbers take the palette accent with the best contrast on that surface (≥ `min`:1, else ink).
 * An optional printed shadow lifts the letters off the surface.
 */
export const meta = defineMeta({
  id: 'face-ink',
  axis: 'material',
  layer: 'dom',
  label: 'Face ink',
  params: {
    min: { min: 1, max: 7, default: 3.2, label: 'Least contrast for an accent on its surface' },
    shadow: { min: 0, max: 0.1, default: 0.025, label: 'Printed shadow offset (em, 0 = none)' },
  },
});
