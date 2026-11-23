import { useEffect, useState } from 'react';
import type { Catalog, ProjectSummary } from '@reel/api';
import example from '../../../examples/dilemma.json';
import { api, errorMessage } from './api.ts';
import { navigate } from './route.ts';
import { blankSpec, newSpecId, type Draft } from './spec.ts';
import { Icon } from './ui.tsx';

/** `examples/dilemma.json` with a fresh id; end-card logos limited to ones already uploaded. */
export function exampleSpec(logoIds: string[]): Draft {
  const spec = structuredClone(example) as unknown as Draft;
  return {
    ...spec,
    id: newSpecId(),
    formats: ['9:16'],
    sections: spec.sections.map((s) => (s.role === 'endcard' ? { ...s, logos: s.logos.filter((l) => logoIds.includes(l)) } : s)),
  };
}

export async function createAndOpen(spec: Draft): Promise<void> {
  const res = await api.createProject(spec);
  navigate(`/p/${res.project.id}`);
}

export function Home({ catalog }: { catalog: Catalog }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => api.projects().then(setProjects, (e) => setError(errorMessage(e)));
  useEffect(() => {
    void refresh();
  }, []);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const startExample = () =>
    run('example', async () => {
      const logos = (await api.assets('logo')).map((a) => a.id);
      await createAndOpen(exampleSpec(logos));
    });
  const startBlank = () => run('blank', () => createAndOpen(blankSpec()));

  const styleName = (id: string) => catalog.styles.find((s) => s.id === id)?.name ?? id;

  return (
    <div className="home">
      <header className="home-head">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Icon name="play" size={16} />
          </span>
          Reel Studio
        </div>
      </header>
      <section className="hero">
        <h1>Turn your text into a moving reel.</h1>
        <p className="muted">Paste your text, drop your logos, pick a style, and press Render. Everything happens here, on your computer.</p>
        <div className="row gap">
          <button className="btn primary lg" onClick={startExample} disabled={busy !== null}>
            {busy === 'example' ? 'Opening…' : 'Start with an example'}
          </button>
          <button className="btn lg" onClick={startBlank} disabled={busy !== null}>
            <Icon name="plus" /> {busy === 'blank' ? 'Creating…' : 'New blank project'}
          </button>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <ol className="how">
          <li>
            <b>1</b> Paste your text: the studio splits it into sections.
          </li>
          <li>
            <b>2</b> Drop your logos: backgrounds are removed for you.
          </li>
          <li>
            <b>3</b> Pick a style and colours: the preview plays as you edit.
          </li>
        </ol>
      </section>
      <section className="projects">
        <h2>Your projects</h2>
        {projects === null ? (
          <div className="project-grid">
            {[0, 1, 2].map((i) => (
              <div key={i} className="project-card skeleton" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <p className="muted">No projects yet. Start with the example to see how it works.</p>
        ) : (
          <div className="project-grid">
            {projects.map((p) => (
              <article key={p.id} className="project-card">
                <button className="project-open" onClick={() => navigate(`/p/${p.id}`)} aria-label={`Open ${p.title || 'untitled'}`}>
                  <div className="project-thumb">{p.thumbnail ? <img src={p.thumbnail} alt="" /> : <span>{(p.title || '?').slice(0, 1)}</span>}</div>
                  <div className="project-meta">
                    <strong dir="auto">{p.title || 'Untitled'}</strong>
                    <span className="muted small">
                      {styleName(p.style)} · {new Date(p.updatedAt).toLocaleString()}
                    </span>
                  </div>
                </button>
                <div className="project-actions">
                  <button className="btn ghost sm" onClick={() => run('dup', async () => navigate(`/p/${(await api.duplicateProject(p.id)).project.id}`))}>
                    Duplicate
                  </button>
                  <button
                    className="btn ghost sm danger"
                    onClick={() => {
                      if (confirm(`Delete “${p.title || 'Untitled'}”?`)) void run('del', async () => (await api.deleteProject(p.id), refresh()));
                    }}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
