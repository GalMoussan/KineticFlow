/**
 * Prototype of the runtime unit splitter: emphasis parsing, Intl.Segmenter units, bidi-js levels,
 * visual order, and the level tree used to emit `unicode-bidi: isolate` wrappers.
 * Pure; runs in Node and in the browser bundle.
 */
import bidiFactory from 'bidi-js';

const bidi = bidiFactory();

export type Granularity = 'grapheme' | 'word';

export interface Unit {
  index: number;
  start: number;
  end: number;
  text: string;
  em: boolean;
  /** UBA embedding level of the unit's first code unit. Odd = RTL. */
  level: number;
  wordLike: boolean;
}

export interface Analysis {
  text: string;
  dir: 'rtl' | 'ltr';
  paragraphLevel: number;
  levels: Uint8Array;
  emphasis: [number, number][];
  units: Unit[];
}

export function parseEmphasis(source: string): { text: string; emphasis: [number, number][] } {
  let text = '';
  const emphasis: [number, number][] = [];
  let last = 0;
  for (const m of source.matchAll(/\*([^*]+)\*/g)) {
    text += source.slice(last, m.index);
    emphasis.push([text.length, text.length + m[1].length]);
    text += m[1];
    last = m.index + m[0].length;
  }
  return { text: text + source.slice(last), emphasis };
}

export function analyzeLine(source: string, granularity: Granularity): Analysis {
  const { text, emphasis } = parseEmphasis(source);
  const lv = bidi.getEmbeddingLevels(text); // auto: first strong char (UBA P2/P3)
  const paragraphLevel: number = lv.paragraphs[0].level;
  const segmenter = new Intl.Segmenter('he', { granularity });
  const units: Unit[] = [];
  for (const s of segmenter.segment(text)) {
    units.push({
      index: units.length,
      start: s.index,
      end: s.index + s.segment.length,
      text: s.segment,
      em: emphasis.some(([a, b]) => s.index >= a && s.index < b),
      level: lv.levels[s.index],
      wordLike: granularity === 'grapheme' ? !/^\s+$/.test(s.segment) : !!s.isWordLike,
    });
  }
  return { text, dir: paragraphLevel & 1 ? 'rtl' : 'ltr', paragraphLevel, levels: lv.levels, emphasis, units };
}

/** Unit indices in visual order, left to right (UBA L2 via bidi-js). */
export function visualOrder(a: Analysis): number[] {
  const charToUnit = new Int32Array(a.text.length);
  for (const u of a.units) charToUnit.fill(u.index, u.start, u.end);
  const lv = { levels: a.levels, paragraphs: [{ start: 0, end: a.text.length - 1, level: a.paragraphLevel }] };
  const visual: number[] = bidi.getReorderedIndices(a.text, lv);
  const firstPos = new Array<number>(a.units.length).fill(Infinity);
  visual.forEach((ci, pos) => {
    const u = charToUnit[ci];
    if (pos < firstPos[u]) firstPos[u] = pos;
  });
  return a.units.map((u) => u.index).sort((x, y) => firstPos[x] - firstPos[y]);
}

/** Bidi-mirrored glyph for a char at an odd level (for renderers without native mirroring). */
export function mirrored(ch: string): string {
  return bidi.getMirroredCharacter(ch) ?? ch;
}

export interface LevelNode {
  level: number;
  children: (Unit | LevelNode)[];
}

/**
 * Nests units by embedding level: every maximal run with level > p becomes a child node at p + 1.
 * Emitting each node as `<span dir=… style="unicode-bidi:isolate">` with the units as atomic
 * inline-blocks (bidi neutrals) reproduces UBA L2 ordering in the browser.
 */
export function levelTree(a: Analysis): LevelNode {
  const build = (units: Unit[], p: number): LevelNode => {
    const node: LevelNode = { level: p, children: [] };
    for (let i = 0; i < units.length; ) {
      if (units[i].level <= p) {
        node.children.push(units[i++]);
        continue;
      }
      let j = i;
      while (j < units.length && units[j].level > p) j++;
      node.children.push(build(units.slice(i, j), p + 1));
      i = j;
    }
    return node;
  };
  return build(a.units, a.paragraphLevel);
}

export function isUnit(n: Unit | LevelNode): n is Unit {
  return 'text' in n;
}
