/**
 * Reel Studio server (PLAN.md §9, M4): the HTTP contract of `@reel/api` on 127.0.0.1, the live preview pages, the
 * render queue and the built web app. `serveApp` is `reelgen serve`.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import type { RenderStreamEvent } from '@reel/api';
import { cacheBudgetBytes, pruneCaches } from '@reel/render';
import { createApp } from './app.ts';
import { loadDotEnv } from './llm/index.ts';
import { paths as defaultPaths, REPO, type Paths } from './paths.ts';
import { PreviewService } from './preview.ts';
import { Hub, RenderQueue } from './renders.ts';
import { StillService } from './stills.ts';
import { Store } from './store.ts';
import { bold, dim, green, mb, red } from './term.ts';

export { createApp } from './app.ts';
export { Store, MIGRATIONS } from './store.ts';
export { Hub, RenderQueue } from './renders.ts';
export { validateSpec } from './validate.ts';
export { splitRules } from './llm/rules.ts';

export interface RunningServer {
  url: string;
  port: number;
  store: Store;
  queue: RenderQueue;
  close(): Promise<void>;
}

const stamp = () => new Date().toTimeString().slice(0, 8);

export async function startServer(o: { port?: number; host?: string; paths?: Paths; quiet?: boolean; heartbeatMs?: number } = {}): Promise<RunningServer> {
  loadDotEnv();
  const paths = o.paths ?? defaultPaths();
  const log = o.quiet ? () => {} : (msg: string) => console.log(`${dim(stamp())} ${msg}`);
  const store = new Store(paths.db);
  const hub = new Hub<RenderStreamEvent>();
  const preview = new PreviewService({ dir: paths.preview, specDir: paths.data, store, log });
  let origin = '';
  const stills = new StillService({ preview, dir: join(paths.preview, 'stills'), origin: () => origin, log });
  const queue = new RenderQueue({ store, paths, hub, log, print: !o.quiet });
  const app = createApp({ store, paths, preview, stills, queue, hub, log, ...(o.heartbeatMs ? { heartbeatMs: o.heartbeatMs } : {}) });
  const host = o.host ?? '127.0.0.1';
  const listening = Promise.withResolvers<number>();
  const server = serve({ fetch: app.fetch, port: o.port ?? 0, hostname: host }, (info) => listening.resolve(info.port));
  server.once('error', listening.reject);
  const port = await listening.promise;
  origin = `http://${host}:${port}`;
  return {
    url: origin,
    port,
    store,
    queue,
    async close() {
      await stills.close();
      const closed = Promise.withResolvers<void>();
      if ('closeAllConnections' in server) server.closeAllConnections();
      server.close(() => closed.resolve());
      await closed.promise;
      store.close();
    },
  };
}

/** First free TCP port on 127.0.0.1 from `start` on. */
export async function freePort(start: number): Promise<number> {
  for (let p = start; p < start + 100; p++) {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    const s = createServer();
    s.once('error', () => resolve(false));
    s.listen(p, '127.0.0.1', () => s.close(() => resolve(true)));
    const ok = await promise;
    if (ok) return p;
  }
  throw new Error(`no free port in ${start}–${start + 99}`);
}

const WEB = join(REPO, 'apps/web');
const VITE = join(WEB, 'node_modules/.bin/vite');

async function newest(path: string): Promise<number> {
  const st = await stat(path).catch(() => null);
  if (!st) return 0;
  if (!st.isDirectory()) return st.mtimeMs;
  let t = st.mtimeMs;
  for (const e of await readdir(path, { recursive: true, withFileTypes: true })) {
    if (e.isFile()) t = Math.max(t, (await stat(join(e.parentPath, e.name))).mtimeMs);
  }
  return t;
}

function run(cmd: string, args: string[], o: { cwd: string; env?: NodeJS.ProcessEnv }): ChildProcess {
  return spawn(cmd, args, { cwd: o.cwd, stdio: 'inherit', env: { ...process.env, ...o.env } });
}

/** Builds `apps/web` when `dist/index.html` is missing or older than any source (src/, index.html, configs). */
export async function ensureWebBuild(dist = join(WEB, 'dist')): Promise<void> {
  const built = await newest(join(dist, 'index.html'));
  const sources = Math.max(
    ...(await Promise.all(['src', 'public', 'index.html', 'vite.config.ts', 'package.json', 'tsconfig.json'].map((p) => newest(join(WEB, p))))),
  );
  if (built && built >= sources) return;
  if (!(await stat(join(WEB, 'index.html')).catch(() => null))) {
    console.log(dim('web app sources not found (apps/web/index.html); serving the API only'));
    return;
  }
  console.log(`${built ? 'web app changed' : 'web app not built yet'}: building apps/web …`);
  const child = run(VITE, ['build'], { cwd: WEB });
  const exited = Promise.withResolvers<number | null>();
  child.on('close', exited.resolve);
  const code = await exited.promise;
  if (code !== 0) {
    console.log(
      `${red('✗')} vite build failed (exit ${code}); ${built ? 'serving the previous build' : 'serving the API only'}. Fix apps/web and restart, or use --dev.`,
    );
  }
}

/**
 * `reelgen serve`: the built web app + API on one port (default 5173 or the next free one), or with `dev` the API on
 * 5180+ and Vite's dev server (hot reload) on 5173+ proxying `/api`, `/files` and `/preview` to it (via `REEL_SERVER`).
 * Prints the URL, opens the browser, and logs requests, previews and renders until Ctrl-C.
 */
export async function serveApp(o: { port?: number; dev?: boolean; open?: boolean }): Promise<void> {
  let vite: ChildProcess | null = null;
  let server: RunningServer;
  let url: string;
  if (o.dev) {
    server = await startServer({ port: await freePort(5180) });
    const vitePort = o.port ?? (await freePort(5173));
    vite = run(VITE, ['--port', String(vitePort), '--strictPort', '--host', '127.0.0.1'], { cwd: WEB, env: { REEL_SERVER: server.url } });
    url = `http://127.0.0.1:${vitePort}`;
    console.log(`${green('✓')} API ${server.url} · Vite dev server ${url}`);
  } else {
    await ensureWebBuild();
    server = await startServer({ port: o.port ?? (await freePort(5173)) });
    url = server.url;
  }
  const pruned = await pruneCaches({ minAgeMs: 0 });
  console.log(
    dim(`cache ${mb(pruned.left)} of ${mb(cacheBudgetBytes())} budget`) +
      (pruned.removed ? dim(` · pruned ${pruned.removed} old entries (${mb(pruned.freed)})`) : ''),
  );
  console.log(`\n  ${bold('Reel Studio')} ${green('→')} ${bold(url)}\n`);
  if (o.open !== false) spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
  const done = Promise.withResolvers<void>();
  const stop = async () => {
    console.log(dim('\nstopping…'));
    vite?.kill('SIGTERM');
    await server.close().catch(() => {});
    done.resolve();
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
  await done.promise;
}
