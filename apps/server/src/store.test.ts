import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { MIGRATIONS, Store } from './store.ts';

const dir = mkdtempSync(join(tmpdir(), 'reel-store-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('migrations run once and set user_version', () => {
  const path = join(dir, 'm.db');
  const a = new Store(path);
  assert.equal(a.version, MIGRATIONS.length);
  a.createProject({ id: 'p1', spec: { id: 'x' } });
  a.close();
  // reopening does not re-run migrations (they would fail on existing tables) and keeps the data
  const b = new Store(path);
  assert.equal(b.version, MIGRATIONS.length);
  assert.equal(b.getProject('p1')?.spec.id, 'x');
  b.close();
});

test('projects CRUD', () => {
  const s = new Store(':memory:');
  const p = s.createProject({ id: 'p1', spec: { id: 'a', sections: [] }, brandKit: 'kit' });
  assert.equal(p.brandKit, 'kit');
  assert.ok(s.saveProject('p1', { id: 'b' }));
  assert.equal(s.getProject('p1')?.brandKit, 'kit', 'undefined keeps the kit');
  s.saveProject('p1', { id: 'c' }, null);
  assert.equal(s.getProject('p1')?.brandKit, undefined, 'null clears the kit');
  assert.equal(s.saveProject('nope', {}), undefined);
  s.createProject({ id: 'p2', spec: {} });
  assert.deepEqual(new Set(s.listProjects().map((x) => x.id)), new Set(['p1', 'p2']));
  assert.ok(s.deleteProject('p1'));
  assert.ok(!s.deleteProject('p1'));
  assert.equal(s.getProject('p1'), undefined);
});

test('assets, brand kits and renders', () => {
  const s = new Store(':memory:');
  const a = s.insertAsset({ id: 'logo-a', kind: 'logo', name: 'Logo A', ext: 'png', bytes: 10, sha256: 'x', meta: { w: 1, h: 2 } });
  assert.equal(a.url, '/files/assets/logo-a.png');
  s.insertAsset({ id: 'font-a', kind: 'font', name: 'F', ext: 'ttf', bytes: 5, sha256: 'y', meta: {} });
  assert.deepEqual(s.listAssets('logo').map((x) => x.id), ['logo-a']);
  assert.equal(s.listAssets().length, 2);
  s.updateAssetMeta('logo-a', { w: 3 });
  assert.deepEqual(s.getAsset('logo-a')?.meta, { w: 3 });
  assert.ok(s.deleteAsset('logo-a'));

  const kit = s.putBrandKit({ id: 'k', name: 'Kit', logos: ['a'], palette: { bg: '#000000', text: '#ffffff', accents: ['#ff0000'] }, fonts: null });
  assert.deepEqual(kit.palette?.accents, ['#ff0000']);
  s.putBrandKit({ ...kit, name: 'Kit 2' });
  assert.equal(s.getBrandKit('k')?.name, 'Kit 2');
  assert.equal(s.listBrandKits().length, 1);
  assert.ok(s.deleteBrandKit('k'));

  const r = s.insertRender({ id: 'r1', projectId: 'p', title: 'T', quality: 'draft', formats: ['1:1'], spec: { id: 's' } });
  assert.equal(r.state, 'queued');
  s.insertRender({ id: 'r2', projectId: 'q', title: 'T', quality: 'final', formats: ['9:16', '1:1'], spec: {} });
  s.updateRender('r1', { state: 'done', progress: 1, outputs: [{ format: '1:1', video: '/v', thumbnail: '/t', bytes: 1 }], qa: [{ gate: 'g', level: 'pass', detail: '' }], outDir: '/o', finished: true });
  const done = s.getRender('r1')!;
  assert.equal(done.state, 'done');
  assert.ok(done.finishedAt);
  assert.equal(done.outDir, '/o');
  assert.equal(done.outputs[0]?.video, '/v');
  assert.deepEqual(s.listRenders({ projectId: 'p' }).map((x) => x.id), ['r1']);
  assert.deepEqual(s.listRenders({ states: ['queued'] }).map((x) => x.id), ['r2']);
});
