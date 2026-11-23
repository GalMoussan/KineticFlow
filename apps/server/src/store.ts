/**
 * SQLite store (`data/reel.db`, `node:sqlite`): projects, brand kits, assets and renders. Schema changes are
 * append-only migrations tracked in `PRAGMA user_version`.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Asset, AssetKind, BrandKit, Project, RenderOutput, RenderState, RenderSummary } from '@reel/api';
import type { FormatId, JobSpecInput } from '@reel/core';

/** Index i upgrades the schema from version i to i + 1. Never edit an entry; append a new one. */
export const MIGRATIONS: readonly string[] = [
  `CREATE TABLE projects (
     id TEXT PRIMARY KEY,
     spec TEXT NOT NULL,
     brand_kit TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE brand_kits (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     logos TEXT NOT NULL,
     palette TEXT,
     fonts TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE assets (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     name TEXT NOT NULL,
     ext TEXT NOT NULL,
     bytes INTEGER NOT NULL,
     sha256 TEXT NOT NULL,
     meta TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE TABLE renders (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL,
     title TEXT NOT NULL,
     quality TEXT NOT NULL,
     formats TEXT NOT NULL,
     spec TEXT NOT NULL,
     state TEXT NOT NULL,
     progress REAL NOT NULL DEFAULT 0,
     outputs TEXT NOT NULL DEFAULT '[]',
     qa TEXT NOT NULL DEFAULT '[]',
     error TEXT,
     out_dir TEXT,
     created_at TEXT NOT NULL,
     finished_at TEXT
   );
   CREATE INDEX renders_project ON renders (project_id, created_at);`,
];

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? undefined : String(v));
const json = <T>(v: unknown): T => JSON.parse(String(v)) as T;
const now = () => new Date().toISOString();

export interface RenderRow extends RenderSummary {
  /** The spec as queued (JobSpecInput). */
  spec: unknown;
  outDir?: string;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  get version(): number {
    return Number((this.db.prepare('PRAGMA user_version').get() as Row).user_version);
  }

  migrate(): void {
    for (let v = this.version; v < MIGRATIONS.length; v++) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(MIGRATIONS[v]!);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw new Error(`database migration ${v + 1} failed: ${(e as Error).message}`, { cause: e });
      }
    }
  }

  close(): void {
    this.db.close();
  }

  // ───────────── projects ─────────────

  #project(r: Row): Project & { createdAt: string } {
    return {
      id: String(r.id),
      spec: json<JobSpecInput>(r.spec),
      ...(r.brand_kit ? { brandKit: String(r.brand_kit) } : {}),
      updatedAt: String(r.updated_at),
      createdAt: String(r.created_at),
    };
  }

  listProjects(): (Project & { createdAt: string })[] {
    return (this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as Row[]).map((r) => this.#project(r));
  }

  getProject(id: string): Project | undefined {
    const r = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined;
    return r ? this.#project(r) : undefined;
  }

  createProject(p: { id: string; spec: unknown; brandKit?: string | undefined }): Project {
    const t = now();
    this.db
      .prepare('INSERT INTO projects (id, spec, brand_kit, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(p.id, JSON.stringify(p.spec), p.brandKit ?? null, t, t);
    return this.getProject(p.id)!;
  }

  /** `brandKit`: undefined keeps the current kit, null clears it. */
  saveProject(id: string, spec: unknown, brandKit?: string | null): Project | undefined {
    const t = now();
    const res =
      brandKit === undefined
        ? this.db.prepare('UPDATE projects SET spec = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(spec), t, id)
        : this.db.prepare('UPDATE projects SET spec = ?, brand_kit = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(spec), brandKit, t, id);
    return res.changes ? this.getProject(id) : undefined;
  }

  deleteProject(id: string): boolean {
    return this.db.prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0;
  }

  // ───────────── assets ─────────────

  #asset(r: Row): Asset & { ext: string; sha256: string } {
    return {
      id: String(r.id),
      kind: String(r.kind) as AssetKind,
      name: String(r.name),
      url: `/files/assets/${encodeURIComponent(`${r.id}.${r.ext}`)}`,
      bytes: Number(r.bytes),
      meta: json<Record<string, unknown>>(r.meta),
      createdAt: String(r.created_at),
      ext: String(r.ext),
      sha256: String(r.sha256),
    };
  }

  listAssets(kind?: AssetKind): (Asset & { ext: string; sha256: string })[] {
    const rows = kind
      ? this.db.prepare('SELECT * FROM assets WHERE kind = ? ORDER BY created_at DESC').all(kind)
      : this.db.prepare('SELECT * FROM assets ORDER BY created_at DESC').all();
    return (rows as Row[]).map((r) => this.#asset(r));
  }

  getAsset(id: string): (Asset & { ext: string; sha256: string }) | undefined {
    const r = this.db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as Row | undefined;
    return r ? this.#asset(r) : undefined;
  }

  insertAsset(a: { id: string; kind: AssetKind; name: string; ext: string; bytes: number; sha256: string; meta: Record<string, unknown> }) {
    this.db
      .prepare('INSERT INTO assets (id, kind, name, ext, bytes, sha256, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(a.id, a.kind, a.name, a.ext, a.bytes, a.sha256, JSON.stringify(a.meta), now());
    return this.getAsset(a.id)!;
  }

  updateAssetMeta(id: string, meta: Record<string, unknown>): void {
    this.db.prepare('UPDATE assets SET meta = ? WHERE id = ?').run(JSON.stringify(meta), id);
  }

  deleteAsset(id: string): boolean {
    return this.db.prepare('DELETE FROM assets WHERE id = ?').run(id).changes > 0;
  }

  // ───────────── brand kits ─────────────

  #kit(r: Row): BrandKit {
    return {
      id: String(r.id),
      name: String(r.name),
      logos: json<string[]>(r.logos),
      palette: r.palette ? json<BrandKit['palette']>(r.palette) : null,
      fonts: r.fonts ? json<BrandKit['fonts']>(r.fonts) : null,
    };
  }

  listBrandKits(): BrandKit[] {
    return (this.db.prepare('SELECT * FROM brand_kits ORDER BY updated_at DESC').all() as Row[]).map((r) => this.#kit(r));
  }

  getBrandKit(id: string): BrandKit | undefined {
    const r = this.db.prepare('SELECT * FROM brand_kits WHERE id = ?').get(id) as Row | undefined;
    return r ? this.#kit(r) : undefined;
  }

  putBrandKit(k: BrandKit): BrandKit {
    const t = now();
    this.db
      .prepare(
        `INSERT INTO brand_kits (id, name, logos, palette, fonts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, logos = excluded.logos, palette = excluded.palette,
           fonts = excluded.fonts, updated_at = excluded.updated_at`,
      )
      .run(k.id, k.name, JSON.stringify(k.logos), k.palette ? JSON.stringify(k.palette) : null, k.fonts ? JSON.stringify(k.fonts) : null, t, t);
    return this.getBrandKit(k.id)!;
  }

  deleteBrandKit(id: string): boolean {
    return this.db.prepare('DELETE FROM brand_kits WHERE id = ?').run(id).changes > 0;
  }

  // ───────────── renders ─────────────

  #render(r: Row): RenderRow {
    return {
      id: String(r.id),
      projectId: String(r.project_id),
      title: String(r.title),
      quality: String(r.quality) as RenderSummary['quality'],
      formats: json<FormatId[]>(r.formats),
      state: String(r.state) as RenderState,
      progress: Number(r.progress),
      createdAt: String(r.created_at),
      ...(r.finished_at ? { finishedAt: String(r.finished_at) } : {}),
      outputs: json<RenderOutput[]>(r.outputs),
      ...(r.error ? { error: String(r.error) } : {}),
      qa: json<RenderSummary['qa']>(r.qa),
      spec: json<unknown>(r.spec),
      ...(str(r.out_dir) ? { outDir: String(r.out_dir) } : {}),
    };
  }

  insertRender(r: { id: string; projectId: string; title: string; quality: RenderSummary['quality']; formats: FormatId[]; spec: unknown }): RenderRow {
    this.db
      .prepare('INSERT INTO renders (id, project_id, title, quality, formats, spec, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(r.id, r.projectId, r.title, r.quality, JSON.stringify(r.formats), JSON.stringify(r.spec), 'queued', now());
    return this.getRender(r.id)!;
  }

  getRender(id: string): RenderRow | undefined {
    const r = this.db.prepare('SELECT * FROM renders WHERE id = ?').get(id) as Row | undefined;
    return r ? this.#render(r) : undefined;
  }

  /** Newest first; optionally one project's or in given states. */
  listRenders(o: { projectId?: string; states?: RenderState[] } = {}): RenderRow[] {
    const where: string[] = [];
    const args: string[] = [];
    if (o.projectId) {
      where.push('project_id = ?');
      args.push(o.projectId);
    }
    if (o.states) {
      where.push(`state IN (${o.states.map(() => '?').join(', ')})`);
      args.push(...o.states);
    }
    const sql = `SELECT * FROM renders ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, rowid DESC`;
    return (this.db.prepare(sql).all(...args) as Row[]).map((r) => this.#render(r));
  }

  updateRender(
    id: string,
    p: Partial<{ state: RenderState; progress: number; outputs: RenderOutput[]; qa: RenderSummary['qa']; error: string; outDir: string; finished: boolean }>,
  ): RenderRow | undefined {
    const sets: string[] = [];
    const args: (string | number | null)[] = [];
    const set = (col: string, v: string | number | null) => {
      sets.push(`${col} = ?`);
      args.push(v);
    };
    if (p.state !== undefined) set('state', p.state);
    if (p.progress !== undefined) set('progress', p.progress);
    if (p.outputs !== undefined) set('outputs', JSON.stringify(p.outputs));
    if (p.qa !== undefined) set('qa', JSON.stringify(p.qa));
    if (p.error !== undefined) set('error', p.error);
    if (p.outDir !== undefined) set('out_dir', p.outDir);
    if (p.finished) set('finished_at', now());
    if (sets.length) this.db.prepare(`UPDATE renders SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    return this.getRender(id);
  }
}
