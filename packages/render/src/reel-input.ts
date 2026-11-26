/**
 * Builds `window.REEL` (PLAN.md §8.1) for one format: everything the page needs, with bundle-relative asset URLs.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import {
  format,
  presetDoc,
  sectionSketchLook,
  seedOf,
  SketchDoc,
  sketchDocHash,
  type CueSheet,
  type FontRef,
  type FormatId,
  type JobSpec,
  type LogoRef,
  type ReelInput,
  type SketchRef,
} from '@reel/core';
import { RECIPES } from '@reel/styles';
import type { StyleResolution } from '@reel/traits';
import { findLogo, fontUrl, specFontIds, type Bundle } from './bundle.ts';
import { resolveFonts } from './fonts.ts';

/** Intrinsic size from the PNG IHDR, the SVG viewBox (or width/height) or the JPEG SOF marker. */
export function imageSize(bytes: Uint8Array, ext: string): { w: number; h: number } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ext === 'png') {
    if (bytes.length < 24 || dv.getUint32(0) !== 0x89504e47 || dv.getUint32(12) !== 0x49484452) throw new Error('not a PNG');
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  if (ext === 'svg') {
    const svg = new TextDecoder().decode(bytes);
    const tag = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? '';
    const vb = /viewBox\s*=\s*["']\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([\d.e]+)[\s,]+([\d.e]+)/i.exec(tag);
    if (vb) return { w: Number(vb[1]), h: Number(vb[2]) };
    const w = /\bwidth\s*=\s*["']([\d.]+)(px)?["']/i.exec(tag);
    const h = /\bheight\s*=\s*["']([\d.]+)(px)?["']/i.exec(tag);
    if (w && h) return { w: Number(w[1]), h: Number(h[1]) };
    throw new Error('SVG has neither a viewBox nor absolute width/height');
  }
  if (ext === 'jpg') {
    if (dv.getUint16(0) !== 0xffd8) throw new Error('not a JPEG');
    for (let i = 2; i + 9 < bytes.length; ) {
      if (bytes[i] !== 0xff) throw new Error('corrupt JPEG marker stream');
      const marker = bytes[i + 1]!;
      if (marker === 0xff) {
        i++;
        continue;
      }
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { w: dv.getUint16(i + 7), h: dv.getUint16(i + 5) };
      }
      i += 2 + dv.getUint16(i + 2);
    }
    throw new Error('JPEG has no SOF marker');
  }
  throw new Error(`unsupported image type "${ext}"`);
}

/**
 * Dominant colours of a logo as `#RRGGBB`, most frequent first: opaque PNG pixels quantised to 4 bits per channel
 * (bucket mean), or the distinct hex fills of an SVG. JPEGs report none (no decoder here).
 */
export function logoColors(bytes: Uint8Array, ext: string, max = 5): string[] {
  const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  if (ext === 'svg') {
    const counts = new Map<string, number>();
    for (const m of new TextDecoder().decode(bytes).matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
      const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
      const k = `#${h.toUpperCase()}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, max).map(([k]) => k);
  }
  if (ext !== 'png') return [];
  const png = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  const step = Math.max(1, Math.floor((png.width * png.height) / 200_000));
  for (let i = 0; i < png.width * png.height; i += step) {
    const o = i * 4;
    if (png.data[o + 3]! < 200) continue;
    const [r, g, b] = [png.data[o]!, png.data[o + 1]!, png.data[o + 2]!];
    const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += r;
    e.g += g;
    e.b += b;
    buckets.set(k, e);
  }
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, max)
    .map((e) => hex(e.r / e.n, e.g / e.n, e.b / e.n));
}

export async function reelInput(o: {
  spec: JobSpec;
  sheet: CueSheet;
  formatId: FormatId;
  specDir: string;
  bundle: Bundle;
  /** `resolveStyles` output, already checked for errors. */
  styles: StyleResolution;
}): Promise<ReelInput> {
  const { spec, styles } = o;
  if (!styles.job) throw new Error('reelInput: the job style did not resolve');

  const fonts = await resolveFonts(specFontIds(spec), o.specDir);
  const font = (id: string): FontRef => {
    const f = fonts[id]!;
    return { family: f.family, url: fontUrl(f), weights: f.weights };
  };

  const logos: LogoRef[] = [];
  for (const id of new Set(spec.sections.flatMap((s) => (s.role === 'endcard' ? s.logos : [])))) {
    const { path, ext } = await findLogo(o.specDir, id);
    try {
      logos.push({ id, url: `logos/${id}.${ext}`, ...imageSize(await readFile(path), ext) });
    } catch (e) {
      throw new Error(`logo "${id}" (${path}): ${(e as Error).message}`);
    }
  }

  const sketches = await sketchRefs(spec, o.specDir);
  return {
    spec,
    cues: o.sheet,
    format: format(o.formatId),
    styles: styles.sections,
    scenes: styles.scenes,
    params: styles.job.params,
    palette: styles.job.palette,
    fonts: { display: font(spec.fonts.display), text: font(spec.fonts.text ?? spec.fonts.display) },
    logos,
    ...(sketches.length ? { sketches } : {}),
  };
}

/** Asset ids of the generated sketches a spec draws (`source.kind: 'generated'`), unique, in reel order. */
export function specSketchAssets(spec: JobSpec): string[] {
  const ids = spec.sections.flatMap((s) =>
    s.role === 'endcard' ? [] : (s.sketches ?? []).flatMap((k) => (k.source.kind === 'generated' ? [k.source.asset] : [])),
  );
  return [...new Set(ids)];
}

/** A generated sketch's stored drawing, `<specDir>/assets/<asset>.sketch.json`, validated against `SketchDoc`. */
export async function loadSketchDoc(specDir: string, asset: string): Promise<SketchDoc> {
  const path = join(specDir, 'assets', `${asset}.sketch.json`);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    throw new Error(`sketch "${asset}": cannot read ${path}: ${(e as Error).message}`);
  }
  const r = SketchDoc.safeParse(raw);
  if (!r.success) throw new Error(`sketch "${asset}" (${path}) is not a valid SketchDoc: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).slice(0, 3).join('; ')}`);
  return r.data;
}

/**
 * The page's view of every section sketch: the resolved look, the drawing and its content hash. Every drawing travels
 * inline (presets drawn here bit-exactly, generated ones read from the asset store), never in the page bundle: the
 * hash in the fingerprint keys exactly the chunks a drawing appears in (SKETCH-PLAN.md SK16).
 */
export async function sketchRefs(spec: JobSpec, specDir: string): Promise<SketchRef[]> {
  const out: SketchRef[] = [];
  for (const s of spec.sections) {
    if (s.role === 'endcard' || !s.sketches) continue;
    for (const k of s.sketches) {
      const look = sectionSketchLook(spec, s, k, RECIPES);
      const doc =
        k.source.kind === 'preset'
          ? presetDoc(k.source.preset, look.presetMode, seedOf(k.id))
          : k.source.kind === 'generated'
            ? await loadSketchDoc(specDir, k.source.asset)
            : null;
      if (!doc) throw new Error(`sketch "${k.id}": logo line versions are not available yet`);
      out.push({ id: k.id, section: s.id, until: k.until ?? s.id, look, place: k.place, hash: await sketchDocHash(doc), doc });
    }
  }
  return out;
}
