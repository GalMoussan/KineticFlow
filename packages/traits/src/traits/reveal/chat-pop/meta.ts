import { defineMeta } from '../../../contract.ts';

/**
 * Messages arrive whole: a typing indicator (three bouncing dots) on the next speaker's side, then the bubble pops
 * from its tail corner with everything in it (uniform scale, `motion.bounce`); the date chip drops in, numbers count
 * up. Sent / received pops pitched by side, light ticks for the typing dots, a stinger on the end card.
 */
export const meta = defineMeta({
  id: 'chat-pop',
  axis: 'reveal',
  layer: 'dom',
  label: 'Chat pop',
  requires: { layout: ['chat-thread'] },
  needs: { chars: true },
  params: {
    overshoot: { min: 0, max: 3, default: 1.5, label: 'Pop overshoot' },
    count: { min: 0.3, max: 2, default: 0.8, label: 'Count-up duration (s)' },
  },
});
