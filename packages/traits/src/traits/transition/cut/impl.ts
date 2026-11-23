import { defineTransition } from '../../../contract.ts';
import { meta } from './meta.ts';

export default defineTransition({
  meta,
  between(_c, w) {
    w.outgoing.ch.visible = false;
  },
});
