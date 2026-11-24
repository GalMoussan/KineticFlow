import { readFileSync } from 'node:fs';
import { JobSpec } from '@reel/core';
import { buildCueSheet } from '../../timing/src/index.ts';
import { recipe } from '../../styles/src/index.ts';
const [specPath, styleId, bpmArg] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(specPath!, 'utf8'));
const rec = recipe(styleId!);
const bpm = Number(bpmArg ?? rec.defaults.music.bpm);
const spec = JobSpec.parse({ ...raw, style: styleId });
const sheet = buildCueSheet({ spec, choreography: rec.choreography, bpm, fps: 30 });
console.log('duration', sheet.duration, 'bpm', bpm);
for (const s of sheet.sections) {
  const t = s.timing;
  console.log(s.id.padEnd(12), s.role.padEnd(9), `in ${t.in.toFixed(2)} land ${t.firstLand.toFixed(2)}-${t.lastLand.toFixed(2)} hold ${t.holdStart.toFixed(2)}-${t.holdEnd.toFixed(2)} out ${t.out.toFixed(2)}`, s.items.map((i) => i.at.toFixed(2)).join(' '));
}
