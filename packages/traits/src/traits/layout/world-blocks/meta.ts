import { defineMeta } from '../../../contract.ts';

/** Each section is a justified block placed in one large world, rotated per block (kinetic quote typography). */
export const meta = defineMeta({
  id: 'world-blocks',
  axis: 'layout',
  layer: 'dom',
  label: 'Justified blocks in a world',
  world: true,
  requires: { camera: ['pan-turn'] },
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    lead: { min: 0, max: 80, default: 30, label: 'Leading between lines (world px)' },
    accentRatio: { min: 1, max: 3, default: 1.35, label: 'Lone word → accent line above × median size' },
  },
});
