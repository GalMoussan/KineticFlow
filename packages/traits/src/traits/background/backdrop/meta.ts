import { defineMeta } from '../../../contract.ts';

/**
 * Studio backdrop for planar-3D styles: the palette background (or a table tone mixed towards the text colour) lit
 * by a soft spotlight, a floor glow, an optional isometric floor grid aligned with the layer's 3D camera, and a
 * vignette. Static (drawn once); in its layer's incoming window it stays hidden when `seam` is on, so the outgoing
 * layer's identical backdrop carries on under both layers during spatial hand-offs.
 */
export const meta = defineMeta({
  id: 'backdrop',
  axis: 'background',
  layer: 'dom',
  label: 'Studio backdrop',
  params: {
    light: { min: 0, max: 1, default: 0.5, label: 'Spotlight strength' },
    floor: { min: 0, max: 1, default: 0.4, label: 'Floor glow strength' },
    grid: { min: 0, max: 1, default: 0, label: 'Floor grid opacity (0 = none)' },
    table: { min: 0, max: 1, default: 0, label: 'Table tone: background mixed towards the text colour' },
    vignette: { min: 0, max: 1, default: 0.5, label: 'Vignette strength' },
    seam: { min: 0, max: 1, default: 1, label: 'Hidden during the incoming window (1) or always shown (0)' },
  },
});
