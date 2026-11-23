import { defineUnit } from '../../../contract.ts';
import { meta } from './meta.ts';

export default defineUnit({
  meta,
  prepare(_c, u) {
    if (u.text) u.split = 'grapheme';
  },
});
