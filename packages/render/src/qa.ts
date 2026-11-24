/** QA gates (PLAN.md §10): each returns pass/warn/fail with a readable detail; `fail` fails the job. */
import { open, readFile, stat } from 'node:fs/promises';
import { PNG } from 'pngjs';
import {
  contrast,
  sectionItems,
  type CueSheet,
  type FormatId,
  type JobSpec,
  type ReelInput,
  type ResolvedPalette,
  type SoundCue,
  type TextBox,
} from '@reel/core';
import { launchBrowser, ReelTab } from './capture.ts';
import { missingChars, readFont } from './fonts.ts';
import { exec, sha256 } from './util.ts';

export type Level = 'pass' | 'warn' | 'fail';

export interface GateResult {
  gate: string;
  level: Level;
  format?: FormatId;
  detail: string;
  data?: unknown;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

// ───────────────────────────── page gates (preflight) ─────────────────────────────

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const rect = (b: TextBox): Rect => ({ x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h });

/** Sub-pixel layout noise allowed at the frame/safe edges. */
const EDGE_TOLERANCE = 0.5;
/** Boxes must intersect by more than this in both axes to count as overlapping. */
const OVERLAP_PX = 2;

interface HoldSample {
  section: CueSheet['sections'][number];
  t: number;
  boxes: TextBox[];
}

/** Seeks to every section's `holdEnd − 1/fps` and reads `boxes()` there. */
export async function sampleHolds(tab: ReelTab, sheet: CueSheet): Promise<HoldSample[]> {
  const out: HoldSample[] = [];
  for (const section of sheet.sections) {
    // the last frame before the section's hold ends (holds can be zero-length: holdStart = holdEnd = out)
    const t = section.timing.holdEnd - 1 / sheet.fps;
    await tab.seek(t);
    out.push({ section, t, boxes: await tab.boxes() });
  }
  return out;
}

/** Text the page shows for each unit of a section (boxes of one unit joined in the order the page reports them). */
function renderedUnits(boxes: TextBox[], section: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const b of boxes) if (b.section === section) out.set(b.unit, (out.get(b.unit) ?? '') + b.text);
  return out;
}

export function gateBounds(samples: HoldSample[], input: ReelInput): GateResult {
  const { w: W, h: H, safe } = input.format;
  const outside: string[] = [];
  const unsafe: string[] = [];
  for (const s of samples) {
    for (const b of s.boxes.filter((x) => x.section === s.section.id)) {
      const r = rect(b);
      const label = `${s.section.id}#${b.unit} "${b.text}" [${r2(r.x0)},${r2(r.y0)} → ${r2(r.x1)},${r2(r.y1)}] @${s.t.toFixed(3)}s`;
      const e = EDGE_TOLERANCE;
      if (r.x0 < -e || r.y0 < -e || r.x1 > W + e || r.y1 > H + e) outside.push(label);
      else if (r.x0 < safe.left - e || r.y0 < safe.top - e || r.x1 > W - safe.right + e || r.y1 > H - safe.bottom + e) {
        unsafe.push(label);
      }
    }
  }
  const level: Level = outside.length ? 'fail' : unsafe.length ? 'warn' : 'pass';
  const detail = outside.length
    ? `${outside.length} box(es) leave the ${W}x${H} frame: ${outside.slice(0, 4).join('; ')}`
    : unsafe.length
      ? `${unsafe.length} box(es) outside the safe area: ${unsafe.slice(0, 4).join('; ')}`
      : `all text inside the safe area at ${samples.length} holds`;
  return { gate: 'text-in-safe-area', level, format: input.format.id, detail, data: { outside, unsafe } };
}

export function gateFidelity(samples: HoldSample[], input: ReelInput): GateResult {
  const problems: string[] = [];
  for (const s of samples) {
    const got = renderedUnits(s.boxes, s.section.id);
    s.section.items.forEach((it, i) => {
      if (it.kind === 'logos') return;
      const text = got.get(i);
      if (text === undefined) problems.push(`${s.section.id}#${i} "${it.text}" missing`);
      else if (text.normalize('NFC') !== it.text.normalize('NFC')) problems.push(`${s.section.id}#${i} shows "${text}" instead of "${it.text}"`);
    });
    for (const unit of got.keys()) {
      if (!s.section.items[unit]) problems.push(`${s.section.id}: unexpected unit #${unit} "${got.get(unit)}"`);
    }
  }
  return {
    gate: 'content-fidelity',
    level: problems.length ? 'fail' : 'pass',
    format: input.format.id,
    detail: problems.length ? problems.slice(0, 6).join('; ') : `every item of ${samples.length} sections on screen at its hold`,
    data: problems,
  };
}

export function gateOverlap(samples: HoldSample[], input: ReelInput): GateResult {
  const { w: W, h: H } = input.format;
  const pairs: string[] = [];
  for (const s of samples) {
    const visible = s.boxes
      .map((b) => {
        const r = rect(b);
        return { b, r: { x0: Math.max(0, r.x0), y0: Math.max(0, r.y0), x1: Math.min(W, r.x1), y1: Math.min(H, r.y1) } };
      })
      .filter(({ r }) => r.x1 > r.x0 && r.y1 > r.y0);
    for (let i = 0; i < visible.length; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        const a = visible[i]!;
        const b = visible[j]!;
        if (a.b.section === b.b.section && a.b.unit === b.b.unit) continue;
        const ix = Math.min(a.r.x1, b.r.x1) - Math.max(a.r.x0, b.r.x0);
        const iy = Math.min(a.r.y1, b.r.y1) - Math.max(a.r.y0, b.r.y0);
        if (ix > OVERLAP_PX && iy > OVERLAP_PX) {
          pairs.push(`@${s.t.toFixed(2)}s "${a.b.text || a.b.section + '#' + a.b.unit}" × "${b.b.text || b.b.section + '#' + b.b.unit}" (${r2(ix)}×${r2(iy)} px)`);
        }
      }
    }
  }
  return {
    gate: 'overlap',
    level: pairs.length ? 'warn' : 'pass',
    format: input.format.id,
    detail: pairs.length ? `${pairs.length} overlapping pair(s): ${pairs.slice(0, 4).join('; ')}` : 'no overlapping text at holds',
    data: pairs,
  };
}

/** Recomputes the weekday with Intl, independently of `@reel/core`'s derivation, and compares the rendered one. */
export function gateWeekday(samples: HoldSample[], spec: JobSpec, input: ReelInput): GateResult | null {
  const problems: string[] = [];
  const checked: string[] = [];
  for (const s of samples) {
    const src = spec.sections.find((x) => x.id === s.section.id);
    if (src?.role !== 'datetime') continue;
    const day = new Date(`${src.date}T12:00:00Z`);
    const expected = new Intl.DateTimeFormat(spec.language, { weekday: 'long', timeZone: 'UTC' }).format(day);
    const [y, m, d] = src.date.split('-');
    const got = renderedUnits(s.boxes, s.section.id);
    const wi = s.section.items.findIndex((it) => it.kind === 'weekday');
    const di = s.section.items.findIndex((it) => it.kind === 'date');
    const shownDay = wi < 0 ? undefined : got.get(wi)?.normalize('NFC');
    const shownDate = di < 0 ? undefined : got.get(di);
    if (shownDay !== expected.normalize('NFC')) problems.push(`${src.date} is "${expected}" but the page shows "${shownDay ?? '(nothing)'}"`);
    if (shownDate !== `${d}.${m}`) problems.push(`${src.date} should read "${d}.${m}" but the page shows "${shownDate ?? '(nothing)'}"`);
    checked.push(`${src.date} → ${expected} (${y})`);
  }
  if (!checked.length) return null;
  return {
    gate: 'weekday',
    level: problems.length ? 'fail' : 'pass',
    format: input.format.id,
    detail: problems.length ? problems.join('; ') : checked.join(', '),
    data: problems,
  };
}

/**
 * Text and accents against the background of every distinct palette in use (sections may carry their own palette).
 * `palettes` maps each palette to the sections it colours.
 */
export function gateContrast(palettes: { palette: ResolvedPalette; sections: string[] }[]): GateResult {
  const per = palettes.map(({ palette: p, sections }) => {
    const rows = [['text', p.text] as const, ...p.accents.map((a, i) => [`accent ${i}`, a] as const)].map(([name, c]) => ({
      name,
      color: c,
      ratio: r2(contrast(c, p.bg)),
    }));
    const low = rows.filter((r) => r.ratio < 3);
    const where = palettes.length > 1 ? ` (${sections.join(', ')})` : '';
    const detail = low.length
      ? `below 3:1 on ${p.bg}${where}: ${low.map((r) => `${r.name} ${r.color} ${r.ratio}:1`).join(', ')}`
      : `text ${rows[0]!.ratio}:1, accents ≥ ${Math.min(...rows.slice(1).map((r) => r.ratio))}:1 on ${p.bg}${where}`;
    return { bg: p.bg, sections, rows, low: low.length > 0, detail };
  });
  return {
    gate: 'contrast',
    level: per.some((x) => x.low) ? 'warn' : 'pass',
    detail: per.map((x) => x.detail).join('; '),
    data: per.map(({ bg, sections, rows }) => ({ bg, sections, rows })),
  };
}

// ───────────────────────────── glyph coverage ─────────────────────────────

const cmapCache = new Map<string, { mtimeMs: number; codepoints: Set<number> }>();

/** Code points the font file maps to glyphs (cached per path + mtime). */
export async function fontCodepoints(path: string): Promise<Set<number>> {
  const { mtimeMs } = await stat(path);
  const hit = cmapCache.get(path);
  if (hit?.mtimeMs === mtimeMs) return hit.codepoints;
  const { codepoints } = readFont(await readFile(path));
  cmapCache.set(path, { mtimeMs, codepoints });
  return codepoints;
}

/** Every character the page will draw: the items of every section (derived weekday/date text included). */
export function specText(spec: JobSpec): string {
  return spec.sections.flatMap((s) => sectionItems(s, spec).map((it) => it.text)).join(' ');
}

/**
 * Font glyph coverage (PLAN.md §10): every character the page draws must exist in each font in use, otherwise the
 * DOM shows tofu and troika hangs fetching a CDN fallback. A hard fail.
 */
export async function gateGlyphs(spec: JobSpec, fonts: readonly { id: string; family: string; path: string }[]): Promise<GateResult> {
  const text = specText(spec);
  const missing: { font: string; chars: string }[] = [];
  for (const f of fonts) {
    const chars = missingChars(text, await fontCodepoints(f.path));
    if (chars) missing.push({ font: f.id, chars });
  }
  return {
    gate: 'glyphs',
    level: missing.length ? 'fail' : 'pass',
    detail: missing.length
      ? missing.map((m) => `font "${m.font}" cannot draw ${[...m.chars].map((c) => `"${c}"`).join(' ')}`).join('; ')
      : `${fonts.map((f) => f.family).join(' + ')} cover all ${new Set(text.replace(/\s/g, '')).size} characters`,
    data: missing,
  };
}

// ───────────────────────────── determinism ─────────────────────────────

/** Largest per-channel difference (RGB) between two same-size PNGs, 0–255. */
export function maxChannelDelta(a: Uint8Array, b: Uint8Array): number {
  const x = PNG.sync.read(Buffer.from(a));
  const y = PNG.sync.read(Buffer.from(b));
  if (x.width !== y.width || x.height !== y.height) return 255;
  let max = 0;
  for (let i = 0; i < x.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(x.data[i + c]! - y.data[i + c]!);
      if (d > max) max = d;
    }
  }
  return max;
}

const PNG_SHOT = { format: 'png', scale: 1 } as const;

async function freshCapture(o: { origin: string; entry: string; input: ReelInput }, times: number[]): Promise<string[]> {
  const browser = await launchBrowser();
  try {
    const tab = await ReelTab.open(browser, o);
    const out: string[] = [];
    for await (const img of tab.captureRange(times, PNG_SHOT)) out.push(sha256(img));
    await tab.check();
    await tab.close();
    return out;
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * (a) the job's first 3 frames in two fresh GPU-raster browsers (as chunks render), same order → identical bytes;
 * (b) 5 sampled frames forward then reverse in the probe page, which runs CPU raster (`launchBrowser` note) → max
 *     channel Δ ≤ 2/255; a difference there is state carried between frames by the page itself.
 */
export async function gateDeterminism(
  tab: ReelTab,
  o: { origin: string; entry: string; input: ReelInput; sheet: CueSheet },
): Promise<GateResult> {
  const { fps, frames } = o.sheet;
  const first = [0, 1, 2].filter((f) => f < frames).map((f) => f / fps);
  const [a, b] = await Promise.all([freshCapture(o, first), freshCapture(o, first)]);
  const mismatched = first.filter((_, i) => a[i] !== b[i]).map((t) => Math.round(t * fps));

  const picks = Array.from({ length: 5 }, (_, i) => Math.round((i * (frames - 1)) / 4));
  const forward = new Map<number, Buffer>();
  for (const f of picks) {
    await tab.seek(f / fps);
    forward.set(f, await tab.shot(PNG_SHOT));
  }
  const deltas: Record<number, number> = {};
  for (const f of [...picks].reverse()) {
    await tab.seek(f / fps);
    deltas[f] = maxChannelDelta(forward.get(f)!, await tab.shot(PNG_SHOT));
  }
  const maxDelta = Math.max(...Object.values(deltas));
  const problems: string[] = [];
  if (mismatched.length) problems.push(`frames ${mismatched.join(', ')} differ between two fresh browsers`);
  if (maxDelta > 2) {
    problems.push(`forward vs reverse differs by up to ${maxDelta}/255 (frames ${Object.entries(deltas).filter(([, d]) => d > 2).map(([f]) => f).join(', ')}): the page is not a pure function of t`);
  }
  return {
    gate: 'determinism',
    level: problems.length ? 'fail' : 'pass',
    format: o.input.format.id,
    detail: problems.length ? problems.join('; ') : `3 frames byte-identical across launches · reverse order max Δ ${maxDelta}/255`,
    data: { firstFrames: { a, b }, reverseDelta: deltas },
  };
}

// ───────────────────────────── audio ─────────────────────────────

export interface AudioFacts {
  wavSamples?: number;
  sampleRate: number;
  /** ffprobe duration of the AAC stream, seconds. */
  aacDuration: number;
  loudness?: { i: number; tp: number };
}

export function gateAudio(a: AudioFacts, sheet: CueSheet): GateResult {
  const duration = sheet.frames / sheet.fps;
  const want = Math.round(duration * a.sampleRate);
  const problems: string[] = [];
  if (a.wavSamples !== undefined && a.wavSamples !== want) problems.push(`WAV has ${a.wavSamples} samples, expected ${want}`);
  if (Math.abs(a.aacDuration - duration) > 1 / sheet.fps) problems.push(`AAC lasts ${a.aacDuration.toFixed(3)} s, expected ${duration.toFixed(3)} s ± 1 frame`);
  return {
    gate: 'audio',
    level: problems.length ? 'fail' : 'pass',
    detail: problems.length
      ? problems.join('; ')
      : `${a.wavSamples !== undefined ? `WAV ${a.wavSamples} samples · ` : ''}AAC ${a.aacDuration.toFixed(3)} s`,
  };
}

export function gateLoudness(l: { i: number; tp: number }): GateResult {
  const ok = Math.abs(l.i - -14) <= 1 && l.tp <= -1;
  return {
    gate: 'loudness',
    level: ok ? 'pass' : 'warn',
    detail: `${l.i.toFixed(1)} LUFS integrated · true peak ${l.tp.toFixed(1)} dBTP${ok ? '' : ' (target −14 ± 1 LUFS, ≤ −1 dBTP)'}`,
  };
}

/**
 * Own-track sync: every `land` cue within ±1 frame of a detected beat or half-beat (the midpoint of two consecutive
 * detected beats). `beats` are the sidecar's beats in video time, before any phantom-beat trimming.
 */
export function gateAudioSync(sheet: CueSheet, beats: number[]): GateResult {
  const slots = [...beats, ...beats.slice(1).map((b, i) => (beats[i]! + b) / 2)];
  const lands = sheet.cues.filter((c) => c.type === 'land');
  const offsets = lands.map((c) => {
    const nearest = slots.reduce((best, s) => (Math.abs(s - c.t) < Math.abs(best - c.t) ? s : best), Infinity);
    return { section: c.section, unit: c.unit, t: c.t, beat: nearest, ms: Math.round((c.t - nearest) * 1e6) / 1e3 };
  });
  const frameMs = 1000 / sheet.fps;
  const off = offsets.filter((o) => !(Math.abs(o.ms) <= frameMs + 1e-6));
  const abs = offsets.map((o) => Math.abs(o.ms));
  const max = abs.length ? Math.max(...abs) : 0;
  const mean = abs.length ? abs.reduce((a, b) => a + b, 0) / abs.length : 0;
  return {
    gate: 'audio-sync',
    level: off.length || !lands.length ? 'fail' : 'pass',
    detail: !lands.length
      ? 'no land cues'
      : off.length
        ? `${off.length} of ${lands.length} landing(s) more than 1 frame (${frameMs.toFixed(1)} ms) from a detected beat: ` +
          off.slice(0, 4).map((o) => `${o.section}#${o.unit} @${o.t.toFixed(3)} s (${o.ms} ms)`).join('; ')
        : `${lands.length} landings on detected beats/half-beats · |offset| max ${max.toFixed(1)} ms, mean ${mean.toFixed(2)} ms (≤ ${frameMs.toFixed(1)} ms)`,
    data: { maxMs: max, meanMs: mean, offsets },
  };
}

/** BS.1770 K-weighting at 48 kHz: high shelf then RLB high-pass. */
const K_STAGES = [
  { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [-1.69065929318241, 0.73248077421585] },
  { b: [1, -2, 1], a: [-1.99004745483398, 0.99007225036621] },
] as const;
const BLOCK = 4800; // 100 ms at 48 kHz
const SHORT_TERM_BLOCKS = 30; // 3 s

/** K-weighted energy (L² + R²) per 100 ms block. */
function kBlocks(x: { l: Float32Array; r: Float32Array }): Float64Array {
  const n = Math.floor(x.l.length / BLOCK);
  const out = new Float64Array(n);
  for (const ch of [x.l, x.r]) {
    const s = K_STAGES.map(() => [0, 0, 0, 0]); // x1 x2 y1 y2 per stage
    for (let i = 0; i < n * BLOCK; i++) {
      let v = ch[i]!;
      K_STAGES.forEach(({ b, a }, k) => {
        const z = s[k]!;
        const y = b[0] * v + b[1] * z[0]! + b[2] * z[1]! - a[0] * z[2]! - a[1] * z[3]!;
        z[1] = z[0]!;
        z[0] = v;
        z[3] = z[2]!;
        z[2] = y;
        v = y;
      });
      out[Math.floor(i / BLOCK)]! += v * v;
    }
  }
  return out;
}

/** Short-term loudness (LUFS-S, 3 s window) ending at each 100 ms block boundary. */
export function shortTermLoudness(x: { l: Float32Array; r: Float32Array }): number[] {
  const blocks = kBlocks(x);
  const out: number[] = [];
  let sum = 0;
  for (let k = 0; k < blocks.length; k++) {
    sum += blocks[k]!;
    if (k >= SHORT_TERM_BLOCKS) sum -= blocks[k - SHORT_TERM_BLOCKS]!;
    const n = Math.min(k + 1, SHORT_TERM_BLOCKS) * BLOCK;
    out.push(-0.691 + 10 * Math.log10(Math.max(sum / n, 1e-12)));
  }
  return out;
}

/**
 * SFX level against the music: at each sound's peak (the loudest SFX short-term value from its attack to 0.5 s after
 * it ends), the SFX stem must not be more than 6 dB louder (LUFS-S) than the music stem. Both stems as mixed.
 */
export function gateSfx(music: { l: Float32Array; r: Float32Array }, sfx: { l: Float32Array; r: Float32Array }, cues: SoundCue[]): GateResult {
  const m = shortTermLoudness(music);
  const s = shortTermLoudness(sfx);
  const rows = cues.map((c) => {
    const k0 = Math.min(s.length - 1, Math.floor(c.t * 10));
    const k1 = Math.min(s.length - 1, Math.ceil(((c.until ?? c.t) + 0.5) * 10));
    let k = k0;
    for (let j = k0; j <= k1; j++) if (s[j]! > s[k]!) k = j;
    return { t: c.t, kind: c.kind, sfx: r2(s[k]!), music: r2(m[k]!), over: r2(s[k]! - m[k]!) };
  });
  const loud = rows.filter((r) => r.over > 6);
  const worst = rows.reduce<(typeof rows)[number] | null>((w, r) => (!w || r.over > w.over ? r : w), null);
  return {
    gate: 'sfx',
    level: loud.length ? 'warn' : 'pass',
    detail: !worst
      ? 'no sound effects'
      : loud.length
        ? `${loud.length} of ${rows.length} sound(s) more than 6 dB over the music (LUFS-S): ` +
          loud.slice(0, 4).map((r) => `${r.kind} @${r.t.toFixed(2)} s +${r.over} dB`).join('; ')
        : `${rows.length} sounds · loudest vs music ${worst.over >= 0 ? '+' : ''}${worst.over} dB LUFS-S (${worst.kind} @${worst.t.toFixed(2)} s; limit +6 dB)`,
    data: rows,
  };
}

// ───────────────────────────── container ─────────────────────────────

export interface Atom {
  type: string;
  offset: number;
  size: number;
}

/** Top-level ISO-BMFF boxes (`ftyp`, `moov`, `mdat`, …): reads only the 8/16-byte headers. */
export async function topLevelAtoms(path: string): Promise<Atom[]> {
  const fh = await open(path, 'r');
  try {
    const { size: fileSize } = await fh.stat();
    const head = Buffer.alloc(16);
    const out: Atom[] = [];
    for (let offset = 0; offset + 8 <= fileSize; ) {
      const { bytesRead } = await fh.read(head, 0, 16, offset);
      if (bytesRead < 8) break;
      let size = head.readUInt32BE(0);
      const type = head.toString('latin1', 4, 8);
      if (size === 1) {
        if (bytesRead < 16) throw new Error(`${path}: truncated 64-bit box header at ${offset}`);
        size = Number(head.readBigUInt64BE(8));
      } else if (size === 0) size = fileSize - offset;
      if (size < 8 || offset + size > fileSize) throw new Error(`${path}: malformed box "${type}" (size ${size}) at ${offset}`);
      out.push({ type, offset, size });
      offset += size;
    }
    return out;
  } finally {
    await fh.close();
  }
}

interface ProbeStream {
  codec_type: string;
  codec_name: string;
  profile?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  nb_read_packets?: string;
  duration?: string;
  color_space?: string;
  color_primaries?: string;
  color_transfer?: string;
  sample_rate?: string;
}

export interface ProbeSummary {
  width: number;
  height: number;
  fps: string;
  frames: number;
  codec: string;
  profile: string;
  pixFmt: string;
  /** `matrix/primaries/transfer`, e.g. `bt709/bt709/bt709`. */
  color: string;
  audio: string | null;
  audioDuration: number | null;
  duration: number;
  bytes: number;
  atoms: string[];
}

export async function probe(path: string): Promise<ProbeSummary> {
  const { stdout } = await exec('ffprobe', [
    // one H.264 packet per frame in MP4: counting packets avoids decoding the whole video
    '-v', 'error', '-count_packets', '-show_entries',
    'stream=codec_type,codec_name,profile,width,height,pix_fmt,r_frame_rate,nb_read_packets,duration,color_space,color_primaries,color_transfer,sample_rate:format=duration,size',
    '-of', 'json', path,
  ]);
  const j = JSON.parse(stdout) as { streams: ProbeStream[]; format: { duration: string; size: string } };
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  if (!v) throw new Error(`${path}: no video stream`);
  return {
    width: v.width ?? 0,
    height: v.height ?? 0,
    fps: v.r_frame_rate ?? '?',
    frames: Number(v.nb_read_packets ?? 0),
    codec: v.codec_name,
    profile: v.profile ?? '',
    pixFmt: v.pix_fmt ?? '',
    color: `${v.color_space ?? '?'}/${v.color_primaries ?? '?'}/${v.color_transfer ?? '?'}`,
    audio: a?.codec_name ?? null,
    audioDuration: a?.duration ? Number(a.duration) : null,
    duration: Number(j.format.duration),
    bytes: Number(j.format.size),
    atoms: (await topLevelAtoms(path)).map((x) => x.type),
  };
}

export function gateContainer(
  p: ProbeSummary,
  want: { format: FormatId; w: number; h: number; fps: number; frames: number; audio: boolean; label: string },
): GateResult {
  const duration = want.frames / want.fps;
  const problems: string[] = [];
  if (p.width !== want.w || p.height !== want.h) problems.push(`size ${p.width}x${p.height} ≠ ${want.w}x${want.h}`);
  if (p.fps !== `${want.fps}/1`) problems.push(`fps ${p.fps} ≠ ${want.fps}/1`);
  if (p.frames !== want.frames) problems.push(`${p.frames} frames ≠ ${want.frames}`);
  if (p.codec !== 'h264') problems.push(`codec ${p.codec} ≠ h264`);
  if (p.pixFmt !== 'yuv420p') problems.push(`pix_fmt ${p.pixFmt} ≠ yuv420p`);
  if (p.color !== 'bt709/bt709/bt709') problems.push(`colour tags (matrix/primaries/transfer) ${p.color} ≠ bt709`);
  if (want.audio && p.audio !== 'aac') problems.push(`audio ${p.audio ?? 'missing'} ≠ aac`);
  if (!want.audio && p.audio) problems.push(`unexpected ${p.audio} audio in the no-music copy`);
  if (Math.abs(p.duration - duration) > 1 / want.fps) problems.push(`duration ${p.duration.toFixed(3)} s ≠ ${duration.toFixed(3)} s`);
  const moov = p.atoms.indexOf('moov');
  const mdat = p.atoms.indexOf('mdat');
  if (moov < 0 || mdat < 0 || moov > mdat) problems.push(`moov is not before mdat (top-level: ${p.atoms.join(' ')})`);
  const summary =
    `${p.width}x${p.height} · ${want.fps} fps · ${p.frames} frames · ${p.codec} ${p.pixFmt} BT.709` +
    `${p.audio ? ` · ${p.audio.toUpperCase()}` : ''} · ${p.duration.toFixed(3)} s · faststart`;
  return {
    gate: 'container',
    level: problems.length ? 'fail' : 'pass',
    format: want.format,
    detail: problems.length ? `${want.label}: ${problems.join('; ')}` : `${want.label}: ${summary}`,
    data: p,
  };
}
