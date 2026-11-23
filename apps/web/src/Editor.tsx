import { useEffect, useRef, useState } from 'react';
import type { ProjectSummary } from '@reel/api';
import { api, errorMessage } from './api.ts';
import { createAndOpen } from './Home.tsx';
import { Player } from './preview/Player.tsx';
import { navigate } from './route.ts';
import { blankSpec, specTitle } from './spec.ts';
import { BrandStep } from './steps/Brand.tsx';
import { ContentStep } from './steps/Content.tsx';
import { LookStep } from './steps/Look.tsx';
import { RenderSheet, RenderStep } from './steps/Render.tsx';
import { StyleStep } from './steps/Style.tsx';
import { useStudio } from './studio.tsx';
import { Icon } from './ui.tsx';

const STEPS = [
  { id: 'content', label: 'Content' },
  { id: 'brand', label: 'Brand' },
  { id: 'style', label: 'Style' },
  { id: 'look', label: 'Look' },
  { id: 'render', label: 'Render' },
] as const;

export function Editor() {
  const s = useStudio();
  const title = specTitle(s.spec);
  useEffect(() => {
    document.title = `${title || 'Untitled'} · Reel Studio`;
  }, [title]);
  return (
    <div className="app">
      <TopBar />
      <main className="workspace">
        <div className="steps-col" id="steps-col">
          <StepNav />
          <ContentStep />
          <BrandStep />
          <StyleStep />
          <LookStep />
          <RenderStep />
        </div>
        <aside className="preview-col" aria-label="Live preview">
          <Player />
        </aside>
      </main>
      {s.renderSheet ? <RenderSheet /> : null}
      <Toasts />
    </div>
  );
}

function TopBar() {
  const s = useStudio();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  useEffect(() => {
    api.projects().then(setProjects, () => {});
  }, [s.projectId]);
  const title = specTitle(s.spec);
  const errors = s.validation ? s.validation.issues.filter((i) => i.level === 'error').length + s.validation.style.filter((i) => i.level === 'error').length : 0;
  const saveLabel = { saved: 'Saved', saving: 'Saving…', dirty: 'Unsaved changes', error: 'Not saved' }[s.save];

  const pick = async (value: string) => {
    if (value === '__new') {
      await s.flush();
      createAndOpen(blankSpec()).catch((e) => s.toast(errorMessage(e), { tone: 'error' }));
    } else if (value === '__all') {
      await s.flush();
      navigate('/');
    } else if (value !== s.projectId) {
      await s.flush();
      navigate(`/p/${value}`);
    }
  };

  return (
    <header className="topbar">
      <button className="brand btn-plain" onClick={() => void pick('__all')} title="All projects">
        <span className="brand-mark" aria-hidden="true">
          <Icon name="play" size={14} />
        </span>
        <span className="brand-name">Reel Studio</span>
      </button>
      <label className="project-picker">
        <span className="sr-only">Project</span>
        <select value={s.projectId} onChange={(e) => void pick(e.target.value)}>
          {projects.some((p) => p.id === s.projectId) ? null : <option value={s.projectId}>{title || 'Untitled'}</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id === s.projectId ? title || 'Untitled' : p.title || 'Untitled'}
            </option>
          ))}
          <option disabled>──────────</option>
          <option value="__new">+ New project</option>
          <option value="__all">All projects…</option>
        </select>
      </label>
      <span className={`save-status save-${s.save}`} role="status" title={s.saveError ?? undefined}>
        <span className="dot" aria-hidden="true" />
        {saveLabel}
      </span>
      <div className="topbar-spacer" />
      <div className="row gap-sm">
        <button className="btn icon ghost" onClick={s.undo} disabled={!s.canUndo} title="Undo (⌘Z)" aria-label="Undo">
          <Icon name="undo" />
        </button>
        <button className="btn icon ghost" onClick={s.redo} disabled={!s.canRedo} title="Redo (⇧⌘Z)" aria-label="Redo">
          <Icon name="redo" />
        </button>
        <button className="btn" onClick={() => void s.runCheck()} disabled={s.checking} title="Run the quality checks without rendering">
          {s.checking ? <span className="spinner sm" aria-hidden="true" /> : <Icon name="check" />}
          {s.checking ? 'Checking…' : 'Check'}
        </button>
        <button
          className="btn primary"
          onClick={() => s.setRenderSheet(true)}
          title={errors ? `${errors} problem${errors > 1 ? 's' : ''} to fix first` : 'Render the video'}
        >
          Render
          {errors ? <span className="badge">{errors}</span> : null}
        </button>
      </div>
    </header>
  );
}

function StepNav() {
  const [active, setActive] = useState<string>('content');
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = document.getElementById('steps-col');
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (vis) setActive(vis.target.id.replace('step-', ''));
      },
      { root, rootMargin: '-80px 0px -60% 0px' },
    );
    for (const st of STEPS) {
      const el = document.getElementById(`step-${st.id}`);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, []);
  return (
    <nav className="step-nav" ref={ref} aria-label="Steps">
      {STEPS.map((st, i) => (
        <a
          key={st.id}
          href={`#step-${st.id}`}
          className={active === st.id ? 'on' : ''}
          onClick={(e) => {
            e.preventDefault();
            document.getElementById(`step-${st.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setActive(st.id);
          }}
        >
          <span className="step-num">{i + 1}</span>
          {st.label}
        </a>
      ))}
    </nav>
  );
}

function Toasts() {
  const s = useStudio();
  return (
    <div className="toasts" aria-live="polite">
      {s.toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone ?? ''}`}>
          <span>{t.text}</span>
          {t.action ? (
            <button
              className="btn sm"
              onClick={() => {
                t.action!.run();
                s.dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          ) : null}
          <button className="btn icon ghost sm" aria-label="Dismiss" onClick={() => s.dismissToast(t.id)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
