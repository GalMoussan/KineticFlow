import { useMemo, useState } from 'react';
import type { CatalogStyle, CatalogTrait } from '@reel/api';
import { materialGlow, sectionSketchLook, styleSketchLook, TRAIT_AXES, type SketchLook, type SketchLookOverrides, type SketchRecipes, type TraitAxis } from '@reel/core';
import { plain, ROLE_LABELS, sectionId, sectionText, styleBase, styleInput, styleObj, type StyleObj } from '../spec.ts';
import { useStudio } from '../studio.tsx';
import { Slider } from '../ui.tsx';

const AXIS_LABELS: Record<TraitAxis, string> = {
  rhythm: 'Rhythm',
  camera: 'Camera',
  layout: 'Layout',
  unit: 'Animate by',
  reveal: 'Reveal',
  motion: 'Motion',
  axis: 'Font axis',
  material: 'Material',
  background: 'Background',
  transition: 'Transition',
};

type Traits = Record<TraitAxis, string>;
/** Recipe param values (trait defaults with the recipe's overrides applied). */
function recipeParams(st: CatalogStyle | undefined): Record<string, number> {
  return st?.params ?? {};
}

/** The catalog's style looks, shaped for the core look resolver (the same one timing and the page input use). */
function sketchRecipes(styles: CatalogStyle[]): SketchRecipes {
  return Object.fromEntries(styles.map((x) => [x.id, { sketch: x.sketch }]));
}

const EXIT_LABELS: Record<SketchLook['exit'], string> = { stay: 'Stay', fade: 'Fade', undraw: 'Draw back' };
const SFX_LABELS: Record<SketchLook['sfx'], string> = { scribble: 'Scribble', pop: 'Pop', none: 'None' };

/**
 * Whether a style ref's text glows, from the catalog as `resolveStyles` resolves it: the material of the dominant side
 * (or the trait override), its glow param lerped across a blend (each side's own value, else the trait default), then
 * the ref's own params. The predicate is `materialGlow`, the one the page's sketch overlays use.
 */
function textGlows(ref: StyleObj, styles: CatalogStyle[], traits: CatalogTrait[]): boolean {
  const a = styles.find((x) => x.id === ref.base);
  if (!a) return false;
  const b = ref.blendWith ? styles.find((x) => x.id === ref.blendWith!.style) : undefined;
  const mix = ref.blendWith?.mix ?? 0;
  const material = ref.traits?.material ?? (b && mix >= 0.5 ? b : a).traits.material;
  const spec = traits.find((t) => t.axis === 'material' && t.id === material);
  const params: Record<string, number> = {};
  for (const [p, ps] of Object.entries(spec?.params ?? {})) {
    const k = `material.${p}`;
    const va = a.params[k] ?? ps.default;
    params[k] = ref.params?.[k] ?? (b ? va + ((b.params[k] ?? ps.default) - va) * mix : va);
  }
  return materialGlow(material, params) !== null;
}

/** A resolved look in a few words for the per-section strip, e.g. "rough · wobble · draw back" or "line · glow · fade". */
function lookLabel(l: SketchLook, glows: boolean): string {
  return [l.presetMode === 'line' ? 'line' : '', glows && l.glow > 0 ? 'glow' : l.rough > 0 ? 'rough' : 'clean', l.boil ? 'wobble' : '', EXIT_LABELS[l.exit].toLowerCase()]
    .filter(Boolean)
    .join(' · ');
}

/** Why `cand` cannot sit on `axis` next to the other effective traits (empty = compatible). */
export function incompatibility(cand: CatalogTrait, axis: TraitAxis, eff: Traits, byId: Map<string, CatalogTrait>, roles: string[]): string[] {
  const traits = { ...eff, [axis]: cand.id };
  const reasons: string[] = [];
  for (const [o, ids] of Object.entries(cand.requires ?? {}) as [TraitAxis, string[]][]) {
    if (!ids.includes(traits[o])) reasons.push(`needs ${AXIS_LABELS[o].toLowerCase()} ${ids.join(' or ')}`);
  }
  for (const [o, ids] of Object.entries(cand.excludes ?? {}) as [TraitAxis, string[]][]) {
    if (ids.includes(traits[o])) reasons.push(`doesn’t work with ${AXIS_LABELS[o].toLowerCase()} ${traits[o]}`);
  }
  for (const o of TRAIT_AXES) {
    if (o === axis) continue;
    const t = byId.get(`${o}:${traits[o]}`);
    const req = t?.requires?.[axis];
    if (req && !req.includes(cand.id)) reasons.push(`${AXIS_LABELS[o].toLowerCase()} ${t.id} needs ${req.join(' or ')}`);
    if (t?.excludes?.[axis]?.includes(cand.id)) reasons.push(`${AXIS_LABELS[o].toLowerCase()} ${t.id} rules it out`);
  }
  if (axis === 'layout' && cand.roles) {
    const missing = [...new Set(roles.filter((r) => !cand.roles!.includes(r)))];
    if (missing.length) reasons.push(`can’t lay out ${missing.join(', ')}`);
  }
  return reasons;
}

export function Mixer() {
  const s = useStudio();
  const obj = styleObj(s.spec.style);
  const styles = s.catalog.styles;
  const base = styles.find((x) => x.id === obj.base);
  const partner = obj.blendWith ? styles.find((x) => x.id === obj.blendWith!.style) : undefined;
  const byId = useMemo(() => new Map(s.catalog.traits.map((t) => [`${t.axis}:${t.id}`, t])), [s.catalog.traits]);
  const roles = s.spec.sections.map((x) => x.role);
  const dominant = partner && (obj.blendWith?.mix ?? 0) >= 0.5 ? partner : base;
  const recipeTraits = (dominant?.traits ?? {}) as Traits;
  const eff = { ...recipeTraits, ...(obj.traits ?? {}) } as Traits;
  const setObj = (fn: (o: StyleObj) => StyleObj, key?: string) => s.update((d) => ({ ...d, style: styleInput(fn(styleObj(d.style))) }), key);
  const overrides =
    Object.keys(obj.traits ?? {}).length + Object.keys(obj.params ?? {}).length + (obj.blendWith ? 1 : 0) + Object.keys(s.spec.sketchLook ?? {}).length;
  const recipes = useMemo(() => sketchRecipes(styles), [styles]);

  if (!base) return null;
  return (
    <details className="card mixer" data-path="style">
      <summary>
        <span>Advanced: mix styles</span>
        {overrides ? <span className="badge">{overrides} change{overrides > 1 ? 's' : ''}</span> : <span className="muted small">trait overrides, blends, per-section styles</span>}
      </summary>

      <h4>Blend with another style</h4>
      <div className="row gap wrap align-end">
        <label className="field">
          <span className="field-label">Partner</span>
          <select
            value={obj.blendWith?.style ?? ''}
            onChange={(e) =>
              setObj((o) => {
                const { blendWith: _b, ...rest } = o;
                return e.target.value ? { ...rest, blendWith: { style: e.target.value, mix: o.blendWith?.mix ?? 0.3 } } : rest;
              })
            }
          >
            <option value="">None</option>
            {styles
              .filter((x) => x.id !== base.id)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </select>
        </label>
        {obj.blendWith ? (
          <div className="grow">
            <Slider
              label={`${base.name} ↔ ${partner?.name ?? obj.blendWith.style}`}
              value={obj.blendWith.mix}
              min={0}
              max={1}
              step={0.05}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => setObj((o) => ({ ...o, blendWith: { style: o.blendWith!.style, mix: v } }), 'blend-mix')}
            />
            <p className="muted small">Below 50% the motion comes from {base.name}; numbers blend smoothly either way.</p>
          </div>
        ) : null}
      </div>

      <h4>Trait overrides</h4>
      <div className="trait-grid">
        {TRAIT_AXES.map((axis) => {
          const options = s.catalog.traits.filter((t) => t.axis === axis);
          const override = obj.traits?.[axis];
          return (
            <label key={axis} className={`field ${override ? 'overridden' : ''}`}>
              <span className="field-label">{AXIS_LABELS[axis]}</span>
              <select
                value={override ?? ''}
                onChange={(e) =>
                  setObj((o) => {
                    const traits = { ...(o.traits ?? {}) };
                    if (e.target.value) traits[axis] = e.target.value;
                    else delete traits[axis];
                    // Params of a replaced trait no longer apply.
                    const params = Object.fromEntries(Object.entries(o.params ?? {}).filter(([k]) => !k.startsWith(`${axis}.`)));
                    return { ...o, traits, params };
                  })
                }
              >
                <option value="">Style default ({recipeTraits[axis] ?? '—'})</option>
                {options.map((t) => {
                  const why = incompatibility(t, axis, eff, byId, roles);
                  return (
                    <option key={t.id} value={t.id} disabled={why.length > 0 && t.id !== override} title={why.join('; ')}>
                      {t.label}
                      {why.length ? ` — ${why[0]}` : ''}
                    </option>
                  );
                })}
              </select>
            </label>
          );
        })}
      </div>

      <h4>Fine-tune</h4>
      <div className="param-grid">
        {TRAIT_AXES.flatMap((axis) => {
          const t = byId.get(`${axis}:${eff[axis]}`);
          if (!t) return [];
          return Object.entries(t.params).map(([name, spec]) => {
            const k = `${axis}.${name}`;
            const own = obj.params?.[k];
            const value = own ?? recipeParams(dominant)[k] ?? spec.default;
            const step = spec.max - spec.min > 20 ? 1 : (spec.max - spec.min) / 100;
            return (
              <Slider
                key={k}
                label={`${spec.label} · ${AXIS_LABELS[axis].toLowerCase()}`}
                value={value}
                min={spec.min}
                max={spec.max}
                step={step}
                format={(v) => (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(Math.abs(v) < 0.1 ? 3 : 2))}
                onChange={(v) => setObj((o) => ({ ...o, params: { ...(o.params ?? {}), [k]: v } }), `param-${k}`)}
                onReset={
                  own === undefined
                    ? undefined
                    : () =>
                        setObj((o) => {
                          const params = { ...(o.params ?? {}) };
                          delete params[k];
                          return { ...o, params };
                        })
                }
              />
            );
          });
        })}
      </div>

      <SketchTune recipes={recipes} />

      <SectionStyles recipes={recipes} />
    </details>
  );
}

/**
 * Fine-tune for sketches: the job-level `sketchLook` over every section style's look (each sketch's own `look` still
 * wins). Defaults shown are the video style's look, blend included.
 */
function SketchTune({ recipes }: { recipes: SketchRecipes }) {
  const s = useStudio();
  const own = s.spec.sketchLook ?? {};
  const style = styleSketchLook(s.spec.style, recipes);
  const set = <K extends keyof SketchLook>(field: K, value: SketchLook[K] | undefined, key?: string) =>
    s.update((d) => {
      const next: SketchLookOverrides = { ...(d.sketchLook ?? {}) };
      if (value === undefined) delete next[field];
      else next[field] = value;
      const { sketchLook: _old, ...rest } = d;
      return Object.keys(next).length ? { ...rest, sketchLook: next } : rest;
    }, key);
  const slider = (field: 'width' | 'rough' | 'drawBeats', label: string, min: number, max: number, step: number, format: (v: number) => string) => (
    <Slider
      label={label}
      value={own[field] ?? style[field]}
      min={min}
      max={max}
      step={step}
      format={format}
      onChange={(v) => set(field, v, `sketch-${field}`)}
      onReset={own[field] === undefined ? undefined : () => set(field, undefined)}
    />
  );
  const choice = <K extends 'boil' | 'exit' | 'sfx'>(field: K, label: string, options: [SketchLook[K], string][]) => {
    const name = (v: SketchLook[K]) => options.find(([o]) => o === v)?.[1] ?? String(v);
    return (
      <label className={`field ${own[field] === undefined ? '' : 'overridden'}`}>
        <span className="field-label">{label}</span>
        <select
          value={own[field] === undefined ? '' : String(own[field])}
          onChange={(e) => set(field, e.target.value === '' ? undefined : options.find(([o]) => String(o) === e.target.value)![0])}
        >
          <option value="">Style default ({name(style[field])})</option>
          {options.map(([v, text]) => (
            <option key={String(v)} value={String(v)}>
              {text}
            </option>
          ))}
        </select>
      </label>
    );
  };
  return (
    <div data-path="sketchLook">
      <h4>Sketch</h4>
      <div className="param-grid">
        {slider('width', 'Width', 0.25, 4, 0.05, (v) => `${v.toFixed(2)}×`)}
        {slider('rough', 'Roughness', 0, 1, 0.05, (v) => v.toFixed(2))}
        {slider('drawBeats', 'Draw speed', 0.5, 8, 0.5, (v) => `${v} beat${v === 1 ? '' : 's'}`)}
      </div>
      <div className="trait-grid">
        {choice('boil', 'Wobble', [[true, 'On'], [false, 'Off']])}
        {choice('exit', 'Exit', Object.entries(EXIT_LABELS) as [SketchLook['exit'], string][])}
        {choice('sfx', 'Sound', Object.entries(SFX_LABELS) as [SketchLook['sfx'], string][])}
      </div>
    </div>
  );
}

function SectionStyles({ recipes }: { recipes: SketchRecipes }) {
  const s = useStudio();
  const [sel, setSel] = useState(0);
  const sections = s.spec.sections;
  const sec = sections[Math.min(sel, sections.length - 1)];
  const idx = Math.min(sel, sections.length - 1);
  if (!sec) return null;
  const sketched = sections.some((x) => x.role !== 'endcard' && (x.sketches?.length ?? 0) > 0);
  const setField = (field: 'style' | 'palette', value: string) =>
    s.update((d) => ({
      ...d,
      sections: d.sections.map((x, j) => {
        if (j !== idx) return x;
        const n = { ...x } as Record<string, unknown>;
        if (value) n[field] = value;
        else delete n[field];
        return n as typeof x;
      }),
    }));
  const own = styleBase(sec.style);
  return (
    <>
      <h4>Per-section style</h4>
      <div className="section-strip" role="tablist" aria-label="Sections">
        {sections.map((x, i) => {
          const st = styleBase(x.style);
          return (
            <button key={i} role="tab" aria-selected={i === idx} className={`strip-item ${i === idx ? 'on' : ''} ${st ? 'custom' : ''}`} onClick={() => setSel(i)}>
              <span className="strip-role">{ROLE_LABELS[x.role] ?? x.role}</span>
              <span className="strip-text ellipsis" dir="auto">
                {plain(sectionText(x)) || sectionId(x, i)}
              </span>
              {st ? <span className="strip-style">{s.catalog.styles.find((c) => c.id === st)?.name ?? st}</span> : null}
              {sketched && x.role !== 'endcard' ? (
                <span className="strip-sketch" title="How this section draws its sketches">
                  ✎ {lookLabel(sectionSketchLook(s.spec, x, undefined, recipes), textGlows(styleObj(x.style ?? s.spec.style), s.catalog.styles, s.catalog.traits))}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="row gap wrap">
        <label className="field grow">
          <span className="field-label">Style of “{ROLE_LABELS[sec.role]}”</span>
          <select value={own ?? ''} onChange={(e) => setField('style', e.target.value)}>
            <option value="">Same as the video</option>
            {s.catalog.styles.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span className="field-label">Palette of this section</span>
          <select value={typeof sec.palette === 'string' ? sec.palette : ''} onChange={(e) => setField('palette', e.target.value)}>
            <option value="">{own ? 'The section style’s own palette' : 'The video palette'}</option>
            {Object.keys(s.catalog.palettes).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}
