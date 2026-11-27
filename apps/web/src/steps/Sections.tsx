import { useMemo, useRef, useState, type ReactNode } from 'react';
import { daysBetween, retargetSketchUntil, retargetWordSketches, SKETCH_LIMITS, weekday, type SectionRole, type SectionSketchInput } from '@reel/core';
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

  // every section-list edit keeps sketches' `until` on the same target (clamped when it is gone), inside the same
  // `s.update`, so one undo restores both
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= sections.length) return;
    s.update((d) => {
      const next = [...d.sections];
      const [x] = next.splice(from, 1);
      next.splice(to, 0, x!);
      return { ...d, sections: retargetSketchUntil(d.sections, next) };
    });
  };
  const patch = (i: number, fn: Patch, key?: string) =>
    s.update((d) => ({ ...d, sections: d.sections.map((x, j) => (j === i ? fn(x) : x)) }), key ?? `sec-${i}`);
  const remove = (i: number) => {
    s.update((d) => ({ ...d, sections: retargetSketchUntil(d.sections, d.sections.filter((_, j) => j !== i)) }));
    s.toast('Section removed', { action: { label: 'Undo', run: s.undo } });
  };
  /** Inserts a new section at `at`, or (no `at`) before the end card so it stays last. */
  const add = (role: SectionRole, at?: number) => {
    const end = sections.findIndex((x) => x.role === 'endcard');
    const i = at ?? (end >= 0 && role !== 'endcard' ? end : sections.length);
    s.update((d) => ({ ...d, sections: retargetSketchUntil(d.sections, [...d.sections.slice(0, i), newSection(role), ...d.sections.slice(i)]) }));
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

/** What the ✎ menu of an emphasised word adds: a preset attached to that word (`place.mode: 'word'`, SKETCH-PLAN SK8). */
const DOODLES = [
  { preset: 'circle', label: 'Circle', fit: 'around' },
  { preset: 'underline', label: 'Underline', fit: 'under' },
  { preset: 'arrow', label: 'Arrow to it', fit: 'beside' },
] as const;
type Doodle = (typeof DOODLES)[number];

/** A text field's word sketches, for its chips; `i` is the word's index in the field. */
interface WordDoodles {
  count(i: number): number;
  /** Why nothing more can be added (the section's or the video's sketch limit), else null. */
  full: string | null;
  add(i: number, d: Doodle): void;
  remove(i: number): void;
  /** Toggles the word's emphasis; a word that loses it loses its sketches in the same step. */
  toggle(i: number): void;
}

/** The section with its sketch list replaced (the key dropped when the list is empty). */
function withSketches(x: SectionInput, f: (list: SectionSketchInput[]) => SectionSketchInput[]): SectionInput {
  if (x.role === 'endcard') return x;
  const next = { ...x } as Record<string, unknown>;
  const list = f(x.sketches ?? []);
  if (list.length) next.sketches = list;
  else delete next.sketches;
  return next as SectionInput;
}

/** The ✎ menu of an emphasised word chip: Circle / Underline / Arrow to it, disabled with the reason at the limit. */
function WordPen({ word, count, full, onAdd, onRemove }: { word: string; count: number; full: string | null; onAdd: (d: Doodle) => void; onRemove: () => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pick = (fn: () => void) => () => {
    fn();
    if (ref.current) ref.current.open = false;
  };
  const label = `Sketch on “${word}”`;
  return (
    <details className="word-pen" ref={ref}>
      <summary className={`chip sm word-pen-toggle ${count ? 'on' : ''}`} aria-label={label} title={label}>
        ✎{count ? <span className="word-pen-count">{count}</span> : null}
      </summary>
      <div className="word-pen-menu" role="menu" aria-label={label}>
        {DOODLES.map((d) => (
          <button key={d.preset} type="button" role="menuitem" className="chip sm" disabled={full !== null} title={full ?? undefined} onClick={pick(() => onAdd(d))}>
            {d.label}
          </button>
        ))}
        {full ? <span className="field-warn">{full}</span> : null}
        {count ? (
          <button type="button" role="menuitem" className="chip sm" onClick={pick(onRemove)}>
            Remove from this word
          </button>
        ) : null}
      </div>
    </details>
  );
}

/** Word chips: a click toggles emphasis; an emphasised word also gets its ✎ menu. */
function WordChips({ words, sm, doodles }: { words: { word: string; emphasis: boolean }[]; sm?: boolean; doodles: WordDoodles }) {
  return (
    <div className="chips" dir="auto" aria-label="Click words to emphasise">
      {words.map((w, i) => (
        <span key={i} className="word-chip">
          <button type="button" className={`chip word ${sm ? 'sm' : ''} ${w.emphasis ? 'on' : ''}`} aria-pressed={w.emphasis} onClick={() => doodles.toggle(i)}>
            {w.word}
          </button>
          {w.emphasis ? <WordPen word={w.word} count={doodles.count(i)} full={doodles.full} onAdd={(d) => doodles.add(i, d)} onRemove={() => doodles.remove(i)} /> : null}
        </span>
      ))}
    </div>
  );
}

function SectionFields({ section, p, issues, patch }: { section: SectionInput; p: string; issues: Map<string, string[]>; patch: (fn: Patch, key?: string) => void }) {
  const { spec, assets, toast, undo } = useStudio();
  const lang = spec.language;
  const set = (field: string, value: unknown, key = field) =>
    patch((x) => {
      const next = { ...x } as Record<string, unknown>;
      if (value === undefined) delete next[field];
      else next[field] = value;
      return next as SectionInput;
    }, `${p}.${key}`);

  if (isTextRole(section.role) && 'text' in section && section.role !== 'endcard') {
    const sub = 'sub' in section ? (section.sub as string | undefined) : undefined;
    const sketches = section.sketches ?? [];
    // the ✎ menu on emphasised word chips (SKETCH-PLAN SK8, P5): sketches attached to a word, by its item index (the
    // small line's words follow the big ones). Each add or remove is its own `s.update`, so one undo takes it back.
    const onItem = (k: SectionSketchInput, item: number) => k.place?.mode === 'word' && k.place.item === item;
    const total = spec.sections.reduce((n, x) => n + (x.role === 'endcard' ? 0 : (x.sketches?.length ?? 0)), 0);
    const full =
      sketches.length >= SKETCH_LIMITS.perSection
        ? `This section already has ${SKETCH_LIMITS.perSection} sketches, the most it can hold`
        : total >= SKETCH_LIMITS.perJob
          ? `This video already has ${SKETCH_LIMITS.perJob} sketches, the most it can hold`
          : null;
    const ids = new Set(spec.sections.flatMap((x) => (x.role === 'endcard' ? [] : (x.sketches ?? []).map((k) => k.id))));
    // every change of the text or the small line (typing, a chip click, Suggest, ✕) keeps word sketches on their word
    // in the same `s.update`; a sketch whose word went away or lost its emphasis is dropped, with an Undo toast
    const edit = (field: 'text' | 'sub', value: string | undefined, key: string) => {
      const apply = (x: SectionInput): SectionInput => {
        const next = { ...x } as Record<string, unknown>;
        if (value === undefined) delete next[field];
        else next[field] = value;
        return next as SectionInput;
      };
      const r = retargetWordSketches(section, apply(section));
      patch((x) => retargetWordSketches(x, apply(x)).section, r.dropped.length ? '' : `${p}.${key}`);
      if (r.dropped.length) {
        const n = r.dropped.length;
        toast(`Removed ${n} sketch${n === 1 ? '' : 'es'} from ${r.words.map((w) => `“${w}”`).join(', ')}`, { action: { label: 'Undo', run: undo } });
      }
    };
    const doodles = (field: 'text' | 'sub', source: string, offset: number, key: string): WordDoodles => ({
      count: (i) => sketches.filter((k) => onItem(k, offset + i)).length,
      full,
      add: (i, d) => {
        let id = `${d.preset}-word-${offset + i}`;
        for (let n = 2; ids.has(id); n++) id = `${d.preset}-word-${offset + i}-${n}`;
        const k: SectionSketchInput = { id, source: { kind: 'preset', preset: d.preset }, place: { mode: 'word', item: offset + i, fit: d.fit } };
        patch((x) => withSketches(x, (list) => [...list, k]), '');
      },
      remove: (i) => patch((x) => withSketches(x, (list) => list.filter((k) => !onItem(k, offset + i))), ''),
      toggle: (i) => edit(field, toggleEmphasis(source, i), key),
    });
    return (
      <div className="stack-sm">
        <TextField
          text={section.text}
          path={`${p}.text`}
          issues={issues}
          onChange={(t, key) => edit('text', t, key ?? 'text')}
          big={section.role === 'title'}
          doodles={doodles('text', section.text, 0, 'emph')}
        />
        <SubLine
          sub={sub}
          path={`${p}.sub`}
          issues={issues}
          onChange={(t, key) => edit('sub', t, key ?? 'sub')}
          doodles={doodles('sub', sub ?? '', emphasisWords(section.text).length, 'sub-emph')}
        />
      </div>
    );
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

/**
 * The small line under the big words, in the same frame (`section.sub`): "There's a prize" → what the prize is. An
 * empty field stays open while typing; the spec only gets the key once there is text.
 */
function SubLine({
  sub,
  path,
  issues,
  onChange,
  doodles,
}: {
  sub: string | undefined;
  path: string;
  issues: Map<string, string[]>;
  onChange: (t: string | undefined, key?: string) => void;
  doodles: WordDoodles;
}) {
  const [open, setOpen] = useState(sub !== undefined);
  if (!open && sub === undefined) {
    return (
      <button type="button" className="btn ghost sm sub-add" onClick={() => setOpen(true)}>
        <Icon name="plus" size={14} /> Small line underneath
      </button>
    );
  }
  const words = emphasisWords(sub ?? '');
  return (
    <div className="sub-line stack-sm">
      <label className="field" data-path={path}>
        <span className="field-label">
          Small line underneath <span className="muted small">· same frame, smaller, lands word by word</span>
        </span>
        <div className="row gap align-center">
          <input
            className="grow"
            dir="auto"
            value={sub ?? ''}
            placeholder="e.g. what the prize is"
            autoFocus={sub === undefined}
            onChange={(e) => onChange(e.target.value.trim() ? e.target.value : undefined)}
          />
          <button
            type="button"
            className="btn icon ghost sm"
            aria-label="Remove the small line"
            onClick={() => {
              onChange(undefined, 'sub-rm');
              setOpen(false);
            }}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
        <Issue path={path} issues={issues} />
      </label>
      {words.length ? <WordChips words={words} sm doodles={doodles} /> : null}
    </div>
  );
}

function TextField({
  text,
  path,
  issues,
  onChange,
  big,
  doodles,
}: {
  text: string;
  path: string;
  issues: Map<string, string[]>;
  onChange: (t: string, key?: string) => void;
  big: boolean;
  doodles: WordDoodles;
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
          <WordChips words={words} doodles={doodles} />
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
