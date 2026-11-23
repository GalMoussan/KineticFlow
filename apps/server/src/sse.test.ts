import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RenderStreamEvent } from '@reel/api';
import { createApp } from './app.ts';
import { paths } from './paths.ts';
import type { PreviewService } from './preview.ts';
import { Hub, summary, type RenderQueue } from './renders.ts';
import type { StillService } from './stills.ts';
import { Store } from './store.ts';

test('Hub fans out per topic, unsubscribes, drops throwing subscribers', () => {
  const hub = new Hub<number>();
  const a: number[] = [];
  const b: number[] = [];
  const offA = hub.subscribe('x', (n) => a.push(n));
  hub.subscribe('x', (n) => b.push(n));
  hub.subscribe('y', () => assert.fail('other topic'));
  hub.subscribe('x', () => {
    throw new Error('boom');
  });
  hub.publish('x', 1);
  assert.equal(hub.count('x'), 2, 'the throwing subscriber is gone');
  offA();
  hub.publish('x', 2);
  assert.deepEqual(a, [1]);
  assert.deepEqual(b, [1, 2]);
});

/** Reads SSE frames until the stream ends: `data` payloads and comment lines. */
async function readSse(res: Response): Promise<{ events: RenderStreamEvent[]; comments: number }> {
  const events: RenderStreamEvent[] = [];
  let comments = 0;
  let buf = '';
  const dec = new TextDecoder();
  const reader = res.body!.getReader();
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    buf += dec.decode(r.value, { stream: true });
    let at: number;
    while ((at = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, at);
      buf = buf.slice(at + 2);
      for (const line of frame.split('\n')) {
        if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)) as RenderStreamEvent);
        else if (line.startsWith(':')) comments++;
      }
    }
  }
  return { events, comments };
}

test('GET /api/renders/:id/events: current state first, every event to every subscriber, heartbeats, ends on a terminal state', async () => {
  const store = new Store(':memory:');
  const subscribed = Promise.withResolvers<void>();
  const hub = new (class extends Hub<RenderStreamEvent> {
    override subscribe(topic: string, fn: (e: RenderStreamEvent) => void) {
      const off = super.subscribe(topic, fn);
      if (this.count('r1') === 2) subscribed.resolve();
      return off;
    }
  })();
  // routes under test touch only the store and the hub
  const unused = {} as PreviewService & StillService & RenderQueue;
  const app = createApp({ store, paths: paths('/tmp/reel-sse-unused'), preview: unused, stills: unused, queue: unused, hub, log: () => {}, heartbeatMs: 30 });
  store.insertRender({ id: 'r1', projectId: 'p', title: 'T', quality: 'draft', formats: ['1:1'], spec: {} });
  store.updateRender('r1', { state: 'running' });

  const [res1, res2] = await Promise.all([app.request('/api/renders/r1/events'), app.request('/api/renders/r1/events')]);
  assert.equal(res1.headers.get('content-type'), 'text/event-stream');
  const reading = Promise.all([readSse(res1), readSse(res2)]);
  await subscribed.promise;
  // heartbeats are a real-time interval of the stream: one short real wait lets at least one through
  await new Promise((r) => setTimeout(r, 80));
  hub.publish('r1', { type: 'progress', progress: 0.5, label: 'rendering 1:1' });
  hub.publish('r1', { type: 'render', event: { type: 'chunk', format: '1:1', index: 0, done: 10, total: 300 } });
  const done = store.updateRender('r1', { state: 'done', progress: 1, finished: true })!;
  hub.publish('r1', { type: 'state', render: summary(done) });
  hub.publish('r1', { type: 'progress', progress: 1, label: 'after the end' });

  for (const { events, comments } of await reading) {
    assert.deepEqual(
      events.map((e) => e.type),
      ['state', 'progress', 'render', 'state'],
    );
    assert.equal(events[0]!.type === 'state' && events[0]!.render.state, 'running');
    assert.equal(events[3]!.type === 'state' && events[3]!.render.state, 'done');
    assert.ok(comments >= 1, 'heartbeat comments');
  }
  assert.equal(hub.count('r1'), 0, 'subscribers removed when the streams end');

  // a late subscriber gets the terminal state and the stream closes at once
  const late = await readSse(await app.request('/api/renders/r1/events'));
  assert.deepEqual(late.events.map((e) => e.type === 'state' && e.render.state), ['done']);
  const missing = await app.request('/api/renders/nope/events');
  assert.equal(missing.status, 404);
  assert.match(((await missing.json()) as { error: string }).error, /no render/);
});
