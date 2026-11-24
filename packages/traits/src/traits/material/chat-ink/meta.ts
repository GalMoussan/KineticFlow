import { defineMeta } from '../../../contract.ts';

/**
 * Messenger colours: bubble fills per speaker (accent 0 outgoing, accent 3 incoming), text in the more legible ink
 * on each fill, emphasis in the side's accent with a soft highlight pill that draws on the word's own landing,
 * muted stamps, read ticks lighting up when the other side answers.
 */
export const meta = defineMeta({
  id: 'chat-ink',
  axis: 'material',
  layer: 'dom',
  label: 'Chat ink',
  requires: { layout: ['chat-thread'] },
  params: {
    highlight: { min: 0, max: 1, default: 1, label: 'Highlight pills behind emphasis (0 = off)' },
  },
});
