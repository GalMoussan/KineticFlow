import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Asset } from '@reel/api';
import { api, errorMessage } from '../api.ts';
import { audioContext, decodeUrl, peaks } from '../audio.ts';
import type { MusicInput } from '../spec.ts';
import { useStudio } from '../studio.tsx';
import { Icon, Segmented, Slider } from '../ui.tsx';

type Source = 'preset' | 'track' | 'none';

const PRESET_BLURBS: Record<string, string> = {
  'lofi-jazz': 'Warm keys, brushed drums',
  'synthwave-drive': 'Retro synths, driving beat',
  'minimal-pop': 'Clean plucks, light groove',
  'house-128': 'Four-on-the-floor club energy',
};

function titleCase(id: string): string {
  return id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function MusicPicker() {
  const s = useStudio();
  const music = s.spec.music;
  const [view, setView] = useState<Source>(music.source === 'ai' ? 'preset' : music.source);
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
    } else {
      const p = s.catalog.music[0];
      if (p) set({ source: 'preset', preset: p.id, bpm: p.defaultBpm, seed: 1101 });
    }
  };
  // Undo/redo can change the source under us.
  const lastSource = useRef(music.source);
  useEffect(() => {
    if (music.source === lastSource.current) return;
    lastSource.current = music.source;
    if (music.source !== 'ai') setView(music.source);
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
            { value: 'track', label: 'My track' },
            { value: 'none', label: 'None' },
          ]}
        />
      </div>

      {music.source === 'preset' ? (
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
                    <strong>{titleCase(p.id)}</strong>
                    <span className="muted small">{PRESET_BLURBS[p.id] ?? `${p.bpm[0]}–${p.bpm[1]} BPM`}</span>
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
      {view === 'none' ? <p className="muted small">No music. Sound effects still play if they are on.</p> : null}
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
