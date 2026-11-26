/** `GET /api/catalog`: styles, traits, palettes, fonts (catalog + uploads), music presets, formats, roles, setup state. */
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Catalog, CatalogFont, CatalogStyle, CatalogTrait } from '@reel/api';
import { PRESET_INFO } from '@reel/audio';
import { FONTS, FORMATS, PALETTES, styleSketchLook, TEXT_ROLES, TRAIT_AXES, type FormatId, type SectionRole } from '@reel/core';
import { checkSamples, FONT_DIR, MODEL_PATH, musicAiReady, REPO } from '@reel/render';
import { RECIPES } from '@reel/styles';
import { TRAIT_META } from '@reel/traits';
import { configuredProviders } from './llm/index.ts';
import type { Store } from './store.ts';

export const ROLES: SectionRole[] = ['title', ...TEXT_ROLES, 'datetime', 'location', 'list', 'stat', 'countdown', 'lyric', 'endcard'];

const exists = (p: string) => access(p).then(() => true, () => false);

export function catalogStyles(): CatalogStyle[] {
  return Object.values(RECIPES).map((r) => {
    const params: Record<string, number> = {};
    for (const axis of TRAIT_AXES) {
      const m = TRAIT_META.find((t) => t.axis === axis && t.id === r.traits[axis]);
      for (const [p, spec] of Object.entries(m?.params ?? {})) params[`${axis}.${p}`] = r.params[`${axis}.${p}`] ?? spec.default;
    }
    return {
      id: r.id,
      name: r.name,
      families: [...r.families],
      energy: r.energy,
      background: r.background,
      traits: r.traits as CatalogStyle['traits'],
      defaults: {
        palette: r.defaults.palette,
        music: { ...r.defaults.music },
        fonts: { display: r.defaults.fonts.display, ...(r.defaults.fonts.text ? { text: r.defaults.fonts.text } : {}) },
      },
      formats: [...r.constraints.formats],
      roles: [...r.constraints.roles],
      maxWordsPerSection: r.constraints.maxWordsPerSection,
      params,
      sketch: styleSketchLook(r.id, RECIPES),
    };
  });
}

export function catalogTraits(): CatalogTrait[] {
  return TRAIT_META.map((m) => ({
    id: m.id,
    axis: m.axis,
    label: m.label,
    layer: m.layer,
    params: { ...m.params },
    ...(m.requires ? { requires: Object.fromEntries(Object.entries(m.requires).map(([k, v]) => [k, [...v]])) } : {}),
    ...(m.excludes ? { excludes: Object.fromEntries(Object.entries(m.excludes).map(([k, v]) => [k, [...v]])) } : {}),
    ...(m.roles ? { roles: [...m.roles] } : {}),
  }));
}

export function catalogFonts(store: Store): CatalogFont[] {
  const catalog: CatalogFont[] = Object.entries(FONTS).map(([id, f]) => ({
    id,
    family: f.family,
    weights: f.weights,
    scripts: [...f.scripts],
    source: 'catalog',
    url: `/files/fonts/${encodeURIComponent(f.file)}`,
  }));
  const uploads: CatalogFont[] = store.listAssets('font').map((a) => ({
    id: a.id,
    family: String(a.meta.family ?? a.name),
    weights: (a.meta.weights as [number, number] | undefined) ?? [400, 400],
    scripts: (a.meta.scripts as CatalogFont['scripts'] | undefined) ?? [],
    source: 'upload',
    url: a.url,
  }));
  return [...catalog, ...uploads];
}

export async function setupState(): Promise<Catalog['setup']> {
  const [fonts, samples, analysis, musicAi] = await Promise.all([
    Promise.all(Object.values(FONTS).map((f) => exists(join(FONT_DIR, f.file)))).then((xs) => xs.every(Boolean)),
    checkSamples().then(() => true, () => false),
    Promise.all([exists(join(REPO, 'sidecar/.venv/bin/python')), exists(MODEL_PATH)]).then((xs) => xs.every(Boolean)),
    musicAiReady(),
  ]);
  return { fonts, samples, analysis, musicAi, llm: configuredProviders() };
}

export async function catalog(store: Store): Promise<Catalog> {
  return {
    styles: catalogStyles(),
    traits: catalogTraits(),
    palettes: { ...PALETTES },
    fonts: catalogFonts(store),
    music: PRESET_INFO.map((p) => ({ ...p, bpm: [...p.bpm] as [number, number] })),
    formats: (Object.keys(FORMATS) as FormatId[]).map((id) => ({ id, w: FORMATS[id].w, h: FORMATS[id].h })),
    roles: ROLES,
    setup: await setupState(),
  };
}
