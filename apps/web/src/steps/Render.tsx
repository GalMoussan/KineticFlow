import { useCallback, useEffect, useRef, useState } from 'react';
import type { RenderSummary } from '@reel/api';
import type { FormatId } from '@reel/core';
import { api, errorMessage, renderEvents, type Quality } from '../api.ts';
import { useStudio } from '../studio.tsx';
import { fmtBytes, Empty, Icon, LevelIcon, Segmented, StepHeader } from '../ui.tsx';
import { estimate, FormatChips } from './Look.tsx';

interface ChunkBar {
  index: number;
  frames: number;
  done: number;
  cached: boolean;
  finished: boolean;
}

interface Live {
  summary: RenderSummary;
  label: string;
  chunks: Partial<Record<FormatId, ChunkBar[]>>;
  qa: RenderSummary['qa'];
}

type RenderEventLike =
  | { type: 'plan'; format: FormatId; chunks: { index: number; frames: number; cached: boolean }[] }
  | { type: 'chunk'; format: FormatId; index: number; done: number; total: number }
  | { type: 'chunk-done'; format: FormatId; index: number }
  | { type: 'qa'; phase: string; result: { gate: string; level: 'pass' | 'warn' | 'fail'; format?: FormatId; detail: string } }
  | { type: string };

const ACTIVE: Record<RenderSummary['state'], boolean> = { queued: true, running: true, done: false, failed: false, cancelled: false };

export function RenderSheet() {
  const s = useStudio();
  const ref = useRef<HTMLDialogElement>(null);
  const [formats, setFormats] = useState<FormatId[]>(s.spec.formats);
  const [quality, setQuality] = useState<Quality>(typeof s.spec.quality === 'string' ? s.spec.quality : 'standard');
  const [busy, setBusy] = useState(false);
  const errors = [...(s.validation?.issues ?? []), ...(s.validation?.style ?? [])].filter((i) => i.level === 'error');

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const start = async () => {
    setBusy(true);
    try {
      await s.flush();
      const r = await api.startRender(s.projectId, quality, formats);
      s.setActiveRender(r.id);
      s.setRenderSheet(false);
      requestAnimationFrame(() => document.getElementById('step-render')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (e) {
      s.toast(`Render could not start: ${errorMessage(e)}`, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="sheet" onClose={() => s.setRenderSheet(false)} aria-labelledby="render-sheet-title">
      <form method="dialog" className="sheet-body" onSubmit={(e) => (e.preventDefault(), void start())}>
        <header className="row space-between align-center">
          <h2 id="render-sheet-title">Render video</h2>
          <button type="button" className="btn icon ghost" aria-label="Close" onClick={() => s.setRenderSheet(false)}>
            <Icon name="close" />
          </button>
        </header>
        <div className="field">
          <span className="field-label">Formats</span>
          <FormatChips value={formats} onChange={setFormats} />
        </div>
        <div className="field">
          <span className="field-label">Quality</span>
          <Segmented
            label="Quality"
            value={quality}
            onChange={setQuality}
            options={[
              { value: 'draft', label: 'Draft' },
              { value: 'standard', label: 'Standard' },
              { value: 'final', label: 'Final' },
            ]}
          />
          <span className="field-hint">
            {estimate(quality, s.spec.duration, formats.length)} on this machine
            {quality === 'final' ? ' · 60 fps, motion blur, 2× sharper' : quality === 'draft' ? ' · a quick look' : ''}
          </span>
        </div>
        {errors.length ? (
          <div className="timing-warn" role="alert">
            <Icon name="warn" />
            <span>
              {errors.length} problem{errors.length > 1 ? 's' : ''} must be fixed first: {errors[0]!.message}
            </span>
          </div>
        ) : null}
        <footer className="row gap end">
          <button type="button" className="btn ghost" onClick={() => s.setRenderSheet(false)}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || errors.length > 0 || formats.length === 0} data-testid="start-render">
            {busy ? 'Starting…' : 'Start render'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

export function RenderStep() {
  const s = useStudio();
  const [history, setHistory] = useState<RenderSummary[] | null>(null);
  const [queue, setQueue] = useState<RenderSummary[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [h, q] = await Promise.all([api.projectRenders(s.projectId), api.renders()]);
      setHistory(h);
      setQueue(q.filter((r) => ACTIVE[r.state]));
    } catch {
      setHistory((h) => h ?? []);
    }
  }, [s.projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh, s.activeRender]);

  // Resume the panel for a render that is still running after a reload.
  useEffect(() => {
    if (!s.activeRender && history) {
      const running = history.find((r) => ACTIVE[r.state]);
      if (running) s.setActiveRender(running.id);
    }
  }, [history, s]);

  const others = queue.filter((r) => r.id !== s.activeRender);
  const past = (history ?? []).filter((r) => r.id !== s.activeRender);

  return (
    <section className="step" id="step-render">
      <StepHeader n={5} title="Render">
        <button className="btn primary sm" onClick={() => s.setRenderSheet(true)}>
          Render…
        </button>
      </StepHeader>
      {s.activeRender ? <RenderPanel key={s.activeRender} id={s.activeRender} onFinished={refresh} /> : null}
      {others.length ? (
        <div className="card">
          <h3>Queue</h3>
          <ul className="render-list">
            {others.map((r) => (
              <li key={r.id}>
                <span dir="auto">{r.title || r.projectId}</span>
                <span className="muted small">
                  {r.state} · {r.formats.join(', ')} · {Math.round(r.progress * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="card">
        <h3>History</h3>
        {history === null ? (
          <div className="skeleton line" />
        ) : past.length === 0 ? (
          <Empty title={s.activeRender ? 'No earlier renders' : 'No renders yet'}>When the preview looks right, press Render. Finished videos appear here.</Empty>
        ) : (
          <ul className="render-list">
            {past.map((r) => (
              <li key={r.id}>
                <button className="render-row" onClick={() => s.setActiveRender(r.id)}>
                  {r.outputs[0] ? <img className="render-thumb" src={r.outputs[0].thumbnail} alt="" /> : <span className={`render-thumb state-${r.state}`} />}
                  <span className="grow">
                    <strong>{new Date(r.createdAt).toLocaleString()}</strong>
                    <span className="muted small">
                      {' '}
                      · {r.quality} · {r.formats.join(', ')}
                    </span>
                  </span>
                  <span className={`state-tag state-${r.state}`}>{r.state}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function RenderPanel({ id, onFinished }: { id: string; onFinished: () => void }) {
  const s = useStudio();
  const [live, setLive] = useState<Live | null>(null);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    let finished = false;
    const stop = renderEvents(
      id,
      (e) => {
        if (e.type === 'state' && !ACTIVE[e.render.state] && !finished) {
          finished = true;
          onFinished();
        }
        setLive((prev) => {
          if (e.type === 'state') return { label: '', chunks: {}, ...prev, summary: e.render, qa: e.render.qa.length ? e.render.qa : (prev?.qa ?? []) };
          if (!prev) return prev;
          const cur = prev;
          if (e.type === 'progress') return { ...cur, summary: { ...cur.summary, progress: e.progress }, label: e.label };
          const ev = e.event as RenderEventLike;
          if (ev.type === 'plan' && 'chunks' in ev) {
            return { ...cur, chunks: { ...cur.chunks, [ev.format]: ev.chunks.map((c) => ({ ...c, done: c.cached ? c.frames : 0, finished: c.cached })) } };
          }
          if ((ev.type === 'chunk' || ev.type === 'chunk-done') && 'index' in ev) {
            const bars = cur.chunks[ev.format];
            if (!bars) return cur;
            const next = bars.map((b) =>
              b.index !== ev.index ? b : ev.type === 'chunk' && 'done' in ev ? { ...b, done: ev.done, frames: ev.total } : { ...b, done: b.frames, finished: true },
            );
            return { ...cur, chunks: { ...cur.chunks, [ev.format]: next } };
          }
          if (ev.type === 'qa' && 'result' in ev) return { ...cur, qa: [...cur.qa.filter((q) => !(q.gate === ev.result.gate && q.format === ev.result.format)), ev.result] };
          return cur;
        });
      },
      () => {
        if (!finished) setLost(true);
      },
    );
    return stop;
  }, [id, onFinished]);

  if (!live?.summary) {
    return (
      <div className="card render-panel">
        <div className="skeleton line" />
        {lost ? <p className="muted small">Lost the connection to the render. It continues in the terminal.</p> : null}
      </div>
    );
  }
  const r = live.summary;
  const active = ACTIVE[r.state];
  const fails = live.qa.filter((q) => q.level !== 'pass');
  return (
    <div className="card render-panel" data-testid="render-panel" data-state={r.state}>
      <div className="row space-between align-center">
        <div>
          <h3>
            {r.state === 'done' ? 'Your video is ready' : r.state === 'failed' ? 'Render failed' : r.state === 'cancelled' ? 'Render cancelled' : r.state === 'queued' ? 'Waiting in the queue…' : 'Rendering…'}
          </h3>
          <span className="muted small">
            {r.quality} · {r.formats.join(', ')} · started {new Date(r.createdAt).toLocaleTimeString()}
            {r.finishedAt ? ` · took ${Math.round((Date.parse(r.finishedAt) - Date.parse(r.createdAt)) / 1000)} s` : ''}
          </span>
        </div>
        {active ? (
          <button className="btn ghost sm danger" onClick={() => api.cancelRender(r.id).catch((e) => s.toast(errorMessage(e), { tone: 'error' }))}>
            Cancel
          </button>
        ) : (
          <button className="btn ghost sm" onClick={() => s.setActiveRender(null)}>
            Close
          </button>
        )}
      </div>

      {active ? (
        <>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(r.progress * 100)}>
            <span style={{ width: `${r.progress * 100}%` }} />
          </div>
          <p className="muted small">
            {Math.round(r.progress * 100)}% · {live.label || r.state}
          </p>
        </>
      ) : null}

      {Object.entries(live.chunks).length ? (
        <div className="chunk-rows">
          {(Object.entries(live.chunks) as [FormatId, ChunkBar[]][]).map(([f, bars]) => (
            <div key={f} className="chunk-row">
              <span className="mono small">{f}</span>
              <div className="chunks">
                {bars.map((b) => (
                  <span key={b.index} className={`chunk ${b.cached ? 'cached' : ''} ${b.finished ? 'done' : ''}`} title={`chunk ${b.index + 1}: ${b.cached ? 'cached' : `${b.done}/${b.frames} frames`}`} style={{ flex: b.frames }}>
                    <span style={{ width: `${(b.done / Math.max(1, b.frames)) * 100}%` }} />
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {r.state === 'failed' && r.error ? <pre className="error-box">{r.error}</pre> : null}

      {r.state === 'done' && r.outputs.length ? (
        <div className="outputs">
          {r.outputs.map((o) => (
            <div key={o.format} className="output">
              <video src={o.video} poster={o.thumbnail} controls playsInline className={`video r-${o.format.replace(':', 'x')}`} data-testid="render-video" />
              <div className="output-meta">
                <strong>{o.format}</strong>
                <span className="muted small">{fmtBytes(o.bytes)}</span>
                <a className="btn sm" href={o.video} download>
                  <Icon name="download" size={14} /> MP4
                </a>
                {o.noMusic ? (
                  <a className="btn ghost sm" href={o.noMusic} download>
                    Without music
                  </a>
                ) : null}
                <a className="btn ghost sm" href={o.thumbnail} download>
                  Thumbnail
                </a>
              </div>
            </div>
          ))}
          <button className="btn" onClick={() => api.revealRender(r.id).catch((e) => s.toast(errorMessage(e), { tone: 'error' }))}>
            <Icon name="folder" size={16} /> Show in Finder
          </button>
        </div>
      ) : null}

      {live.qa.length ? (
        <details className="qa" open={fails.length > 0}>
          <summary>
            Quality checks: {live.qa.filter((q) => q.level === 'pass').length} passed
            {fails.length ? `, ${fails.length} to look at` : ''}
          </summary>
          <ul>
            {live.qa.map((q, i) => (
              <li key={i}>
                <LevelIcon level={q.level} /> <b>{q.gate}</b>
                {q.format ? ` ${q.format}` : ''} <span className="muted">{q.detail}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
