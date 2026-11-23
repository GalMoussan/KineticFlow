/**
 * End to end over HTTP (slow: renders a real draft video, ~30 s). Runs with `REEL_SLOW=1`:
 *   REEL_SLOW=1 node --test apps/server/src/integration.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { PreviewSession, ProjectWithValidation, RenderStreamEvent, RenderSummary, SplitResult, StyleStill } from '@reel/api';
import { REPO } from './paths.ts';
import { paths } from './paths.ts';
import { startServer } from './index.ts';

test('paste → split → project → preview → draft render 1:1 → MP4', { skip: process.env.REEL_SLOW !== '1' && 'slow; set REEL_SLOW=1' }, async () => {
  process.env.REEL_NO_OPEN = '1';
  const root = await mkdtemp(join(tmpdir(), 'reel-e2e-'));
  const server = await startServer({ port: 0, paths: paths(join(root, 'data'), join(root, 'out')), quiet: true });
  const B = server.url;
  const json = async <T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
    const res = await fetch(B + path, {
      ...init,
      ...(init?.json !== undefined ? { method: init.method ?? 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.json) } : {}),
    });
    const body = (await res.json()) as T;
    assert.ok(res.ok, `${path}: ${res.status} ${JSON.stringify(body)}`);
    return body;
  };
  try {
    for (const name of ['ayalim', 'kiryat-shmona']) {
      const form = new FormData();
      form.set('kind', 'logo');
      form.set('file', new Blob([readFileSync(join(REPO, `examples/assets/${name}.png`))], { type: 'image/png' }), `${name}.png`);
      const asset = await json<{ id: string }>('/api/assets', { method: 'POST', body: form });
      assert.equal(asset.id, name);
    }
    const kit = await json<{ id: string }>('/api/brand-kits', { json: { name: 'Khan', logos: ['kiryat-shmona', 'ayalim'], palette: null, fonts: null } });

    const split = await json<SplitResult>('/api/llm/split', {
      json: { text: 'Open Mic Night\nFriday, December 4th at 8pm\n@ The Khan Club, Tel Aviv\nJoin us!', provider: 'rules', brandKit: kit.id },
    });
    assert.equal(split.provider, 'rules');
    const spec = {
      language: split.language,
      contentType: split.contentType,
      sections: split.sections,
      style: 'kinetic-quote',
      palette: 'flamingo-cafe',
      fonts: { display: 'rubik' },
      music: { source: 'preset', preset: 'lofi-jazz', bpm: 100, seed: 7 },
      duration: 14,
      formats: ['1:1'],
    };
    let created = await json<ProjectWithValidation>('/api/projects', { json: { spec, brandKit: kit.id } });
    const timing = created.validation.timing;
    if (timing && !timing.ok) {
      created = await json<ProjectWithValidation>(`/api/projects/${created.project.id}`, { method: 'PUT', json: { spec: { ...created.project.spec, duration: Math.ceil(timing.needed) } } });
    }
    assert.equal(created.validation.ok, true, JSON.stringify(created.validation.issues));
    const pid = created.project.id;

    const session = await json<PreviewSession>('/api/preview', { json: { spec: created.project.spec, format: '1:1' } });
    assert.equal(session.width, 1080);
    assert.ok(session.musicUrl);
    const page = await (await fetch(B + session.url)).text();
    assert.ok(page.indexOf('window.REEL =') < page.indexOf('<script src="engine.js">'));
    const audio = await json<{ url: string }>(`/api/preview/${session.id}/audio`, { json: { soundCues: [{ t: 1, kind: 'pop', weight: 0.8 }] } });
    assert.equal((await fetch(B + audio.url)).headers.get('content-type'), 'audio/wav');

    const [still] = await json<StyleStill[]>('/api/style-stills', { json: { spec: created.project.spec, styles: ['swiss-title-reveal'], format: '1:1' } });
    assert.ok(still?.url, still?.error ?? 'no still');

    const render = await json<RenderSummary>(`/api/projects/${pid}/renders`, { json: { quality: 'draft' } });
    assert.deepEqual(render.formats, ['1:1']);
    const res = await fetch(`${B}/api/renders/${render.id}/events`);
    const seen: RenderStreamEvent[] = [];
    let buf = '';
    const dec = new TextDecoder();
    const reader = res.body!.getReader();
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      const chunk = r.value;
      buf += dec.decode(chunk, { stream: true });
      for (let at = buf.indexOf('\n\n'); at >= 0; at = buf.indexOf('\n\n')) {
        const line = buf.slice(0, at).split('\n').find((l) => l.startsWith('data: '));
        buf = buf.slice(at + 2);
        if (line) seen.push(JSON.parse(line.slice(6)) as RenderStreamEvent);
      }
    }
    const last = seen.at(-1)!;
    assert.equal(last.type, 'state');
    const final = (last as { render: RenderSummary }).render;
    assert.equal(final.state, 'done', final.error ?? 'not done');
    assert.equal(final.progress, 1);
    assert.ok(seen.some((e) => e.type === 'progress' && e.progress > 0 && e.progress < 1));
    assert.ok(seen.some((e) => e.type === 'render' && (e.event as { type: string }).type === 'chunk-done'));
    const out = final.outputs[0]!;
    const mp4 = join(root, 'out', decodeURIComponent(out.video.replace(/^\/files\/out\//, '')));
    assert.ok(statSync(mp4).size > 100_000);
    const head = await fetch(B + out.video, { headers: { range: 'bytes=0-99' } });
    assert.equal(head.status, 206);
    assert.ok(final.qa.some((g) => g.gate === 'container' && g.level === 'pass'));
    assert.deepEqual(await json('/api/renders/' + render.id + '/reveal', { method: 'POST' }), { ok: true });
    const list = await json<{ thumbnail?: string }[]>('/api/projects');
    assert.ok(list[0]?.thumbnail);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
