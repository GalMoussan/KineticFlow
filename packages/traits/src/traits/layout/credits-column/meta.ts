import { defineMeta } from '../../../contract.ts';

/**
 * Film-credit column (credits-roll): every section is one centred block in a single world column, one fixed pitch
 * apart (the pitch does not depend on the text, so a date edit cannot move the other blocks). `credits-dolly`
 * rolls the column; neighbours farther than `gone` are fully hidden, so a hold shows only the centred credit.
 */
export const meta = defineMeta({
  id: 'credits-column',
  axis: 'layout',
  layer: 'dom',
  label: 'Credits column',
  world: true,
  requires: { camera: ['credits-dolly'], reveal: ['credit-hold'] },
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    pitch: { min: 0.75, max: 1.4, default: 0.92, label: 'Distance between credits (× frame height)' },
    share: { min: 0.22, max: 0.7, default: 0.4, label: 'Block height (× frame height)' },
    gone: { min: 0.5, max: 1.2, default: 0.78, label: 'Neighbour fully hidden past this (× frame height)' },
    fade: { min: 0.04, max: 0.4, default: 0.12, label: 'Neighbour fade band (× frame height)' },
    cap: { min: 0.15, max: 0.6, default: 0.34, label: 'Largest emphasis size (× column width)' },
    plain: { min: 0.3, max: 1, default: 0.66, label: 'Plain word size (× emphasis size)' },
    leading: { min: 0.05, max: 1, default: 0.22, label: 'Gap between rows (em of the rows)' },
  },
});
