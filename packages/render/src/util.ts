import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';

/** Repository root (absolute, trailing slash). */
export const REPO = new URL('../../../', import.meta.url).pathname;

export const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

/** JSON with object keys sorted at every depth, so equal values always hash equally. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return v;
  });
}

/** Writes via a temp file + rename, so readers never see a partial file. */
export async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/** Runs a tool to completion; a non-zero exit throws with the tail of stderr. */
export function exec(cmd: string, args: string[]): Promise<ExecResult> {
  const { promise, resolve, reject } = Promise.withResolvers<ExecResult>();
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  child.stdout.on('data', (b: Buffer) => out.push(b));
  child.stderr.on('data', (b: Buffer) => err.push(b));
  child.on('error', reject);
  child.on('close', (code) => {
    const stdout = Buffer.concat(out).toString();
    const stderr = Buffer.concat(err).toString();
    if (code === 0) resolve({ stdout, stderr });
    else reject(new Error(`${cmd} exited with ${code}: ${stderr.trim().split('\n').slice(-6).join('\n')}`));
  });
  return promise;
}

export const ffmpeg = (args: string[]) => exec('ffmpeg', ['-hide_banner', '-nostdin', ...args]);
