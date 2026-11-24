import { useMemo, useState, type ReactNode } from 'react';
import { daysBetween, weekday, type SectionRole } from '@reel/core';
import { api, errorMessage } from '../api.ts';
import { convertSection, emphasisWords, humanMessage, isTextRole, newSection, plain, ROLE_LABELS, sectionId, styleBase, toggleEmphasis, type SectionInput } from '../spec.ts';
import { useStudio } from '../studio.tsx';
import { Empty, Icon } from '../ui.tsx';

type Patch = (s: SectionInput) => SectionInput;

function useIssues(): Map<string, string[]> {
  const { validation } = useStudio();
  return useMemo(() => {
    const m = new Map<string, string[]>();
    for (const i of validation?.issues ?? []) {
      const k = i.path.join('.');
      m.set(k, [...(m.get(k) ?? []), i.message]);
    }
    return m;
  }, [validation]);
}

function Issue({ path, issues }: { path: string; issues: Map<string, string[]> }) {
  const msgs = issues.get(path);
  return msgs ? (
    <span className="field-error" role="alert">
      {msgs.map(humanMessage).join('; ')}
    </span>
  ) : null;
}

export function SectionList() {
  const s = useStudio();
  const [drag, setDrag] = useState<number | null>(null);
  /** Index of the section an "Add section above" picker is open for. */
  const [inserting, setInserting] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const sections = s.spec.sections;
  const issues = useIssues();

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= sections.length) return;
    s.update((d) => {
      const next = [...d.sections];
      const [x] = next.splice(from, 1);
      next.splice(to, 0, x!);
      return { ...d, sections: next };
    });
  };
  const patch = (i: number, fn: Patch, key?: string) =>
    s.update((d) => ({ ...d, sections: d.sections.map((x, j) => (j === i ? fn(x) : x)) }), key ?? `sec-${i}`);
  const remove = (i: number) => {
    s.update((d) => ({ ...d, sections: d.sections.filter((_, j) => j !== i) }));
    s.toast('Section removed', { action: { label: 'Undo', run: s.undo } });
  };
  /** Inserts a new section at `at`, or (no `at`) before the end card so it stays last. */
  const add = (role: SectionRole, at?: number) => {
    const end = sections.findIndex((x) => x.role === 'endcard');
    const i = at ?? (end >= 0 && role !== 'endcard' ? end : sections.length);
    s.update((d) => ({ ...d, sections: [...d.sections.slice(0, i), newSection(role), ...d.sections.slice(i)] }));
    setInserting(null);
    requestAnimationFrame(() => s.select(['sections', i]));
  };

  return (
    <div className="sections" data-path="sections">
      <div className="sections-head">
        <h3>Sections</h3>
        <Issue path="sections" issues={issues} />
      </div>
      {sections.length === 0 ? <Empty title="No sections yet">Paste text above, or add a title section below.</Empty> : null}
      <ol className="section-list">
        {sections.flatMap((sec, i) => [
          <li key={`insert-${i}`} className="insert-slot">
            {inserting === i ? (
              <AddSection onAdd={(r) => add(r, i)} onCancel={() => setInserting(null)} label={`New section above section ${i + 1}:`} />
            ) : (
              <button className="insert-btn" aria-label={`Add a section above section ${i + 1}`} onClick={() => setInserting(i)}>
                <Icon name="plus" size={14} /> Add section above
              </button>
            )}
          </li>,
          <li
            key={i}
            className={`section-card ${drag === i ? 'dragging' : ''} ${over === i && drag !== null && drag !== i ? 'drop-target' : ''}`}
            data-path={`sections.${i}`}
            onDragOver={(e) => {
              if (drag === null) return;
              e.preventDefault();
              setOver(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (drag !== null) move(drag, i);
              setDrag(null);
              setOver(null);
            }}
          >
            <SectionCard
              index={i}
              count={sections.length}
              section={sec}
              issues={issues}
              patch={(fn, key) => patch(i, fn, key)}
              onMove={(to) => move(i, to)}
              onRemove={() => remove(i)}
              onDragStart={() => setDrag(i)}
              onDragEnd={() => {
                setDrag(null);
                setOver(null);
              }}
            />
          </li>,
        ])}
      </ol>
      <AddSection onAdd={add} label="Add at the end:" />
    </div>
  );
}

function AddSection({ onAdd, onCancel, label = 'Add:' }: { onAdd: (r: SectionRole) => void; onCancel?: () => void; label?: string }) {
  const { catalog } = useStudio();
  const roles = catalog.roles.length ? catalog.roles : (Object.keys(ROLE_LABELS) as SectionRole[]);
  const common: SectionRole[] = ['tagline', 'body', 'datetime', 'location', 'list', 'stat', 'cta'];
  return (
    <div className="add-section">
      <span className="muted small">{label}</span>
      {common
        .filter((r) => roles.includes(r))
        .map((r) => (
          <button key={r} className="chip" onClick={() => onAdd(r)}>
            <Icon name="plus" size={14} /> {ROLE_LABELS[r]}
          </button>
        ))}
      <select
        className="chip-select"
        value=""
        aria-label="Add another kind of section"
        onChange={(e) => {
          if (e.target.value) onAdd(e.target.value as SectionRole);
        }}
      >
        <option value="">More…</option>
        {roles
          .filter((r) => !common.includes(r))
          .map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r] ?? r}
            </option>
          ))}
      </select>
      {onCancel ? (
        <button className="btn ghost sm" onClick={onCancel}>
          Cancel
        </button>
      ) : null}
    </div>
  );
}

function SectionCard({
  index,
  count,
  section,
  issues,
  patch,
  onMove,
  onRemove,
  onDragStart,
  onDragEnd,
}: {
  index: number;
  count: number;
  section: SectionInput;
  issues: Map<string, string[]>;
  patch: (fn: Patch, key?: string) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const { catalog } = useStudio();
  const roles = catalog.roles.length ? catalog.roles : (Object.keys(ROLE_LABELS) as SectionRole[]);
  const p = `sections.${index}`;
  const sectionStyle = styleBase(section.style);
  return (
    <>
      <div className="section-head">
        <span
          className="grip"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(index));
            onDragStart();
          }}
          onDragEnd={onDragEnd}
          title="Drag to reorder"
          aria-hidden="true"
        >
          <Icon name="grip" />
        </span>
        <span className="section-index">{index + 1}</span>
        <select
          className="role-select"
          aria-label={`Section ${index + 1} kind`}
          value={section.role}
          onChange={(e) => patch((x) => convertSection(x, e.target.value as SectionRole), 'role')}
        >
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r] ?? r}
            </option>
          ))}
        </select>
        {sectionStyle ? <span className="tag">{catalog.styles.find((x) => x.id === sectionStyle)?.name ?? sectionStyle}</span> : null}
        <span className="section-id muted small">{sectionId(section, index)}</span>
        <div className="section-tools">
          <button className="btn icon ghost sm" aria-label="Move up" disabled={index === 0} onClick={() => onMove(index - 1)}>
            <Icon name="up" />
          </button>
          <button className="btn icon ghost sm" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(index + 1)}>
            <Icon name="down" />
          </button>
          <button className="btn icon ghost sm danger" aria-label="Remove section" onClick={onRemove}>
            <Icon name="trash" size={16} />
          </button>
        </div>
      </div>
      <div className="section-body">
        <SectionFields section={section} p={p} issues={issues} patch={patch} />
      </div>
    </>
  );
}

function F({ label, children, path, issues, grow }: { label: string; children: ReactNode; path: string; issues: Map<string, string[]>; grow?: boolean }) {
  return (
    <label className={`field ${grow ? 'grow' : ''}`} data-path={path}>
      <span className="field-label">{label}</span>
      {children}
      <Issue path={path} issues={issues} />
    </label>
  );
}

const optional = (v: string) => (v.trim() ? v : undefined);

function SectionFields({ section, p, issues, patch }: { section: SectionInput; p: string; issues: Map<string, string[]>; patch: (fn: Patch, key?: string) => void }) {
  const { spec, assets } = useStudio();
  const lang = spec.language;
  const set = (field: string, value: unknown, key = field) =>
    patch((x) => {
      const next = { ...x } as Record<string, unknown>;
      if (value === undefined) delete next[field];
      else next[field] = value;
      return next as SectionInput;
    }, `${p}.${key}`);

  if (isTextRole(section.role) && 'text' in section && section.role !== 'endcard') {
    return <TextField text={section.text} path={`${p}.text`} issues={issues} onChange={(t, key) => set('text', t, key)} big={section.role === 'title'} />;
  }
  switch (section.role) {
    case 'datetime': {
      const valid = /^\d{4}-\d{2}-\d{2}$/.test(section.date);
      return (
        <div className="row gap wrap">
          <F label="Date" path={`${p}.date`} issues={issues}>
            <input type="date" value={section.date} onChange={(e) => set('date', e.target.value)} />
          </F>
          <div className="field">
            <span className="field-label">Weekday (automatic)</span>
            <span className="derived" dir="auto">
              {valid ? weekday(section.date, lang) : '—'}
            </span>
          </div>
          <F label="Time" path={`${p}.time`} issues={issues}>
            <input type="time" value={section.time ?? ''} onChange={(e) => set('time', optional(e.target.value))} />
          </F>
        </div>
      );
    }
    case 'location':
      return (
        <div className="row gap wrap">
          <F label="Place" path={`${p}.place`} issues={issues} grow>
            <input dir="auto" value={section.place} onChange={(e) => set('place', e.target.value)} />
          </F>
          <F label="City (optional)" path={`${p}.city`} issues={issues} grow>
            <input dir="auto" value={section.city ?? ''} onChange={(e) => set('city', optional(e.target.value))} />
          </F>
        </div>
      );
    case 'list':
      return (
        <div className="stack">
          <F label="Heading (optional)" path={`${p}.title`} issues={issues}>
            <input dir="auto" value={section.title ?? ''} onChange={(e) => set('title', optional(e.target.value))} />
          </F>
          <div className="field" data-path={`${p}.items`}>
            <span className="field-label">Items</span>
            <ol className="list-items">
              {section.items.map((it, j) => (
                <li key={j} data-path={`${p}.items.${j}`}>
                  <input
                    dir="auto"
                    value={it}
                    aria-label={`Item ${j + 1}`}
                    onChange={(e) => set('items', section.items.map((x, k) => (k === j ? e.target.value : x)), `items.${j}`)}
                  />
                  <button className="btn icon ghost sm" aria-label={`Remove item ${j + 1}`} disabled={section.items.length <= 1} onClick={() => set('items', section.items.filter((_, k) => k !== j), 'items-rm')}>
                    <Icon name="close" size={14} />
                  </button>
                  <Issue path={`${p}.items.${j}`} issues={issues} />
                </li>
              ))}
            </ol>
            {section.items.length < 10 ? (
              <button className="btn ghost sm" onClick={() => set('items', [...section.items, ''], 'items-add')}>
                <Icon name="plus" size={14} /> Add item
              </button>
            ) : null}
            <Issue path={`${p}.items`} issues={issues} />
          </div>
        </div>
      );
    case 'stat':
      return (
        <div className="row gap wrap">
          <F label="Prefix" path={`${p}.prefix`} issues={issues}>
            <input className="w-xs" dir="auto" maxLength={4} value={section.prefix ?? ''} onChange={(e) => set('prefix', optional(e.target.value))} />
          </F>
          <F label="Number" path={`${p}.value`} issues={issues}>
            <input className="w-sm" type="number" value={Number.isFinite(section.value) ? section.value : ''} onChange={(e) => set('value', e.target.value === '' ? 0 : Number(e.target.value))} />
          </F>
          <F label="Suffix" path={`${p}.suffix`} issues={issues}>
            <input className="w-xs" dir="auto" maxLength={4} value={section.suffix ?? ''} onChange={(e) => set('suffix', optional(e.target.value))} />
          </F>
          <F label="Label" path={`${p}.label`} issues={issues} grow>
            <input dir="auto" value={section.label} onChange={(e) => set('label', e.target.value)} />
          </F>
        </div>
      );
    case 'countdown': {
      const ok = /^\d{4}-\d{2}-\d{2}$/.test(section.from) && /^\d{4}-\d{2}-\d{2}$/.test(section.to);
      return (
        <div className="row gap wrap">
          <F label="Counting from (posting date)" path={`${p}.from`} issues={issues}>
            <input type="date" value={section.from} onChange={(e) => set('from', e.target.value)} />
          </F>
          <F label="To" path={`${p}.to`} issues={issues}>
            <input type="date" value={section.to} onChange={(e) => set('to', e.target.value)} />
          </F>
          <div className="field">
            <span className="field-label">Days left</span>
            <span className="derived">{ok ? daysBetween(section.from, section.to) : '—'}</span>
          </div>
          <F label="Label (optional)" path={`${p}.label`} issues={issues} grow>
            <input dir="auto" value={section.label ?? ''} onChange={(e) => set('label', optional(e.target.value))} />
          </F>
        </div>
      );
    }
    case 'lyric':
      return (
        <div className="field" data-path={`${p}.lines`}>
          <span className="field-label">Lines (seconds into the track, optional)</span>
          <ol className="list-items">
            {section.lines.map((ln, j) => (
              <li key={j}>
                <input dir="auto" value={ln.text} aria-label={`Line ${j + 1}`} onChange={(e) => set('lines', section.lines.map((x, k) => (k === j ? { ...x, text: e.target.value } : x)), `lines.${j}`)} />
                <input
                  className="w-sm"
                  type="number"
                  min={0}
                  step={0.1}
                  aria-label={`Line ${j + 1} time`}
                  value={ln.at ?? ''}
                  onChange={(e) =>
                    set('lines', section.lines.map((x, k) => (k === j ? (e.target.value === '' ? { text: x.text } : { ...x, at: Number(e.target.value) }) : x)), `lines-at.${j}`)
                  }
                />
                <button className="btn icon ghost sm" aria-label="Remove line" disabled={section.lines.length <= 1} onClick={() => set('lines', section.lines.filter((_, k) => k !== j), 'lines-rm')}>
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
          </ol>
          <button className="btn ghost sm" onClick={() => set('lines', [...section.lines, { text: '' }], 'lines-add')}>
            <Icon name="plus" size={14} /> Add line
          </button>
        </div>
      );
    case 'endcard': {
      const logos = assets.filter((a) => a.kind === 'logo');
      return (
        <div className="stack">
          <div className="field" data-path={`${p}.logos`}>
            <span className="field-label">Logos on the end card ({section.logos.length}/4)</span>
            {logos.length === 0 ? (
              <p className="muted small">
                No logos yet. Drop them in <a href="#step-brand">step 2, Brand</a>.
              </p>
            ) : (
              <div className="logo-pick">
                {logos.map((a) => {
                  const on = section.logos.includes(a.id);
                  return (
                    <label key={a.id} className={`logo-tile ${on ? 'on' : ''}`} title={a.name}>
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!on && section.logos.length >= 4}
                        onChange={() => set('logos', on ? section.logos.filter((l) => l !== a.id) : [...section.logos, a.id], 'logos')}
                      />
                      <span className="checker">
                        <img src={a.url} alt={a.name} />
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            <Issue path={`${p}.logos`} issues={issues} />
            {section.logos
              .filter((l) => !logos.some((a) => a.id === l))
              .map((l) => (
                <span key={l} className="field-error">
                  Logo “{l}” is not uploaded.{' '}
                  <button className="link" onClick={() => set('logos', section.logos.filter((x) => x !== l), 'logos')}>
                    Remove
                  </button>
                </span>
              ))}
          </div>
          <F label="Closing line (optional)" path={`${p}.text`} issues={issues}>
            <input dir="auto" value={section.text ?? ''} onChange={(e) => set('text', optional(e.target.value))} />
          </F>
        </div>
      );
    }
    default:
      return null;
  }
}

function TextField({
  text,
  path,
  issues,
  onChange,
  big,
}: {
  text: string;
  path: string;
  issues: Map<string, string[]>;
  onChange: (t: string, key?: string) => void;
  big: boolean;
}) {
  const s = useStudio();
  const [busy, setBusy] = useState(false);
  const words = emphasisWords(text);
  const style = s.catalog.styles.find((x) => x.id === styleBase(s.spec.style));
  const max = style?.maxWordsPerSection;
  const suggest = async () => {
    if (!plain(text).trim()) return;
    setBusy(true);
    try {
      const res = await api.emphasis(plain(text), s.spec.language === 'en' ? 'en' : 'he');
      onChange(res.text, 'suggest');
    } catch (e) {
      s.toast(`Suggestion failed: ${errorMessage(e)}`, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack-sm">
      <label className="field" data-path={path}>
        <span className="field-label">
          Text <span className="muted small">· *stars* mark emphasis</span>
        </span>
        <input className={big ? 'big' : ''} dir="auto" value={text} onChange={(e) => onChange(e.target.value)} />
        <Issue path={path} issues={issues} />
      </label>
      {words.length ? (
        <div className="chips-row">
          <div className="chips" dir="auto" aria-label="Click words to emphasise">
            {words.map((w, i) => (
              <button key={i} type="button" className={`chip word ${w.emphasis ? 'on' : ''}`} aria-pressed={w.emphasis} onClick={() => onChange(toggleEmphasis(text, i), 'emph')}>
                {w.word}
              </button>
            ))}
          </div>
          <button type="button" className="btn ghost sm" onClick={() => void suggest()} disabled={busy} title="Suggest emphasis words">
            {busy ? <span className="spinner sm" aria-hidden="true" /> : <Icon name="spark" size={14} />} Suggest
          </button>
        </div>
      ) : null}
      {max && words.length > max ? (
        <span className="field-warn">
          {words.length} words; this style shows up to {max} per section. Consider splitting it into two sections.
        </span>
      ) : null}
    </div>
  );
}
