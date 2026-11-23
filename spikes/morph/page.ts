/** Browser side of the spike (bundled by www.ts). Everything is exposed on `window.M`. */
import createHarfBuzz from 'harfbuzzjs/hb.js';
import hbjs from 'harfbuzzjs/hbjs.js';
import { loadFont, placeShaped, shapeText, type Hb, type LoadedFont } from './hb.ts';
import { PAIRS, STRATEGIES, buildSides, buildStrategy, type Fonts } from './pairs.ts';

type FontKey = 'noto' | 'rubik' | 'frank';
const FAMILY: Record<FontKey, string> = { noto: 'NotoV', rubik: 'RubikV', frank: 'FrankV' };
const FILE: Record<FontKey, string> = { noto: 'NotoSansHebrew', rubik: 'Rubik', frank: 'FrankRuhlLibre' };

let fonts: Record<FontKey, LoadedFont>;
const MARKS = /[\u0591-\u05C7]/g;

async function init(): Promise<{ initMs: number; renderer: string }> {
  const t0 = performance.now();
  const hb = hbjs(await createHarfBuzz({ locateFile: (p: string) => './' + p })) as Hb;
  const entries = await Promise.all(
    (Object.keys(FILE) as FontKey[]).map(async (k) => [k, loadFont(hb, new Uint8Array(await (await fetch(`fonts/${FILE[k]}.ttf`)).arrayBuffer()))] as const),
  );
  fonts = Object.fromEntries(entries) as Record<FontKey, LoadedFont>;
  const initMs = performance.now() - t0;
  await Promise.all((Object.keys(FAMILY) as FontKey[]).map((k) => document.fonts.load(`200px ${FAMILY[k]}`, 'אa')));
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  const renderer = gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'n/a';
  return { initMs, renderer };
}

// ---------- fidelity ----------

type Mode = 'dom' | 'dom-base' | 'hb' | 'hb-base';

/** Lays out one case; `-base` modes strip niqqud so marks can be isolated as full − base. */
function setCase(text: string, font: FontKey, wght: number, mode: Mode) {
  const stage = document.getElementById('stage')!;
  const shown = mode.endsWith('-base') ? text.replace(MARKS, '') : text;
  const rtl = /[\u0590-\u05FF]/.test(text);
  stage.innerHTML = '';
  const div = document.createElement('div');
  div.dir = 'rtl';
  div.style.cssText = `position:absolute;left:40px;top:40px;width:900px;height:300px;font-family:${FAMILY[font]};font-size:200px;line-height:300px;font-variation-settings:'wght' ${wght};text-align:right;white-space:pre;color:${mode.startsWith('hb') ? 'transparent' : '#000'}`;
  const tn = document.createTextNode(shown);
  const bl = document.createElement('span');
  bl.style.cssText = 'display:inline-block;width:0;height:0';
  div.append(tn, bl);
  stage.append(div);
  const range = document.createRange();
  range.selectNodeContents(tn);
  const r = range.getBoundingClientRect();
  const baseline = bl.getBoundingClientRect().bottom;
  const sh = shapeText(fonts[font], shown, 200, wght);
  if (mode.startsWith('hb')) {
    const ox = rtl ? r.right - sh.width : r.left;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('style', 'position:absolute;left:0;top:0;width:1000px;height:400px;overflow:visible');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', placeShaped(sh, ox, baseline).d);
    svg.append(path);
    stage.append(svg);
  }
  return { clip: { x: 40, y: 40, width: 900, height: 300 }, domWidth: r.width, hbWidth: sh.width, baseline, domLeft: r.left, domRight: r.right };
}

const masks = new Map<string, { w: number; h: number; m: Uint8Array }>();

async function loadMask(key: string, b64: string) {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const c = new OffscreenCanvas(img.width, img.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, img.width, img.height).data;
  const m = new Uint8Array(img.width * img.height);
  for (let i = 0; i < m.length; i++) m[i] = px[i * 4]! * 0.299 + px[i * 4 + 1]! * 0.587 + px[i * 4 + 2]! * 0.114 < 128 ? 1 : 0;
  masks.set(key, { w: img.width, h: img.height, m });
}

function minus(a: string, b: string, out: string) {
  const A = masks.get(a)!;
  const B = masks.get(b)!;
  masks.set(out, { w: A.w, h: A.h, m: A.m.map((v, i) => (v && !B.m[i] ? 1 : 0)) });
}

function iou(a: string, b: string) {
  const A = masks.get(a)!.m;
  const B = masks.get(b)!.m;
  let inter = 0;
  let uni = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < A.length; i++) {
    inter += A[i]! & B[i]!;
    uni += A[i]! | B[i]!;
    na += A[i]!;
    nb += B[i]!;
  }
  return { iou: uni ? inter / uni : 1, inter, union: uni, a: na, b: nb };
}

/** Connected components (8-conn) with ≥ minPx pixels → centroids. */
function components(key: string, minPx = 12) {
  const { w, h, m } = masks.get(key)!;
  const seen = new Uint8Array(m.length);
  const out: { x: number; y: number; n: number }[] = [];
  const stack: number[] = [];
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || seen[i]) continue;
    let n = 0;
    let sx = 0;
    let sy = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % w;
      const y = (j - x) / w;
      n++;
      sx += x;
      sy += y;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const k = yy * w + xx;
          if (m[k] && !seen[k]) {
            seen[k] = 1;
            stack.push(k);
          }
        }
    }
    if (n >= minPx) out.push({ x: sx / n, y: sy / n, n });
  }
  return out;
}

function markOffsets(domKey: string, hbKey: string) {
  const d = components(domKey);
  const h = components(hbKey);
  return d.map((c) => {
    let best = h[0];
    let bd = Infinity;
    for (const k of h) {
      const dist = Math.hypot(k.x - c.x, k.y - c.y);
      if (dist < bd) {
        bd = dist;
        best = k;
      }
    }
    return { dom: [+c.x.toFixed(2), +c.y.toFixed(2)], hb: best ? [+best.x.toFixed(2), +best.y.toFixed(2)] : null, dist: +bd.toFixed(3), domPx: c.n, hbPx: best?.n ?? 0 };
  });
}

/** Pixels set in exactly one mask that are farther than `r` px (Chebyshev) from any pixel of the other mask. */
function farMismatch(a: string, b: string, r = 1) {
  const { w, h, m: A } = masks.get(a)!;
  const B = masks.get(b)!.m;
  const near = (M: Uint8Array, x: number, y: number) => {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && M[yy * w + xx]) return true;
      }
    return false;
  };
  let xor = 0;
  let far = 0;
  for (let i = 0; i < A.length; i++) {
    if (A[i] === B[i]) continue;
    xor++;
    const x = i % w;
    const y = (i - x) / w;
    if (!near(A[i] ? B : A, x, y)) far++;
  }
  return { xor, far };
}

/** Diff visual: black = both, red = DOM only, blue = harfbuzz only. */
async function diffPng(a: string, b: string): Promise<string> {
  const A = masks.get(a)!;
  const B = masks.get(b)!.m;
  const c = new OffscreenCanvas(A.w, A.h);
  const ctx = c.getContext('2d')!;
  const im = ctx.createImageData(A.w, A.h);
  for (let i = 0; i < A.m.length; i++) {
    const [r, g, bl] = A.m[i] && B[i] ? [0, 0, 0] : A.m[i] ? [230, 0, 0] : B[i] ? [0, 60, 255] : [255, 255, 255];
    im.data.set([r, g, bl, 255], i * 4);
  }
  ctx.putImageData(im, 0, 0);
  const blob = await c.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s);
}

// ---------- morph: determinism, perf, coverage ----------

const morphFonts = (): Fonts => ({ noto: fonts.noto, rubik: fonts.rubik });

async function sha256(s: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Hash of all frames of every strategy for every pair at the given t list. */
async function morphHashes(ts: number[]) {
  const out: Record<string, string> = {};
  for (const p of PAIRS) {
    const { A, B } = buildSides(morphFonts(), p);
    for (const s of STRATEGIES) {
      const st = buildStrategy(s, A, B, p);
      if (st.frame) out[`${p.id}/${s}`] = await sha256(ts.map((t) => st.frame!(t)).join('\n'));
    }
  }
  return out;
}

function benchMorph(reps: number, frames: number) {
  const out: Record<string, { setupMs: number; frameUs: number }> = {};
  for (const p of PAIRS) {
    for (const s of STRATEGIES) {
      const setups: number[] = [];
      let st = null;
      for (let r = 0; r < reps; r++) {
        const t0 = performance.now();
        const { A, B } = buildSides(morphFonts(), p);
        st = buildStrategy(s, A, B, p);
        setups.push(performance.now() - t0);
      }
      if (!st?.frame) continue;
      let sink = 0;
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) sink += st.frame(((i * 7919) % frames) / frames + 0.5 / frames).length;
      const frameUs = ((performance.now() - t0) * 1000) / frames;
      setups.sort((a, b) => a - b);
      out[`${p.id}/${s}`] = { setupMs: setups[setups.length >> 1]!, frameUs: frameUs + (sink < 0 ? 1 : 0) };
    }
  }
  return out;
}

/** Ink pixel count of each path (rasterised 1:1 in a box), for pop / discontinuity detection. */
function coverage(ds: string[], fill: CanvasFillRule, box: [number, number, number, number]) {
  const w = Math.ceil(box[2] - box[0]);
  const h = Math.ceil(box[3] - box[1]);
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  return ds.map((d) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(1, 0, 0, 1, -box[0], -box[1]);
    ctx.fill(new Path2D(d), fill);
    const px = ctx.getImageData(0, 0, w, h).data;
    let n = 0;
    for (let i = 3; i < px.length; i += 4) n += px[i]! >= 128 ? 1 : 0;
    return n;
  });
}

// ---------- variable font re-shape per frame ----------

function benchReshape(text: string, font: FontKey, frames: number, cache: boolean) {
  let sink = 0;
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) {
    const wght = 400 + (500 * i) / (frames - 1);
    sink += shapeText(fonts[font], text, 200, wght, cache).d.length;
  }
  return { frameUs: ((performance.now() - t0) * 1000) / frames, sink };
}

async function reshapeHash(text: string, font: FontKey, wghts: number[]) {
  return sha256(wghts.map((w) => shapeText(fonts[font], text, 200, w, false).d).join('\n'));
}

/** CSS alternative: set font-variation-settings and force style+layout each frame (raster cost not included). */
function benchCssAxis(text: string, font: FontKey, frames: number) {
  const stage = document.getElementById('stage')!;
  stage.innerHTML = '';
  const div = document.createElement('div');
  div.dir = 'rtl';
  div.style.cssText = `position:absolute;left:40px;top:40px;font-family:${FAMILY[font]};font-size:200px;white-space:pre`;
  div.textContent = text;
  stage.append(div);
  let sink = 0;
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) {
    div.style.fontVariationSettings = `'wght' ${400 + (500 * i) / (frames - 1)}`;
    sink += div.getBoundingClientRect().width;
  }
  return { frameUs: ((performance.now() - t0) * 1000) / frames, sink };
}

const api = { ready: init(), setCase, loadMask, minus, iou, farMismatch, markOffsets, diffPng, morphHashes, benchMorph, coverage, benchReshape, reshapeHash, benchCssAxis };
export type PageApi = typeof api;
declare global {
  interface Window {
    M: PageApi;
  }
}
window.M = api;
