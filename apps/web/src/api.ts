/** Typed client for the HTTP contract in `@reel/api`. */
import type {
  ApiError,
  Asset,
  AssetKind,
  BrandKit,
  Catalog,
  CheckResult,
  EmphasisResult,
  MusicAiState,
  PreviewAudio,
  PreviewSession,
  ProjectSummary,
  ProjectWithValidation,
  RankStylesResult,
  RenderStreamEvent,
  RenderSummary,
  SpecIssue,
  SplitResult,
  StyleStill,
  Validation,
} from '@reel/api';
import type { FormatId, JobSpecInput } from '@reel/core';

export class ApiFailure extends Error {
  readonly status: number;
  readonly issues: SpecIssue[];
  constructor(status: number, message: string, issues: SpecIssue[] = []) {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}

async function call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const init: RequestInit = { method };
  if (signal) init.signal = signal;
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  const res = await fetch(path, init);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiError>;
    throw new ApiFailure(res.status, err.error ?? `${res.status} ${res.statusText}`, err.issues ?? []);
  }
  return data as T;
}

export type Quality = 'draft' | 'standard' | 'final';
export type SplitInput = {
  text: string;
  language?: 'he' | 'en';
  contentType?: SplitResult['contentType'];
  provider?: 'gemini' | 'claude' | 'rules';
  brandKit?: string;
};

export const api = {
  catalog: () => call<Catalog>('GET', '/api/catalog'),

  projects: () => call<ProjectSummary[]>('GET', '/api/projects'),
  project: (id: string) => call<ProjectWithValidation>('GET', `/api/projects/${id}`),
  createProject: (spec?: JobSpecInput, brandKit?: string) =>
    call<ProjectWithValidation>('POST', '/api/projects', { ...(spec ? { spec } : {}), ...(brandKit ? { brandKit } : {}) }),
  saveProject: (id: string, spec: JobSpecInput, brandKit: string | null) =>
    call<ProjectWithValidation>('PUT', `/api/projects/${id}`, { spec, brandKit }),
  deleteProject: (id: string) => call<{ ok: true }>('DELETE', `/api/projects/${id}`),
  duplicateProject: (id: string) => call<ProjectWithValidation>('POST', `/api/projects/${id}/duplicate`),
  validate: (spec: JobSpecInput) => call<Validation>('POST', '/api/validate', { spec }),
  check: (id: string) => call<CheckResult>('POST', `/api/projects/${id}/check`),

  startRender: (id: string, quality: Quality, formats: FormatId[]) =>
    call<RenderSummary>('POST', `/api/projects/${id}/renders`, { quality, formats }),
  projectRenders: (id: string) => call<RenderSummary[]>('GET', `/api/projects/${id}/renders`),
  renders: () => call<RenderSummary[]>('GET', '/api/renders'),
  cancelRender: (id: string) => call<RenderSummary>('POST', `/api/renders/${id}/cancel`),
  revealRender: (id: string) => call<{ ok: true }>('POST', `/api/renders/${id}/reveal`),

  assets: (kind?: AssetKind) => call<Asset[]>('GET', `/api/assets${kind ? `?kind=${kind}` : ''}`),
  upload: (file: Blob, kind: AssetKind, name: string) => {
    const fd = new FormData();
    fd.append('file', file, name);
    fd.append('kind', kind);
    // The asset id is a slug of `name`: keep the extension out of it.
    fd.append('name', name.replace(/\.[^.]+$/, ''));
    return call<Asset>('POST', '/api/assets', fd);
  },
  deleteAsset: (id: string) => call<{ ok: true }>('DELETE', `/api/assets/${id}`),

  brandKits: () => call<BrandKit[]>('GET', '/api/brand-kits'),
  saveBrandKit: (kit: Omit<BrandKit, 'id'>, id?: string) =>
    id ? call<BrandKit>('PUT', `/api/brand-kits/${id}`, kit) : call<BrandKit>('POST', '/api/brand-kits', kit),
  deleteBrandKit: (id: string) => call<{ ok: true }>('DELETE', `/api/brand-kits/${id}`),

  preview: (spec: JobSpecInput, format: FormatId, signal?: AbortSignal) =>
    call<PreviewSession>('POST', '/api/preview', { spec, format }, signal),
  previewAudio: (id: string, soundCues: unknown[]) =>
    call<PreviewAudio>('POST', `/api/preview/${id}/audio`, { soundCues }),
  styleStills: (spec: JobSpecInput, styles: string[], format: FormatId, width: number, signal?: AbortSignal) =>
    call<StyleStill[]>('POST', '/api/style-stills', { spec, styles, format, width }, signal),
  musicSample: (preset: string, bpm: number) => `/api/music/${preset}/sample?bpm=${Math.round(bpm)}`,
  musicAi: (req: { prompt: string; lyrics?: string; bpm?: number; seed: number; seconds: number; cachedOnly?: boolean }) =>
    call<MusicAiState>('POST', '/api/music-ai', req),

  split: (req: SplitInput) => call<SplitResult>('POST', '/api/llm/split', req),
  emphasis: (text: string, language?: 'he' | 'en') =>
    call<EmphasisResult>('POST', '/api/llm/emphasis', { text, ...(language ? { language } : {}) }),
  rankStyles: (brief: string, spec?: JobSpecInput) =>
    call<RankStylesResult>('POST', '/api/llm/rank-styles', { brief, ...(spec ? { spec } : {}) }),
};

/** Subscribes to a render's SSE stream; returns the unsubscribe function. */
export function renderEvents(id: string, on: (e: RenderStreamEvent) => void, onEnd: () => void): () => void {
  const es = new EventSource(`/api/renders/${id}/events`);
  let closed = false;
  es.onmessage = (m) => {
    try {
      on(JSON.parse(m.data as string) as RenderStreamEvent);
    } catch {
      /* ignore malformed frames */
    }
  };
  es.onerror = () => {
    // The server ends the stream after a terminal state; EventSource would reconnect forever otherwise.
    if (!closed) {
      closed = true;
      es.close();
      onEnd();
    }
  };
  return () => {
    closed = true;
    es.close();
  };
}

/** Follows an AI music job (SSE) until it is done or failed; returns the unsubscribe function. */
export function musicAiEvents(key: string, on: (s: MusicAiState) => void): () => void {
  const es = new EventSource(`/api/music-ai/${key}/events`);
  es.onmessage = (m) => {
    try {
      const s = JSON.parse(m.data as string) as MusicAiState;
      on(s);
      if (s.status !== 'running') es.close();
    } catch {
      /* ignore malformed frames */
    }
  };
  // the server ends the stream after the last state; EventSource would reconnect forever otherwise
  es.onerror = () => es.close();
  return () => es.close();
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
