import { defineMeta } from '../../../contract.ts';

/**
 * One world: a seeded walk of street intersections, one card per section. The location section (or the last section
 * when the reel has no location) is the venue — its pin tip sits on the route vertex and the camera frames the pin
 * together with the card. Card size comes from the safe area only, so a date edit cannot move the streets.
 */
export const meta = defineMeta({
  id: 'map-route',
  axis: 'layout',
  layer: 'dom',
  label: 'Map route',
  world: true,
  requires: { camera: ['pan-turn'] },
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {},
});
