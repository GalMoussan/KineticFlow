import { defineMeta } from '../../../contract.ts';

/**
 * Extruded type: bold palette fills (text, hero and emphasis in accents) with a solid extrusion behind every glyph,
 * stacked `text-shadow` layers along the projected depth vector of the layer's 3D camera (oblique fallback without
 * one), shading darker towards the back, plus a soft contact shadow. Offsets are solved in each element's own
 * transformed coordinates, so the extrusion stays true while reveals and the camera turn the letters.
 */
export const meta = defineMeta({
  id: 'extrude',
  axis: 'material',
  layer: 'dom',
  label: 'Extrude',
  params: {
    depth: { min: 0.05, max: 1, default: 0.42, label: 'Extrusion depth (em)' },
    steps: { min: 4, max: 48, default: 28, label: 'Most shadow layers per glyph' },
    shade: { min: 0, max: 1, default: 0.6, label: 'Darkening towards the back' },
    soft: { min: 0, max: 1, default: 0.35, label: 'Contact shadow opacity' },
  },
});
