import { defineMaterial } from '../../../contract.ts';
import { meta } from './meta.ts';

export default defineMaterial({
  meta,
  prepare({ host, section }, u) {
    if (u.item < 0) return; // decorations are coloured by their creators
    const ink = (u.data.layout as { ink?: string } | undefined)?.ink;
    u.color =
      ink ??
      (u.tags.hero
        ? host.accent(0, section)
        : u.tags.ordinal >= 0
          ? host.accent(u.tags.ordinal % 2, section)
          : u.tags.numeric
            ? host.accent(1, section)
            : section.palette.text);
  },
});
