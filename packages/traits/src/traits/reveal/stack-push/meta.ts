import { defineMeta } from '../../../contract.ts';

/**
 * Stack and push (with `layout: list-stack`): each row rises into the bottom slot of the stack as it lands and pushes
 * every earlier row up by its own height, with a little overshoot, so the stack builds from the bottom; numerals
 * slam onto their tabs. Rows of other layouts simply rise in. A swipe per push, a pop per landing, pitch rising
 * through a list.
 */
export const meta = defineMeta({
  id: 'stack-push',
  axis: 'reveal',
  layer: 'dom',
  label: 'Stack push',
  params: {
    lead: { min: 0, max: 0.5, default: 0.14, label: 'Start before landing (s)' },
    duration: { min: 0.15, max: 1.2, default: 0.45, label: 'Push duration (s)' },
    overshoot: { min: 0, max: 3, default: 1.1, label: 'Push overshoot (back-out constant)' },
    slam: { min: 1, max: 3, default: 1.9, label: 'Numeral start scale' },
  },
});
