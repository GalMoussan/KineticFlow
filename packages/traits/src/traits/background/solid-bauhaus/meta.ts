import { defineMeta } from '../../../contract.ts';

/**
 * One solid panel per scene layer (dark base for title and end card, then the light base and the accents in turn;
 * see `lib/bauhaus.ts` `panelColor`) with Bauhaus shapes in the free space around the text: half-discs on the frame
 * edges, big corner circles, rings, stripe blocks, a top-view coffee cup and dots. They pop in after the section
 * lands and pulse on the beat (`section.pulse`).
 */
export const meta = defineMeta({
  id: 'solid-bauhaus',
  axis: 'background',
  layer: 'dom',
  label: 'Solid panels + Bauhaus shapes',
  params: {
    shapes: { min: 0, max: 1, default: 1, label: 'Shape density (0 = plain panels)' },
    pulse: { min: 0, max: 3, default: 1, label: 'Beat pulse of the shapes (× default)' },
  },
});
