/**
 * Builds `window.REEL` (PLAN.md §8.1) for one format: everything the page needs, with bundle-relative asset URLs.
 */
import { readFile } from 'node:fs/promises';
import {
  fontEntry,
  format,
  resolvePalette,
  type CueSheet,
  type FontRef,
  type FormatId,
  type JobSpec,
  type LogoRef,
  type ReelInput,
  type ResolvedStyle,
  type StyleRef,
  type TraitAxis,
} from '@reel/core';
import { recipe } from '@reel/styles';
import { findLogo, fontUrl, type Bundle } from './bundle.ts';

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

function styleBase(ref: StyleRef): { base: string; traits: Partial<Record<TraitAxis, string>>; params: Record<string, number> } {
  return typeof ref === 'string' ? { base: ref, traits: {}, params: {} } : { base: ref.base, traits: ref.traits ?? {}, params: ref.params ?? {} };
}

export async function reelInput(o: {
  spec: JobSpec;
  sheet: CueSheet;
  formatId: FormatId;
  specDir: string;
  bundle: Bundle;
}): Promise<ReelInput> {
  const { spec } = o;
  const job = styleBase(spec.style);
  const rec = recipe(job.base);
  const params = { ...rec.params, ...job.params };

  // M1 renders one monolithic style; per-section overrides still merge their traits/params on top of the job's.
  const styles: Record<string, ResolvedStyle> = {};
  for (const s of spec.sections) {
    const own = s.style ? styleBase(s.style) : { traits: {}, params: {} };
    styles[s.id] = {
      recipe: rec.id,
      traits: { ...rec.traits, ...job.traits, ...own.traits } as Record<TraitAxis, string>,
      params: { ...params, ...own.params },
    };
  }

  const font = (id: string): FontRef => {
    const f = fontEntry(id);
    return { family: f.family, url: fontUrl(id), weights: f.weights };
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

  return {
    spec,
    cues: o.sheet,
    format: format(o.formatId),
    styles,
    params,
    palette: resolvePalette(spec.palette ?? rec.defaults.palette),
    fonts: { display: font(spec.fonts.display), text: font(spec.fonts.text ?? spec.fonts.display) },
    logos,
  };
}
