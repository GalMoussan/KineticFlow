/**
 * Page bundle (PLAN.md §8.1): one self-contained directory per job that the loopback server serves as-is.
 * `index.html` + `engine.js` (style engine and runtime, one IIFE) + `engine.css` + `fonts/*` + `logos/*`.
 * Everything the page can load is in here, so `hash` covers every byte that can influence pixels except the
 * injected `window.REEL`.
 */
import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { build } from 'esbuild';
import { fontEntry, type JobSpec } from '@reel/core';
import { styleDir } from '@reel/styles';
import { ensureFonts } from './fonts.ts';

export interface Bundle {
  /** Absolute directory served as the page root. */
  dir: string;
  /** Entry document, relative to `dir`. */
  entry: string;
  /** sha256 over every bundle file's relative path and bytes, sorted by path. */
  hash: string;
}

const LOGO_EXTS = ['png', 'svg', 'jpg'] as const;

/** Logo id → its source file `<specDir>/assets/<id>.{png,svg,jpg}`. */
export async function findLogo(specDir: string, id: string): Promise<{ path: string; ext: string }> {
  for (const ext of LOGO_EXTS) {
    const path = join(specDir, 'assets', `${id}.${ext}`);
    try {
      await access(path);
      return { path, ext };
    } catch {}
  }
  throw new Error(`logo "${id}": no ${LOGO_EXTS.map((e) => `assets/${id}.${e}`).join(' / ')} in ${specDir}`);
}

/** Fonts a spec uses: the display font and, if set, the text font. */
export function specFontIds(spec: JobSpec): string[] {
  return spec.fonts.text ? [spec.fonts.display, spec.fonts.text] : [spec.fonts.display];
}

/** Bundle-relative URL of a catalog font. */
export function fontUrl(id: string): string {
  return `fonts/${encodeURIComponent(fontEntry(id).file)}`;
}

function styleIdOf(spec: JobSpec): string {
  return typeof spec.style === 'string' ? spec.style : spec.style.base;
}

const html = (lang: string, dir: string) =>
  `<!doctype html>
<html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><link rel="stylesheet" href="engine.css"></head>
<body><div id="stage"></div><script src="engine.js"></script></body></html>
`;

async function listFiles(dir: string): Promise<string[]> {
  try {
    const ents = await readdir(dir, { recursive: true, withFileTypes: true });
    return ents.filter((e) => e.isFile()).map((e) => relative(dir, join(e.parentPath, e.name)));
  } catch {
    return [];
  }
}

export async function buildBundle(o: { styleId: string; spec: JobSpec; specDir: string; outDir: string }): Promise<Bundle> {
  if (styleIdOf(o.spec) !== o.styleId) {
    throw new Error(`bundle: spec style "${styleIdOf(o.spec)}" does not match "${o.styleId}"`);
  }
  const src = styleDir(o.styleId);
  const files = new Map<string, Uint8Array>();

  const js = await build({
    entryPoints: [join(src, 'engine.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    minify: true,
    write: false,
    legalComments: 'none',
    charset: 'utf8',
    logLevel: 'silent',
  });
  files.set('engine.js', js.outputFiles[0]!.contents);
  files.set('engine.css', await readFile(join(src, 'engine.css')));

  const fontPaths = await ensureFonts(specFontIds(o.spec));
  for (const [id, path] of Object.entries(fontPaths)) files.set(`fonts/${fontEntry(id).file}`, await readFile(path));

  for (const id of new Set(o.spec.sections.flatMap((s) => (s.role === 'endcard' ? s.logos : [])))) {
    const logo = await findLogo(o.specDir, id);
    files.set(`logos/${id}.${logo.ext}`, await readFile(logo.path));
  }

  const lang = o.spec.language;
  files.set('index.html', new TextEncoder().encode(html(lang, lang === 'he' ? 'rtl' : 'ltr')));

  // Write only what changed and drop stale files, so repeated builds are cheap and the dir equals the hash input.
  await mkdir(o.outDir, { recursive: true });
  for (const old of await listFiles(o.outDir)) if (!files.has(old)) await rm(join(o.outDir, old));
  const hash = createHash('sha256');
  for (const rel of [...files.keys()].sort()) {
    const bytes = files.get(rel)!;
    const path = join(o.outDir, rel);
    const current = await readFile(path).catch(() => null);
    if (!current || !Buffer.from(bytes).equals(current)) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    }
    hash.update(`${rel}\0${bytes.length}\0`).update(bytes);
  }
  return { dir: resolve(o.outDir), entry: 'index.html', hash: hash.digest('hex') };
}
