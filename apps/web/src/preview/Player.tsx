/**
 * Live preview: `POST /api/preview` (debounced) → same-origin iframe → `reelPage.ready()` → `soundCues()` → mastered
 * audio. Playback drives `seek(t)` from the AudioContext clock and skips frames while a seek is in flight. The old
 * frame stays on screen until the next session has painted.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PreviewSession } from '@reel/api';
import { FORMATS, type FormatId, type ReelPage } from '@reel/core';
import { api, errorMessage } from '../api.ts';
import { audioContext, decodeUrl } from '../audio.ts';
import { describeIssue, issueSection, sectionId, ROLE_LABELS, type Draft } from '../spec.ts';
import { useStudio } from '../studio.tsx';
import { fmtTime, Icon, LevelIcon } from '../ui.tsx';

const DEBOUNCE_MS = 600;

interface Frame {
  session: PreviewSession;
  ready: boolean;
}

interface Live {
  session: PreviewSession;
  page: ReelPage;
}

interface Problem {
  level: 'error' | 'warn' | 'fail';
  text: string;
  path?: (string | number)[];
  section?: number;
  source: 'spec' | 'check';
}

async function waitForPage(el: HTMLIFrameElement, timeoutMs = 20000): Promise<ReelPage> {
  const start = performance.now();
  for (;;) {
    const page = el.contentWindow?.reelPage;
    if (page) return page;
    if (!el.isConnected) throw new Error('preview replaced');
    if (performance.now() - start > timeoutMs) throw new Error('the preview page did not start');
    await new Promise((r) => setTimeout(r, 40));
  }
}

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName) || el.getAttribute('role') === 'slider';
}

export function Player() {
  const s = useStudio();
  const formats = s.spec.formats;
  const format: FormatId = formats.includes(s.previewFormat) ? s.previewFormat : (formats[0] ?? '9:16');
  useEffect(() => {
    if (format !== s.previewFormat) s.setPreviewFormat(format);
  }, [format, s]);

  const [frames, setFrames] = useState<Frame[]>([]);
  const [session, setSession] = useState<PreviewSession | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [safe, setSafe] = useState(false);
  const [dropped, setDropped] = useState(0);
  const [audioState, setAudioState] = useState<'none' | 'loading' | 'ready' | 'silent'>('none');

  const live = useRef<Live | null>(null);
  const audioBuf = useRef<AudioBuffer | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  const timeRef = useRef(0);
  const startRef = useRef(0);
  const playingRef = useRef(false);
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const busy = useRef(false);
  const pendingSeek = useRef<number | null>(null);
  const raf = useRef(0);
  const droppedRef = useRef(0);
  const gen = useRef(0);
  const latestId = useRef<string | null>(null);

  // ---------- rendering frames ----------

  const requestFrame = useCallback((t: number) => {
    const l = live.current;
    if (!l) return;
    if (busy.current) {
      pendingSeek.current = t;
      return;
    }
    busy.current = true;
    l.page
      .seek(t)
      .catch(() => {})
      .finally(() => {
        busy.current = false;
        const next = pendingSeek.current;
        pendingSeek.current = null;
        if (next !== null && !playingRef.current) requestFrame(next);
      });
  }, []);

  const stopSource = () => {
    try {
      source.current?.stop();
    } catch {
      /* not started */
    }
    source.current?.disconnect();
    source.current = null;
  };

  const startAt = useCallback((t: number) => {
    const ctx = audioContext();
    stopSource();
    const buf = audioBuf.current;
    if (buf && t < buf.duration) {
      const n = ctx.createBufferSource();
      n.buffer = buf;
      n.connect(ctx.destination);
      n.start(0, t);
      source.current = n;
    }
    startRef.current = ctx.currentTime - t;
  }, []);

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    cancelAnimationFrame(raf.current);
    stopSource();
  }, []);

  const tick = useCallback(() => {
    if (!playingRef.current) return;
    const l = live.current;
    const dur = l?.session.duration ?? 0;
    let t = audioContext().currentTime - startRef.current;
    if (t >= dur) {
      if (loopRef.current && dur > 0) {
        startAt(0);
        t = 0;
      } else {
        timeRef.current = dur;
        setTime(dur);
        pause();
        busy.current = false;
        requestFrame(Math.max(0, dur - 1e-3));
        return;
      }
    }
    timeRef.current = t;
    setTime(t);
    if (l) {
      if (busy.current) {
        droppedRef.current++;
        setDropped(droppedRef.current);
      } else {
        busy.current = true;
        l.page
          .seek(t)
          .catch(() => {})
          .finally(() => {
            busy.current = false;
          });
      }
    }
    raf.current = requestAnimationFrame(tick);
  }, [pause, requestFrame, startAt]);

  const play = useCallback(async () => {
    if (!live.current) return;
    const ctx = audioContext();
    await ctx.resume();
    let t = timeRef.current;
    if (t >= live.current.session.duration - 0.05) t = 0;
    startAt(t);
    playingRef.current = true;
    setPlaying(true);
    droppedRef.current = 0;
    setDropped(0);
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
  }, [startAt, tick]);

  const seekTo = useCallback(
    (t: number) => {
      const dur = live.current?.session.duration ?? 0;
      const c = Math.max(0, Math.min(dur, t));
      timeRef.current = c;
      setTime(c);
      if (playingRef.current) startAt(c);
      else requestFrame(c);
    },
    [requestFrame, startAt],
  );

  useEffect(() => () => pause(), [pause]);

  // ---------- sessions ----------

  const specJson = useMemo(() => JSON.stringify(s.spec), [s.spec]);
  useEffect(() => {
    const my = ++gen.current;
    const ctl = new AbortController();
    setStatus('loading');
    const timer = setTimeout(async () => {
      try {
        const sess = await api.preview(JSON.parse(specJson) as Draft, format, ctl.signal);
        if (my !== gen.current) return;
        latestId.current = sess.id;
        setFrames((f) => [...f.filter((x) => x.ready), { session: sess, ready: false }]);
      } catch (e) {
        if (ctl.signal.aborted || my !== gen.current) return;
        setStatus('error');
        setError(errorMessage(e));
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [specJson, format]);

  const boot = useCallback(
    async (sess: PreviewSession, el: HTMLIFrameElement) => {
      try {
        const page = await waitForPage(el);
        await page.ready();
        if (!el.isConnected) return;
        // The first frame shown is the title fully on screen, not the empty t = 0.
        const first = sess.sections[0];
        const t = live.current ? Math.min(timeRef.current, sess.duration) : first ? Math.min(first.holdEnd, first.holdStart + 0.3) : 0;
        await page.seek(t);
        if (!el.isConnected) return;
        live.current = { session: sess, page };
        busy.current = false;
        timeRef.current = t;
        setTime(t);
        setSession(sess);
        setFrames((f) => {
          const i = f.findIndex((x) => x.session.id === sess.id);
          return f.slice(i).map((x) => (x.session.id === sess.id ? { ...x, ready: true } : x));
        });
        if (sess.id === latestId.current) {
          setStatus('idle');
          setError(null);
        }
        // Music + SFX for what this page animates.
        setAudioState('loading');
        let buf: AudioBuffer | null = null;
        try {
          const { url } = await api.previewAudio(sess.id, page.soundCues());
          buf = await decodeUrl(url);
        } catch {
          buf = sess.musicUrl ? await decodeUrl(sess.musicUrl).catch(() => null) : null;
        }
        if (live.current?.session.id !== sess.id) return;
        audioBuf.current = buf;
        setAudioState(buf ? 'ready' : 'silent');
        if (playingRef.current) startAt(audioContext().currentTime - startRef.current);
      } catch (e) {
        if (!el.isConnected) return;
        setStatus('error');
        setError(errorMessage(e));
        setFrames((f) => f.filter((x) => x.session.id !== sess.id));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startAt],
  );

  // ---------- keyboard ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const fps = live.current?.session.fps ?? 30;
      if (e.key === ' ') {
        e.preventDefault();
        if (playingRef.current) pause();
        else void play();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (playingRef.current) pause();
        const f = Math.round(timeRef.current * fps) + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? fps : 1);
        seekTo(f / fps);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [pause, play, seekTo]);

  // ---------- layout ----------

  const fmt = FORMATS[format];
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 360, h: 640 });
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const bezel = format === '16:9' ? 10 : 12;
  const scale = Math.max(0.05, Math.min((box.w - bezel * 2) / fmt.w, (box.h - bezel * 2) / fmt.h));
  const sw = fmt.w * scale;
  const sh = fmt.h * scale;

  // ---------- problems ----------

  const problems = useMemo<Problem[]>(() => {
    const out: Problem[] = [];
    const v = s.validation;
    if (v) {
      const has = (key: string) => v.issues.some((i) => i.path[0] === key);
      for (const i of v.issues) {
        const sec = issueSection(i.path);
        out.push({ level: i.level, text: describeIssue(i.path, i.message, s.spec), path: i.path, ...(sec !== undefined ? { section: sec } : {}), source: 'spec' });
      }
      for (const st of v.style) {
        const idx = st.section ? s.spec.sections.findIndex((x, i) => sectionId(x, i) === st.section) : -1;
        out.push({ level: st.level, text: st.message, path: idx >= 0 ? ['sections', idx] : ['style'], ...(idx >= 0 ? { section: idx } : {}), source: 'spec' });
      }
      if (v.timing && !v.timing.ok && !has('duration')) out.push({ level: 'error', text: v.timing.message, path: ['duration'], source: 'spec' });
      if (!has('fonts')) for (const m of v.missingGlyphs) out.push({ level: 'error', text: `Font ${m.font} has no glyphs for “${m.chars}”`, path: ['fonts'], source: 'spec' });
      if (!has('palette')) for (const c of v.contrast.filter((x) => x.ratio < 3)) out.push({ level: 'warn', text: `Low contrast ${c.color} on ${c.palette} (${c.ratio.toFixed(1)}:1)`, path: ['palette'], source: 'spec' });
    }
    for (const g of s.check?.gates ?? []) {
      if (g.level === 'pass') continue;
      out.push({ level: g.level === 'fail' ? 'fail' : 'warn', text: `${g.gate}${g.format ? ` (${g.format})` : ''}: ${g.detail}`, source: 'check' });
    }
    return out;
  }, [s.validation, s.check, s.spec.sections]);

  const dur = session?.duration ?? s.spec.duration;
  const sectionTimes = session?.sections ?? [];
  const pins = problems
    .filter((p) => p.section !== undefined)
    .map((p) => ({ p, sec: sectionTimes.find((x) => x.id === sectionId(s.spec.sections[p.section!]!, p.section!)) }))
    .filter((x) => x.sec);

  const scrub = useRef<HTMLDivElement>(null);
  const scrubTo = (clientX: number) => {
    const r = scrub.current?.getBoundingClientRect();
    if (!r) return;
    seekTo(((clientX - r.left) / r.width) * dur);
  };

  const checkPassed = s.check && !s.check.gates.some((g) => g.level !== 'pass');

  return (
    <div className="player">
      <div className="player-top">
        <div className="chips" role="group" aria-label="Preview format">
          {formats.map((f) => (
            <button key={f} className={`chip sm ${f === format ? 'on' : ''}`} aria-pressed={f === format} onClick={() => s.setPreviewFormat(f)}>
              <span className={`ratio r-${f.replace(':', 'x')}`} aria-hidden="true" />
              {f}
            </button>
          ))}
        </div>
        <span className={`preview-status ${status}`} role="status" data-testid="preview-status" data-status={status}>
          {status === 'loading' ? (
            <>
              <span className="spinner xs" aria-hidden="true" /> Updating
            </>
          ) : status === 'error' ? (
            <>
              <Icon name="warn" size={14} /> Not updated
            </>
          ) : session ? (
            'Live'
          ) : null}
        </span>
        <button className={`btn icon ghost sm ${safe ? 'on' : ''}`} aria-pressed={safe} title="Show Instagram safe area" aria-label="Safe area overlay" onClick={() => setSafe((x) => !x)}>
          <Icon name="safe" size={16} />
        </button>
      </div>

      <div className="stage" ref={stage}>
        <div className={`phone ${format === '16:9' ? 'landscape' : ''}`} style={{ width: sw + bezel * 2, height: sh + bezel * 2, padding: bezel }}>
          <div className="screen" style={{ width: sw, height: sh }} data-testid="screen">
            {frames.map((f) => (
              <iframe
                key={f.session.id}
                title="Reel preview"
                src={f.session.url}
                width={f.session.width}
                height={f.session.height}
                tabIndex={-1}
                className={f.ready ? 'frame ready' : 'frame pending'}
                style={{ transform: `scale(${sw / f.session.width})` }}
                onLoad={(e) => void boot(f.session, e.currentTarget)}
              />
            ))}
            {frames.length === 0 || (frames.length === 1 && !frames[0]!.ready) ? (
              <div className="screen-empty">
                {status === 'error' ? (
                  <>
                    <strong>Nothing to show yet</strong>
                    <span>{error}</span>
                  </>
                ) : (
                  <>
                    <span className="spinner" aria-hidden="true" />
                    <span>Preparing preview…</span>
                  </>
                )}
              </div>
            ) : null}
            {safe && session ? (
              <div
                className="safe-overlay"
                style={{
                  top: session.safe.top * scale,
                  right: session.safe.right * scale,
                  bottom: session.safe.bottom * scale,
                  left: session.safe.left * scale,
                }}
              />
            ) : null}
          </div>
        </div>
        {status === 'error' && session ? (
          <div className="stage-error" role="alert" title={error ?? ''}>
            <Icon name="warn" size={14} /> {error}
          </div>
        ) : null}
      </div>

      <div className="transport">
        <button className="btn icon primary round" onClick={() => (playing ? pause() : void play())} disabled={!session} aria-label={playing ? 'Pause (space)' : 'Play (space)'} data-testid="play">
          <Icon name={playing ? 'pause' : 'play'} size={20} />
        </button>
        <button className="btn icon ghost sm" onClick={() => seekTo(timeRef.current - 1 / (session?.fps ?? 30))} disabled={!session} aria-label="Previous frame (←)">
          <Icon name="prev" size={16} />
        </button>
        <button className="btn icon ghost sm" onClick={() => seekTo(timeRef.current + 1 / (session?.fps ?? 30))} disabled={!session} aria-label="Next frame (→)">
          <Icon name="next" size={16} />
        </button>
        <span className="time mono" data-testid="player-time" data-t={time.toFixed(3)}>
          {fmtTime(time)} / {fmtTime(dur)}
        </span>
        <div className="transport-spacer" />
        {playing && dropped > 0 ? (
          <span className="dropped" title="Frames skipped because the page was still drawing the previous one">
            {dropped} skipped
          </span>
        ) : null}
        <span className="muted small" title="Audio">
          <Icon name="volume" size={14} /> {audioState === 'loading' ? '…' : audioState === 'silent' ? 'silent' : audioState === 'ready' ? 'on' : ''}
        </span>
        <button className={`btn icon ghost sm ${loop ? 'on' : ''}`} aria-pressed={loop} aria-label="Loop" title="Loop" onClick={() => setLoop((x) => !x)}>
          <Icon name="loop" size={16} />
        </button>
      </div>

      <div
        className="scrub"
        ref={scrub}
        role="slider"
        tabIndex={0}
        aria-label="Timeline"
        aria-valuemin={0}
        aria-valuemax={dur}
        aria-valuenow={Number(time.toFixed(2))}
        aria-valuetext={fmtTime(time)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          scrubTo(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons) scrubTo(e.clientX);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            seekTo(timeRef.current + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / (session?.fps ?? 30)));
          } else if (e.key === ' ') {
            e.preventDefault();
            if (playing) pause();
            else void play();
          }
        }}
      >
        <div className="scrub-track">
          {sectionTimes.map((x) => (
            <span key={x.id} className="scrub-sec" style={{ left: `${(x.in / dur) * 100}%`, width: `${((x.out - x.in) / dur) * 100}%` }}>
              <span className="scrub-hold" style={{ left: `${((x.holdStart - x.in) / Math.max(0.001, x.out - x.in)) * 100}%`, width: `${((x.holdEnd - x.holdStart) / Math.max(0.001, x.out - x.in)) * 100}%` }} />
            </span>
          ))}
          <span className="scrub-fill" style={{ width: `${(time / dur) * 100}%` }} />
          {pins.map(({ p, sec }, i) => (
            <button
              key={i}
              className={`pin pin-${p.level}`}
              style={{ left: `${((sec!.holdStart + sec!.holdEnd) / 2 / dur) * 100}%` }}
              title={p.text}
              aria-label={p.text}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => p.path && s.select(p.path)}
            />
          ))}
          <span className="playhead" style={{ left: `${(time / dur) * 100}%` }} />
        </div>
      </div>

      <div className="jump-chips" aria-label="Jump to section">
        {sectionTimes.map((x) => (
          <button
            key={x.id}
            className={`chip sm ${time >= x.in && time < x.out ? 'on' : ''}`}
            onClick={() => {
              pause();
              seekTo(x.holdStart + Math.min(0.3, (x.holdEnd - x.holdStart) / 2));
            }}
          >
            {ROLE_LABELS[x.role] ?? x.role}
          </button>
        ))}
      </div>

      <div className="problems" aria-label="Issues">
        {problems.length === 0 ? (
          <p className="muted small ok-line">
            <LevelIcon level="pass" /> {checkPassed ? 'Check passed. Ready to render.' : s.validation?.ok ? 'No problems found. Press Check for the full quality check.' : 'Fill in your content to see the preview.'}
          </p>
        ) : (
          <ul>
            {problems.map((p, i) => (
              <li key={i}>
                <button className={`problem ${p.level}`} onClick={() => p.path && s.select(p.path)} disabled={!p.path}>
                  <LevelIcon level={p.level === 'fail' ? 'fail' : p.level === 'error' ? 'error' : 'warn'} />
                  <span dir="auto">{p.text}</span>
                  {p.source === 'check' ? <span className="tag">check</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
