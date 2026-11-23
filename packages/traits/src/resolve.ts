/**
 * Style resolution (PLAN.md §5.3): spec + recipes + trait metadata → one `ResolvedStyle` per section, the scene
 * layers (world chains) and diagnostics. Pure and bit-exact (+ − × ÷ only), so Node and the browser agree.
 */
import {
  resolvePalette,
  TRAIT_AXES,
  type FormatId,
  type PaletteRef,
  type ResolvedPalette,
  type ResolvedStyle,
  type Scene,
  type SectionRole,
  type StyleRecipe,
  type StyleRef,
  type TraitAxis,
  type TraitMeta,
} from '@reel/core';

/** A style before its palette is decided (that depends on the section, not on the style reference). */
type Styled = Omit<ResolvedStyle, 'palette'>;

export type DiagnosticCode =
  | 'unknown-style'
  | 'unknown-trait'
  | 'unknown-param'
  | 'param-range'
  | 'signature'
  | 'requires'
  | 'excludes'
  | 'role'
  | 'format'
  | 'needs'
  | 'unknown-palette'
  | 'transition-fallback';

export interface StyleDiagnostic {
  /** `error` blocks rendering; `warn` is recorded in QA and the receipt. */
  level: 'error' | 'warn';
  code: DiagnosticCode;
  /** Sections the diagnostic applies to (absent: a recipe or the job style). */
  sections?: string[];
  message: string;
}

export interface StyleResolution {
  /** `spec.style` resolved: its dominant recipe sets choreography, music defaults and the job-wide params. */
  job: ResolvedStyle | null;
  /** Section id → effective style (transition after fallback). Empty when there are errors. */
  sections: Record<string, ResolvedStyle>;
  scenes: Scene[];
  diagnostics: StyleDiagnostic[];
}

export interface StyleSpec {
  style: StyleRef;
  /** The job palette: it colours the sections of the job's own dominant style. */
  palette: PaletteRef;
  formats: readonly FormatId[];
  sections: readonly { id: string; role: SectionRole; style?: StyleRef | undefined; palette?: PaletteRef | undefined }[];
}

/** The transition every invalid transition falls back to. */
export const FALLBACK_TRANSITION = 'cut';

const key = (axis: string, id: string) => `${axis}/${id}`;
const list = (xs: readonly string[]) => `{${xs.join(', ')}}`;

export function resolveStyles(
  spec: StyleSpec,
  recipes: Readonly<Record<string, StyleRecipe>>,
  traits: readonly TraitMeta[],
): StyleResolution {
  const meta = new Map(traits.map((m) => [key(m.axis, m.id), m]));
  const find = (axis: TraitAxis, id: string) => meta.get(key(axis, id));
  const diags: StyleDiagnostic[] = [];
  const err = (code: DiagnosticCode, message: string, section?: string) => {
    const same = diags.find((d) => d.level === 'error' && d.code === code && d.message === message);
    if (same) {
      if (section && !same.sections?.includes(section)) (same.sections ??= []).push(section);
      return;
    }
    diags.push({ level: 'error', code, message, ...(section ? { sections: [section] } : {}) });
  };

  // ── recipes are checked once, wherever they are used ──
  const checked = new Map<string, boolean>();
  const recipeOk = (r: StyleRecipe): boolean => {
    let ok = checked.get(r.id);
    if (ok !== undefined) return ok;
    ok = true;
    for (const axis of TRAIT_AXES) {
      if (!find(axis, r.traits[axis])) {
        err('unknown-trait', `style "${r.id}": unknown ${axis} trait "${r.traits[axis]}"`);
        ok = false;
      }
    }
    for (const [k, v] of Object.entries(r.params)) {
      const [axis, p] = k.split('.') as [TraitAxis, string];
      const spec = find(axis, r.traits[axis] ?? '')?.params[p];
      if (!spec) {
        err('unknown-param', `style "${r.id}": param "${k}" is not a param of its ${axis} trait "${r.traits[axis] ?? '?'}"`);
        ok = false;
      } else if (v < spec.min || v > spec.max) {
        err('param-range', `style "${r.id}": param "${k}" = ${v} is outside [${spec.min}, ${spec.max}]`);
        ok = false;
      }
    }
    checked.set(r.id, ok);
    return ok;
  };

  /** A recipe's value for `<axis>.<p>`: its override, else its own trait's default, else the final trait's default. */
  const valueIn = (r: StyleRecipe, axis: TraitAxis, p: string, fallback: number): number =>
    r.params[`${axis}.${p}`] ?? find(axis, r.traits[axis])?.params[p]?.default ?? fallback;

  const cache = new Map<string, Styled | null>();
  const resolveRef = (ref: StyleRef, section?: string): Styled | null => {
    const id = JSON.stringify(ref);
    if (cache.has(id)) return cache.get(id)!;
    const out = resolveUncached(typeof ref === 'string' ? { base: ref } : ref, section);
    cache.set(id, out);
    return out;
  };
  const resolveUncached = (ref: Exclude<StyleRef, string>, section?: string): Styled | null => {
    const a = recipes[ref.base];
    if (!a) return err('unknown-style', `unknown style "${ref.base}" (known: ${Object.keys(recipes).join(', ')})`, section), null;
    const b = ref.blendWith ? recipes[ref.blendWith.style] : undefined;
    if (ref.blendWith && !b) {
      return err('unknown-style', `unknown style "${ref.blendWith.style}" (known: ${Object.keys(recipes).join(', ')})`, section), null;
    }
    if (!recipeOk(a) || (b && !recipeOk(b))) return null;
    const mix = ref.blendWith?.mix ?? 0;
    const dominant = b && mix >= 0.5 ? b : a;

    const traits = { ...dominant.traits } as Record<TraitAxis, string>;
    const locked = new Set(dominant.signature?.owns ?? []);
    let ok = true;
    for (const [axis, id] of Object.entries(ref.traits ?? {}) as [TraitAxis, string][]) {
      if (locked.has(axis)) {
        err('signature', `style "${dominant.id}": axis ${axis} belongs to its signature module "${dominant.signature!.module}" and cannot be overridden`, section);
        ok = false;
      } else if (!find(axis, id)) {
        err('unknown-trait', `unknown ${axis} trait "${id}"`, section);
        ok = false;
      } else traits[axis] = id;
    }
    if (!ok) return null;

    const params: Record<string, number> = {};
    for (const axis of TRAIT_AXES) {
      for (const [p, spec] of Object.entries(find(axis, traits[axis])!.params)) {
        const va = valueIn(a, axis, p, spec.default);
        params[`${axis}.${p}`] = b ? va + (valueIn(b, axis, p, spec.default) - va) * mix : va;
      }
    }
    for (const [k, v] of Object.entries(ref.params ?? {})) {
      const [axis, p] = k.split('.') as [TraitAxis, string];
      const spec = TRAIT_AXES.includes(axis) ? find(axis, traits[axis])?.params[p] : undefined;
      if (!spec) {
        err('unknown-param', `param "${k}" is not a param of the ${axis} trait "${traits[axis] ?? '?'}"`, section);
        ok = false;
      } else if (v < spec.min || v > spec.max) {
        err('param-range', `param "${k}" = ${v} is outside [${spec.min}, ${spec.max}]`, section);
        ok = false;
      } else params[k] = v;
    }
    return ok ? { recipe: dominant.id, traits, params } : null;
  };

  /** requires/excludes, roles, formats and needs of one section's style. */
  const compat = (st: Styled, s: StyleSpec['sections'][number]) => {
    const r = recipes[st.recipe]!;
    for (const axis of TRAIT_AXES) {
      const m = find(axis, st.traits[axis])!;
      for (const [other, ids] of Object.entries(m.requires ?? {}) as [TraitAxis, readonly string[]][]) {
        if (!ids.includes(st.traits[other])) {
          err('requires', `${axis}:${m.id} requires ${other} ∈ ${list(ids)}, got ${other}:${st.traits[other]}`, s.id);
        }
      }
      for (const [other, ids] of Object.entries(m.excludes ?? {}) as [TraitAxis, readonly string[]][]) {
        if (ids.includes(st.traits[other])) err('excludes', `${axis}:${m.id} excludes ${other}:${st.traits[other]}`, s.id);
      }
      if (m.formats) {
        const bad = spec.formats.filter((f) => !m.formats!.includes(f));
        if (bad.length) err('format', `${axis}:${m.id} does not support format(s) ${bad.join(', ')}`, s.id);
      }
      if (m.needs?.chars && find('unit', st.traits.unit)!.chars === false) {
        err('needs', `${axis}:${m.id} needs grapheme units, but unit:${st.traits.unit} cannot split into graphemes`, s.id);
      }
    }
    const layout = find('layout', st.traits.layout)!;
    if (!(layout.roles ?? []).includes(s.role)) err('role', `layout:${layout.id} cannot lay out role "${s.role}"`, s.id);
    if (!r.constraints.roles.includes(s.role)) err('role', `style "${r.id}" cannot lay out role "${s.role}"`, s.id);
    const bad = spec.formats.filter((f) => !r.constraints.formats.includes(f));
    if (bad.length) err('format', `style "${r.id}" does not support format(s) ${bad.join(', ')}`, s.id);
  };

  const paletteOf = (ref: PaletteRef, section?: string): ResolvedPalette | null => {
    try {
      return resolvePalette(ref);
    } catch (e) {
      return err('unknown-palette', (e as Error).message, section), null;
    }
  };
  const jobStyle = resolveRef(spec.style);
  const jobPalette = paletteOf(spec.palette);
  const job = jobStyle && jobPalette ? { ...jobStyle, palette: jobPalette } : null;
  const styles: Record<string, ResolvedStyle> = {};
  for (const s of spec.sections) {
    const st = s.style ? resolveRef(s.style, s.id) : jobStyle;
    if (!st) continue;
    compat(st, s);
    // own palette, else the job's for the job's own style, else the section style's default palette
    const palette = s.palette
      ? paletteOf(s.palette, s.id)
      : st.recipe === jobStyle?.recipe
        ? jobPalette
        : paletteOf(recipes[st.recipe]!.defaults.palette, s.id);
    if (palette) styles[s.id] = { recipe: st.recipe, traits: { ...st.traits }, params: { ...st.params }, palette };
  }
  if (diags.some((d) => d.level === 'error')) return { job, sections: {}, scenes: [], diagnostics: diags };

  // ── scene layers: world chains and transition fallbacks ──
  const worldOf = (st: Styled) => !!find('layout', st.traits.layout)!.world && !!find('camera', st.traits.camera)!.world;
  /** One layer has one background, camera and palette: these must agree for two sections to share a world. */
  const shared = (a: ResolvedStyle, b: ResolvedStyle) =>
    JSON.stringify(a.palette) === JSON.stringify(b.palette) &&
    (['layout', 'camera', 'background'] as const).every(
      (axis) =>
        a.traits[axis] === b.traits[axis] &&
        Object.keys(a.params).every((k) => !k.startsWith(`${axis}.`) || a.params[k] === b.params[k]),
    );
  const scenes: Scene[] = [];
  spec.sections.forEach((s, i) => {
    const st = styles[s.id]!;
    const cur = scenes.at(-1);
    if (i > 0 && cur) {
      const prev = styles[spec.sections[i - 1]!.id]!;
      const tr = find('transition', st.traits.transition)!;
      if (tr.scope === 'world') {
        if (cur.world && worldOf(st) && shared(prev, st)) {
          cur.sections.push(s.id);
          return;
        }
        const why = !cur.world
          ? `the previous section is not in a world layout`
          : !worldOf(st)
            ? `layout:${st.traits.layout} + camera:${st.traits.camera} is not a shared world`
            : `layout/camera/background or palette differ from the previous section`;
        const cut = find('transition', FALLBACK_TRANSITION);
        if (!cut) throw new Error(`trait registry lacks the fallback transition "${FALLBACK_TRANSITION}"`);
        diags.push({
          level: 'warn',
          code: 'transition-fallback',
          sections: [s.id],
          message: `transition:${tr.id} into "${s.id}" is invalid (${why}); falling back to transition:${cut.id}`,
        });
        for (const k of Object.keys(st.params)) if (k.startsWith('transition.')) delete st.params[k];
        for (const [p, spec] of Object.entries(cut.params)) st.params[`transition.${p}`] = spec.default;
        st.traits.transition = cut.id;
      }
    }
    scenes.push({ sections: [s.id], world: worldOf(st) });
  });
  return { job, sections: styles, scenes, diagnostics: diags };
}

/** Throws one readable error listing every `error` diagnostic. */
export function assertResolved(r: StyleResolution): asserts r is StyleResolution & { job: ResolvedStyle } {
  const errors = r.diagnostics.filter((d) => d.level === 'error');
  if (!errors.length && r.job) return;
  throw new Error(`style resolution failed:\n${formatDiagnostics(errors)}`);
}

export function formatDiagnostics(ds: readonly StyleDiagnostic[]): string {
  return ds.map((d) => `  ${d.level} [${d.code}]${d.sections ? ` (${d.sections.join(', ')})` : ''}: ${d.message}`).join('\n');
}

/** Every trait the resolved sections use, in axis order then id: what the page bundle must contain. */
export function usedTraits(r: StyleResolution): { axis: TraitAxis; id: string }[] {
  const seen = new Set<string>();
  const out: { axis: TraitAxis; id: string }[] = [];
  for (const axis of TRAIT_AXES) {
    for (const id of [...new Set(Object.values(r.sections).map((s) => s.traits[axis]))].sort()) {
      if (!seen.has(key(axis, id))) {
        seen.add(key(axis, id));
        out.push({ axis, id });
      }
    }
  }
  return out;
}
