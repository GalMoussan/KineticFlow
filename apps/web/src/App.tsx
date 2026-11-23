import { useCallback, useEffect, useState } from 'react';
import type { Catalog, ProjectWithValidation } from '@reel/api';
import { api, errorMessage } from './api.ts';
import { Home } from './Home.tsx';
import { Editor } from './Editor.tsx';
import { navigate, projectIdOf, usePath } from './route.ts';
import { StudioProvider } from './studio.tsx';

export function App() {
  const path = usePath();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.catalog().then(setCatalog, (e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  if (error) {
    return (
      <div className="center-screen">
        <div className="card narrow">
          <h1>Can’t reach Reel Studio</h1>
          <p className="muted">The local server did not answer ({error}). Start it with <code>pnpm reelgen serve</code>, then retry.</p>
          <button className="btn primary" onClick={load}>
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (!catalog) return <div className="center-screen"><div className="spinner" aria-label="Loading" /></div>;
  const projectId = projectIdOf(path);
  return projectId ? <ProjectLoader key={projectId} id={projectId} catalog={catalog} /> : <Home catalog={catalog} />;
}

function ProjectLoader({ id, catalog }: { id: string; catalog: Catalog }) {
  const [data, setData] = useState<ProjectWithValidation | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.project(id).then(setData, (e) => setError(errorMessage(e)));
  }, [id]);
  if (error) {
    return (
      <div className="center-screen">
        <div className="card narrow">
          <h1>Project not found</h1>
          <p className="muted">{error}</p>
          <button className="btn primary" onClick={() => navigate('/')}>
            All projects
          </button>
        </div>
      </div>
    );
  }
  if (!data) return <div className="center-screen"><div className="spinner" aria-label="Loading project" /></div>;
  return (
    <StudioProvider catalog={catalog} project={data.project} initialValidation={data.validation}>
      <Editor />
    </StudioProvider>
  );
}
