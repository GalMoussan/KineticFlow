import { defineCamera } from '../../../contract.ts';
import { meta } from './meta.ts';

export default defineCamera({
  meta,
  view: ({ host }) => ({ x: host.safe.cx, y: host.safe.cy, r: 0, s: 1 }),
});
