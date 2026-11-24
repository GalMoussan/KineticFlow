/**
 * Page side of the morph library: loads harfbuzz (`hb.wasm`, copied into the bundle by `files.ts` `pageAssets`) and
 * the job's own font files, outlines units exactly where the DOM draws them, and writes trait-owned SVG.
 *
 * Outlines are measured from the built DOM in `mount` (run left edge from a `Range`, baseline from a 0×0
 * inline-block probe) and shaped with the same font file, weight and direction as the DOM; a unit whose harfbuzz
 * advance differs from the DOM's by more than 1.5 px (+1.5 %) is not outlined (callers fall back to a fade).
 */
import createHarfBuzz from 'harfbuzzjs/hb.js';
import hbjs from 'harfbuzzjs/hbjs.js';
import type { Host, Section, Unit } from '../../contract.ts';
import { ringsBBox, type BBox } from './geom.ts';
import { loadFont, outline, shapeText, type Hb, type LoadedFont, type Outline } from './shape.ts';

let hbP: Promise<Hb> | null = null;
const fonts = new Map<string, Promise<LoadedFont>>();

/** harfbuzz, once per page. The wasm bytes are fetched by us (no streaming compile, so any MIME type works). */
function hb(): Promise<Hb> {
  hbP ??= (async () => {
    const res = await fetch('hb.wasm');
    if (!res.ok) throw new Error(`morph: hb.wasm missing from the bundle (${res.status})`);
    const mod = await createHarfBuzz({ wasmBinary: await res.arrayBuffer() });
    return hbjs(mod) as Hb;
  })();
  return hbP;
}

/** The job font (`display` / `text`) as a harfbuzz font, from the same bundle file the DOM uses. */
function fontOf(host: Host, family: 'display' | 'text'): Promise<LoadedFont> {
  const url = host.reel.fonts[family].url;
  let p = fonts.get(url);
  if (!p) {
    p = (async () => {
      const [h, res] = await Promise.all([hb(), fetch(url)]);
      if (!res.ok) throw new Error(`morph: font ${url} failed to load (${res.status})`);
      return loadFont(h, new Uint8Array(await res.arrayBuffer()));
    })();
    fonts.set(url, p);
  }
  return p;
}

export type Script = 'he' | 'latin' | 'num' | 'mixed' | 'none';

/** Script class of a text: Hebrew, Latin, digits only, mixed Hebrew + Latin/digits (bidi), or no letters. */
export function scriptOf(text: string): Script {
  const he = /[\u05D0-\u05EA]/.test(text);
  const la = /\p{Script=Latin}/u.test(text);
  const nu = /\p{Nd}/u.test(text);
  if (he && (la || nu)) return 'mixed';
  if (he) return 'he';
  if (la) return 'latin';
  if (nu) return 'num';
  return 'none';
}

export interface UnitOutline {
  unit: Unit;
  script: Script;
  /** Contours in the coordinates of the unit's section group. */
  outline: Outline;
  bbox: BBox;
  /** Ink centre (group coordinates). */
  cx: number;
  cy: number;
}

const cache = new WeakMap<Unit, Promise<UnitOutline | null>>();

/**
 * Outline of a text unit in its section group's coordinates, or null when it cannot be reproduced faithfully (no
 * text, bidi-mixed text, an RTL-neutral edge harfbuzz would order differently, or an advance mismatch with the DOM).
 * Call from `mount` (the DOM must exist, units not yet transformed). Memoised per unit.
 */
export function unitOutline(host: Host, u: Unit): Promise<UnitOutline | null> {
  let p = cache.get(u);
  if (!p) cache.set(u, (p = build(host, u)));
  return p;
}

async function build(host: Host, u: Unit): Promise<UnitOutline | null> {
  const inner = u.inner;
  if (!inner || !u.text || u.html !== null || u.mount || !u.font.size) return null;
  const script = scriptOf(u.text);
  if (script === 'mixed' || script === 'none') return null;
  const rtlPara = u.section.dir === 'rtl' && !u.ltr;
  // an LTR run inside an RTL paragraph with neutrals at its edges is reordered by bidi; harfbuzz shapes one run
  if (script !== 'he' && rtlPara && /^[^\p{L}\p{N}]|[^\p{L}\p{N}]$/u.test(u.text)) return null;
  if (script === 'he' && !rtlPara && /^[^\p{L}\p{N}]|[^\p{L}\p{N}]$/u.test(u.text)) return null;

  const g = u.section.group.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(inner);
  const r = range.getBoundingClientRect();
  const probe = document.createElement('span');
  probe.style.cssText = 'display:inline-block;width:0;height:0';
  inner.appendChild(probe);
  const baseline = probe.getBoundingClientRect().bottom - g.top;
  probe.remove();
  const x0 = r.left - g.left;

  const font = await fontOf(host, u.font.family);
  const sh = shapeText(font, u.text, u.font.size, u.font.weight, script === 'he' ? 'rtl' : 'ltr');
  if (Math.abs(sh.width - r.width) > 1.5 + 0.015 * r.width) return null;
  const ol = outline(sh, x0, baseline);
  if (!ol.all.length) return null;
  const bbox = ringsBBox(ol.all.map((c) => c.ring));
  return { unit: u, script, outline: ol, bbox, cx: (bbox[0] + bbox[2]) / 2, cy: (bbox[1] + bbox[3]) / 2 };
}

/** Whether a text pair morphs well (M0d): same script and similar length; otherwise crossfade. */
export function morphable(a: Unit, b: Unit): boolean {
  if (scriptOf(a.text) !== scriptOf(b.text)) return false;
  const na = a.graphemes || a.text.length;
  const nb = b.graphemes || b.text.length;
  return Math.max(na, nb) <= 2.2 * Math.min(na, nb) + 1;
}

/**
 * Offset that maps a unit of section `from` into section `to`'s group coordinates, or null when the two groups are
 * not related by a plain translation on screen (rotated placement, a world layer whose camera moves).
 */
export function groupOffset(from: Section, to: Section): [number, number] | null {
  const plain = (s: Section) => s.place.rot === 0 && !s.layer.world && s.style.traits.camera === 'static';
  if (!plain(from) || !plain(to)) return null;
  return [from.place.x - to.place.x, from.place.y - to.place.y];
}

// ───────────────────────────── SVG ─────────────────────────────

const NS = 'http://www.w3.org/2000/svg';

/**
 * A full-size SVG overlay at the end of `parent` (a section group), owned by the running hook's trait instance (the
 * host hides it while the instance is idle). Call from `mount`.
 */
export function overlay(host: Host, parent: Element, cls: string): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('width', String(host.W));
  svg.setAttribute('height', String(host.H));
  svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible;pointer-events:none';
  parent.appendChild(svg);
  host.own(svg);
  return svg;
}

export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, parent: Element, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent.appendChild(e);
  return e;
}

const written = new WeakMap<Element, Map<string, string>>();

/** Sets an attribute ('' removes it); skips unchanged values. Write every attribute you use in every frame. */
export function put(el: Element, name: string, value: string): void {
  let m = written.get(el);
  if (!m) written.set(el, (m = new Map()));
  if (m.get(name) === value) return;
  m.set(name, value);
  if (value === '') el.removeAttribute(name);
  else el.setAttribute(name, value);
}

/**
 * Shows a path with these attributes, or hides it (`display: none`) when `d` is ''. Translucency goes through
 * `fill-opacity` (alpha in the fill), never element `opacity`, which paints the path through a transparency layer.
 */
export function draw(el: SVGElement, d: string, fill: string, opacity: number, transform = ''): void {
  if (!d || opacity <= 0.002) {
    put(el, 'display', 'none');
    return;
  }
  put(el, 'display', '');
  put(el, 'd', d);
  put(el, 'fill', fill);
  put(el, 'fill-opacity', opacity >= 0.998 ? '' : opacity.toFixed(3));
  put(el, 'transform', transform);
}

/** `translate(dx dy) rotate(deg cx cy) scale about (cx, cy)` as an SVG transform attribute ('' at identity). */
export function xform(dx: number, dy: number, rot: number, s: number, cx: number, cy: number): string {
  let out = '';
  if (dx !== 0 || dy !== 0) out += `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`;
  if (rot !== 0) out += ` rotate(${rot.toFixed(3)} ${cx.toFixed(2)} ${cy.toFixed(2)})`;
  if (s !== 1) out += ` translate(${cx.toFixed(2)} ${cy.toFixed(2)}) scale(${s.toFixed(4)}) translate(${(-cx).toFixed(2)} ${(-cy).toFixed(2)})`;
  return out.trim();
}
