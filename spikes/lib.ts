/** Shared spike harness: CSP-locked loopback server + Chromium launch modes. */
import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium, type Browser, type LaunchOptions } from 'playwright';

const CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'self' blob:; media-src 'self' blob:";

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.wav': 'audio/wav',
};

export async function serve(root: string): Promise<{ url: string; close(): Promise<void> }> {
  const base = resolve(root);
  const server: Server = createServer(async (req, res) => {
    const path = normalize(join(base, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)));
    if (!path.startsWith(base)) return void res.writeHead(403).end();
    try {
      if (!(await stat(path)).isFile()) throw new Error('not a file');
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream', 'Content-Security-Policy': CSP });
      res.end(await readFile(path));
    } catch {
      res.writeHead(404).end();
    }
  });
  const listening = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', listening.resolve);
  await listening.promise;
  const { port } = server.address() as { port: number };
  const close = () => {
    const closed = Promise.withResolvers<void>();
    server.close(() => closed.resolve());
    return closed.promise;
  };
  return { url: `http://127.0.0.1:${port}`, close };
}

export const GPU_ARGS = ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'];

/**
 * - `shell`: chrome-headless-shell (Playwright's default for headless: true)
 * - `new-headless`: full Chromium in new headless mode
 * - `chrome`: system Google Chrome, new headless
 * - `headed`: full Chromium with a real window
 * - `*-nogpu`: OpenKatana's flags (`--disable-gpu`), the baseline
 */
export type Mode = 'shell' | 'shell-nogpu' | 'new-headless' | 'chrome' | 'headed';

export function launch(mode: Mode, extra: LaunchOptions = {}): Promise<Browser> {
  const base: LaunchOptions = { args: mode === 'shell-nogpu' ? ['--disable-gpu'] : GPU_ARGS, ...extra };
  switch (mode) {
    case 'shell':
    case 'shell-nogpu':
      return chromium.launch({ ...base, headless: true });
    case 'new-headless':
      return chromium.launch({ ...base, headless: true, channel: 'chromium' });
    case 'chrome':
      return chromium.launch({ ...base, headless: true, channel: 'chrome' });
    case 'headed':
      return chromium.launch({ ...base, headless: false });
  }
}

/** Resolves after two animation frames: the frame has been painted. */
export const PAINTED = 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))';
