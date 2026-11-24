import { defineMeta } from '../../../contract.ts';

/**
 * Letter tiles of a `tile-board`. Each grapheme's tile is an idle mosaic cell until it flips (the box narrows to
 * nothing and opens onto the letter face; the glyph stays hidden until the face is nearly flat). Tiles live in the
 * section group, behind the text, so hiding a glyph does not hide its tile. After the flip the letter face stays
 * put — ripples keep moving only the idle cells.
 */
export const meta = defineMeta({
  id: 'tile-flip',
  axis: 'reveal',
  layer: 'dom',
  label: 'Tile flip',
  needs: { chars: true },
  requires: { layout: ['tile-board'] },
  params: {
    /** How flat (width factor) the letter face must be before the glyph shows. */
    flat: { min: 0.7, max: 0.98, default: 0.86, label: 'Glyph shows once the face is this open' },
  },
});
