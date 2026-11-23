/** Browser page for the DOM splitting spike. Bundled by dom.ts; driven through `window.T.render`. */
import { FONTS, FONT_SIZE, LINES, type FontKey } from './strings.ts';
import { analyzeLine, isUnit, levelTree, visualOrder, type Analysis, type Granularity, type LevelNode, type Unit } from './units.ts';

/**
 * - plain:  unsplit text (emphasis as inline span), the reference
 * - inline: one `display:inline` span per unit (no transforms possible; kerning control)
 * - ib:     one `display:inline-block` span per unit, logical order, no bidi handling (naive)
 * - iso:    inline-block units nested in `unicode-bidi:isolate` spans built from bidi-js levels
 * - visual: inline-block units emitted in bidi-js visual order inside an LTR bidi-override line
 * - isok:   iso + per-unit `margin-inline-end` restoring the advance the unit had inside the shaped line
 * - abs:    unit positions measured on the unsplit text (Range rects), then absolutely positioned
 */
export type Variant = 'plain' | 'inline' | 'ib' | 'iso' | 'isok' | 'visual' | 'abs';

export interface UnitInfo {
  text: string;
  level: number;
  em: boolean;
  /** left, right, top, bottom in page px */
  rect: [number, number, number, number];
}

export interface RenderInfo {
  dir: 'rtl' | 'ltr';
  units: UnitInfo[];
  /** Unit indices sorted by rendered rect center, left to right. */
  order: number[];
  /** bidi-js visual order, left to right. */
  bidiOrder: number[];
}

export const STAGE = { width: 2600, height: 240, lineTop: 40, lineLeft: 40, lineHeight: 154 };

const css = `
${Object.values(FONTS)
  .map((f) => `@font-face{font-family:"${f.family}";src:url(/fonts/${f.file}) format("truetype");font-weight:100 900;font-display:block}`)
  .join('\n')}
html,body{margin:0;background:#fff}
#stage{position:absolute;left:0;top:0;width:${STAGE.width}px;height:${STAGE.height}px;background:#fff;overflow:hidden}
.line{position:absolute;left:${STAGE.lineLeft}px;top:${STAGE.lineTop}px;width:${STAGE.width - 2 * STAGE.lineLeft}px;height:${STAGE.lineHeight}px;
  font-size:${FONT_SIZE}px;line-height:${STAGE.lineHeight}px;white-space:pre;color:#000;font-weight:400;font-kerning:normal}
.u{display:inline-block}
.u.inl{display:inline}
.abs .u{position:absolute;top:0}
.em{font-weight:700}
`;

const style = document.createElement('style');
style.textContent = css;
document.head.append(style);
const stage = document.createElement('div');
stage.id = 'stage';
document.body.append(stage);

const span = (u: Unit, cls = 'u'): HTMLSpanElement => {
  const s = document.createElement('span');
  s.className = u.em ? `${cls} em` : cls;
  s.textContent = u.text;
  return s;
};
const dirOf = (level: number) => (level & 1 ? 'rtl' : 'ltr');

function lineEl(a: Analysis, font: FontKey): HTMLDivElement {
  stage.replaceChildren();
  const el = document.createElement('div');
  el.className = 'line';
  el.dir = a.dir;
  el.style.fontFamily = `"${FONTS[font].family}"`;
  el.style.textAlign = a.dir === 'rtl' ? 'right' : 'left';
  stage.append(el);
  return el;
}

/** Writes unsplit text; returns text pieces so text offsets can be mapped to DOM positions. */
function writePlain(el: HTMLElement, a: Analysis): { node: Text; start: number }[] {
  const cuts = [0, ...a.emphasis.flat(), a.text.length].filter((v, i, arr) => arr.indexOf(v) === i).sort((x, y) => x - y);
  const pieces: { node: Text; start: number }[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const node = document.createTextNode(a.text.slice(cuts[i], cuts[i + 1]));
    const em = a.emphasis.some(([s]) => s === cuts[i]);
    if (em) {
      const s = document.createElement('span');
      s.className = 'em';
      s.append(node);
      el.append(s);
    } else el.append(node);
    pieces.push({ node, start: cuts[i] });
  }
  return pieces;
}

function plainRects(a: Analysis, pieces: { node: Text; start: number }[]): DOMRect[] {
  const locate = (offset: number, isEnd: boolean) => {
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i];
      if (isEnd ? offset > p.start : offset >= p.start) return { node: p.node, off: offset - p.start };
    }
    throw new Error(`offset ${offset}`);
  };
  return a.units.map((u) => {
    const r = document.createRange();
    const s = locate(u.start, false), e = locate(u.end, true);
    r.setStart(s.node, s.off);
    r.setEnd(e.node, e.off);
    return r.getBoundingClientRect();
  });
}

function emitTree(parent: HTMLElement, node: LevelNode, spans: HTMLSpanElement[]): void {
  for (const c of node.children) {
    if (isUnit(c)) {
      parent.append((spans[c.index] = span(c)));
      continue;
    }
    const iso = document.createElement('span');
    iso.dir = dirOf(c.level);
    iso.style.unicodeBidi = 'isolate';
    parent.append(iso);
    emitTree(iso, c, spans);
  }
}

function render(lineId: string, font: FontKey, variant: Variant, gran: Granularity): RenderInfo {
  const line = LINES.find((l) => l.id === lineId);
  if (!line) throw new Error(`no line ${lineId}`);
  const a = analyzeLine(line.source, gran);
  const el = lineEl(a, font);
  let rects: DOMRect[];
  const spans: HTMLSpanElement[] = [];
  switch (variant) {
    case 'plain':
      rects = plainRects(a, writePlain(el, a));
      break;
    case 'inline':
    case 'ib':
      for (const u of a.units) el.append((spans[u.index] = span(u, variant === 'inline' ? 'u inl' : 'u')));
      break;
    case 'iso':
      emitTree(el, levelTree(a), spans);
      break;
    case 'visual':
      el.style.direction = 'ltr';
      el.style.unicodeBidi = 'bidi-override';
      for (const i of visualOrder(a)) {
        const s = (spans[i] = span(a.units[i]));
        s.dir = dirOf(a.units[i].level);
        el.append(s);
      }
      break;
    case 'isok': {
      // iso + kerning compensation: per-unit margin-inline-end = (advance inside the shaped line) − (isolated advance)
      const measured = plainRects(a, writePlain(el, a));
      el.replaceChildren();
      emitTree(el, levelTree(a), spans);
      const widths = spans.map((s) => s.getBoundingClientRect().width);
      spans.forEach((s, i) => {
        const delta = measured[i].width - widths[i];
        if (Math.abs(delta) > 0.01) s.style.marginInlineEnd = `${delta}px`;
        s.dir = dirOf(a.units[i].level);
      });
      break;
    }
    case 'abs': {
      const measured = plainRects(a, writePlain(el, a));
      const box = el.getBoundingClientRect();
      el.replaceChildren();
      el.classList.add('abs');
      for (const u of a.units) {
        const s = (spans[u.index] = span(u));
        const r = measured[u.index];
        s.dir = dirOf(u.level);
        // Anchor each unit at its logical start edge: right edge for RTL units, left for LTR.
        if (u.level & 1) s.style.right = `${box.right - r.right}px`;
        else s.style.left = `${r.left - box.left}px`;
        el.append(s);
      }
      break;
    }
  }
  rects ??= spans.map((s) => s.getBoundingClientRect());
  const units: UnitInfo[] = a.units.map((u, i) => ({ text: u.text, level: u.level, em: u.em, rect: [rects[i].left, rects[i].right, rects[i].top, rects[i].bottom] }));
  const order = units
    .map((u, i) => ({ i, c: (u.rect[0] + u.rect[1]) / 2 }))
    .sort((x, y) => x.c - y.c)
    .map((x) => x.i);
  return { dir: a.dir, units, order, bidiOrder: visualOrder(a) };
}

const T = { ready: false, render, stage: STAGE };
Object.assign(window, { T });

await Promise.all(
  Object.values(FONTS).flatMap((f) => ['400', '700'].map((w) => document.fonts.load(`${w} ${FONT_SIZE}px "${f.family}"`, 'אבג abc 123'))),
);
T.ready = true;
