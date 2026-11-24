import { useEffect, useMemo, useRef, useState } from 'react';
import { DURATION } from '@reel/core';
import type { Validation } from '@reel/api';
import { api, errorMessage, type SplitInput } from '../api.ts';
import { exampleSpec } from '../Home.tsx';
import { detectLanguage, sectionId, specTitle, type Draft, type SectionInput } from '../spec.ts';
import { useStudio } from '../studio.tsx';
import { Field, Icon, Slider, StepHeader } from '../ui.tsx';
import { SectionList } from './Sections.tsx';

const CONTENT_TYPES = [
  { value: 'event', label: 'Event' },
  { value: 'list', label: 'List / top-N' },
  { value: 'story', label: 'Story / dilemma' },
  { value: 'stats', label: 'Numbers' },
  { value: 'lyric', label: 'Lyrics' },
] as const;
type ContentType = (typeof CONTENT_TYPES)[number]['value'];

export function ContentStep() {
  const s = useStudio();
  const empty = !specTitle(s.spec) && s.spec.sections.length <= 2;
  return (
    <section className="step" id="step-content" aria-labelledby="h-content">
      <StepHeader n={1} title="Content" />
      <PasteBox />
      {empty ? (
        <div className="hint-card">
          <div>
            <strong>Not sure where to start?</strong>
            <p className="muted">Load a ready-made Hebrew event reel and change it to yours.</p>
          </div>
          <button
            className="btn"
            onClick={() => {
              const logos = s.assets.filter((a) => a.kind === 'logo').map((a) => a.id);
              const ex = exampleSpec(logos);
              s.update((d) => ({ ...ex, id: d.id }));
            }}
          >
            Start with an example
          </button>
        </div>
      ) : null}
      <SectionList />
      <DurationControl />
    </section>
  );
}

function PasteBox() {
  const s = useStudio();
  const [text, setText] = useState('');
  const [language, setLanguage] = useState<'auto' | 'he' | 'en'>('auto');
  const providers = s.catalog.setup.llm;
  const [provider, setProvider] = useState<'gemini' | 'claude' | 'rules'>(providers[0] ?? 'rules');
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const contentType = s.spec.contentType as ContentType;
  const fitAfterSplit = useRef(false);

  // Once the split content is saved and timed: lengthen the video if the text needs it (up to the duration cap).
  const timing = s.validation?.timing;
  useEffect(() => {
    if (!fitAfterSplit.current || s.save !== 'saved' || !timing) return;
    fitAfterSplit.current = false;
    if (timing.ok || timing.needed > DURATION.max) return;
    const need = Math.ceil(timing.needed * 2) / 2;
    s.update((d) => ({ ...d, duration: need }));
    s.toast(`Made the video ${need} s long so your text fits`, { action: { label: 'Undo', run: s.undo } });
  }, [timing, s]);

  const split = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setNotes([]);
    try {
      const req: SplitInput = { text, language: language === 'auto' ? detectLanguage(text) : language, contentType, provider, ...(s.brandKit ? { brandKit: s.brandKit } : {}) };
      const res = await api.split(req);
      const logos = currentLogos(s.spec, s.assets.filter((a) => a.kind === 'logo').map((a) => a.id));
      const sections = (res.sections as SectionInput[]).map((sec) => (sec.role === 'endcard' && !sec.logos.length ? { ...sec, logos } : sec));
      if (!sections.some((x) => x.role === 'endcard')) sections.push({ role: 'endcard', logos });
      s.update((d) => ({ ...d, sections, language: res.language, contentType: res.contentType }));
      setNotes(res.notes);
      fitAfterSplit.current = true;
      s.toast(`Split into ${sections.length} sections${res.provider === 'rules' ? '' : ` with ${res.provider === 'gemini' ? 'Gemini' : 'Claude'}`}`, {
        tone: 'ok',
        action: { label: 'Undo', run: s.undo },
      });
    } catch (e) {
      s.toast(`Split failed: ${errorMessage(e)}`, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card paste">
      <Field label="Paste anything" hint="An invitation, a post, a list: it becomes sections you can edit below.">
        <textarea
          dir="auto"
          rows={5}
          value={text}
          placeholder="קפה דילמה וג׳אם · יום שלישי 1.12 בשעה 19:30 · בית החאן, קרית שמונה…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void split();
          }}
          data-testid="paste"
        />
      </Field>
      <div className="row gap wrap align-end">
        <Field label="Language">
          <select value={language} onChange={(e) => setLanguage(e.target.value as typeof language)}>
            <option value="auto">Detect{text ? ` (${detectLanguage(text) === 'he' ? 'Hebrew' : 'English'})` : ''}</option>
            <option value="he">Hebrew</option>
            <option value="en">English</option>
          </select>
        </Field>
        <Field label="Kind of content">
          <select value={contentType} onChange={(e) => s.update((d) => ({ ...d, contentType: e.target.value as ContentType }))}>
            {CONTENT_TYPES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Split with" hint={providers.length ? undefined : 'Built-in rules (add an API key for AI)'}>
          <select value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)}>
            {providers.map((p) => (
              <option key={p} value={p}>
                {p === 'gemini' ? 'Gemini' : 'Claude'}
              </option>
            ))}
            <option value="rules">Built-in rules</option>
          </select>
        </Field>
        <button className="btn primary" onClick={() => void split()} disabled={busy || !text.trim()} title="⌘↵">
          {busy ? <span className="spinner sm" aria-hidden="true" /> : <Icon name="spark" />}
          {busy ? 'Splitting…' : 'Split into sections'}
        </button>
      </div>
      {notes.length ? (
        <ul className="notes">
          {notes.map((n, i) => (
            <li key={i} dir="auto">
              {n}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The end-card logos already picked in this project (the split keeps them; the library is not dumped in). */
function currentLogos(spec: Draft, uploaded: string[]): string[] {
  const end = spec.sections.find((x) => x.role === 'endcard');
  return end && end.role === 'endcard' ? end.logos.filter((l) => uploaded.includes(l)) : [];
}

function DurationControl() {
  const s = useStudio();
  const v = s.validation;
  const duration = s.spec.duration;
  return (
    <div className="card" data-path="duration">
      <Slider label="Duration" value={duration} min={DURATION.min} max={DURATION.max} step={0.5} format={(x) => `${x} s`} onChange={(x) => s.update((d) => ({ ...d, duration: x }), 'duration')} dataPath="duration" />
      <TimingFeedback validation={v} />
    </div>
  );
}

const ROLE_HUES: Record<string, number> = { title: 260, endcard: 200, datetime: 30, location: 140, list: 320, stat: 50, countdown: 0 };

function TimingFeedback({ validation }: { validation: Validation | null }) {
  const s = useStudio();
  const roles = useMemo(() => new Map(s.spec.sections.map((x, i) => [sectionId(x, i), { role: x.role, index: i }])), [s.spec.sections]);
  const timing = validation?.timing;
  if (!timing) return <p className="muted small">Timing appears once every section is filled in.</p>;
  if (!timing.ok) {
    const fits = timing.needed <= DURATION.max;
    const need = Math.ceil(timing.needed * 2) / 2;
    return (
      <div className="timing-warn" role="alert">
        <Icon name="warn" />
        <span>
          This content needs <b>{need} s</b> but the video is {timing.available} s. {fits ? '' : 'Shorten the text or remove a section.'}
        </span>
        {fits ? (
          <button className="btn sm primary" onClick={() => s.update((d) => ({ ...d, duration: need }))}>
            Make it {need} s
          </button>
        ) : null}
      </div>
    );
  }
  const total = s.spec.duration;
  return (
    <div className="timing">
      <div className="timing-bar" aria-label="Section timing">
        {timing.sections.map((sec) => {
          const info = roles.get(sec.id);
          const hue = ROLE_HUES[info?.role ?? ''] ?? 280;
          return (
            <button
              key={sec.id}
              className="timing-seg"
              style={{ left: `${(sec.in / total) * 100}%`, width: `${Math.max(0.5, ((sec.out - sec.in) / total) * 100)}%`, ['--hue' as string]: hue }}
              title={`${sec.id}: ${sec.in.toFixed(1)}–${sec.out.toFixed(1)} s · ${sec.items} item${sec.items === 1 ? '' : 's'}`}
              onClick={() => info && s.select(['sections', info.index])}
            />
          );
        })}
      </div>
      <p className="muted small">
        Fits at {timing.bpm} BPM · {timing.sections.length} sections
      </p>
    </div>
  );
}
