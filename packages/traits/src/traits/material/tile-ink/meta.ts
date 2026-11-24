import { defineMeta } from '../../../contract.ts';

/**
 * Flat fills that follow the layout: a unit sitting on a filled tile or panel takes the ink its layout chose for it
 * (`unit.data.layout.ink`, picked for contrast on that fill); elsewhere the hero and emphasis take palette accents
 * and everything else the text colour.
 */
export const meta = defineMeta({
  id: 'tile-ink',
  axis: 'material',
  layer: 'dom',
  label: 'Ink on tiles',
  params: {},
});
