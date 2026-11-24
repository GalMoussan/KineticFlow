import { defineMeta } from '../../../contract.ts';

/**
 * A messenger thread (chat-bubbles): every section is a message bubble from one of two speakers, list items a burst
 * of bubbles, the date a centred day chip, the location a map message, the end card a contact card. All sections
 * stack in one world that `camera: chat-scroll` scrolls up as new bubbles arrive.
 */
export const meta = defineMeta({
  id: 'chat-thread',
  axis: 'layout',
  layer: 'dom',
  label: 'Messenger thread',
  world: true,
  requires: { camera: ['chat-scroll'] },
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    size: { min: 0.04, max: 0.1, default: 0.07, label: 'Message text size (× column width)' },
    width: { min: 0.5, max: 0.95, default: 0.8, label: 'Widest bubble (× column)' },
    column: { min: 0.8, max: 2, default: 1.3, label: 'Widest column (× safe height)' },
    avatars: { min: 0, max: 1, default: 1, label: 'Logo avatar beside incoming bubbles (0 = off)' },
  },
});
