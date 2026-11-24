import { defineMeta } from '../../../contract.ts';

/**
 * A messenger's scroll: the camera only moves up and down the thread, easing to each scroll stop the layout sets
 * (typing indicator, then every new bubble's bottom on the anchor line). No zoom, no roll.
 */
export const meta = defineMeta({
  id: 'chat-scroll',
  axis: 'camera',
  layer: 'dom',
  label: 'Chat scroll',
  world: true,
  requires: { layout: ['chat-thread'] },
  params: {},
});
