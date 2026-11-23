import { useEffect, useRef, useState } from 'react';
import type { Asset } from '@reel/api';
import { api, errorMessage } from '../api.ts';
import { canvasBlob, decodeImage, paletteFromColors, processLogo, type LogoOptions, type ProcessedLogo } from '../image.ts';
import { resolvePaletteInput, styleBase } from '../spec.ts';
import { useStudio } from '../studio.tsx';
import { Empty, Icon, Slider, StepHeader, Toggle } from '../ui.tsx';

interface Pending {
  key: number;
  file: File;
  originalUrl: string;
  bmp: ImageBitmap | null;
  opts: LogoOptions;
  result: ProcessedLogo | null;
  resultUrl: string | null;
  useOriginal: boolean;
  busy: boolean;
}

const DEFAULT_OPTS: LogoOptions = { removeBackground: true, tolerance: 18, trim: true };

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

function assetColors(a: Asset): string[] {
  const c = a.meta['colors'];
  return Array.isArray(c) ? c.filter((x): x is string => typeof x === 'string') : [];
}

export function BrandStep() {
  return (
    <section className="step" id="step-brand">
      <StepHeader n={2} title="Brand" />
      <Logos />
      <FontUpload />
      <BrandKits />
    </section>
  );
}

function Logos() {
  const s = useStudio();
  const [pending, setPending] = useState<Pending[]>([]);
  const [hover, setHover] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const keyRef = useRef(0);
  const logos = s.assets.filter((a) => a.kind === 'logo');

  const run = (p: Pending): Pending => {
    if (!p.bmp) return p;
    const result = processLogo(p.bmp, p.opts);
    return { ...p, result, resultUrl: result.canvas.toDataURL('image/png') };
  };

  const addFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type) && !/\.(png|jpe?g|webp|svg)$/i.test(file.name)) {
        s.toast(`${file.name}: drop PNG, JPEG, WebP or SVG files`, { tone: 'error' });
        continue;
      }
      const key = ++keyRef.current;
      const base: Pending = { key, file, originalUrl: URL.createObjectURL(file), bmp: null, opts: DEFAULT_OPTS, result: null, resultUrl: null, useOriginal: false, busy: false };
      if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
        setPending((ps) => [...ps, { ...base, useOriginal: true }]);
        continue;
      }
      try {
        const bmp = await decodeImage(file);
        setPending((ps) => [...ps, run({ ...base, bmp })]);
      } catch (e) {
        s.toast(`${file.name}: ${errorMessage(e)}`, { tone: 'error' });
      }
    }
  };

  const change = (key: number, fn: (p: Pending) => Pending) => setPending((ps) => ps.map((p) => (p.key === key ? fn(p) : p)));
  const drop = (key: number) =>
    setPending((ps) => {
      const p = ps.find((x) => x.key === key);
      if (p) {
        URL.revokeObjectURL(p.originalUrl);
        p.bmp?.close();
      }
      return ps.filter((x) => x.key !== key);
    });

  const upload = async (p: Pending) => {
    change(p.key, (x) => ({ ...x, busy: true }));
    try {
      const processed = p.useOriginal ? null : p.result;
      const blob = processed ? await canvasBlob(processed.canvas) : p.file;
      const asset = await api.upload(blob, 'logo', processed ? `${baseName(p.file.name)}.png` : p.file.name);
      await s.refreshAssets();
      // Put the new logo on the end card when there is room.
      s.update((d) => ({
        ...d,
        sections: d.sections.map((sec) => (sec.role === 'endcard' && sec.logos.length < 4 && !sec.logos.includes(asset.id) ? { ...sec, logos: [...sec.logos, asset.id] } : sec)),
      }));
      drop(p.key);
      s.toast(`Added logo “${asset.name}”`, { tone: 'ok' });
    } catch (e) {
      change(p.key, (x) => ({ ...x, busy: false }));
      s.toast(`Upload failed: ${errorMessage(e)}`, { tone: 'error' });
    }
  };

  const allColors = [...new Set([...logos.flatMap(assetColors), ...pending.flatMap((p) => p.result?.colors ?? [])])];
  const background = s.catalog.styles.find((x) => x.id === styleBase(s.spec.style))?.background ?? 'light';

  return (
    <div className="card">
      <h3>Logos</h3>
      <div
        className={`dropzone ${hover ? 'hover' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setHover(true);
        }}
        onDragLeave={() => setHover(false)}
        onDrop={(e) => {
          e.preventDefault();
          setHover(false);
          void addFiles(e.dataTransfer.files);
        }}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            input.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Drop logos here or choose files"
        data-testid="logo-drop"
      >
        <Icon name="upload" size={22} />
        <div>
          <strong>Drop logos here</strong> or click to choose
          <div className="muted small">PNG, JPEG or SVG. Flat backgrounds are removed for you.</div>
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          multiple
          hidden
          data-testid="logo-input"
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {pending.length ? (
        <div className="pending-list">
          {pending.length > 1 ? (
            <div className="row gap">
              <button className="btn primary sm" onClick={() => pending.forEach((p) => void upload(p))}>
                Add all {pending.length}
              </button>
            </div>
          ) : null}
          {pending.map((p) => (
            <div key={p.key} className="pending" data-testid="pending-logo">
              <div className="pending-previews">
                <figure className={p.useOriginal ? 'picked' : ''}>
                  <div className="checker big-thumb">
                    <img src={p.originalUrl} alt="Original" />
                  </div>
                  <figcaption>Original</figcaption>
                </figure>
                {p.resultUrl ? (
                  <figure className={p.useOriginal ? '' : 'picked'}>
                    <div className="checker big-thumb">
                      <img src={p.resultUrl} alt="Background removed" />
                    </div>
                    <figcaption>{p.opts.removeBackground ? `Background removed (${Math.round((p.result?.removed ?? 0) * 100)}%)` : 'Processed'}</figcaption>
                  </figure>
                ) : null}
              </div>
              <div className="pending-controls">
                <strong className="ellipsis">{p.file.name}</strong>
                {p.bmp ? (
                  <>
                    <Toggle label="Remove background" checked={p.opts.removeBackground} onChange={(v) => change(p.key, (x) => run({ ...x, opts: { ...x.opts, removeBackground: v } }))} />
                    {p.opts.removeBackground ? (
                      <Slider
                        label="Colour tolerance"
                        value={p.opts.tolerance}
                        min={0}
                        max={100}
                        step={1}
                        onChange={(v) => change(p.key, (x) => run({ ...x, opts: { ...x.opts, tolerance: v } }))}
                      />
                    ) : null}
                    <Toggle label="Trim empty edges" checked={p.opts.trim} onChange={(v) => change(p.key, (x) => run({ ...x, opts: { ...x.opts, trim: v } }))} />
                    <Toggle label="Keep the original instead" checked={p.useOriginal} onChange={(v) => change(p.key, (x) => ({ ...x, useOriginal: v }))} />
                    {p.result?.colors.length ? (
                      <div className="swatches" aria-label="Logo colours">
                        {p.result.colors.map((c) => (
                          <span key={c} className="swatch" style={{ background: c }} title={c} />
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="muted small">SVG logos are used as they are.</p>
                )}
                <div className="row gap">
                  <button className="btn primary sm" disabled={p.busy} onClick={() => void upload(p)}>
                    {p.busy ? 'Adding…' : 'Add logo'}
                  </button>
                  <button className="btn ghost sm" onClick={() => drop(p.key)}>
                    Discard
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {logos.length ? (
        <div className="logo-library">
          {logos.map((a) => (
            <div key={a.id} className="logo-item">
              <div className="checker thumb">
                <img src={a.url} alt={a.name} />
              </div>
              <div className="logo-item-meta">
                <span className="ellipsis" title={a.id}>
                  {baseName(a.name)}
                </span>
                <div className="swatches sm">
                  {assetColors(a).map((c) => (
                    <span key={c} className="swatch" style={{ background: c }} title={c} />
                  ))}
                </div>
              </div>
              <button
                className="btn icon ghost sm danger"
                aria-label={`Delete ${a.name}`}
                onClick={async () => {
                  if (!confirm(`Delete logo “${a.name}”? Projects that use it will show an error until you pick another.`)) return;
                  try {
                    await api.deleteAsset(a.id);
                    s.update((d) => ({ ...d, sections: d.sections.map((sec) => (sec.role === 'endcard' ? { ...sec, logos: sec.logos.filter((l) => l !== a.id) } : sec)) }));
                    await s.refreshAssets();
                  } catch (e) {
                    s.toast(errorMessage(e), { tone: 'error' });
                  }
                }}
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          ))}
        </div>
      ) : pending.length === 0 ? (
        <Empty title="No logos yet">They appear on the end card. You can also skip this step.</Empty>
      ) : null}

      {allColors.length ? (
        <div className="row gap wrap align-center logo-colors">
          <span className="muted small">Colours from your logos:</span>
          <div className="swatches">
            {allColors.slice(0, 8).map((c) => (
              <span key={c} className="swatch" style={{ background: c }} title={c} />
            ))}
          </div>
          <button className="btn sm" onClick={() => s.update((d) => ({ ...d, palette: paletteFromColors(allColors, background) }))}>
            Use as palette
          </button>
        </div>
      ) : null}
    </div>
  );
}

function FontUpload() {
  const s = useStudio();
  const [busy, setBusy] = useState(false);
  const fonts = s.assets.filter((a) => a.kind === 'font');
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const asset = await api.upload(file, 'font', file.name);
      await Promise.all([s.refreshAssets(), s.refreshCatalog()]);
      s.toast(`Added font “${String(asset.meta['family'] ?? asset.name)}”`, { tone: 'ok' });
    } catch (e) {
      s.toast(`Font upload failed: ${errorMessage(e)}`, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <div className="row space-between align-center">
        <h3>Your fonts</h3>
        <label className="btn sm">
          <Icon name="upload" size={16} /> {busy ? 'Uploading…' : 'Upload font'}
          <input
            type="file"
            accept=".ttf,.otf,.woff2,font/ttf,font/otf,font/woff2"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {fonts.length ? (
        <ul className="font-list">
          {fonts.map((f) => {
            const scripts = (f.meta['scripts'] as string[] | undefined) ?? [];
            const he = scripts.includes('hebrew');
            const weights = f.meta['weights'] as [number, number] | undefined;
            return (
              <li key={f.id}>
                <strong>{String(f.meta['family'] ?? f.name)}</strong>
                <span className="muted small">{weights ? (weights[0] === weights[1] ? `weight ${weights[0]}` : `weights ${weights[0]}–${weights[1]}`) : ''}</span>
                <span className={`tag ${he ? 'ok' : 'warn'}`}>{he ? 'Covers Hebrew' : 'No Hebrew letters'}</span>
                <button className="btn ghost sm" onClick={() => s.update((d) => ({ ...d, fonts: { ...d.fonts, display: f.id } }))}>
                  Use for titles
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted small">Optional: TTF, OTF or WOFF2. The studio shows whether it has Hebrew letters.</p>
      )}
    </div>
  );
}

function BrandKits() {
  const s = useStudio();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const current = s.kits.find((k) => k.id === s.brandKit);
  useEffect(() => {
    if (current) setName(current.name);
  }, [current]);

  const endLogos = s.spec.sections.flatMap((x) => (x.role === 'endcard' ? x.logos : []));
  const palette = resolvePaletteInput(s.spec.palette, s.catalog.palettes) ?? null;

  const save = async (asNew: boolean) => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const kit = await api.saveBrandKit(
        { name: name.trim(), logos: endLogos.slice(0, 4), palette: palette ? { ...palette, accents: palette.accents.slice(0, 8) } : null, fonts: s.spec.fonts.text ? { display: s.spec.fonts.display, text: s.spec.fonts.text } : { display: s.spec.fonts.display } },
        asNew || !current ? undefined : current.id,
      );
      await s.refreshKits();
      s.setBrandKit(kit.id);
      s.toast(`Brand kit “${kit.name}” saved`, { tone: 'ok' });
    } catch (e) {
      s.toast(errorMessage(e), { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const apply = (id: string) => {
    if (!id) {
      s.setBrandKit(null);
      return;
    }
    const kit = s.kits.find((k) => k.id === id);
    if (!kit) return;
    s.setBrandKit(kit.id);
    s.update((d) => ({
      ...d,
      ...(kit.palette ? { palette: kit.palette } : {}),
      ...(kit.fonts ? { fonts: kit.fonts.text ? { display: kit.fonts.display, text: kit.fonts.text } : { display: kit.fonts.display } } : {}),
      sections: d.sections.map((sec) => (sec.role === 'endcard' ? { ...sec, logos: kit.logos } : sec)),
    }));
    s.toast(`Applied “${kit.name}”`, { action: { label: 'Undo', run: s.undo } });
  };

  return (
    <div className="card">
      <h3>Brand kit</h3>
      <p className="muted small">Save your logos, colours and fonts once and reuse them in every project.</p>
      <div className="row gap wrap align-end">
        <label className="field">
          <span className="field-label">Use a kit</span>
          <select value={s.brandKit ?? ''} onChange={(e) => apply(e.target.value)}>
            <option value="">None</option>
            {s.kits.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span className="field-label">Kit name</span>
          <input dir="auto" value={name} placeholder="e.g. Dilemma Café" onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="btn" disabled={!name.trim() || saving} onClick={() => void save(false)}>
          {current ? 'Update kit' : 'Save as kit'}
        </button>
        {current ? (
          <button className="btn ghost" disabled={!name.trim() || saving} onClick={() => void save(true)}>
            Save as new
          </button>
        ) : null}
      </div>
    </div>
  );
}
