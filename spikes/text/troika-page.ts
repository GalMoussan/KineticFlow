/** Browser page for the troika spike: DOM reference, troika render modes, raw typesetter output, timing. */
import * as THREE from 'three';
import { BatchedText, Text, configureTextBuilder, typesetterWorkerModule } from 'troika-three-text';
import { FONT_SIZE, LINES } from './strings.ts';
import { analyzeLine } from './units.ts';

// Under the production CSP (script-src without blob:) troika's worker cannot importScripts its blob
// modules and Text.sync() never resolves. `?worker` keeps the default to demonstrate that.
if (!new URLSearchParams(location.search).has('worker')) configureTextBuilder({ useWorker: false });

const W = 2600, H = 240, LEFT = 40, TOP = 40, LINE_W = 2520, LINE_H = 154;

export const TFONTS = {
  noto400: { url: '/text/fonts/NotoSansHebrew-400.ttf', family: 'T noto400' },
  rubik400: { url: '/text/fonts/Rubik-400.ttf', family: 'T rubik400' },
  notoVar: { url: '/fonts/NotoSansHebrew.ttf', family: 'T notoVar' },
  rubikVar: { url: '/fonts/Rubik.ttf', family: 'T rubikVar' },
} as const;
export type TFontKey = keyof typeof TFONTS;

/**
 * - line:      one troika Text per line (troika shaping + bidi)
 * - g-troika:  one troika Text per grapheme (BatchedText), placed from the line Text's caretPositions
 * - g-dom:     one troika Text per grapheme (BatchedText), placed from DOM Range rects of the unsplit line
 * - g-canvas:  one Canvas2D-drawn texture quad per grapheme, placed from DOM Range rects (browser shaping)
 * - canvas:    Canvas2D fillText of the whole line, uploaded as one texture
 * (LRO/PDF-wrapped graphemes were tried to dodge troika's RTL run flip: the fonts lack U+202D/U+202C,
 * troika then fetches fallback fonts from a CDN, the CSP blocks it and sync() never resolves.)
 */
export type TMode = 'line' | 'g-troika' | 'g-dom' | 'g-canvas' | 'canvas';

const style = document.createElement('style');
style.textContent = `
${Object.values(TFONTS).map((f) => `@font-face{font-family:"${f.family}";src:url(${f.url}) format("truetype");font-weight:100 900;font-display:block}`).join('\n')}
html,body{margin:0;background:#fff}
#dom,#gl{position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#fff}
.line{position:absolute;left:${LEFT}px;top:${TOP}px;width:${LINE_W}px;height:${LINE_H}px;font-size:${FONT_SIZE}px;line-height:${LINE_H}px;white-space:pre;color:#000;font-weight:400}
.mark{display:inline-block;width:0;height:0;vertical-align:baseline}`;
document.head.append(style);
const dom = document.createElement('div');
dom.id = 'dom';
const canvas = document.createElement('canvas');
canvas.id = 'gl';
canvas.width = W;
canvas.height = H;
document.body.append(dom, canvas);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setClearColor(0xffffff, 1);
const gl = renderer.getContext();
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(0, W, 0, -H, -1000, 1000);
const px = new Uint8Array(4);
const frame = () => {
  renderer.render(scene, camera);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // forces the GPU to finish the frame
};

const show = (which: 'dom' | 'gl') => {
  dom.style.visibility = which === 'dom' ? 'visible' : 'hidden';
  canvas.style.visibility = which === 'gl' ? 'visible' : 'hidden';
};

function lineData(lineId: string) {
  const line = LINES.find((l) => l.id === lineId);
  if (!line) throw new Error(`no line ${lineId}`);
  return analyzeLine(line.source, 'grapheme'); // emphasis markers stripped; rendered at one weight
}

/** Unsplit DOM reference; returns baseline y and grapheme rects (page px). */
function showDom(lineId: string, font: TFontKey) {
  const a = lineData(lineId);
  const el = document.createElement('div');
  el.className = 'line';
  el.dir = a.dir;
  el.style.fontFamily = `"${TFONTS[font].family}"`;
  el.style.textAlign = a.dir === 'rtl' ? 'right' : 'left';
  const node = document.createTextNode(a.text);
  const marker = document.createElement('span');
  marker.className = 'mark';
  el.append(node, marker);
  dom.replaceChildren(el);
  show('dom');
  const rects = a.units.map((u) => {
    const r = document.createRange();
    r.setStart(node, u.start);
    r.setEnd(node, u.end);
    const b = r.getBoundingClientRect();
    return [b.left, b.right] as [number, number];
  });
  return { a, baseline: marker.getBoundingClientRect().top, rects };
}

/** Scene-level objects (line Text, BatchedText, line quad). */
let objects: THREE.Object3D[] = [];
/** Per-unit objects that animation moves (BatchedText members or standalone meshes). */
let units: THREE.Object3D[] = [];
const clear = () => {
  for (const o of new Set([...objects, ...units])) {
    scene.remove(o);
    if (o instanceof Text) o.dispose();
    else if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      o.material.map?.dispose();
      o.material.dispose();
    }
  }
  objects = [];
  units = [];
};
function synced(t: Text): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  t.sync(() => resolve());
  return promise;
}

function makeText(text: string, font: TFontKey, dir: 'rtl' | 'ltr', anchorX: 'left' | 'right', x: number, y: number): Text {
  const t = new Text();
  t.text = text;
  t.font = TFONTS[font].url;
  t.fontSize = FONT_SIZE;
  t.direction = dir;
  t.anchorX = anchorX;
  t.anchorY = 'top-baseline';
  t.color = 0x000000;
  t.position.set(x, y, 0);
  return t;
}

async function troika(lineId: string, font: TFontKey, mode: TMode, batched = true) {
  const { a, baseline, rects } = showDom(lineId, font);
  clear();
  const y = -baseline;
  const xStart = a.dir === 'rtl' ? LEFT + LINE_W : LEFT;
  const t0 = performance.now();
  let info: { timings?: unknown; glyphs?: number; units?: number } = {};
  if (mode === 'line') {
    const t = makeText(a.text, font, a.dir, a.dir === 'rtl' ? 'right' : 'left', xStart, y);
    await synced(t);
    scene.add(t);
    objects.push(t);
    info = { timings: t.textRenderInfo?.timings, glyphs: t.textRenderInfo!.glyphBounds.length / 4 };
  } else if (mode === 'canvas') {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.font = `400 ${FONT_SIZE}px "${TFONTS[font].family}"`;
    ctx.direction = a.dir;
    ctx.textAlign = a.dir === 'rtl' ? 'right' : 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#000';
    ctx.fontKerning = 'normal';
    ctx.fillText(a.text, xStart, baseline);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    mesh.position.set(W / 2, -H / 2, 0);
    scene.add(mesh);
    objects.push(mesh);
  } else if (mode === 'g-canvas') {
    const PAD = 32;
    for (const u of a.units) {
      if (!u.text.trim()) continue;
      const rtl = (u.level & 1) === 1;
      const [lo, hi] = rects[u.index];
      const c = document.createElement('canvas');
      c.width = Math.ceil(hi - lo + 2 * PAD);
      c.height = LINE_H;
      const ctx = c.getContext('2d')!;
      ctx.font = `400 ${FONT_SIZE}px "${TFONTS[font].family}"`;
      ctx.direction = rtl ? 'rtl' : 'ltr';
      ctx.textAlign = rtl ? 'right' : 'left';
      ctx.fillStyle = '#000';
      ctx.fontKerning = 'normal';
      ctx.fillText(u.text, rtl ? hi - lo + PAD : PAD, baseline - TOP);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = tex.magFilter = THREE.NearestFilter;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(c.width, c.height), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
      mesh.position.set(lo - PAD + c.width / 2, -(TOP + c.height / 2), 0);
      scene.add(mesh);
      units.push(mesh);
    }
    info = { units: units.length };
  } else {
    // unit x-ranges: troika caretPositions of a full-line Text, or DOM rects
    let ranges: [number, number][];
    if (mode === 'g-dom') ranges = rects;
    else {
      const ref = makeText(a.text, font, a.dir, a.dir === 'rtl' ? 'right' : 'left', xStart, y);
      await synced(ref);
      const cp = ref.textRenderInfo!.caretPositions!;
      ranges = a.units.map((u) => {
        let lo = Infinity, hi = -Infinity;
        for (let ci = u.start; ci < u.end; ci++) {
          lo = Math.min(lo, cp[ci * 4], cp[ci * 4 + 1]);
          hi = Math.max(hi, cp[ci * 4], cp[ci * 4 + 1]);
        }
        return [xStart + lo, xStart + hi];
      });
      ref.dispose();
    }
    const batch = new BatchedText();
    batch.color = 0x000000;
    for (const u of a.units) {
      if (!u.text.trim()) continue;
      const rtl = (u.level & 1) === 1;
      const [lo, hi] = ranges[u.index];
      // anchor at the unit's logical start edge, as the DOM `abs` strategy does
      const t = makeText(u.text, font, rtl ? 'rtl' : 'ltr', rtl ? 'right' : 'left', rtl ? hi : lo, y);
      units.push(t);
      if (batched) batch.add(t);
      else scene.add(t);
    }
    if (batched) {
      await synced(batch);
      scene.add(batch);
      objects.push(batch);
    } else await Promise.all(units.filter((t) => t instanceof Text).map(synced));
    info = { units: units.length };
  }
  const tSync = performance.now();
  frame();
  const tFrame = performance.now();
  show('gl');
  return { ...info, dir: a.dir, msSync: tSync - t0, msFirstFrame: tFrame - t0 };
}

/** Steady state: per frame, move/rotate/scale every unit (as channel commit would), render, wait for the GPU. */
function bench(frames: number) {
  const targets = units.length ? units : objects;
  const base = targets.map((o) => o.position.clone());
  const times: number[] = [];
  for (let f = 0; f < frames; f++) {
    const t = f / 30;
    const s = performance.now();
    targets.forEach((o, i) => {
      o.position.set(base[i].x, base[i].y + 10 * Math.sin(t * 4 + i * 0.3), 0);
      o.rotation.z = 0.05 * Math.sin(t * 3 + i);
      o.scale.setScalar(1 + 0.05 * Math.sin(t * 5 + i));
      const opacity = 0.75 + 0.25 * Math.sin(t + i);
      if (o instanceof Text) o.fillOpacity = opacity;
      else if (o instanceof THREE.Mesh) o.material.opacity = opacity;
    });
    frame();
    times.push(performance.now() - s);
  }
  targets.forEach((o, i) => {
    o.position.copy(base[i]);
    o.rotation.z = 0;
    o.scale.setScalar(1);
    if (o instanceof Text) o.fillOpacity = 1;
    else if (o instanceof THREE.Mesh) o.material.opacity = 1;
  });
  frame();
  times.sort((x, y) => x - y);
  return { frames, units: targets.length, meanMs: times.reduce((x, y) => x + y, 0) / frames, p95Ms: times[Math.floor(frames * 0.95)], maxMs: times[frames - 1] };
}

/** What troika exposes per glyph / per char after sync(), and whether mark carets sit on their base. */
async function access(lineId: string, font: TFontKey) {
  const a = lineData(lineId);
  const t = makeText(a.text, font, a.dir, 'left', 0, 0);
  await synced(t);
  const info = t.textRenderInfo!;
  const cp = info.caretPositions!;
  const marks: { char: string; base: string; markCaret: [number, number]; baseCaret: [number, number]; onBase: boolean }[] = [];
  let base = -1;
  for (let i = 0; i < a.text.length; i++) {
    if (!/\p{M}/u.test(a.text[i])) {
      base = i;
      continue;
    }
    const m: [number, number] = [Math.min(cp[i * 4], cp[i * 4 + 1]), Math.max(cp[i * 4], cp[i * 4 + 1])];
    const b: [number, number] = [Math.min(cp[base * 4], cp[base * 4 + 1]), Math.max(cp[base * 4], cp[base * 4 + 1])];
    marks.push({ char: `U+${a.text.charCodeAt(i).toString(16).toUpperCase()}`, base: a.text[base], markCaret: m, baseCaret: b, onBase: m[0] >= b[0] - 0.5 && m[1] <= b[1] + 0.5 });
  }
  const out = {
    textRenderInfoKeys: Object.keys(info),
    renderableGlyphs: info.glyphBounds.length / 4,
    glyphAtlasIndices: info.glyphAtlasIndices.length,
    chars: a.text.length,
    caretEntries: cp.length / 4,
    geometryAttributes: Object.keys(t.geometry.attributes),
    marks,
  };
  t.dispose();
  return out;
}

/** Syncs an arbitrary string (e.g. one with a codepoint the font lacks); resolves with the sync time. */
async function probeText(text: string, font: TFontKey) {
  const t = makeText(text, font, 'ltr', 'left', 0, 0);
  const t0 = performance.now();
  await synced(t);
  const ms = performance.now() - t0;
  t.dispose();
  return ms;
}

/** Raw troika typesetter output (real glyph ids + glyph origins), for comparison with HarfBuzz. */
async function raw(lineId: string, font: TFontKey) {
  const a = lineData(lineId);
  type Raw = { glyphIds: Uint16Array; glyphPositions: Float32Array };
  // `onMainThread._getInitResult` is troika-worker-utils internals, untyped: the Typesetter instance itself.
  const mod = typesetterWorkerModule as unknown as { onMainThread: { _getInitResult(): Promise<{ typeset(args: object, cb: (r: Raw) => void): void }> } };
  const ts = await mod.onMainThread._getInitResult();
  const { promise, resolve } = Promise.withResolvers<Raw>();
  ts.typeset({ text: a.text, font: new URL(TFONTS[font].url, location.href).href, fontSize: FONT_SIZE, direction: a.dir }, resolve);
  const r = await promise;
  return { dir: a.dir, glyphIds: Array.from(r.glyphIds), positions: Array.from(r.glyphPositions) };
}

const T = { ready: false, showDom: (l: string, f: TFontKey) => showDom(l, f).baseline, troika, bench, raw, access, probeText, frame };
Object.assign(window, { T });
await Promise.all(Object.values(TFONTS).map((f) => document.fonts.load(`400 ${FONT_SIZE}px "${f.family}"`, 'אבג abc')));
T.ready = true;
