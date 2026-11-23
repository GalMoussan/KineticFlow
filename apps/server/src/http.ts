/** HTTP helpers: `ApiError` responses, request validation, static files with Range support, ids. */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, normalize, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import type { Context } from 'hono';
import type { ApiError, SpecIssue } from '@reel/api';

/** Thrown anywhere in a handler; the app turns it into an `ApiError` JSON response. */
export class HttpError extends Error {
  readonly status: 400 | 404 | 409 | 413 | 415 | 422 | 500 | 502 | 503;
  readonly issues: SpecIssue[] | undefined;
  constructor(status: HttpError['status'], message: string, issues?: SpecIssue[]) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.issues = issues;
  }
}

export function apiError(message: string, issues?: SpecIssue[]): ApiError {
  return { error: message, ...(issues?.length ? { issues } : {}) };
}

interface SafeParser<T> {
  safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
}

/** zod issue path → `SpecIssue.path` (symbols dropped). */
export const issuePath = (p: readonly PropertyKey[]) => p.filter((k): k is string | number => typeof k !== 'symbol');

/** Validates a parsed JSON body (or any value) with a contract schema; 400 with issues on failure. */
export function check<T>(schema: SafeParser<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const issues = r.error.issues.map((i) => ({ path: issuePath(i.path), message: i.message, level: 'error' as const }));
  throw new HttpError(400, `invalid request: ${issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`).join('; ')}`, issues);
}

export async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new HttpError(400, 'the request body is not valid JSON');
  }
}

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
};

/** `rel` inside `root`, or null when it escapes it. */
export function within(root: string, rel: string): string | null {
  const base = resolve(root);
  let path: string;
  try {
    path = normalize(resolve(base, `.${sep}${decodeURIComponent(rel)}`));
  } catch {
    return null;
  }
  return path === base || path.startsWith(base + sep) ? path : null;
}

/**
 * Streams a file with `Content-Type`, `Accept-Ranges` and single-range `206` support (the video and audio elements
 * seek with Range requests). Returns null when the path is not a file.
 */
export async function sendFile(c: Context, path: string, headers: Record<string, string> = {}): Promise<Response | null> {
  const st = await stat(path).catch(() => null);
  if (!st?.isFile()) return null;
  const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
  const base: Record<string, string> = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Last-Modified': st.mtime.toUTCString(), ...headers };
  const range = c.req.header('range');
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]));
    let end = m[1] && m[2] ? Number(m[2]) : st.size - 1;
    end = Math.min(end, st.size - 1);
    if (start > end || start >= st.size) {
      return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${st.size}` } });
    }
    start = Math.max(0, start);
    const body = c.req.method === 'HEAD' ? null : (Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream);
    return new Response(body, {
      status: 206,
      headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': String(end - start + 1) },
    });
  }
  const body = c.req.method === 'HEAD' ? null : (Readable.toWeb(createReadStream(path)) as ReadableStream);
  return new Response(body, { status: 200, headers: { ...base, 'Content-Length': String(st.size) } });
}

/** Short random id: lowercase base-36, valid as a spec slug. */
export function newId(len = 8): string {
  const bytes = randomBytes(len);
  return [...bytes].map((b) => '0123456789abcdefghijklmnopqrstuvwxyz'[b % 36]).join('');
}

/** ASCII kebab-case slug of a name (`Ayalim Logo.png` → `ayalim-logo`); empty when nothing ASCII is left. */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
}

/** `base`, else `base-2`, `base-3`, … whichever `taken` rejects first. */
export function uniqueSlug(base: string, taken: (id: string) => boolean): string {
  if (!taken(base)) return base;
  for (let i = 2; ; i++) if (!taken(`${base}-${i}`)) return `${base}-${i}`;
}
