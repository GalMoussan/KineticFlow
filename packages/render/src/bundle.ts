/**
 * Page bundle (PLAN.md §8.1): one self-contained directory per job that the loopback server serves as-is.
 * `index.html` + `engine.js` (the generic trait host, the job's traits and the runtime, one IIFE) + `engine.css`
 * (host + trait stylesheets) + `fonts/*` + `logos/*`. The entry is generated per job and imports only the traits the
 * job uses, so editing an unrelated trait does not change the hash. Everything the page can load is in here, so
 * `hash` covers every byte that can influence pixels except the injected `window.REEL`.
 */
import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { build } from 'esbuild';
import type { JobSpec, TraitAxis } from '@reel/core';
import { HOST_CSS, TRAITS_SRC, pageAssets, traitFiles } from '@reel/traits/files.ts';
import { resolveFonts, type SpecFont } from './fonts.ts';

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

/** Bundle-relative URL of a resolved font (catalog or uploaded). */
export function fontUrl(font: SpecFont): string {
  return `fonts/${encodeURIComponent(font.file)}`;
}

/** The generated page entry: the host plus one import per used trait. */
async function entrySource(traits: readonly { axis: TraitAxis; id: string }[]): Promise<{ js: string; css: string[] }> {
  const imports: string[] = [];
  const css = [HOST_CSS];
  for (const [i, t] of traits.entries()) {
    const f = await traitFiles(t.axis, t.id);
    imports.push(`import t${i} from ${JSON.stringify(`./${relative(TRAITS_SRC, f.impl)}`)};`);
    if (f.css) css.push(f.css);
  }
  const js = [
    `import { runHost } from './host/host.ts';`,
    ...imports,
    `runHost([${traits.map((_, i) => `t${i}`).join(', ')}]);`,
    '',
  ].join('\n');
  return { js, css };
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

export async function buildBundle(o: {
  spec: JobSpec;
  specDir: string;
  outDir: string;
  /** Traits the job uses (`usedTraits(resolveStyles(…))`), in axis order. */
  traits: readonly { axis: TraitAxis; id: string }[];
}): Promise<Bundle> {
  const files = new Map<string, Uint8Array>();
  const entry = await entrySource(o.traits);

  const js = await build({
    stdin: { contents: entry.js, resolveDir: TRAITS_SRC, sourcefile: 'entry.ts', loader: 'ts' },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    minify: true,
    write: false,
    legalComments: 'none',
    charset: 'utf8',
    logLevel: 'silent',
    // harfbuzzjs' Emscripten loader only requires `fs` in its Node branch
    external: ['fs'],
    metafile: true,
  });
  files.set('engine.js', js.outputFiles[0]!.contents);
  for (const [name, path] of Object.entries(pageAssets(Object.keys(js.metafile.inputs)))) files.set(name, await readFile(path));
  const sheets = await Promise.all(entry.css.map((p) => readFile(p, 'utf8')));
  files.set('engine.css', new TextEncoder().encode(sheets.join('\n')));

  for (const f of Object.values(await resolveFonts(specFontIds(o.spec), o.specDir))) files.set(`fonts/${f.file}`, await readFile(f.path));

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
