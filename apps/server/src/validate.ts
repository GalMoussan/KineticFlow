/**
 * Draft validation (`Validation`): schema issues mapped to JSON paths, asset references, `resolveStyles`
 * diagnostics, timing (cue sheet or the needed duration), contrast per palette in use and missing glyphs per font.
 * Runs on every save, so it never touches a browser or renders audio.
 */
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { SpecIssue, Validation } from '@reel/api';
import { contrast, fontEntry, isCatalogFont, JobSpec, PALETTES, words, type ResolvedPalette } from '@reel/core';
import { FONT_DIR, findFontFile, fontCodepoints, missingChars, resolveQuality, specText } from '@reel/render';
import { RECIPES } from '@reel/styles';
import { buildCueSheet, TimingError } from '@reel/timing';
import { formatDiagnostics, resolveStyles, TRAIT_META } from '@reel/traits';
import { issuePath } from './http.ts';
import type { Store } from './store.ts';

export interface ValidateEnv {
  /** Spec dir of uploads: `<specDir>/assets/<id>.<ext>`. */
  specDir: string;
  store: Store;
}

/** Name of a resolved palette: its catalog id, or `custom`. */
export function paletteName(p: ResolvedPalette): string {
  const k = JSON.stringify(p);
  return Object.entries(PALETTES).find(([, q]) => JSON.stringify(q) === k)?.[0] ?? 'custom';
}

/** Tempo the timing engine would use without rendering audio (tracks: the analysed tempo, when known). */
export function previewBpm(spec: JobSpec, defaultBpm: number, store: Store): number {
  const m = spec.music;
  if (m.source === 'preset' || m.source === 'ai') return m.bpm;
  if (m.source === 'track') {
    const bpm = store.getAsset(m.file)?.meta.bpm;
    return typeof bpm === 'number' && bpm > 0 ? bpm : defaultBpm;
  }
  return defaultBpm;
}

export async function validateSpec(raw: unknown, env: ValidateEnv): Promise<Validation> {
  const issues: SpecIssue[] = [];
  const parsed = JobSpec.safeParse(raw);
  if (!parsed.success) {
    for (const i of parsed.error.issues) issues.push({ path: issuePath(i.path), message: i.message, level: 'error' });
    return { ok: false, issues, style: [], contrast: [], missingGlyphs: [] };
  }
  const spec = parsed.data;
  const { store } = env;

  // ── asset references ──
  spec.sections.forEach((s, i) => {
    if (s.role !== 'endcard') return;
    s.logos.forEach((id, j) => {
      if (store.getAsset(id)?.kind !== 'logo') {
        issues.push({ path: ['sections', i, 'logos', j], message: `logo "${id}" is not uploaded`, level: 'error' });
      }
    });
  });
  if (spec.music.source === 'track' && store.getAsset(spec.music.file)?.kind !== 'track') {
    issues.push({ path: ['music', 'file'], message: `track "${spec.music.file}" is not uploaded`, level: 'error' });
  }
  if (spec.music.source === 'ai') {
    issues.push({ path: ['music', 'source'], message: 'AI music arrives in a later version; pick a preset, a track or none', level: 'error' });
  }
  const fontSlots = (['display', 'text'] as const).filter((k) => spec.fonts[k] !== undefined);
  const fontPaths = new Map<string, string>();
  for (const slot of fontSlots) {
    const id = spec.fonts[slot]!;
    if (fontPaths.has(id)) continue;
    if (isCatalogFont(id)) {
      const path = join(FONT_DIR, fontEntry(id).file);
      if (await access(path).then(() => true, () => false)) fontPaths.set(id, path);
      else issues.push({ path: ['fonts', slot], message: `font "${id}" is not installed: run \`reelgen setup fonts\``, level: 'warn' });
    } else if (store.getAsset(id)?.kind !== 'font') {
      issues.push({ path: ['fonts', slot], message: `font "${id}" is neither a catalog font nor an uploaded font`, level: 'error' });
    } else {
      fontPaths.set(id, (await findFontFile(env.specDir, id)).path);
    }
  }

  // ── styles ──
  const styles = resolveStyles(spec, RECIPES, TRAIT_META);
  const sectionIndex = new Map(spec.sections.map((s, i) => [s.id, i]));
  const style = styles.diagnostics.map((d) => ({
    level: d.level,
    message: formatDiagnostics([d]).trim(),
    ...(d.sections ? { section: d.sections.join(', ') } : {}),
  }));
  for (const d of styles.diagnostics) {
    if (d.level !== 'error') continue;
    const at = d.sections?.map((id) => sectionIndex.get(id)).filter((i) => i !== undefined) ?? [];
    if (d.code === 'unknown-palette' && !at.length) issues.push({ path: ['palette'], message: d.message, level: 'error' });
    else if (at.length) for (const i of at) issues.push({ path: ['sections', i, 'style'], message: d.message, level: 'error' });
    else issues.push({ path: ['style'], message: d.message, level: 'error' });
  }

  // ── timing + words per section ──
  let timing: Validation['timing'];
  const rec = styles.job ? RECIPES[styles.job.recipe] : undefined;
  if (rec) {
    const fps = resolveQuality(spec.quality).fps;
    const bpm = previewBpm(spec, rec.defaults.music.bpm, store);
    try {
      const sheet = buildCueSheet({ spec, choreography: rec.choreography, bpm, fps });
      timing = {
        ok: true,
        bpm,
        sections: sheet.sections.map((s) => ({ id: s.id, in: s.timing.in, out: s.timing.out, items: s.items.length })),
      };
    } catch (e) {
      if (!(e instanceof TimingError)) throw e;
      timing = { ok: false, needed: e.needed, available: e.available, message: e.message };
      issues.push({ path: ['duration'], message: e.message, level: 'error' });
    }
    const max = rec.constraints.maxWordsPerSection;
    spec.sections.forEach((s, i) => {
      if (s.role === 'endcard' || !('text' in s)) return;
      const n = words(s.text).length;
      if (n > max) {
        issues.push({
          path: ['sections', i, 'text'],
          message: `${n} words; ${rec.name} shows up to ${max} per section, so split this into two sections`,
          level: 'warn',
        });
      }
    });
  }

  // ── contrast of every palette in use ──
  const inUse = new Map<string, ResolvedPalette>();
  for (const st of Object.values(styles.sections)) inUse.set(JSON.stringify(st.palette), st.palette);
  if (!inUse.size && styles.job) inUse.set(JSON.stringify(styles.job.palette), styles.job.palette);
  const contrastRows: Validation['contrast'] = [];
  for (const p of inUse.values()) {
    const name = paletteName(p);
    for (const color of [p.text, ...p.accents]) {
      const ratio = Math.round(contrast(color, p.bg) * 100) / 100;
      contrastRows.push({ palette: name, color, ratio });
      if (ratio < 3) {
        issues.push({
          path: ['palette'],
          message: `${color === p.text ? 'text' : 'accent'} ${color} on ${p.bg} has contrast ${ratio}:1 (want ≥ 3:1)`,
          level: 'warn',
        });
      }
    }
  }

  // ── glyph coverage ──
  const text = specText(spec);
  const missingGlyphs: Validation['missingGlyphs'] = [];
  for (const [id, path] of fontPaths) {
    const chars = missingChars(text, await fontCodepoints(path));
    if (!chars) continue;
    missingGlyphs.push({ font: id, chars });
    for (const slot of fontSlots.filter((k) => spec.fonts[k] === id)) {
      issues.push({ path: ['fonts', slot], message: `font "${id}" cannot draw ${[...chars].join(' ')}`, level: 'error' });
    }
  }

  const ok = !issues.some((i) => i.level === 'error') && !!styles.job && timing?.ok === true;
  return { ok, issues, ...(timing ? { timing } : {}), style, contrast: contrastRows, missingGlyphs };
}
