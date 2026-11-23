import { useEffect, useMemo } from 'react';
import { contrast, type FormatId, type ResolvedPalette } from '@reel/core';
import { loadFont, uiFamily } from '../fonts.ts';
import { paletteFromColors } from '../image.ts';
import { ALL_FORMATS, resolvePaletteInput, specTitle, styleBase } from '../spec.ts';
import { useStudio } from '../studio.tsx';
import { Icon, Segmented, StepHeader, Toggle } from '../ui.tsx';
import { MusicPicker } from './Music.tsx';

export function LookStep() {
  return (
    <section className="step" id="step-look">
      <StepHeader n={4} title="Look & sound" />
      <PalettePicker />
      <FontPicker />
      <MusicPicker />
      <Output />
    </section>
  );
}

export function PaletteChip({ p, size }: { p: ResolvedPalette; size?: 'sm' }) {
  return (
    <span className={`palette-chip ${size ?? ''}`} style={{ background: p.bg, color: p.text }}>
      <span className="aa">Aa</span>
      {p.accents.slice(0, 5).map((c, i) => (
        <span key={i} className="dot" style={{ background: c }} />
      ))}
    </span>
  );
}

function PalettePicker() {
  const s = useStudio();
  const current = s.spec.palette;
  const resolved = resolvePaletteInput(current, s.catalog.palettes);
  const kit = s.kits.find((k) => k.id === s.brandKit);
  const logoColors = useMemo(
    () => [...new Set(s.assets.filter((a) => a.kind === 'logo').flatMap((a) => (Array.isArray(a.meta['colors']) ? (a.meta['colors'] as string[]) : [])))],
    [s.assets],
  );
  const background = s.catalog.styles.find((x) => x.id === styleBase(s.spec.style))?.background ?? 'light';
  const custom = typeof current === 'object' ? current : null;
  const setCustom = (p: ResolvedPalette, key = 'palette-custom') => s.update((d) => ({ ...d, palette: p }), key);
  const warnings = (s.validation?.contrast ?? []).filter((c) => c.ratio < 3);
  const localWarn = custom ? custom.accents.concat(custom.text).filter((c) => contrast(c, custom.bg) < 3) : [];

  return (
    <div className="card" data-path="palette">
      <h3>Colours</h3>
      <div className="palette-grid" role="radiogroup" aria-label="Palettes">
        {Object.entries(s.catalog.palettes).map(([id, p]) => (
          <button key={id} role="radio" aria-checked={current === id} className={`palette-option ${current === id ? 'on' : ''}`} onClick={() => s.update((d) => ({ ...d, palette: id }))}>
            <PaletteChip p={p} />
            <span className="small">{id}</span>
          </button>
        ))}
        {kit?.palette ? (
          <button className={`palette-option ${custom && JSON.stringify(custom) === JSON.stringify(kit.palette) ? 'on' : ''}`} onClick={() => setCustom(kit.palette!, 'palette')}>
            <PaletteChip p={kit.palette} />
            <span className="small">Kit: {kit.name}</span>
          </button>
        ) : null}
        {logoColors.length ? (
          <button className="palette-option" onClick={() => setCustom(paletteFromColors(logoColors, background), 'palette')}>
            <PaletteChip p={paletteFromColors(logoColors, background)} />
            <span className="small">From your logos</span>
          </button>
        ) : null}
        <button className={`palette-option ${custom ? 'on' : ''}`} onClick={() => resolved && !custom && setCustom({ ...resolved, accents: resolved.accents.slice(0, 5) }, 'palette')}>
          {custom ? <PaletteChip p={custom} /> : <span className="palette-chip custom-chip">+</span>}
          <span className="small">Custom</span>
        </button>
      </div>

      {custom ? (
        <div className="custom-palette">
          <ColorInput label="Background" value={custom.bg} onChange={(v) => setCustom({ ...custom, bg: v })} />
          <ColorInput label="Text" value={custom.text} onChange={(v) => setCustom({ ...custom, text: v })} warn={contrast(custom.text, custom.bg) < 3} />
          {custom.accents.map((c, i) => (
            <ColorInput
              key={i}
              label={`Accent ${i + 1}`}
              value={c}
              warn={contrast(c, custom.bg) < 3}
              onChange={(v) => setCustom({ ...custom, accents: custom.accents.map((x, j) => (j === i ? v : x)) })}
              onRemove={custom.accents.length > 1 ? () => setCustom({ ...custom, accents: custom.accents.filter((_, j) => j !== i) }, 'palette') : undefined}
            />
          ))}
          {custom.accents.length < 5 ? (
            <button className="btn ghost sm" onClick={() => setCustom({ ...custom, accents: [...custom.accents, custom.text] }, 'palette')}>
              <Icon name="plus" size={14} /> Accent
            </button>
          ) : null}
        </div>
      ) : null}

      {warnings.length || localWarn.length ? (
        <ul className="contrast-list">
          {warnings.map((w, i) => (
            <li key={i}>
              <Icon name="warn" size={15} /> <span className="swatch sm" style={{ background: w.color }} /> {w.color} on {w.palette}: contrast {w.ratio.toFixed(1)}:1 (3:1 wanted)
            </li>
          ))}
          {!warnings.length
            ? localWarn.map((c) => (
                <li key={c}>
                  <Icon name="warn" size={15} /> <span className="swatch sm" style={{ background: c }} /> {c} is hard to read on {custom?.bg}
                </li>
              ))
            : null}
        </ul>
      ) : null}
    </div>
  );
}

function ColorInput({ label, value, onChange, warn, onRemove }: { label: string; value: string; onChange: (v: string) => void; warn?: boolean; onRemove?: (() => void) | undefined }) {
  return (
    <label className={`color-input ${warn ? 'warn' : ''}`}>
      <input type="color" value={value.length === 7 ? value.toLowerCase() : '#000000'} onChange={(e) => onChange(e.target.value.toUpperCase())} />
      <span>
        <span className="field-label">{label}</span>
        <span className="mono small">{value}</span>
      </span>
      {warn ? <Icon name="warn" size={14} /> : null}
      {onRemove ? (
        <button className="btn icon ghost sm" aria-label={`Remove ${label}`} onClick={(e) => (e.preventDefault(), onRemove())}>
          <Icon name="close" size={12} />
        </button>
      ) : null}
    </label>
  );
}

function FontPicker() {
  const s = useStudio();
  const fonts = s.catalog.fonts;
  useEffect(() => {
    for (const f of fonts) void loadFont(f);
  }, [fonts]);
  const title = specTitle(s.spec) || (s.spec.language === 'he' ? 'כותרת לדוגמה' : 'Your title here');
  const display = s.spec.fonts.display;
  const text = s.spec.fonts.text;
  const missing = s.validation?.missingGlyphs ?? [];
  const label = (id: string) => {
    const f = fonts.find((x) => x.id === id);
    return f ? `${f.family}${f.source === 'upload' ? ' (yours)' : ''}${f.scripts.includes('hebrew') ? '' : ' · Latin only'}` : id;
  };
  return (
    <div className="card" data-path="fonts">
      <h3>Fonts</h3>
      {!s.catalog.setup.fonts ? <p className="field-warn">The font library is not downloaded yet: run <code>pnpm reelgen setup fonts</code>.</p> : null}
      <div className="row gap wrap">
        <label className="field grow" data-path="fonts.display">
          <span className="field-label">Titles</span>
          <select value={display} onChange={(e) => s.update((d) => ({ ...d, fonts: { ...d.fonts, display: e.target.value } }))}>
            {fonts.some((f) => f.id === display) ? null : <option value={display}>{display}</option>}
            {fonts.map((f) => (
              <option key={f.id} value={f.id}>
                {label(f.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow" data-path="fonts.text">
          <span className="field-label">Small text</span>
          <select
            value={text ?? ''}
            onChange={(e) => s.update((d) => ({ ...d, fonts: e.target.value ? { display: d.fonts.display, text: e.target.value } : { display: d.fonts.display } }))}
          >
            <option value="">Same as titles</option>
            {fonts.map((f) => (
              <option key={f.id} value={f.id}>
                {label(f.id)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="font-sample" dir="auto" style={{ fontFamily: `${uiFamily(display)}, system-ui`, fontWeight: 800 }}>
        {title}
      </div>
      <div className="font-sample small-sample" dir="auto" style={{ fontFamily: `${uiFamily(text ?? display)}, system-ui` }}>
        {s.spec.language === 'he' ? 'יום שלישי · 19:30 · בית החאן' : 'Tuesday · 19:30 · The Old Inn'}
      </div>
      {missing.map((m) => (
        <p key={m.font} className="field-error">
          {label(m.font)} cannot draw: <span dir="auto">{m.chars}</span>
        </p>
      ))}
    </div>
  );
}

const QUALITY_TIME: Record<'draft' | 'standard' | 'final', [number, number]> = { draft: [0.4, 0.8], standard: [0.7, 1.6], final: [8, 15] };

export function estimate(q: 'draft' | 'standard' | 'final', duration: number, formats: number): string {
  const [lo, hi] = QUALITY_TIME[q].map((k) => k * duration * formats) as [number, number];
  const f = (x: number) => (x >= 90 ? `${Math.round(x / 60)} min` : `${Math.max(5, Math.round(x / 5) * 5)} s`);
  return `≈ ${f(lo)}–${f(hi)}`;
}

export function FormatChips({ value, onChange }: { value: FormatId[]; onChange: (v: FormatId[]) => void }) {
  return (
    <div className="chips" role="group" aria-label="Formats">
      {ALL_FORMATS.map((f) => {
        const on = value.includes(f);
        return (
          <button
            key={f}
            className={`chip format-chip ${on ? 'on' : ''}`}
            aria-pressed={on}
            onClick={() => (on ? value.length > 1 && onChange(value.filter((x) => x !== f)) : onChange([...value, f]))}
          >
            <span className={`ratio r-${f.replace(':', 'x')}`} aria-hidden="true" />
            {f}
            {on && value[0] === f ? <span className="muted small">preview</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function Output() {
  const s = useStudio();
  const q = typeof s.spec.quality === 'string' ? s.spec.quality : 'standard';
  return (
    <div className="card" data-path="formats">
      <h3>Output</h3>
      <Toggle label="Sound effects on the motion (whooshes, pops, ticks)" checked={s.spec.sfx ?? true} onChange={(v) => s.update((d) => ({ ...d, sfx: v }))} />
      <div className="field">
        <span className="field-label">Formats (the first one is previewed)</span>
        <FormatChips value={s.spec.formats} onChange={(formats) => s.update((d) => ({ ...d, formats }))} />
      </div>
      <div className="field" data-path="quality">
        <span className="field-label">Quality</span>
        <Segmented
          label="Quality"
          value={q}
          onChange={(v) => s.update((d) => ({ ...d, quality: v }))}
          options={[
            { value: 'draft', label: 'Draft', title: 'Quick check, fastest encode' },
            { value: 'standard', label: 'Standard', title: '30 fps, the default export' },
            { value: 'final', label: 'Final', title: '60 fps, motion blur, 2× supersampling' },
          ]}
        />
        <span className="field-hint">
          {estimate(q, s.spec.duration, s.spec.formats.length)} to render {s.spec.formats.length > 1 ? `${s.spec.formats.length} formats` : ''}
          {q === 'final' ? ' · 60 fps with motion blur' : ''}
        </span>
      </div>
    </div>
  );
}
