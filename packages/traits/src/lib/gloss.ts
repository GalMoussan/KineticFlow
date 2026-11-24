/**
 * Gradient-filled text without losing the text-shadow stack (chrome, bubble letters). `background-clip: text`
 * paints the background under the element's own `text-shadow` (a shadow on the same element covers the gradient)
 * and does not reach absolutely positioned part spans, so the fill lives on an owned **overlay**: a clone of the
 * unit's inner element appended to `u.el` above it, its glyphs transparent and filled with the gradient (per part
 * span for split units, positioned so the gradient runs continuously across the unit). The real inner element keeps
 * the base colour and the shadow stack underneath; QA keeps reading it.
 *
 * The overlay copies the inner and part channels the host is about to commit (call `glossFrame` from a `material`
 * frame: reveal and motion have written them by then), with the same transform strings as `host/commit.ts`, so
 * both rasters coincide. Every property it ever sets is rewritten every frame. Page-side only.
 */
import { hash } from '@reel/runtime';
import type { Host, Rect, Unit } from '../contract.ts';

export interface Gloss {
  u: Unit;
  el: HTMLElement;
  /** Fill targets: one per part (split units), else the overlay itself. */
  targets: HTMLElement[];
  /** Part index of each target (-1 for an unsplit overlay). */
  parts: number[];
  /**
   * The gradient frame in inner coordinates (the inner box grown by `pad` on every side): every background layer is
   * drawn in it. `ink` is the unit's ink rect inside the frame (px), for stops keyed to the glyphs.
   */
  frame: Rect;
  ink: Rect;
}

const n2 = (v: number) => v.toFixed(2);
const n4 = (v: number) => v.toFixed(4);

/** `host/commit.ts` transform order and formatting: translate → rotate → skewX → scale; `none` at identity. */
export function transformOf(tx: number, ty: number, rot: number, sx: number, sy: number, skx = 0): string {
  let s = '';
  if (tx !== 0 || ty !== 0) s += `translate(${n2(tx)}px, ${n2(ty)}px) `;
  if (rot !== 0) s += `rotate(${n4(rot)}deg) `;
  if (skx !== 0) s += `skewX(${n4(skx)}deg) `;
  if (sx !== 1 || sy !== 1) s += sx === sy ? `scale(${n4(sx)}) ` : `scale(${n4(sx)}, ${n4(sy)}) `;
  return s ? s.trimEnd() : 'none';
}

const written = new WeakMap<HTMLElement, Map<string, string>>();
/** Sets a style property, skipping unchanged values. */
export function setStyle(el: HTMLElement, prop: string, value: string): void {
  let m = written.get(el);
  if (!m) written.set(el, (m = new Map()));
  if (m.get(prop) === value) return;
  m.set(prop, value);
  el.style.setProperty(prop, value);
}

/**
 * Builds the overlay of a text unit (call from `mount`, after the host split it). `pad` (em) grows every fill target
 * so glyph ink outside the line box (niqqud, round overshoot) is still filled. Null for units without text.
 */
export function glossMount(host: Host, u: Unit, pad = 0.45): Gloss | null {
  const inner = u.inner;
  if (!inner || !u.el || !u.text || u.kind === 'logos' || u.html !== null || u.mount || !u.font.size) return null;
  const el = inner.cloneNode(true) as HTMLElement;
  for (const ink of el.querySelectorAll('.ink')) ink.remove();
  el.classList.add('gloss');
  el.removeAttribute('id');
  Object.assign(el.style, { color: 'transparent', webkitTextFillColor: 'transparent', textShadow: 'none', pointerEvents: 'none' });
  u.el.appendChild(el);
  host.own(el);

  const P = pad * u.font.size;
  const W = inner.offsetWidth;
  const H = inner.offsetHeight;
  const frame = { x: -P, y: -P, w: W + 2 * P, h: H + 2 * P };
  const ib = u.inkBox ?? { x: 0, y: 0, w: W, h: H };
  const ink = { x: ib.x + P, y: ib.y + P, w: ib.w, h: ib.h };

  const kids = [...inner.children];
  const targets: HTMLElement[] = [];
  const parts: number[] = [];
  if (u.parts.length) {
    u.parts.forEach((p, i) => {
      const t = el.children[kids.indexOf(p.span)] as HTMLElement | undefined;
      if (!t) return;
      targets.push(t);
      parts.push(i);
    });
  } else {
    targets.push(el);
    parts.push(-1);
  }
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!;
    const p = parts[i]! >= 0 ? u.parts[parts[i]!]!.span : null;
    // grow the box by P on every side without moving the glyphs (padding in, margin out)
    Object.assign(t.style, { padding: `${n2(P)}px`, margin: `${n2(-P)}px` });
    // the target's padding-box origin in inner coordinates: a part span's own offset, the overlay's frame corner
    const ox = p ? p.offsetLeft - P : -P;
    const oy = p ? p.offsetTop - P : -P;
    Object.assign(t.style, {
      backgroundPosition: `${n2(frame.x - ox)}px ${n2(frame.y - oy)}px`,
      backgroundOrigin: 'padding-box',
      webkitBackgroundClip: 'text',
      backgroundClip: 'text',
      webkitTextFillColor: 'transparent',
      color: 'transparent',
    });
  }
  return { u, el, targets, parts, frame, ink };
}

/** One background layer of the fill: drawn over the whole gradient frame, or repeated as a `tile` (w, h px). */
export interface GlossLayer {
  image: string;
  tile?: [number, number];
}

/**
 * Mirrors this frame's inner and part channels onto the overlay and paints `layers` (top first, in frame
 * coordinates; tiles are anchored at the frame's corner so patterns run on across parts) into every fill target.
 */
export function glossFrame(g: Gloss, layers: readonly GlossLayer[]): void {
  const c = g.u.ch;
  setStyle(g.el, 'transform', transformOf(c.itx, c.ity, c.irot, c.isx, c.isy, c.iskx));
  setStyle(g.el, 'font-weight', String(c.wght || g.u.font.weight));
  const image = layers.map((l) => l.image).join(', ');
  const size = layers.map((l) => (l.tile ? `${n2(l.tile[0])}px ${n2(l.tile[1])}px` : `${n2(g.frame.w)}px ${n2(g.frame.h)}px`)).join(', ');
  const repeat = layers.map((l) => (l.tile ? 'repeat' : 'no-repeat')).join(', ');
  for (let i = 0; i < g.targets.length; i++) {
    const t = g.targets[i]!;
    setStyle(t, 'background-image', image);
    setStyle(t, 'background-size', size);
    setStyle(t, 'background-repeat', repeat);
    const pi = g.parts[i]!;
    if (pi < 0) continue;
    const p = g.u.parts[pi]!;
    const pc = p.ch;
    const flat = Math.abs(pc.sx) <= 1e-4 || Math.abs(pc.sy) <= 1e-4;
    setStyle(t, 'transform', flat ? 'none' : transformOf(pc.tx, pc.ty, pc.rot, pc.sx, pc.sy, pc.skx));
    setStyle(t, 'opacity', flat || pc.opacity <= 0 ? '0' : pc.opacity >= 1 ? '1' : pc.opacity.toFixed(3));
    setStyle(t, 'filter', pc.blur > 0.01 ? `blur(${n2(pc.blur)}px)` : 'none');
    const text = pc.glyph ?? p.text;
    if (t.textContent !== text) t.textContent = text;
  }
}

/** A diagonal light band at fraction `x` (0..1 across the frame, may run past either end) of width `w` (fraction). */
export function sheenBand(x: number, w: number, alpha: number, angle = 105, color = '255,255,255'): string {
  const a = (x - w) * 100;
  const m = x * 100;
  const b = (x + w) * 100;
  return (
    `linear-gradient(${angle}deg, rgba(${color},0) ${a.toFixed(2)}%, rgba(${color},${alpha.toFixed(3)}) ${m.toFixed(2)}%, ` +
    `rgba(${color},0) ${b.toFixed(2)}%)`
  );
}

/**
 * A `size`-px square tile of hashed specks in `color` (`#RRGGBB`) as a data-URL background image: `density` of the
 * pixels get a speck of alpha up to `alpha`. Drawn once (an off-DOM canvas), so it never composites.
 */
export function speckle(size: number, color: string, density: number, alpha: number, seed: number): string {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  const im = g.createImageData(size, size);
  const [r, gr, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)) as [number, number, number];
  for (let i = 0; i < size * size; i++) {
    const h = hash(seed * 7919 + i * 1.618);
    if (h > density) continue;
    im.data[i * 4] = r;
    im.data[i * 4 + 1] = gr;
    im.data[i * 4 + 2] = b;
    im.data[i * 4 + 3] = Math.round(255 * alpha * (0.35 + 0.65 * hash(seed * 31 + i * 0.7071)));
  }
  g.putImageData(im, 0, 0);
  return `url("${cv.toDataURL('image/png')}")`;
}
