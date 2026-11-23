/** Project helpers: starter specs, list titles, and the on-disk job dir (`data/projects/<id>/`) renders read. */
import { mkdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrandKit } from '@reel/api';
import { isCatalogFont, plainText, type JobSpec } from '@reel/core';
import type { Store } from './store.ts';

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** A minimal valid spec to start from; a brand kit contributes its logos, palette and fonts. */
export function starterSpec(id: string, kit?: BrandKit): Record<string, unknown> {
  return {
    id,
    language: 'he',
    contentType: 'event',
    brief: '',
    sections: [
      { role: 'title', text: 'הכותרת *שלכם*' },
      { role: 'endcard', logos: kit?.logos.slice(0, 4) ?? [] },
    ],
    style: 'kinetic-quote',
    ...(kit ? { brandKit: kit.id } : {}),
    palette: kit?.palette ?? 'flamingo-cafe',
    fonts: kit?.fonts ?? { display: 'rubik' },
    music: { source: 'preset', preset: 'lofi-jazz', bpm: 100, seed: 1 },
    sfx: true,
    duration: 12,
    formats: ['9:16'],
    quality: 'standard',
  };
}

/** Title for lists: the title section's plain text (drafts may be partial). */
export function specTitle(spec: unknown): string {
  const sections = rec(spec).sections;
  const title = Array.isArray(sections) ? sections.map(rec).find((s) => s.role === 'title') : undefined;
  const text = typeof title?.text === 'string' ? plainText(title.text).trim() : '';
  return text || 'Untitled';
}

export function specStyle(spec: unknown): string {
  const style = rec(spec).style;
  if (typeof style === 'string') return style;
  const base = rec(style).base;
  return typeof base === 'string' ? base : '';
}

/** Asset ids a parsed spec references (logos, track, uploaded fonts). */
export function referencedAssets(spec: JobSpec): string[] {
  const ids = new Set<string>();
  for (const s of spec.sections) if (s.role === 'endcard') for (const l of s.logos) ids.add(l);
  if (spec.music.source === 'track') ids.add(spec.music.file);
  for (const f of [spec.fonts.display, spec.fonts.text]) if (f && !isCatalogFont(f)) ids.add(f);
  return [...ids];
}

/**
 * Writes `data/projects/<id>/<file>` and links every referenced asset into `data/projects/<id>/assets/`, so
 * `renderJob(<that path>)` resolves logos, tracks and fonts exactly like a hand-written job dir.
 */
export async function materialise(o: { projects: string; assets: string; store: Store; projectId: string; spec: JobSpec; file: string }): Promise<string> {
  const dir = join(o.projects, o.projectId);
  const assetDir = join(dir, 'assets');
  await mkdir(assetDir, { recursive: true });
  for (const id of referencedAssets(o.spec)) {
    const a = o.store.getAsset(id);
    if (!a) continue;
    const link = join(assetDir, `${id}.${a.ext}`);
    const target = join(o.assets, `${id}.${a.ext}`);
    if ((await readlink(link).catch(() => null)) === target) continue;
    await rm(link, { force: true });
    await symlink(target, link);
  }
  const path = join(dir, o.file);
  await writeFile(path, JSON.stringify(o.spec, null, 2) + '\n');
  return path;
}
