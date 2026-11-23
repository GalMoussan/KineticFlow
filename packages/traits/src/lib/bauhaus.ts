/**
 * Shared Swiss/Bauhaus pieces (port of dilemma-reel `reel12.js`): the per-layer solid panel colour every trait can
 * agree on, contrast-picked ink colours on it, and style records for circles, half-circles, rings, stripes and a
 * top-view coffee cup. They only build colours and markup; the trait that owns an element animates it.
 */
import type { ResolvedPalette } from '@reel/core';
import type { Host, Layer } from '../contract.ts';

const lum = (hex: string): number => {
  const ch = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
};

/** WCAG contrast ratio of two `#RRGGBB` colours. */
export function contrast(a: string, b: string): number {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The palette's dark and light base (navy and cream for flamingo-cafe), whichever of bg/text is which. */
export function bases(p: ResolvedPalette): { dark: string; light: string } {
  const { bg, text } = p;
  return lum(bg) <= lum(text) ? { dark: bg, light: text } : { dark: text, light: bg };
}

/** Background trait that paints `panelColor` panels; other traits fall back to the palette background without it. */
export const SOLID_BACKGROUND = 'solid-bauhaus';

const panelCache = new WeakMap<Layer, string>();

/**
 * Solid panel colour of a scene layer: the dark base for the first layer, the title and the end card; otherwise the
 * light base and the accents in turn (cream, teal, pink, sage, peach), never repeating the previous layer's colour.
 */
export function panelColor(host: Host, layer: Layer): string {
  const hit = panelCache.get(layer);
  if (hit) return hit;
  const { dark, light } = bases(layer.palette);
  const role = layer.sections[0]!.role;
  let c: string;
  if (layer.index === 0 || role === 'title' || role === 'endcard') c = dark;
  else {
    const seq = [light, host.accent(1, layer), host.accent(0, layer), host.accent(3, layer), host.accent(2, layer)];
    const prev = panelColor(host, host.layers[layer.index - 1]!);
    c = seq[(layer.index - 1) % seq.length]!;
    if (c === prev) c = seq[layer.index % seq.length]!;
  }
  panelCache.set(layer, c);
  return c;
}

export interface Surface {
  /** What the layer is painted with. */
  panel: string;
  /** Main text colour (the base with the higher contrast on the panel). */
  ink: string;
  /** Hero/emphasis colour: the accent that reads best on the panel, or the ink. */
  hero: string;
  /** Highlight block colour behind an emphasised word (text in `ink` on it). */
  block: string;
}

/** Colours to draw on `layer`: its solid panel when the layer's background is `solid-bauhaus`, else the palette bg. */
export function surface(host: Host, layer: Layer): Surface {
  const panel = layer.sections[0]!.style.traits.background === SOLID_BACKGROUND ? panelColor(host, layer) : layer.palette.bg;
  const { dark, light } = bases(layer.palette);
  // light text on darker panels (navy, teal) as in reel12, else the base that contrasts most
  const ink = lum(panel) < 0.25 && contrast(light, panel) >= 3 ? light : contrast(dark, panel) >= contrast(light, panel) ? dark : light;
  const accents = layer.palette.accents.filter((a) => a !== panel);
  // the first accent in palette order (the primary emphasis colour) that reads on the panel
  const hero = accents.find((a) => a !== ink && contrast(a, panel) >= 3) ?? ink;
  const order = [2, 0, 3, 1, 4].map((i) => host.accent(i, layer));
  const block = order.find((a) => a !== panel && a !== ink && contrast(a, ink) >= 3) ?? (ink === dark ? light : dark);
  return { panel, ink, hero, block };
}

/** Accents of `p` for shapes on a panel, rotated by `k`, never the panel colour itself. */
export function shapeColors(p: ResolvedPalette, panel: string, k: number): string[] {
  const { dark, light } = bases(p);
  const all = [...p.accents, light, dark].filter((c, i, a) => c !== panel && a.indexOf(c) === i);
  const n = all.length;
  return all.map((_, i) => all[(i + k) % n]!);
}

/**
 * A Bauhaus shape: inline SVG that fills its element (`width/height: 100%`), so a trait animates it by rewriting the
 * element's box (left/top/width/height). A 2D `scale()` measured seek-order safe (≤ 1/255) on non-composited
 * elements; the 83/255 residue first seen with `scale()` is most likely the composited-layer or stale-element class
 * (README §1), not the transform itself.
 */
export interface ShapeArt {
  /** Unscaled box (px). */
  w: number;
  h: number;
  svg: string;
}

const svg = (vw: number, vh: number, body: string, stretch = false) =>
  `<svg width="100%" height="100%" viewBox="0 0 ${vw} ${vh}"${stretch ? ' preserveAspectRatio="none"' : ''} style="display:block;overflow:visible">${body}</svg>`;

/** Filled disc of radius r. */
export const circle = (r: number, fill: string): ShapeArt => ({
  w: 2 * r, h: 2 * r, svg: svg(100, 100, `<circle cx="50" cy="50" r="50" fill="${fill}"/>`),
});

/** Ring of radius r (outer edge) and stroke width w px. */
export function ring(r: number, w: number, color: string): ShapeArt {
  const sw = (w / r) * 50;
  return { w: 2 * r, h: 2 * r, svg: svg(100, 100, `<circle cx="50" cy="50" r="${(50 - sw / 2).toFixed(3)}" fill="none" stroke="${color}" stroke-width="${sw.toFixed(3)}"/>`) };
}

/** Half-disc of radius r whose flat edge faces `edge`; stretches with its box (grow it out of that edge via height). */
export const half = (r: number, fill: string, edge: 'top' | 'bottom'): ShapeArt => ({
  w: 2 * r,
  h: r,
  svg: svg(100, 50, edge === 'bottom' ? `<path d="M0 50 A50 50 0 0 1 100 50 Z" fill="${fill}"/>` : `<path d="M0 0 A50 50 0 0 0 100 0 Z" fill="${fill}"/>`, true),
});

/** Top-view coffee cup in a 2R × 2R box: saucer ring, handle ring, cup body, coffee. */
export function cup(R: number, o: { saucer: string; body: string; coffee: string | null; handleLeft: boolean }): ShapeArt {
  const hx = o.handleLeft ? 10 : 190;
  return {
    w: 2 * R,
    h: 2 * R,
    svg: svg(
      200,
      200,
      `<circle cx="100" cy="100" r="97" fill="none" stroke="${o.saucer}" stroke-width="6"/>` +
        `<circle cx="${hx}" cy="100" r="19.5" fill="none" stroke="${o.body}" stroke-width="9"/>` +
        `<circle cx="100" cy="100" r="76" fill="${o.body}"/>` +
        (o.coffee ? `<circle cx="100" cy="100" r="58" fill="${o.coffee}"/>` : ''),
    ),
  };
}

/** Background of a block of parallel bars (`angle` 90 = vertical bars side by side); reveal it with a clip. */
export const stripes = (color: string, bar: number, gap: number, angle = 90): string =>
  `repeating-linear-gradient(${angle}deg, ${color} 0 ${bar.toFixed(2)}px, transparent ${bar.toFixed(2)}px ${(bar + gap).toFixed(2)}px)`;
