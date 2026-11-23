import { useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogStyle, RankStylesResult, StyleStill } from '@reel/api';
import { api, errorMessage } from '../api.ts';
import { styleBase, styleInput, styleObj, type Draft } from '../spec.ts';
import { useStudio } from '../studio.tsx';
import { Icon, Segmented, StepHeader } from '../ui.tsx';
import { Mixer } from './Mixer.tsx';

type Energy = 'any' | 'calm' | 'medium' | 'high';
type Bg = 'any' | 'light' | 'dark';

const ENERGY_RANGE: Record<Energy, [number, number]> = { any: [1, 5], calm: [1, 2], medium: [3, 3], high: [4, 5] };

/** Applies a catalog style; palette/music/fonts follow it unless the user changed them from the old style's defaults. */
export function pickStyle(d: Draft, next: CatalogStyle, styles: CatalogStyle[]): Draft {
  const cur = styleObj(d.style);
  const prev = styles.find((x) => x.id === cur.base);
  const blend = cur.blendWith && cur.blendWith.style !== next.id ? cur.blendWith : undefined;
  const out: Draft = { ...d, style: styleInput({ base: next.id, ...(blend ? { blendWith: blend } : {}) }) };
  if (!prev) return out;
  if (d.palette === prev.defaults.palette) out.palette = next.defaults.palette;
  if (d.music.source === 'preset' && d.music.preset === prev.defaults.music.preset && d.music.bpm === prev.defaults.music.bpm) {
    out.music = { ...d.music, preset: next.defaults.music.preset, bpm: next.defaults.music.bpm };
  }
  if (d.fonts.display === prev.defaults.fonts.display && !d.fonts.text) out.fonts = { display: next.defaults.fonts.display };
  return out;
}

export function StyleStep() {
  const s = useStudio();
  const [family, setFamily] = useState<string[]>([]);
  const [energy, setEnergy] = useState<Energy>('any');
  const [bg, setBg] = useState<Bg>('any');
  const [rank, setRank] = useState<RankStylesResult | null>(null);
  const [ranking, setRanking] = useState(false);
  const base = styleBase(s.spec.style);

  const families = useMemo(() => [...new Set(s.catalog.styles.flatMap((x) => x.families))].sort(), [s.catalog.styles]);
  const shown = useMemo(() => {
    const [lo, hi] = ENERGY_RANGE[energy];
    let list = s.catalog.styles.filter(
      (x) => (family.length === 0 || x.families.some((f) => family.includes(f))) && x.energy >= lo && x.energy <= hi && (bg === 'any' || x.background === bg),
    );
    if (rank) {
      const score = new Map(rank.ranked.map((r) => [r.style, r.score]));
      list = [...list].sort((a, b) => (score.get(b.id) ?? -1) - (score.get(a.id) ?? -1));
    }
    return list;
  }, [s.catalog.styles, family, energy, bg, rank]);

  const suggest = async () => {
    setRanking(true);
    try {
      await s.flush();
      setRank(await api.rankStyles(s.spec.brief ?? '', s.spec));
    } catch (e) {
      s.toast(`Suggestion failed: ${errorMessage(e)}`, { tone: 'error' });
    } finally {
      setRanking(false);
    }
  };

  return (
    <section className="step" id="step-style">
      <StepHeader n={3} title="Style" />
      <div className="card">
        <label className="field" data-path="brief">
          <span className="field-label">Describe the mood (optional)</span>
          <textarea
            dir="auto"
            rows={2}
            value={s.spec.brief ?? ''}
            placeholder="Monthly debate café + jam. Warm, playful."
            onChange={(e) => s.update((d) => ({ ...d, brief: e.target.value }), 'brief')}
          />
        </label>
        <div className="row gap wrap align-center">
          <button className="btn" onClick={() => void suggest()} disabled={ranking}>
            {ranking ? <span className="spinner sm" aria-hidden="true" /> : <Icon name="spark" />}
            {ranking ? 'Ranking…' : 'Suggest from brief'}
          </button>
          {rank ? (
            <>
              <span className="muted small">Ordered by fit{rank.provider === 'rules' ? ' (built-in rules)' : ''}</span>
              <button className="link" onClick={() => setRank(null)}>
                Clear
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="filters">
        <div className="chips" role="group" aria-label="Families">
          {families.map((f) => (
            <button key={f} className={`chip ${family.includes(f) ? 'on' : ''}`} aria-pressed={family.includes(f)} onClick={() => setFamily((x) => (x.includes(f) ? x.filter((y) => y !== f) : [...x, f]))}>
              {f.replace(/-/g, ' ')}
            </button>
          ))}
        </div>
        <div className="row gap wrap">
          <Segmented
            label="Energy"
            size="sm"
            value={energy}
            onChange={setEnergy}
            options={[
              { value: 'any', label: 'Any energy' },
              { value: 'calm', label: 'Calm' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
            ]}
          />
          <Segmented
            label="Background"
            size="sm"
            value={bg}
            onChange={setBg}
            options={[
              { value: 'any', label: 'Any' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
      </div>

      <StyleGrid styles={shown} selected={base} rank={rank} />
      <Mixer />
    </section>
  );
}

function stillKey(spec: Draft, format: string): string {
  // Stills use each style's own palette and no music.
  const { style: _style, brief: _brief, quality: _q, formats: _f, palette: _p, music: _m, sfx: _s, ...rest } = spec;
  return JSON.stringify([rest, format]);
}

function StyleGrid({ styles, selected, rank }: { styles: CatalogStyle[]; selected: string | undefined; rank: RankStylesResult | null }) {
  const s = useStudio();
  const [stills, setStills] = useState<Record<string, StyleStill & { key: string }>>({});
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const grid = useRef<HTMLDivElement>(null);
  const format = s.previewFormat;
  const key = stillKey(s.spec, format);

  useEffect(() => {
    const root = grid.current;
    if (!root) return;
    const obs = new IntersectionObserver((entries) => {
      setVisible((v) => {
        const n = new Set(v);
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset['style']!;
          if (e.isIntersecting) n.add(id);
        }
        return n;
      });
    }, { rootMargin: '200px' });
    root.querySelectorAll('[data-style]').forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [styles]);

  useEffect(() => {
    const need = [...visible].filter((id) => stills[id]?.key !== key && !loading.has(id));
    if (!need.length) return;
    const t = setTimeout(async () => {
      setLoading((l) => new Set([...l, ...need]));
      try {
        const res = await api.styleStills(s.spec, need, format, 270);
        setStills((st) => {
          const n = { ...st };
          res.forEach((r, i) => (n[r.style ?? need[i]!] = { ...r, key }));
          return n;
        });
      } catch (e) {
        setStills((st) => {
          const n = { ...st };
          for (const id of need) n[id] = { style: id, error: errorMessage(e), key };
          return n;
        });
      } finally {
        setLoading((l) => new Set([...l].filter((x) => !need.includes(x))));
      }
    }, Object.keys(stills).length ? 1200 : 150);
    return () => clearTimeout(t);
    // `s.spec` is captured through `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, key, stills, loading, format]);

  const reason = new Map(rank?.ranked.map((r) => [r.style, r]) ?? []);
  const aspect = format === '9:16' ? '9 / 16' : format === '16:9' ? '16 / 9' : format === '4:5' ? '4 / 5' : '1 / 1';

  if (!styles.length) return <p className="muted">No style matches these filters.</p>;
  return (
    <div className="style-grid" ref={grid} role="listbox" aria-label="Styles">
      {styles.map((st, i) => {
        const still = stills[st.id];
        const fresh = still?.key === key;
        const on = st.id === selected;
        const r = reason.get(st.id);
        return (
          <button
            key={st.id}
            data-style={st.id}
            role="option"
            aria-selected={on}
            className={`style-card ${on ? 'on' : ''}`}
            onClick={() => s.update((d) => pickStyle(d, st, s.catalog.styles))}
          >
            <div className="style-still" style={{ aspectRatio: aspect }}>
              {still?.url ? <img src={still.url} alt="" className={fresh ? '' : 'stale'} /> : null}
              {!still?.url && still?.error ? <span className="still-error">{still.error}</span> : null}
              {!still || (!fresh && !still.url) ? <span className="skeleton fill" /> : null}
              {rank && i < 2 && r ? <span className="badge-corner">Suggested</span> : null}
              {on ? (
                <span className="check-corner" aria-hidden="true">
                  <Icon name="check" size={14} />
                </span>
              ) : null}
            </div>
            <div className="style-meta">
              <strong>{st.name}</strong>
              <span className="energy" aria-label={`Energy ${st.energy} of 5`}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <i key={n} className={n <= st.energy ? 'on' : ''} />
                ))}
              </span>
            </div>
            <div className="style-tags">
              {st.families.map((f) => (
                <span key={f} className="tag">
                  {f.replace(/-/g, ' ')}
                </span>
              ))}
              <span className={`tag bg-${st.background}`}>{st.background}</span>
            </div>
            {r ? <p className="style-reason small muted">{r.reason}</p> : null}
          </button>
        );
      })}
    </div>
  );
}
