import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Asset, MusicAiState } from '@reel/api';
import { AI_INTRO_ROOM_S, aiClipSeconds } from '@reel/core';
import { api, errorMessage, musicAiEvents } from '../api.ts';
import { audioContext, decodeUrl, peaks } from '../audio.ts';
import type { MusicInput } from '../spec.ts';
import { useStudio } from '../studio.tsx';
import { Field, Icon, Segmented, Slider, Toggle } from '../ui.tsx';

type Source = MusicInput['source'];

export function MusicPicker() {
  const s = useStudio();
  const music = s.spec.music;
  const [view, setView] = useState<Source>(music.source);
  const tracks = s.assets.filter((a) => a.kind === 'track');
  const sample = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => sample.current?.pause(), []);

  const set = (m: MusicInput, key?: string) => s.update((d) => ({ ...d, music: m }), key);
  const choose = (src: Source) => {
    setView(src);
    if (src === 'none') set({ source: 'none' });
    else if (src === 'track') {
      const t = tracks[0];
      if (t) set({ source: 'track', file: t.id, offset: 0, fadeOut: 1.5 });
    } else if (src === 'preset') {
      const p = s.catalog.music[0];
      if (p) set({ source: 'preset', preset: p.id, bpm: p.defaultBpm, seed: 1101 });
    }
    // 'ai': the spec switches once a clip is generated (the preview cannot play an ungenerated clip)
  };
  // Undo/redo can change the source under us.
  const lastSource = useRef(music.source);
  useEffect(() => {
    if (music.source === lastSource.current) return;
    lastSource.current = music.source;
    setView(music.source);
  }, [music.source]);

  const toggleSample = (preset: string, bpm: number) => {
    sample.current?.pause();
    if (playing === preset) {
      setPlaying(null);
      return;
    }
    const a = new Audio(api.musicSample(preset, bpm));
    a.loop = true;
    a.onended = () => setPlaying(null);
    a.play().catch((e) => {
      s.toast(`Sample unavailable: ${errorMessage(e)}`, { tone: 'error' });
      setPlaying(null);
    });
    sample.current = a;
    setPlaying(preset);
  };

  const uploadTrack = async (file: File) => {
    try {
      const a = await api.upload(file, 'track', file.name);
      await s.refreshAssets();
      set({ source: 'track', file: a.id, offset: 0, fadeOut: 1.5 });
    } catch (e) {
      s.toast(`Track upload failed: ${errorMessage(e)}`, { tone: 'error' });
    }
  };

  return (
    <div className="card" data-path="music">
      <div className="row space-between align-center">
        <h3>Music</h3>
        <Segmented
          label="Music source"
          size="sm"
          value={view}
          onChange={choose}
          options={[
            { value: 'preset', label: 'Generated' },
            { value: 'ai', label: 'AI', disabled: !s.catalog.setup.musicAi, title: s.catalog.setup.musicAi ? 'Describe the music; ACE-Step writes it' : 'Not installed: run pnpm reelgen setup music-ai' },
            { value: 'track', label: 'My track' },
            { value: 'none', label: 'None' },
          ]}
        />
      </div>
      {!s.catalog.setup.musicAi && view !== 'ai' ? (
        <p className="muted small" data-path="music-ai-hint">
          AI music is an optional add-on: run <code>pnpm reelgen setup music-ai</code> (ACE-Step 1.5, ~11 GB) to enable it.
        </p>
      ) : null}

      {view === 'preset' && music.source === 'preset' ? (
        <>
          {!s.catalog.setup.samples ? <p className="field-warn">Instrument samples are missing: run <code>pnpm reelgen setup samples</code>.</p> : null}
          <div className="preset-grid" role="radiogroup" aria-label="Music presets">
            {s.catalog.music.map((p) => {
              const on = music.preset === p.id;
              const bpm = on ? music.bpm : p.defaultBpm;
              return (
                <div key={p.id} className={`preset-card ${on ? 'on' : ''}`}>
                  <button
                    role="radio"
                    aria-checked={on}
                    className="preset-pick"
                    onClick={() => set({ ...music, preset: p.id, bpm: Math.min(p.bpm[1], Math.max(p.bpm[0], on ? music.bpm : p.defaultBpm)) })}
                  >
                    <strong>{p.name}</strong>
                    <span className="muted small">
                      {p.description} · {p.defaultBpm} BPM
                    </span>
                  </button>
                  <button
                    className="btn icon ghost sm play-sample"
                    aria-label={playing === p.id ? `Stop ${p.id} sample` : `Play ${p.id} sample`}
                    onClick={() => toggleSample(p.id, bpm)}
                  >
                    <Icon name={playing === p.id ? 'pause' : 'play'} size={16} />
                  </button>
                </div>
              );
            })}
          </div>
          {(() => {
            const p = s.catalog.music.find((x) => x.id === music.preset);
            return p ? (
              <Slider
                label="Tempo"
                value={music.bpm}
                min={p.bpm[0]}
                max={p.bpm[1]}
                step={1}
                format={(v) => `${v} BPM`}
                onChange={(v) => set({ ...music, bpm: v }, 'bpm')}
                onReset={music.bpm === p.defaultBpm ? undefined : () => set({ ...music, bpm: p.defaultBpm })}
              />
            ) : null;
          })()}
          <div className="row gap align-center">
            <button className="btn ghost sm" onClick={() => set({ ...music, seed: Math.floor(Math.random() * 100000) })}>
              Try another variation
            </button>
            <span className="muted small">variation #{music.seed}</span>
          </div>
        </>
      ) : null}

      {view === 'track' ? (
        music.source === 'track' ? (
          <TrackPanel music={music} tracks={tracks} onUpload={uploadTrack} set={set} />
        ) : (
          <label className="dropzone compact">
            <Icon name="upload" size={20} />
            <div>
              <strong>Upload a song</strong>
              <div className="muted small">MP3, WAV, M4A, FLAC or OGG. The text lands on its beats.</div>
            </div>
            <input type="file" accept="audio/*" hidden onChange={(e) => e.target.files?.[0] && void uploadTrack(e.target.files[0])} />
          </label>
        )
      ) : null}
      {view === 'ai' ? <AiPanel set={set} /> : null}
      {view === 'none' ? <p className="muted small">No music. Sound effects still play if they are on.</p> : null}
    </div>
  );
}

/** AI music (ACE-Step add-on): prompt, optional lyrics and tempo hint, seed; Generate streams progress, then plays. */
function AiPanel({ set }: { set: (m: MusicInput, key?: string) => void }) {
  const s = useStudio();
  const music = s.spec.music;
  const ai = music.source === 'ai' ? music : null;
  const [prompt, setPrompt] = useState(ai?.prompt ?? '');
  const [lyrics, setLyrics] = useState(ai?.lyrics ?? '');
  const [bpm, setBpm] = useState<number | null>(ai?.bpm ?? null);
  const [seed, setSeed] = useState(ai?.seed ?? 1);
  const [job, setJob] = useState<MusicAiState | null>(null);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  const offset = ai?.offset ?? 0;
  const seconds = aiClipSeconds(s.spec.duration, offset);

  // A spec that already uses AI music: find its clip in the cache (never generates).
  const specKey = ai ? JSON.stringify([ai.prompt, ai.lyrics ?? '', ai.bpm ?? null, ai.seed, seconds]) : '';
  useEffect(() => {
    if (!ai) return;
    api
      .musicAi({ prompt: ai.prompt, ...(ai.lyrics?.trim() ? { lyrics: ai.lyrics } : {}), ...(ai.bpm !== undefined ? { bpm: ai.bpm } : {}), seed: ai.seed, seconds, cachedOnly: true })
      .then(setJob, () => setJob(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey]);

  const generate = async (withSeed: number) => {
    setSeed(withSeed);
    stop.current?.();
    const clip = { prompt: prompt.trim(), ...(lyrics.trim() ? { lyrics } : {}), ...(bpm !== null ? { bpm } : {}), seed: withSeed };
    const req = { ...clip, seconds };
    const finish = (st: MusicAiState) => {
      setJob(st);
      if (st.status === 'done') set({ source: 'ai', ...clip, offset, fadeOut: ai?.fadeOut ?? 1.5 });
      if (st.status === 'error') s.toast(`AI music failed: ${st.error ?? 'unknown error'}`, { tone: 'error' });
    };
    try {
      const first = await api.musicAi(req);
      finish(first);
      if (first.status === 'running') stop.current = musicAiEvents(first.key, finish);
    } catch (e) {
      s.toast(`AI music failed: ${errorMessage(e)}`, { tone: 'error' });
    }
  };
  const running = job?.status === 'running';

  return (
    <div className="stack" data-path="music-ai">
      {!s.catalog.setup.musicAi ? (
        <p className="field-warn">
          AI music is not installed: run <code>pnpm reelgen setup music-ai</code>.
        </p>
      ) : null}
      <Field label="Describe the music">
        <textarea rows={3} maxLength={500} value={prompt} placeholder="e.g. upbeat nu-disco, slap bass, rhythm guitar, claps" onChange={(e) => setPrompt(e.target.value)} />
      </Field>
      <Field label="Lyrics (optional; instrumental without)">
        <textarea rows={2} maxLength={4000} value={lyrics} onChange={(e) => setLyrics(e.target.value)} />
      </Field>
      <Toggle checked={bpm !== null} onChange={(on) => setBpm(on ? 110 : null)} label="Tempo hint" />
      {bpm !== null ? <Slider label="Tempo" value={bpm} min={60} max={180} step={1} format={(v) => `${v} BPM`} onChange={setBpm} /> : null}
      <div className="row gap align-center">
        <button className="btn primary sm" disabled={running || !prompt.trim() || !s.catalog.setup.musicAi} onClick={() => void generate(seed)}>
          <Icon name="spark" size={16} /> Generate
        </button>
        <button className="btn ghost sm" disabled={running || !prompt.trim() || !s.catalog.setup.musicAi} onClick={() => void generate(Math.floor(Math.random() * 100000))}>
          Try another
        </button>
        <span className="muted small">variation #{seed}</span>
      </div>
      {running ? (
        <div className="stack">
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((job?.progress ?? 0) * 100)}>
            <span style={{ width: `${Math.round((job?.progress ?? 0) * 100)}%` }} />
          </div>
          <span className="muted small">
            {Math.round((job?.progress ?? 0) * 100)}% · {job?.stage} (about a minute on Apple Silicon)
          </span>
        </div>
      ) : null}
      {job?.status === 'done' && job.url && ai ? (
        <>
          <Waveform url={job.url} offset={offset} length={s.spec.duration} onOffset={(o) => set({ ...ai, offset: Math.min(AI_INTRO_ROOM_S, Math.round(o * 100) / 100) }, 'offset')} />
          <Slider label="Fade out at the end" value={ai.fadeOut ?? 1.5} min={0} max={5} step={0.1} format={(v) => `${v.toFixed(1)} s`} onChange={(v) => set({ ...ai, fadeOut: v }, 'fade')} />
        </>
      ) : null}
    </div>
  );
}

function TrackPanel({ music, tracks, onUpload, set }: { music: MusicInput; tracks: Asset[]; onUpload: (f: File) => Promise<void>; set: (m: MusicInput, key?: string) => void }) {
  const s = useStudio();
  if (music.source !== 'track') return null;
  const track = tracks.find((t) => t.id === music.file);
  return (
    <div className="stack">
      {!s.catalog.setup.analysis ? <p className="field-warn">Beat analysis is not installed: run <code>pnpm reelgen setup analysis</code>.</p> : null}
      <div className="row gap align-end wrap">
        <label className="field grow">
          <span className="field-label">Track</span>
          <select value={music.file} onChange={(e) => set({ ...music, file: e.target.value, offset: 0 })}>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="btn sm">
          <Icon name="upload" size={16} /> Upload
          <input type="file" accept="audio/*" hidden onChange={(e) => e.target.files?.[0] && void onUpload(e.target.files[0])} />
        </label>
      </div>
      {track ? (
        <Waveform url={track.url} offset={music.offset ?? 0} length={s.spec.duration} onOffset={(o) => set({ ...music, offset: Math.round(o * 100) / 100 }, 'offset')} />
      ) : null}
      <Slider label="Fade out at the end" value={music.fadeOut ?? 1.5} min={0} max={5} step={0.1} format={(v) => `${v.toFixed(1)} s`} onChange={(v) => set({ ...music, fadeOut: v }, 'fade')} />
    </div>
  );
}

function Waveform({ url, offset, length, onOffset }: { url: string; offset: number; length: number; onOffset: (o: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [buf, setBuf] = useState<AudioBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const src = useRef<AudioBufferSourceNode | null>(null);
  useEffect(() => {
    setBuf(null);
    setError(null);
    decodeUrl(url).then(setBuf, (e) => setError(errorMessage(e)));
  }, [url]);
  useEffect(() => () => src.current?.stop(), []);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !buf) return;
    const dpr = devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    const cols = Math.floor(w / 2);
    const pk = peaks(buf, cols);
    const css = getComputedStyle(c);
    const a = (offset / buf.duration) * w;
    const b = ((offset + length) / buf.duration) * w;
    g.fillStyle = css.getPropertyValue('--accent-soft') || 'rgba(109,94,252,.15)';
    g.fillRect(a, 0, b - a, h);
    pk.forEach((v, i) => {
      const x = i * 2;
      const inside = x >= a && x <= b;
      g.fillStyle = inside ? css.getPropertyValue('--accent') || '#6d5efc' : css.getPropertyValue('--muted') || '#888';
      const bh = Math.max(1, v * (h - 4));
      g.fillRect(x, (h - bh) / 2, 1.4, bh);
    });
    g.fillStyle = css.getPropertyValue('--text') || '#000';
    g.fillRect(a - 1, 0, 2, h);
  }, [buf, offset, length]);

  const setFromEvent = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!buf) return;
    const r = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * buf.duration;
    onOffset(Math.max(0, Math.min(Math.max(0, buf.duration - length), t)));
  };

  const play = () => {
    if (!buf) return;
    if (playing) {
      src.current?.stop();
      return;
    }
    const ctx = audioContext();
    void ctx.resume();
    const n = ctx.createBufferSource();
    n.buffer = buf;
    n.connect(ctx.destination);
    n.onended = () => setPlaying(false);
    n.start(0, offset, Math.min(length, buf.duration - offset));
    src.current = n;
    setPlaying(true);
  };

  if (error) return <p className="field-error">Could not decode the track: {error}</p>;
  return (
    <div className="waveform">
      <div className="row space-between align-center">
        <span className="field-label">Start at {offset.toFixed(2)} s {buf ? <span className="muted small">of {buf.duration.toFixed(1)} s · drag to move</span> : null}</span>
        <button className="btn sm" onClick={play} disabled={!buf}>
          <Icon name={playing ? 'pause' : 'play'} size={14} /> {playing ? 'Stop' : `Play ${length} s`}
        </button>
      </div>
      <canvas
        ref={canvas}
        className={buf ? '' : 'skeleton'}
        role="slider"
        tabIndex={0}
        aria-label="Track start"
        aria-valuemin={0}
        aria-valuemax={buf?.duration ?? 0}
        aria-valuenow={offset}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setFromEvent(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons) setFromEvent(e);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') onOffset(Math.max(0, offset - 0.5));
          if (e.key === 'ArrowRight' && buf) onOffset(Math.min(buf.duration - length, offset + 0.5));
        }}
      />
    </div>
  );
}
