/**
 * On-disk layout owned by the server: `data/reel.db` (SQLite), `data/assets/<id>.<ext>` (uploads),
 * `data/projects/<id>/` (materialised job dirs: spec + `assets/` symlinks), `data/preview/` (bundles, WAVs, stills),
 * `out/<job-id>/` (render outputs, served under `/files/out/`).
 */
import { join } from 'node:path';
import { DATA_DIR, OUT_DIR, REPO } from '@reel/render';

export { DATA_DIR, OUT_DIR, REPO };

/** Overridable for tests: `REEL_DATA_DIR` moves the database, assets, projects and preview caches. */
export interface Paths {
  /** Root of everything below; also the spec dir of previews and validation (`<data>/assets/<id>.<ext>`). */
  data: string;
  db: string;
  assets: string;
  projects: string;
  /** Preview bundles, music/mix WAVs and style stills. */
  preview: string;
  /** Temp dirs of preflight checks. */
  checks: string;
  out: string;
  web: string;
}

export function paths(data = process.env.REEL_DATA_DIR ?? DATA_DIR, out = process.env.REEL_OUT_DIR ?? OUT_DIR): Paths {
  return {
    data,
    db: join(data, 'reel.db'),
    assets: join(data, 'assets'),
    projects: join(data, 'projects'),
    preview: join(data, 'preview'),
    checks: join(data, 'checks'),
    out,
    web: join(REPO, 'apps/web/dist'),
  };
}
