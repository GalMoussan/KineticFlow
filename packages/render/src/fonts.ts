/**
 * Fonts (PLAN.md §11).
 * - Catalog fonts live in `<repo>/assets/fonts/<file>` (git-ignored), downloaded once from the catalog URL and verified
 *   by SHA-256. Pages only ever load these local copies.
 * - Uploaded fonts are referenced by asset id: any font id that is not a catalog id resolves like a logo, to
 *   `<specDir>/assets/<id>.{ttf,otf,woff2}`, with family and weights read from the file.
 * - `readFont`: a minimal OpenType reader (name, OS/2, fvar, cmap) for TTF/OTF/TTC and WOFF2.
 */
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { FONT_EXTS, fontEntry, isCatalogFont } from '@reel/core';

export const FONT_DIR = new URL('../../../assets/fonts/', import.meta.url).pathname;

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

async function readIfValid(path: string, expected: string): Promise<boolean> {
  try {
    return sha256(await readFile(path)) === expected;
  } catch {
    return false;
  }
}

/** Font id → absolute path of the verified local file. Missing or corrupt files are (re)downloaded. */
export async function ensureFonts(ids: string[], log?: (msg: string) => void): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of new Set(ids)) {
    const f = fontEntry(id);
    const path = join(FONT_DIR, f.file);
    if (!(await readIfValid(path, f.sha256))) {
      await mkdir(FONT_DIR, { recursive: true });
      const res = await fetch(f.url);
      if (!res.ok) throw new Error(`font "${id}": download failed (${res.status} ${res.statusText}) from ${f.url}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const got = sha256(bytes);
      if (got !== f.sha256) throw new Error(`font "${id}": sha256 mismatch for ${f.url} (expected ${f.sha256}, got ${got})`);
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, bytes);
      await rename(tmp, path);
      log?.(`font ${id}: downloaded ${f.file} (${(bytes.length / 1024).toFixed(0)} KB)`);
    }
    out[id] = path;
  }
  return out;
}

/** Uploaded font id → its source file `<specDir>/assets/<id>.{ttf,otf,woff2}`. */
export async function findFontFile(specDir: string, id: string): Promise<{ path: string; ext: string }> {
  for (const ext of FONT_EXTS) {
    const path = join(specDir, 'assets', `${id}.${ext}`);
    if (await access(path).then(() => true, () => false)) return { path, ext };
  }
  throw new Error(`font "${id}" is neither a catalog font nor an uploaded font (no ${FONT_EXTS.map((e) => `assets/${id}.${e}`).join(' / ')} in ${specDir})`);
}

export interface SpecFont {
  id: string;
  /** Absolute path of the local file. */
  path: string;
  /** File name inside the bundle's `fonts/` directory. */
  file: string;
  family: string;
  weights: [number, number];
}

/** Resolves catalog ids (downloaded + verified) and uploaded ids (read from the file) to local files. */
export async function resolveFonts(ids: readonly string[], specDir: string): Promise<Record<string, SpecFont>> {
  const out: Record<string, SpecFont> = {};
  for (const id of new Set(ids)) {
    if (isCatalogFont(id)) {
      const f = fontEntry(id);
      const path = (await ensureFonts([id]))[id]!;
      out[id] = { id, path, file: f.file, family: f.family, weights: f.weights };
    } else {
      const { path, ext } = await findFontFile(specDir, id);
      const info = readFont(await readFile(path));
      out[id] = { id, path, file: `${id}.${ext}`, family: info.family, weights: info.weights };
    }
  }
  return out;
}

// ───────────────────────────── OpenType reader ─────────────────────────────

export interface FontInfo {
  /** Typographic family (name ID 16), else the family (name ID 1). */
  family: string;
  /** `fvar` wght axis range, else [usWeightClass, usWeightClass]. */
  weights: [number, number];
  /** Variation axis tags (`wght`, `wdth`, …). */
  axes: string[];
  /** `hebrew` when the cmap covers U+05D0–U+05EA; `latin` when it covers A–Z and a–z. */
  scripts: ('hebrew' | 'latin')[];
  /** Every code point the cmap maps to a real glyph. */
  codepoints: Set<number>;
  format: 'ttf' | 'otf' | 'woff2';
}

type Tables = Map<string, DataView>;

const tagAt = (v: DataView, o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
const view = (b: Uint8Array, o = 0, n = b.byteLength - o) => new DataView(b.buffer, b.byteOffset + o, n);

function sfntTables(bytes: Uint8Array, offset = 0): Tables {
  const v = view(bytes);
  const n = v.getUint16(offset + 4);
  const tables: Tables = new Map();
  for (let i = 0; i < n; i++) {
    const r = offset + 12 + i * 16;
    const off = v.getUint32(r + 8);
    const len = v.getUint32(r + 12);
    if (off + len > bytes.byteLength) throw new Error(`table ${tagAt(v, r)} runs past the end of the file`);
    tables.set(tagAt(v, r), view(bytes, off, len));
  }
  return tables;
}

/** WOFF2 table tags by known-tag index (WOFF2 §5.1). */
const WOFF2_TAGS = (
  'cmap head hhea hmtx maxp name OS/2 post cvt  fpgm glyf loca prep CFF  VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX ' +
  'vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG  sbix acnt avar bdat bloc bsln cvar fdsc feat ' +
  'fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill'
)
  .match(/.{4}\s?/g)!
  .map((s) => s.slice(0, 4));

/**
 * WOFF2 → the tables this reader needs. cmap, name, OS/2 and fvar are never transformed (only glyf/loca/hmtx are),
 * so they are plain byte ranges of the Brotli stream.
 */
function woff2Tables(bytes: Uint8Array): Tables {
  const v = view(bytes);
  const numTables = v.getUint16(12);
  const compressedSize = v.getUint32(20);
  if (v.getUint32(4) === 0x74746366) throw new Error('WOFF2 font collections are not supported');
  let p = 48;
  const base128 = () => {
    let x = 0;
    for (let i = 0; i < 5; i++) {
      const b = v.getUint8(p++);
      x = x * 128 + (b & 0x7f);
      if (!(b & 0x80)) return x;
    }
    throw new Error('bad UIntBase128');
  };
  const dir: { tag: string; length: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = v.getUint8(p++);
    let tag: string;
    if ((flags & 0x3f) === 0x3f) {
      tag = tagAt(v, p);
      p += 4;
    } else tag = WOFF2_TAGS[flags & 0x3f] ?? '????';
    const version = flags >> 6;
    const origLength = base128();
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    dir.push({ tag, length: transformed ? base128() : origLength });
  }
  const data = brotliDecompressSync(bytes.subarray(p, p + compressedSize));
  const tables: Tables = new Map();
  let o = 0;
  for (const t of dir) {
    tables.set(t.tag, view(data, o, t.length));
    o += t.length;
  }
  return tables;
}

function decodeName(v: DataView, platform: number, o: number, n: number): string {
  if (platform === 3 || platform === 0) {
    let s = '';
    for (let i = 0; i + 1 < n; i += 2) s += String.fromCharCode(v.getUint16(o + i));
    return s;
  }
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(v.getUint8(o + i));
  return s;
}

function familyName(v: DataView | undefined): string {
  if (!v) return '';
  const count = v.getUint16(2);
  const strings = v.getUint16(4);
  const found = new Map<number, { score: number; text: string }>();
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    const platform = v.getUint16(r);
    const lang = v.getUint16(r + 4);
    const id = v.getUint16(r + 6);
    if (id !== 1 && id !== 16) continue;
    const score = platform === 3 ? (lang === 0x409 ? 3 : 2) : platform === 0 ? 2 : platform === 1 && lang === 0 ? 1 : 0;
    if (!score || (found.get(id)?.score ?? 0) >= score) continue;
    found.set(id, { score, text: decodeName(v, platform, strings + v.getUint16(r + 10), v.getUint16(r + 8)) });
  }
  return (found.get(16)?.text || found.get(1)?.text || '').trim();
}

function cmapCodepoints(v: DataView | undefined): Set<number> {
  const out = new Set<number>();
  if (!v) return out;
  const n = v.getUint16(2);
  const subtables: { platform: number; encoding: number; offset: number; format: number }[] = [];
  for (let i = 0; i < n; i++) {
    const r = 4 + i * 8;
    const offset = v.getUint32(r + 4);
    subtables.push({ platform: v.getUint16(r), encoding: v.getUint16(r + 2), offset, format: v.getUint16(offset) });
  }
  const unicode = subtables.filter((s) => s.platform === 0 || (s.platform === 3 && (s.encoding === 1 || s.encoding === 10)));
  const pick = unicode.find((s) => s.format === 12) ?? unicode.find((s) => s.format === 4) ?? unicode.find((s) => s.format === 6);
  if (!pick) return out;
  const o = pick.offset;
  if (pick.format === 12) {
    const groups = v.getUint32(o + 12);
    for (let g = 0; g < groups; g++) {
      const start = v.getUint32(o + 16 + g * 12);
      const end = v.getUint32(o + 20 + g * 12);
      const glyph = v.getUint32(o + 24 + g * 12);
      for (let c = start; c <= end; c++) if (glyph + (c - start) !== 0) out.add(c);
    }
  } else if (pick.format === 4) {
    const segs = v.getUint16(o + 6) / 2;
    const ends = o + 14;
    const starts = ends + segs * 2 + 2;
    const deltas = starts + segs * 2;
    const ranges = deltas + segs * 2;
    for (let s = 0; s < segs; s++) {
      const end = v.getUint16(ends + s * 2);
      const start = v.getUint16(starts + s * 2);
      const delta = v.getUint16(deltas + s * 2);
      const rangeAt = ranges + s * 2;
      const range = v.getUint16(rangeAt);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g: number;
        if (range === 0) g = (c + delta) & 0xffff;
        else {
          const at = rangeAt + range + (c - start) * 2;
          g = at + 1 < v.byteLength ? v.getUint16(at) : 0;
          if (g) g = (g + delta) & 0xffff;
        }
        if (g) out.add(c);
      }
    }
  } else {
    const first = v.getUint16(o + 6);
    const count = v.getUint16(o + 8);
    for (let i = 0; i < count; i++) if (v.getUint16(o + 10 + i * 2)) out.add(first + i);
  }
  return out;
}

/** Reads family, weights, axes, scripts and cmap coverage of a TTF/OTF/TTC (first face) or WOFF2 file. */
export function readFont(bytes: Uint8Array): FontInfo {
  if (bytes.byteLength < 12) throw new Error('not a font file (too short)');
  const v = view(bytes);
  const magic = v.getUint32(0);
  let tables: Tables;
  let format: FontInfo['format'];
  if (magic === 0x774f4632) {
    tables = woff2Tables(bytes);
    format = 'woff2';
  } else if (magic === 0x00010000 || magic === 0x74727565) {
    tables = sfntTables(bytes);
    format = 'ttf';
  } else if (magic === 0x4f54544f) {
    tables = sfntTables(bytes);
    format = 'otf';
  } else if (magic === 0x74746366) {
    tables = sfntTables(bytes, v.getUint32(12));
    format = 'ttf';
  } else if (magic === 0x774f4646) {
    throw new Error('WOFF 1 fonts are not supported; use TTF, OTF or WOFF2');
  } else throw new Error('not a TTF/OTF/WOFF2 font file');

  const family = familyName(tables.get('name'));
  if (!family) throw new Error('the font has no family name');
  const os2 = tables.get('OS/2');
  const weightClass = os2 && os2.byteLength >= 6 ? os2.getUint16(4) : 400;
  const axes: string[] = [];
  let weights: [number, number] = [weightClass, weightClass];
  const fvar = tables.get('fvar');
  if (fvar) {
    const arrays = fvar.getUint16(4);
    const count = fvar.getUint16(8);
    const size = fvar.getUint16(10);
    for (let i = 0; i < count; i++) {
      const r = arrays + i * size;
      const tag = tagAt(fvar, r);
      axes.push(tag);
      if (tag === 'wght') weights = [Math.round(fvar.getInt32(r + 4) / 65536), Math.round(fvar.getInt32(r + 12) / 65536)];
    }
  }
  const codepoints = cmapCodepoints(tables.get('cmap'));
  const covers = (a: number, b: number) => {
    for (let c = a; c <= b; c++) if (!codepoints.has(c)) return false;
    return true;
  };
  const scripts: FontInfo['scripts'] = [];
  if (covers(0x05d0, 0x05ea)) scripts.push('hebrew');
  if (covers(0x41, 0x5a) && covers(0x61, 0x7a)) scripts.push('latin');
  return { family, weights, axes, scripts, codepoints, format };
}

/** Code points that never need a glyph (spaces, bidi marks, joiners). */
const INVISIBLE = /[\s\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/u;

/** Characters of `text` the font cannot draw, deduplicated in first-seen order. */
export function missingChars(text: string, codepoints: ReadonlySet<number>): string {
  const missing = new Set<string>();
  for (const ch of text.normalize('NFC')) {
    if (INVISIBLE.test(ch)) continue;
    if (!codepoints.has(ch.codePointAt(0)!)) missing.add(ch);
  }
  return [...missing].join('');
}
