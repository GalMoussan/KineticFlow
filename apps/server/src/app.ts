/** Routes of the HTTP contract (`@reel/api`), the preview pages, `/files/*` and the built web app. */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  AssetKind,
  CreateProject,
  EmphasisRequest,
  MusicAiRequest,
  PreviewAudioRequest,
  PreviewRequest,
  RankStylesRequest,
  SaveBrandKit,
  SaveProject,
  SplitRequest,
  StartRender,
  StyleStillsRequest,
  ValidateRequest,
  type CheckResult,
  type MusicAiState,
  type ProjectSummary,
  type ProjectWithValidation,
  type RenderStreamEvent,
} from '@reel/api';
import { JobSpec } from '@reel/core';
import { CSP, FONT_DIR, renderJob, type GateResult } from '@reel/render';
import { ingestAsset } from './assets.ts';
import { catalog } from './catalog.ts';
import { apiError, check, HttpError, jsonBody, newId, sendFile, slugify, uniqueSlug, within } from './http.ts';
import { rankStyles, splitContent, suggestEmphasis } from './llm/index.ts';
import { musicSample, type MusicAiJobs } from './music.ts';
import type { Paths } from './paths.ts';
import type { PreviewService } from './preview.ts';
import { materialise, specTitle, specStyle, starterSpec } from './projects.ts';
import { errorMessage, summary, TERMINAL, type Hub, type RenderQueue } from './renders.ts';
import type { StillService } from './stills.ts';
import type { Store } from './store.ts';
import { cyan, dim, red, yellow } from './term.ts';
import { validateSpec } from './validate.ts';

export interface AppDeps {
  store: Store;
  paths: Paths;
  preview: PreviewService;
  stills: StillService;
  queue: RenderQueue;
  hub: Hub<RenderStreamEvent>;
  musicAi: MusicAiJobs;
  log: (msg: string) => void;
  /** SSE comment interval (default 15 s). */
  heartbeatMs?: number;
}

const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function createApp(d: AppDeps): Hono {
  const { store, paths, preview, stills, queue, hub, musicAi, log } = d;
  const app = new Hono();
  const validate = (spec: unknown) => validateSpec(spec, { specDir: paths.data, store });
  const withValidation = async (id: string): Promise<ProjectWithValidation> => {
    const project = store.getProject(id);
    if (!project) throw new HttpError(404, `no project "${id}"`);
    return { project, validation: await validate(project.spec) };
  };

  // ── request log (API only; previews and files are too chatty) ──
  app.use('/api/*', async (c, next) => {
    const t0 = performance.now();
    await next();
    const ms = Math.round(performance.now() - t0);
    const s = c.res.status;
    const status = s >= 500 ? red(String(s)) : s >= 400 ? yellow(String(s)) : dim(String(s));
    log(`${cyan(c.req.method.padEnd(6))} ${c.req.path} ${status} ${dim(`${ms} ms`)}`);
  });

  app.onError((e, c) => {
    if (e instanceof HttpError) return c.json(apiError(e.message, e.issues), e.status);
    log(`${red('error')} ${c.req.method} ${c.req.path}: ${(e as Error).stack ?? e}`);
    return c.json(apiError(errorMessage(e)), 500);
  });

  // ── catalog + validation ──
  app.get('/api/catalog', async (c) => c.json(await catalog(store)));
  app.post('/api/validate', async (c) => c.json(await validate(check(ValidateRequest, await jsonBody(c)).spec)));

  // ── projects ──
  app.get('/api/projects', (c) => {
    const list: ProjectSummary[] = store.listProjects().map((p) => {
      const thumb = store.listRenders({ projectId: p.id, states: ['done'] })[0]?.outputs[0]?.thumbnail;
      return { id: p.id, title: specTitle(p.spec), updatedAt: p.updatedAt, style: specStyle(p.spec), ...(thumb ? { thumbnail: thumb } : {}) };
    });
    return c.json(list);
  });

  app.post('/api/projects', async (c) => {
    const body = check(CreateProject, await jsonBody(c).catch(() => ({})));
    const kit = body.brandKit ? store.getBrandKit(body.brandKit) : undefined;
    if (body.brandKit && !kit) throw new HttpError(404, `no brand kit "${body.brandKit}"`);
    const id = newId(8);
    const given = rec(body.spec);
    const spec = given ? { ...given, id: typeof given.id === 'string' && given.id ? given.id : `reel-${id}` } : starterSpec(`reel-${id}`, kit);
    store.createProject({ id, spec, brandKit: body.brandKit });
    log(`project ${id} created · ${specTitle(spec)}`);
    return c.json(await withValidation(id), 201);
  });

  app.get('/api/projects/:id', async (c) => c.json(await withValidation(c.req.param('id'))));

  app.put('/api/projects/:id', async (c) => {
    const id = c.req.param('id');
    const body = check(SaveProject, await jsonBody(c));
    const current = store.getProject(id);
    if (!current) throw new HttpError(404, `no project "${id}"`);
    if (body.brandKit && !store.getBrandKit(body.brandKit)) throw new HttpError(404, `no brand kit "${body.brandKit}"`);
    const given = rec(body.spec);
    const spec = given && given.id === undefined ? { ...given, id: rec(current.spec)?.id ?? `reel-${id}` } : body.spec;
    store.saveProject(id, spec, body.brandKit);
    return c.json(await withValidation(id));
  });

  app.delete('/api/projects/:id', (c) => {
    if (!store.deleteProject(c.req.param('id'))) throw new HttpError(404, `no project "${c.req.param('id')}"`);
    return c.json({ ok: true });
  });

  app.post('/api/projects/:id/duplicate', async (c) => {
    const src = store.getProject(c.req.param('id'));
    if (!src) throw new HttpError(404, `no project "${c.req.param('id')}"`);
    const id = newId(8);
    store.createProject({ id, spec: { ...(rec(src.spec) ?? {}), id: `reel-${id}` }, brandKit: src.brandKit });
    log(`project ${id} duplicated from ${src.id}`);
    return c.json(await withValidation(id), 201);
  });

  app.post('/api/projects/:id/check', async (c) => {
    const t0 = performance.now();
    const id = c.req.param('id');
    const project = store.getProject(id);
    if (!project) throw new HttpError(404, `no project "${id}"`);
    const gates: CheckResult['gates'] = [];
    const add = (g: GateResult) => gates.push({ gate: g.gate, level: g.level, ...(g.format ? { format: g.format } : {}), detail: g.detail });
    const validation = await validate(project.spec);
    const parsed = JobSpec.safeParse(project.spec);
    if (!validation.ok || !parsed.success) {
      for (const i of validation.issues.filter((x) => x.level === 'error')) add({ gate: 'spec', level: 'fail', detail: `${i.path.join('.') || 'spec'}: ${i.message}` });
      return c.json({ gates, ms: Math.round(performance.now() - t0) } satisfies CheckResult);
    }
    const workDir = join(paths.checks, newId(10));
    try {
      const specPath = await materialise({ projects: paths.projects, assets: paths.assets, store, projectId: id, spec: parsed.data, file: 'check.json' });
      const res = await renderJob(specPath, { preflightOnly: true, workDir }, () => {});
      res.qa.forEach(add);
    } catch (e) {
      add({ gate: (e as Error).name === 'TimingError' ? 'timing' : 'preflight', level: 'fail', detail: errorMessage(e) });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
    const ms = Math.round(performance.now() - t0);
    log(`check ${id} · ${gates.filter((g) => g.level === 'fail').length} fail, ${gates.filter((g) => g.level === 'warn').length} warn · ${ms} ms`);
    return c.json({ gates, ms } satisfies CheckResult);
  });

  app.post('/api/projects/:id/renders', async (c) => {
    const id = c.req.param('id');
    const body = check(StartRender, await jsonBody(c).catch(() => ({})));
    const project = store.getProject(id);
    if (!project) throw new HttpError(404, `no project "${id}"`);
    const validation = await validate(project.spec);
    const parsed = JobSpec.safeParse(project.spec);
    if (!validation.ok || !parsed.success) {
      const errors = validation.issues.filter((i) => i.level === 'error');
      throw new HttpError(422, `fix the spec first: ${errors.map((i) => i.message).join('; ') || 'not renderable'}`, errors);
    }
    const r = queue.enqueue({
      projectId: id,
      title: specTitle(project.spec),
      spec: project.spec,
      quality: body.quality,
      formats: body.formats ?? parsed.data.formats,
    });
    return c.json(r, 201);
  });

  app.get('/api/projects/:id/renders', (c) => c.json(store.listRenders({ projectId: c.req.param('id') }).map(summary)));

  // ── renders ──
  app.get('/api/renders', (c) => c.json(store.listRenders().map(summary)));
  app.get('/api/renders/:id', (c) => {
    const r = store.getRender(c.req.param('id'));
    if (!r) throw new HttpError(404, `no render "${c.req.param('id')}"`);
    return c.json(summary(r));
  });
  app.post('/api/renders/:id/cancel', (c) => {
    const r = queue.cancel(c.req.param('id'));
    if (!r) throw new HttpError(404, `no render "${c.req.param('id')}"`);
    return c.json(r);
  });
  app.post('/api/renders/:id/reveal', (c) => {
    const id = c.req.param('id');
    if (!store.getRender(id)) throw new HttpError(404, `no render "${id}"`);
    if (!queue.reveal(id)) throw new HttpError(409, 'this render has no output folder yet');
    return c.json({ ok: true });
  });
  app.get('/api/renders/:id/events', (c) => {
    const id = c.req.param('id');
    if (!store.getRender(id)) throw new HttpError(404, `no render "${id}"`);
    return streamSSE(c, async (stream) => {
      const pending: RenderStreamEvent[] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = hub.subscribe(id, (e) => {
        pending.push(e);
        wake?.();
      });
      let closed = false;
      stream.onAbort(() => {
        closed = true;
        wake?.();
      });
      const hb = setInterval(() => void stream.write(': hb\n\n').catch(() => {}), d.heartbeatMs ?? 15_000);
      try {
        const now = summary(store.getRender(id)!);
        await stream.writeSSE({ data: JSON.stringify({ type: 'state', render: now } satisfies RenderStreamEvent) });
        if (TERMINAL.includes(now.state)) return;
        while (!closed) {
          const e = pending.shift();
          if (!e) {
            const w = Promise.withResolvers<void>();
            wake = w.resolve;
            await w.promise;
            wake = null;
            continue;
          }
          await stream.writeSSE({ data: JSON.stringify(e) });
          if (e.type === 'state' && TERMINAL.includes(e.render.state)) break;
        }
      } finally {
        clearInterval(hb);
        unsubscribe();
      }
    });
  });

  // ── assets ──
  app.get('/api/assets', (c) => {
    const kind = c.req.query('kind');
    const k = kind === undefined ? undefined : check(AssetKind, kind);
    return c.json(store.listAssets(k).map(({ ext: _e, sha256: _s, ...a }) => a));
  });
  app.post('/api/assets', async (c) => {
    let body: Record<string, string | File | (string | File)[]>;
    try {
      body = await c.req.parseBody();
    } catch {
      throw new HttpError(400, 'expected multipart/form-data with "file" and "kind"');
    }
    const file = body.file;
    if (!(file instanceof File)) throw new HttpError(400, 'missing "file" (multipart file field)');
    const kind = check(AssetKind, body.kind);
    const asset = await ingestAsset(store, paths.assets, { file, kind, name: typeof body.name === 'string' ? body.name : undefined }, log);
    return c.json(asset, 201);
  });
  app.delete('/api/assets/:id', async (c) => {
    const a = store.getAsset(c.req.param('id'));
    if (!a) throw new HttpError(404, `no asset "${c.req.param('id')}"`);
    store.deleteAsset(a.id);
    await rm(join(paths.assets, `${a.id}.${a.ext}`), { force: true });
    log(`asset ${a.id} deleted`);
    return c.json({ ok: true });
  });

  // ── brand kits ──
  app.get('/api/brand-kits', (c) => c.json(store.listBrandKits()));
  app.get('/api/brand-kits/:id', (c) => {
    const k = store.getBrandKit(c.req.param('id'));
    if (!k) throw new HttpError(404, `no brand kit "${c.req.param('id')}"`);
    return c.json(k);
  });
  app.post('/api/brand-kits', async (c) => {
    const body = check(SaveBrandKit, await jsonBody(c));
    const id = uniqueSlug(slugify(body.name) || `kit-${newId(6)}`, (x) => store.getBrandKit(x) !== undefined);
    return c.json(store.putBrandKit({ id, ...body }), 201);
  });
  app.put('/api/brand-kits/:id', async (c) => {
    const id = c.req.param('id');
    if (!store.getBrandKit(id)) throw new HttpError(404, `no brand kit "${id}"`);
    return c.json(store.putBrandKit({ id, ...check(SaveBrandKit, await jsonBody(c)) }));
  });
  app.delete('/api/brand-kits/:id', (c) => {
    if (!store.deleteBrandKit(c.req.param('id'))) throw new HttpError(404, `no brand kit "${c.req.param('id')}"`);
    return c.json({ ok: true });
  });

  // ── preview + stills + music samples ──
  app.post('/api/preview', async (c) => {
    const body = check(PreviewRequest, await jsonBody(c));
    return c.json((await preview.create(body.spec, body.format)).response);
  });
  app.post('/api/preview/:id/audio', async (c) => {
    const body = check(PreviewAudioRequest, await jsonBody(c));
    return c.json({ url: await preview.audio(c.req.param('id'), body.soundCues) });
  });
  app.post('/api/style-stills', async (c) => c.json(await stills.stills(check(StyleStillsRequest, await jsonBody(c)))));
  app.get('/api/music/:preset/sample', async (c) => {
    const bpm = c.req.query('bpm') === undefined ? undefined : Number(c.req.query('bpm'));
    const path = await musicSample(join(paths.preview, 'audio'), c.req.param('preset'), bpm);
    return (await sendFile(c, path, { 'Cache-Control': 'max-age=86400' }))!;
  });

  // ── AI music (ACE-Step add-on) ──
  app.post('/api/music-ai', async (c) => c.json(await musicAi.start(check(MusicAiRequest, await jsonBody(c)))));
  app.get('/api/music-ai/:key/events', (c) => {
    const key = c.req.param('key');
    if (!musicAi.state(key)) throw new HttpError(404, `no AI music job "${key}" (start it with POST /api/music-ai)`);
    return streamSSE(c, async (stream) => {
      const pending: MusicAiState[] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = musicAi.subscribe(key, (s) => {
        pending.push(s);
        wake?.();
      });
      let closed = false;
      stream.onAbort(() => {
        closed = true;
        wake?.();
      });
      const hb = setInterval(() => void stream.write(': hb\n\n').catch(() => {}), d.heartbeatMs ?? 15_000);
      try {
        let last = musicAi.state(key)!;
        await stream.writeSSE({ data: JSON.stringify(last) });
        while (!closed && last.status === 'running') {
          const next = pending.shift();
          if (!next) {
            const w = Promise.withResolvers<void>();
            wake = w.resolve;
            await w.promise;
            wake = null;
            continue;
          }
          last = next;
          await stream.writeSSE({ data: JSON.stringify(next) });
        }
      } finally {
        clearInterval(hb);
        unsubscribe();
      }
    });
  });
  app.get('/api/music-ai/:key/audio', async (c) => {
    const res = await sendFile(c, musicAi.audioPath(c.req.param('key')), { 'Cache-Control': 'max-age=86400' });
    return res || c.json(apiError('AI clip not found (generate it again)'), 404);
  });

  app.get('/preview/:sid/*', async (c) => {
    const sid = c.req.param('sid');
    const session = preview.session(sid);
    if (!session) return c.text('preview session expired', 404);
    const rest = c.req.path.slice(`/preview/${sid}/`.length) || 'index.html';
    const headers = { 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store' };
    if (rest === 'index.html') return c.html((await preview.page(sid))!, 200, headers);
    const path = within(session.bundle.dir, rest);
    const res = path && (await sendFile(c, path, headers));
    return res || c.text('not found', 404);
  });

  // ── LLM helpers ──
  app.post('/api/llm/split', async (c) => {
    const body = check(SplitRequest, await jsonBody(c));
    const kit = body.brandKit ? store.getBrandKit(body.brandKit) : undefined;
    return c.json(await splitContent(body, { logos: kit?.logos ?? [] }));
  });
  app.post('/api/llm/emphasis', async (c) => c.json(await suggestEmphasis(check(EmphasisRequest, await jsonBody(c)))));
  app.post('/api/llm/rank-styles', async (c) => c.json(await rankStyles(check(RankStylesRequest, await jsonBody(c)))));

  app.all('/api/*', (c) => c.json(apiError(`no route ${c.req.method} ${c.req.path}`), 404));

  // ── files ──
  const roots: Record<string, string> = { assets: paths.assets, fonts: FONT_DIR, out: paths.out, preview: paths.preview };
  app.get('/files/:root/*', async (c) => {
    const rootName = c.req.param('root');
    const root = roots[rootName];
    if (!root) return c.text('not found', 404);
    const path = within(root, c.req.path.slice(`/files/${rootName}/`.length));
    // uploaded SVGs are opened as documents only sandboxed (no scripts)
    const headers: Record<string, string> = rootName === 'assets' ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox" } : {};
    const res = path && (await sendFile(c, path, headers));
    return res || c.text('not found', 404);
  });

  // ── the web app (SPA fallback to index.html) ──
  app.get('*', async (c) => serveWeb(c, paths.web));
  return app;
}

async function serveWeb(c: Context, dist: string): Promise<Response> {
  const path = within(dist, c.req.path);
  const file = path && (await sendFile(c, path, c.req.path.startsWith('/assets/') ? { 'Cache-Control': 'public, max-age=31536000, immutable' } : {}));
  if (file) return file;
  const index = await sendFile(c, join(dist, 'index.html'), { 'Cache-Control': 'no-cache' });
  return (
    index ??
    c.html(
      '<!doctype html><meta charset="utf-8"><title>Reel Studio</title><body style="font:16px system-ui;padding:3em">' +
        '<h1>Reel Studio</h1><p>The web app is not built yet. Run <code>pnpm reelgen serve</code> (it builds <code>apps/web</code>) ' +
        'or <code>pnpm reelgen serve --dev</code>.</p>',
      503,
    )
  );
}
