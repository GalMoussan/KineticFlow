/**
 * HTTP contract between `apps/server` and `apps/web` (PLAN.md §9, M4). JSON over `/api/*`, server-sent events for
 * render progress, static files under `/files/*` and `/preview/*`. Request bodies are validated with these zod
 * schemas on the server; responses are typed with the interfaces.
 *
 * Spec drafts are stored as `JobSpecInput` (possibly invalid while the user types); every write returns the
 * validation result so the UI can show issues inline without a second round trip.
 */
import { z } from 'zod';
import { AI_CLIP_MAX_S } from '@reel/core';
import type {
  FormatId,
  JobSpecInput,
  ParamSpec,
  ResolvedPalette,
  SectionRole,
  SketchLook,
  SoundCue,
  TraitAxis,
} from '@reel/core';

// ---------- catalog: GET /api/catalog ----------

export interface CatalogStyle {
  id: string;
  name: string;
  families: string[];
  energy: number;
  background: 'light' | 'dark';
  traits: Record<TraitAxis, string>;
  defaults: { palette: string; music: { preset: string; bpm: number }; fonts: { display: string; text?: string } };
  formats: FormatId[];
  roles: string[];
  maxWordsPerSection: number;
  /** Every param of the style's traits (`<axis>.<param>`): trait defaults with the recipe's overrides applied. */
  params: Record<string, number>;
  /** The style's sketch look: its recipe `sketch` block over the house default (what its sketches start from). */
  sketch: SketchLook;
}

export interface CatalogTrait {
  id: string;
  axis: TraitAxis;
  label: string;
  layer: 'dom' | 'canvas' | 'webgl';
  params: Record<string, ParamSpec>;
  requires?: Partial<Record<TraitAxis, string[]>>;
  excludes?: Partial<Record<TraitAxis, string[]>>;
  roles?: string[];
}

export interface CatalogFont {
  /** Catalog id (`rubik`) or uploaded asset id. */
  id: string;
  family: string;
  weights: [number, number];
  scripts: ('hebrew' | 'latin')[];
  source: 'catalog' | 'upload';
  /** URL the web UI can load with `FontFace` for pickers and previews of typed text. */
  url: string;
}

export interface Catalog {
  styles: CatalogStyle[];
  traits: CatalogTrait[];
  palettes: Record<string, ResolvedPalette>;
  fonts: CatalogFont[];
  music: { id: string; name: string; description: string; bpm: [number, number]; defaultBpm: number }[];
  formats: { id: FormatId; w: number; h: number }[];
  roles: SectionRole[];
  /**
   * Which optional subsystems are installed / configured. `musicAi`: the ACE-Step add-on
   * (`reelgen setup music-ai`) and the beat analysis it needs.
   */
  setup: { fonts: boolean; samples: boolean; analysis: boolean; musicAi: boolean; llm: LlmProvider[] };
}

// ---------- validation ----------

export interface SpecIssue {
  /** JSON path into the spec, e.g. `["sections", 2, "text"]`. */
  path: (string | number)[];
  message: string;
  level: 'error' | 'warn';
}

export interface Validation {
  /** True when the draft parses as a `JobSpec` and timing + style resolution succeed (renderable). */
  ok: boolean;
  issues: SpecIssue[];
  /** Timing summary when the spec parses: per-section windows, or the needed duration on overflow. */
  timing?:
    | { ok: true; bpm: number; sections: { id: string; in: number; out: number; items: number }[] }
    | { ok: false; needed: number; available: number; message: string };
  /** `resolveStyles` diagnostics (fallbacks, compat errors), already formatted. */
  style: { level: 'error' | 'warn'; message: string; section?: string }[];
  /** WCAG contrast of each palette in use vs its bg (≥ 3:1 wanted). */
  contrast: { palette: string; color: string; ratio: number }[];
  /** Characters the chosen fonts cannot draw. */
  missingGlyphs: { font: string; chars: string }[];
}

// ---------- projects ----------

export interface ProjectSummary {
  id: string;
  title: string;
  updatedAt: string;
  style: string;
  /** Latest finished render's thumbnail, if any. */
  thumbnail?: string;
}

export interface Project {
  id: string;
  spec: JobSpecInput;
  brandKit?: string;
  updatedAt: string;
}

export const CreateProject = z.object({
  spec: z.unknown().optional(),
  brandKit: z.string().optional(),
});
export const SaveProject = z.object({ spec: z.unknown(), brandKit: z.string().nullable().optional() });
/** `POST /api/validate` (no save): the draft's `Validation`. */
export const ValidateRequest = z.object({ spec: z.unknown() });

/** `PUT /api/projects/:id` and `POST /api/projects` responses. */
export interface ProjectWithValidation {
  project: Project;
  validation: Validation;
}

// ---------- assets: POST /api/assets (multipart: file, kind) ----------

/** `sketch`: a `SketchDoc` stored as `<id>.sketch.json` with an SVG thumbnail (`meta.thumb`). */
export const AssetKind = z.enum(['logo', 'track', 'font', 'sketch']);
export type AssetKind = z.infer<typeof AssetKind>;

export interface Asset {
  /** Slug, unique; used in specs (`endcard.logos`, `music.file`, `fonts.display`, a generated sketch's `asset`). */
  id: string;
  kind: AssetKind;
  name: string;
  url: string;
  bytes: number;
  /**
   * logo: {w, h, colors (dominant hex, most frequent first)}; track: {duration}; font: {family, weights, scripts};
   * sketch: {mode, box, strokes, points, source, hash (sha256 of the canonical doc), thumb (SVG URL)}.
   */
  meta: Record<string, unknown>;
  createdAt: string;
}

/** `POST /api/sketch/save`: stores a `SketchDoc` (validated server-side) as a `sketch` asset. */
export const SaveSketch = z.object({ name: z.string().trim().max(120).optional(), doc: z.unknown() });

// ---------- brand kits ----------

export const BrandKit = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  logos: z.array(z.string()).max(4),
  palette: z.object({ bg: z.string(), text: z.string(), accents: z.array(z.string()).min(1).max(8) }).nullable(),
  fonts: z.object({ display: z.string(), text: z.string().optional() }).nullable(),
});
export type BrandKit = z.infer<typeof BrandKit>;
export const SaveBrandKit = BrandKit.omit({ id: true });

// ---------- preview ----------

export const PreviewRequest = z.object({
  spec: z.unknown(),
  format: z.enum(['9:16', '1:1', '4:5', '16:9']),
});

/** `POST /api/preview` (spec inline, so unsaved edits preview immediately). */
export interface PreviewSession {
  id: string;
  /** Same-origin page: load in an iframe, await `contentWindow.reelPage.ready()`, then `seek(t)`. */
  url: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  /** Section hold times for the "jump to section" strip and QA overlays. */
  sections: { id: string; role: SectionRole; in: number; holdStart: number; holdEnd: number; out: number }[];
  /** Safe area insets of the format (for the overlay toggle). */
  safe: { top: number; right: number; bottom: number; left: number };
  /** Music only (WAV), ready when the session is returned; `null` for `music.source = none`. */
  musicUrl: string | null;
  bpm: number;
}

/** `POST /api/preview/:id/audio` body: the iframe's `reelPage.soundCues()`. Returns `{ url }` of music+SFX mastered. */
export const PreviewAudioRequest = z.object({ soundCues: z.array(z.unknown()) });
export interface PreviewAudio {
  url: string;
}
export type { SoundCue };

// ---------- AI music (ACE-Step add-on) ----------

/**
 * `POST /api/music-ai` starts (or joins, or answers from the cache) the generation of one clip, `seconds` long
 * (`aiClipSeconds(duration, offset)` of the spec, so the render finds the same clip). `cachedOnly` answers 404
 * instead of generating. Returns the job's `MusicAiState`; `GET /api/music-ai/:key/events` streams it (SSE) until
 * `done` or `error`; `GET /api/music-ai/:key/audio` is the generated WAV.
 */
export const MusicAiRequest = z.object({
  prompt: z.string().trim().min(1).max(500),
  lyrics: z.string().max(4000).optional(),
  bpm: z.number().int().min(60).max(180).optional(),
  seed: z.number().int().nonnegative(),
  seconds: z.number().int().min(10).max(AI_CLIP_MAX_S),
  cachedOnly: z.boolean().optional(),
});
export interface MusicAiState {
  key: string;
  status: 'running' | 'done' | 'error';
  /** 0..1 */
  progress: number;
  stage: string;
  /** The clip (WAV), when done. */
  url?: string;
  cached?: boolean;
  /** Wall time of the generation, ms. */
  ms?: number;
  error?: string;
}

// ---------- check (preflight QA without rendering video): POST /api/projects/:id/check ----------

export interface CheckResult {
  gates: { gate: string; level: 'pass' | 'warn' | 'fail'; format?: FormatId; detail: string }[];
  ms: number;
}

// ---------- renders ----------

export const StartRender = z.object({
  quality: z.enum(['draft', 'standard', 'final']).default('standard'),
  formats: z.array(z.enum(['9:16', '1:1', '4:5', '16:9'])).min(1).optional(),
});

export type RenderState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface RenderOutput {
  format: FormatId;
  video: string;
  noMusic?: string;
  thumbnail: string;
  bytes: number;
}

export interface RenderSummary {
  id: string;
  projectId: string;
  title: string;
  quality: 'draft' | 'standard' | 'final';
  formats: FormatId[];
  state: RenderState;
  /** 0..1 over all formats' frames. */
  progress: number;
  createdAt: string;
  finishedAt?: string;
  outputs: RenderOutput[];
  error?: string;
  qa: { gate: string; level: 'pass' | 'warn' | 'fail'; format?: FormatId; detail: string }[];
}

// ---------- style stills: POST /api/style-stills ----------

/**
 * Stills of the user's own content in several styles, for the style grid (headless capture, cached by
 * fingerprint). One still per style at the hold of the section chosen by `section` (default: the title).
 */
export const StyleStillsRequest = z.object({
  spec: z.unknown(),
  styles: z.array(z.string()).min(1).max(60),
  format: z.enum(['9:16', '1:1', '4:5', '16:9']).default('9:16'),
  section: z.string().optional(),
  /** Output width in px (height follows the format). */
  width: z.number().int().min(120).max(540).default(270),
});
export interface StyleStill {
  style: string;
  /** PNG/JPEG URL, or absent with `error` when the style cannot lay out this content (roles, timing, fonts). */
  url?: string;
  error?: string;
}

/**
 * `GET /api/renders/:id/events` (text/event-stream). Each SSE `data:` is one of these. `render` wraps the pipeline's
 * own `RenderEvent` (see `@reel/render`), forwarded unchanged; `state` and `progress` are added by the server.
 * On connect the server first sends a `state` with the current summary, so late subscribers catch up.
 */
export type RenderStreamEvent =
  | { type: 'state'; render: RenderSummary }
  | { type: 'progress'; progress: number; label: string }
  | { type: 'render'; event: unknown };

// ---------- LLM helpers (optional; text only) ----------

export const LlmProvider = z.enum(['gemini', 'claude']);
export type LlmProvider = z.infer<typeof LlmProvider>;

export const SplitRequest = z.object({
  text: z.string().min(1).max(4000),
  language: z.enum(['he', 'en']).optional(),
  contentType: z.enum(['event', 'list', 'story', 'lyric', 'stats']).optional(),
  brief: z.string().max(1000).optional(),
  /** Omit to use the first configured provider; `rules` forces the offline splitter. */
  provider: z.union([LlmProvider, z.literal('rules')]).optional(),
  /** Brand kit id: its logos go on the end card. */
  brandKit: z.string().optional(),
});
export interface SplitResult {
  /** Sections ready to drop into `spec.sections` (emphasis as `*word*`, dates ISO, roles from core). */
  sections: unknown[];
  language: 'he' | 'en';
  contentType: 'event' | 'list' | 'story' | 'lyric' | 'stats';
  /** A short title for the project list. */
  title: string;
  provider: LlmProvider | 'rules';
  notes: string[];
}

export const RankStylesRequest = z.object({
  brief: z.string().max(1000),
  spec: z.unknown().optional(),
  provider: LlmProvider.optional(),
});
export interface RankStylesResult {
  ranked: { style: string; score: number; reason: string }[];
  provider: LlmProvider | 'rules';
}

export const EmphasisRequest = z.object({
  text: z.string().min(1).max(400),
  language: z.enum(['he', 'en']).optional(),
  provider: LlmProvider.optional(),
});
export interface EmphasisResult {
  /** The text with suggested `*emphasis*` markers (1–2 per line). */
  text: string;
  provider: LlmProvider | 'rules';
}

// ---------- errors ----------

/** Every non-2xx JSON response. */
export interface ApiError {
  error: string;
  /** Present for spec validation failures. */
  issues?: SpecIssue[];
}
