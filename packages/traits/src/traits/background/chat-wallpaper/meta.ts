import { defineMeta } from '../../../contract.ts';

/**
 * A messenger's wallpaper (chat-bubbles): the palette background with a faint static doodle tile, a fade at the top
 * where old messages scroll away, and the input bar (field + send button) below the thread. All static CSS set once.
 */
export const meta = defineMeta({
  id: 'chat-wallpaper',
  axis: 'background',
  layer: 'dom',
  label: 'Chat wallpaper',
  params: {
    doodles: { min: 0, max: 1, default: 1, label: 'Doodle tile strength (0 = none)' },
    footer: { min: 0, max: 1, default: 1, label: 'Input bar below the thread (0 = off)' },
  },
});
