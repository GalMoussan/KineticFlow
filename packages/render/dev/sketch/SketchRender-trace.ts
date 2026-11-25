/**
 * P0 spike (S4/S5): per-frame attribution of a Chromium trace. Frames are delimited by `performance.mark('f<i>')`
 * (mark i opens frame i; mark `frames` closes the last). Self time (nesting-aware) of renderer main-thread events is
 * bucketed into script / style / layout / paint; GPU-process raster (OOP raster) wall time is summed separately.
 */
export interface TraceEvent {
  name: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  cat: string;
  args?: { name?: string };
}

export const TRACE_CATEGORIES = ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing', 'gpu', 'cc', 'v8'];

const CATEGORY: Record<string, 'script' | 'style' | 'layout' | 'paint'> = {
  FunctionCall: 'script',
  EvaluateScript: 'script',
  'v8.callFunction': 'script',
  'v8.compile': 'script',
  'V8.GCScavenger': 'script',
  MajorGC: 'script',
  MinorGC: 'script',
  'V8.GC_MC_BACKGROUND_MARKING': 'script',
  FireAnimationFrame: 'script',
  RunMicrotasks: 'script',
  UpdateLayoutTree: 'style',
  RecalculateStyles: 'style',
  ParseAuthorStyleSheet: 'style',
  Layout: 'layout',
  PrePaint: 'paint',
  Paint: 'paint',
  PaintImage: 'paint',
  Layerize: 'paint',
  UpdateLayer: 'paint',
  UpdateLayerTree: 'paint',
  CompositeLayers: 'paint',
  Commit: 'paint',
  'LocalFrameView::RunPaintLifecyclePhase': 'paint',
};

export interface Breakdown {
  script: number;
  style: number;
  layout: number;
  paint: number;
  /** script + style + layout + paint. */
  main: number;
  /** GPU-process raster wall time. */
  raster: number;
  /** Renderer main thread busy: every top-level task (JS, lifecycle, commit, anything), wall ms. */
  busy: number;
}

const RASTER = /Raster|DoRasterCHROMIUM|Paint/i;

export function attribute(events: TraceEvent[], frames: number, discover: Map<string, number> | null = null): Breakdown[] {
  const marks = events
    .filter((e) => /^f\d+$/.test(e.name) && (e.ph === 'R' || e.ph === 'I' || e.ph === 'n' || e.ph === 'b' || e.ph === 'X'))
    .map((e) => ({ i: Number(e.name.slice(1)), ts: e.ts, pid: e.pid }));
  const byIndex = new Map(marks.map((m) => [m.i, m]));
  const renderer = marks[0]?.pid;
  const threadNames = new Map<string, string>();
  const procNames = new Map<number, string>();
  for (const e of events) {
    if (e.ph === 'M' && e.name === 'thread_name') threadNames.set(`${e.pid}:${e.tid}`, e.args?.name ?? '');
    if (e.ph === 'M' && e.name === 'process_name') procNames.set(e.pid, e.args?.name ?? '');
  }
  const starts = [...Array(frames + 1).keys()].map((i) => byIndex.get(i)?.ts ?? Infinity);
  const frameOf = (ts: number): number => {
    if (!(ts < starts[frames]!)) return -1;
    let f = -1;
    for (let i = 0; i < frames; i++) if (ts >= starts[i]!) f = i;
    return f;
  };
  const out: Breakdown[] = [...Array(frames)].map(() => ({ script: 0, style: 0, layout: 0, paint: 0, main: 0, raster: 0, busy: 0 }));
  const groups = new Map<string, TraceEvent[]>();
  for (const e of events) {
    if (e.ph !== 'X' || e.dur === undefined) continue;
    const k = `${e.pid}:${e.tid}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(e);
  }
  for (const [k, list] of groups) {
    const pid = Number(k.split(':')[0]);
    const tname = threadNames.get(k) ?? '';
    const isMain = pid === renderer && tname === 'CrRendererMain';
    const isGpu = (procNames.get(pid) ?? '').startsWith('GPU');
    if (!isMain && !isGpu) continue;
    list.sort((a, b) => a.ts - b.ts || b.dur! - a.dur!);
    // self time = dur − children's dur; `rasterParent` = the enclosing raster event, if any
    const self = new Map<TraceEvent, number>(list.map((e) => [e, e.dur!]));
    const nestedRaster = new Set<TraceEvent>();
    const stack: TraceEvent[] = [];
    for (const e of list) {
      while (stack.length && stack[stack.length - 1]!.ts + stack[stack.length - 1]!.dur! <= e.ts) stack.pop();
      const parent = stack[stack.length - 1];
      if (parent) self.set(parent, self.get(parent)! - e.dur!);
      else if (isMain) {
        const f = frameOf(e.ts);
        if (f >= 0) out[f]!.busy += e.dur! / 1000;
      }
      if (stack.some((s) => RASTER.test(s.name))) nestedRaster.add(e);
      stack.push(e);
    }
    for (const [e, s] of self) {
      const f = frameOf(e.ts);
      if (f < 0) continue;
      const ms = s / 1000;
      if (isMain) {
        if (discover) discover.set(`main ${e.name}`, (discover.get(`main ${e.name}`) ?? 0) + ms);
        const c = CATEGORY[e.name];
        if (c) out[f]![c] += ms;
      } else {
        if (discover) discover.set(`gpu ${tname} ${e.name}`, (discover.get(`gpu ${tname} ${e.name}`) ?? 0) + ms);
        if (RASTER.test(e.name) && !nestedRaster.has(e)) out[f]!.raster += e.dur! / 1000;
      }
    }
  }
  for (const b of out) b.main = b.script + b.style + b.layout + b.paint;
  return out;
}

export interface Stat {
  median: number;
  p95: number;
  max: number;
}

const quantile = (sorted: number[], k: number): number => sorted[Math.min(sorted.length - 1, Math.floor(k * (sorted.length - 1) + 0.5))]!;

export function stats(xs: number[]): Stat {
  const s = [...xs].sort((x, y) => x - y);
  return { median: +quantile(s, 0.5).toFixed(3), p95: +quantile(s, 0.95).toFixed(3), max: +s[s.length - 1]!.toFixed(3) };
}
