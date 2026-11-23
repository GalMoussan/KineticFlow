// bidi-js ships CJS typings, so NodeNext types the namespace's `default` as the whole module; both its ESM build
// (bundled by esbuild) and its CJS build (Node) expose the factory there.
import * as bidiModule from 'bidi-js';
import type { Bidi } from 'bidi-js';

/** The shared bidi-js instance (UAX #9). Pure, so it runs in Node and in the page alike. */
export const bidi = (bidiModule.default as unknown as () => Bidi)();

/** Bidi classes that decide where a piece sits: strong letters and numbers. Neutrals (punctuation, spaces) follow
 * the paragraph or their neighbours, so a trailing comma in an RTL line can jump to the far left. */
const ANCHOR: Record<string, true> = { L: true, R: true, AL: true, EN: true, AN: true };

/**
 * Left-to-right placement order of the pieces of one line, as the Unicode bidi algorithm lays out their texts joined
 * by spaces in a paragraph of direction `dir`. Returns indices into `texts`. A run of LTR pieces inside an RTL line
 * (`ערב Open Mic 2026`) keeps its left-to-right order: `[1, 2, 3, 0]`. A piece with no text of its own (an icon) can
 * pass `\u200F` (RLM) or `\u200E` (LRM) to act as a strong character of that direction.
 */
export function visualOrder(texts: readonly string[], dir: 'rtl' | 'ltr'): number[] {
  const starts: number[] = [];
  let line = '';
  texts.forEach((t, i) => {
    if (i) line += ' ';
    starts.push(line.length);
    line += t;
  });
  const visual = bidi.getReorderedIndices(line, bidi.getEmbeddingLevels(line, dir));
  const pos = new Int32Array(line.length);
  visual.forEach((logical, x) => (pos[logical] = x));
  // A piece sits where its leftmost strong character (letter or digit) lands; its neutrals are ignored unless it has
  // nothing else (`HaChan,` in an RTL line: the comma moves to the far left, the word does not).
  const left = texts.map((t, i) => {
    let strong = Infinity;
    let any = Infinity;
    for (let c = starts[i]!; c < starts[i]! + t.length; c++) {
      any = Math.min(any, pos[c]!);
      if (ANCHOR[bidi.getBidiCharTypeName(line[c]!)]) strong = Math.min(strong, pos[c]!);
    }
    const m = strong !== Infinity ? strong : any;
    return m === Infinity ? (starts[i]! < line.length ? pos[starts[i]!]! : line.length) : m;
  });
  return texts.map((_, i) => i).sort((a, b) => left[a]! - left[b]! || a - b);
}
