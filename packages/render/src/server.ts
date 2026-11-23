/** Loopback static server for a job bundle dir, sending the production CSP (PLAN.md §8.1). */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

/** Same-origin only; inline script/style allowed for the page itself (measured in M0, `spikes/lib.ts`). */
export const CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'self' blob:; media-src 'self' blob:";

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.wav': 'audio/wav',
};

export interface StaticServer {
  /** `http://127.0.0.1:<port>`, no trailing slash. */
  url: string;
  close(): Promise<void>;
}

export async function serveDir(root: string): Promise<StaticServer> {
  const base = resolve(root);
  const server = createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405).end();
    let path: string;
    try {
      path = normalize(join(base, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)));
    } catch {
      return void res.writeHead(400).end();
    }
    if (path !== base && !path.startsWith(base + sep)) return void res.writeHead(403).end();
    try {
      if (!(await stat(path)).isFile()) throw new Error('not a file');
      const body = await readFile(path);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': body.length,
        'Content-Security-Policy': CSP,
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404).end();
    }
  });
  const listening = Promise.withResolvers<void>();
  server.once('error', listening.reject);
  server.listen(0, '127.0.0.1', listening.resolve);
  await listening.promise;
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    close() {
      const closed = Promise.withResolvers<void>();
      server.closeAllConnections();
      server.close(() => closed.resolve());
      return closed.promise;
    },
  };
}
