/**
 * Measured-absolute unit splitting (spike M0c, `spikes/results/text.md` §5): the browser lays out the unsplit text,
 * every unit's rect is read with `Range.getBoundingClientRect`, then the content is replaced by one absolutely
 * positioned span per unit anchored at its logical start edge. This keeps kerning, niqqud and bidi order exactly
 * as in the unsplit line (≤ 0.84 % ink diff, 0 px shift). Never split into naive inline-block spans.
 */
import { bidi } from './bidi.ts';

export type Granularity = 'grapheme' | 'word';

export interface MeasuredUnit {
  /** Logical index (sequential reveals use this order; spatial sweeps sort by `x`). */
  index: number;
  /** UTF-16 offsets into the element's text. */
  start: number;
  end: number;
  text: string;
  /** UBA embedding level of the unit's first code unit; odd = RTL. */
  level: number;
  dir: 'rtl' | 'ltr';
  /** False for whitespace (and, at word granularity, punctuation-only segments). */
  wordLike: boolean;
  span: HTMLSpanElement;
  /** Measured rect relative to the element's border box, in untransformed CSS px. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Splits the text of `el` (already styled and attached, with no transformed ancestors) into units. `el` keeps its
 * measured size; afterwards its children are the unit spans (`position:absolute; white-space:pre`, `dir` set).
 * Text inside nested inline elements keeps that element's `className` on its spans.
 */
export function splitMeasured(el: HTMLElement, granularity: Granularity): MeasuredUnit[] {
  const pieces: { node: Text; start: number }[] = [];
  let text = '';
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    pieces.push({ node: n as Text, start: text.length });
    text += (n as Text).data;
  }

  const box = el.getBoundingClientRect();
  if (Math.abs(box.width - el.offsetWidth) > 0.5 || Math.abs(box.height - el.offsetHeight) > 0.5) {
    throw new Error('splitMeasured: the element is transformed; split before applying transforms');
  }
  const cs = getComputedStyle(el);
  const direction = cs.direction === 'rtl' ? 'rtl' : 'ltr';
  if (cs.position === 'static') el.style.position = 'relative';

  // Offset → (text node, local offset); ends prefer the earlier node so a range never starts a node late.
  const locate = (offset: number, isEnd: boolean) => {
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i]!;
      if (isEnd ? offset > p.start : offset >= p.start) return { piece: p, off: offset - p.start };
    }
    return { piece: pieces[0]!, off: 0 };
  };

  const levels = bidi.getEmbeddingLevels(text, direction).levels;
  const segmenter = new Intl.Segmenter(document.documentElement.lang || undefined, { granularity });
  const range = document.createRange();
  const measured = [...segmenter.segment(text)].map((s, index) => {
    const a = locate(s.index, false);
    const b = locate(s.index + s.segment.length, true);
    range.setStart(a.piece.node, a.off);
    range.setEnd(b.piece.node, b.off);
    const level = levels[s.index] ?? 0;
    return {
      index,
      start: s.index,
      end: s.index + s.segment.length,
      text: s.segment,
      level,
      dir: (level & 1 ? 'rtl' : 'ltr') as 'rtl' | 'ltr',
      wordLike: granularity === 'grapheme' ? !/^\s+$/u.test(s.segment) : !!s.isWordLike,
      cls: a.piece.node.parentElement !== el ? (a.piece.node.parentElement?.className ?? '') : '',
      r: range.getBoundingClientRect(),
    };
  });

  // Padding box of `el`: the containing block of the absolute spans.
  const px = (v: string) => parseFloat(v) || 0;
  const padLeft = box.left + px(cs.borderLeftWidth);
  const padRight = box.right - px(cs.borderRightWidth);
  const padTop = px(cs.paddingTop);
  const firstTop = measured[0]?.r.top ?? box.top;
  // Lock the measured size: the absolute spans no longer give `el` any intrinsic size.
  const inset = (a: string, b: string, c: string, d: string) => px(a) + px(b) + px(c) + px(d);
  const contentBox = cs.boxSizing !== 'border-box';
  el.style.width = `${box.width - (contentBox ? inset(cs.borderLeftWidth, cs.borderRightWidth, cs.paddingLeft, cs.paddingRight) : 0)}px`;
  el.style.height = `${box.height - (contentBox ? inset(cs.borderTopWidth, cs.borderBottomWidth, cs.paddingTop, cs.paddingBottom) : 0)}px`;

  const units: MeasuredUnit[] = measured.map((m) => {
    const span = document.createElement('span');
    if (m.cls) span.className = m.cls;
    span.textContent = m.text;
    span.dir = m.dir;
    const st = span.style;
    st.position = 'absolute';
    st.whiteSpace = 'pre';
    const dy = m.r.top - firstTop;
    st.top = `${padTop + (Math.abs(dy) < 0.5 ? 0 : dy)}px`;
    // Anchor at the logical start edge: right for RTL units, left for LTR.
    if (m.level & 1) st.right = `${padRight - m.r.right}px`;
    else st.left = `${m.r.left - padLeft}px`;
    return {
      index: m.index,
      start: m.start,
      end: m.end,
      text: m.text,
      level: m.level,
      dir: m.dir,
      wordLike: m.wordLike,
      span,
      x: m.r.left - box.left,
      y: m.r.top - box.top,
      w: m.r.width,
      h: m.r.height,
    };
  });
  el.replaceChildren(...units.map((u) => u.span));
  return units;
}
