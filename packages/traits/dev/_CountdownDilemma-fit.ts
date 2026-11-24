import { readFile } from 'node:fs/promises';
import { JobSpec } from '@reel/core';
import { buildCueSheet } from '../../timing/src/index.ts';
const base = { unitBeats: 1, shortUnitBeats: 0.5, moveBeats: 1, leadIn: 0.2, minTail: 0.6, entry: 0.6, endUnitBeats: 1, endHold: 2.5, introBeats: 0, outroBeats: 0 };
const variants: [string, number, object][] = JSON.parse(process.argv[2]!);
for (const f of ['event-en', 'event-he', 'list', 'stats', 'mixed-niqqud']) {
  const spec = JobSpec.parse(JSON.parse(await readFile(`examples/test-set/${f}.json`, 'utf8')));
  for (const [name, bpm, ch] of variants) {
    try {
      const s = buildCueSheet({ spec, choreography: { ...base, ...ch } as any, bpm, fps: 30 });
      const holds = s.sections.map((x) => (x.timing.holdEnd - x.timing.holdStart).toFixed(2)).join(' ');
      console.log(f, name, 'ok', holds);
    } catch (e) { console.log(f, name, 'FAIL', (e as Error).message); }
  }
}
