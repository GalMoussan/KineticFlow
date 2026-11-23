// Spike M0e step 3: deterministic mixing by stems. Each pass has non-overlapping sources only; sums happen in JS
// in a fixed order; bus processing (reverb, compressor) runs as its own pass with a single buffer source.
import { build } from './graph.js';

const SR = 48000;
const LEN = 26 * SR;

async function pass(fill) {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: LEN, sampleRate: SR });
  await fill(ctx);
  const out = await ctx.startRendering();
  return [out.getChannelData(0), out.getChannelData(1)];
}

/** Renders one instrument group of the reference graph with the bus nodes bypassed. */
const group = (keep, withTrack = false) =>
  pass((ctx) => build(ctx, { withTrack, off: ['kick', 'hats', 'pluck', 'reverb', 'comp'].filter((x) => !keep.includes(x)) }));

function sum(stems, gains) {
  const out = [new Float32Array(LEN), new Float32Array(LEN)];
  for (let c = 0; c < 2; c++)
    for (let s = 0; s < stems.length; s++) {
      const src = stems[s][c];
      const g = gains[s];
      const dst = out[c];
      for (let i = 0; i < LEN; i++) dst[i] += src[i] * g;
    }
  return out;
}

function bufferFrom(ctx, chans) {
  const b = ctx.createBuffer(2, LEN, SR);
  b.copyToChannel(chans[0], 0);
  b.copyToChannel(chans[1], 1);
  return b;
}

async function sha(chans) {
  const all = new Uint8Array(chans.reduce((n, c) => n + c.byteLength, 0));
  let o = 0;
  for (const c of chans) (all.set(new Uint8Array(c.buffer, c.byteOffset, c.byteLength), o), (o += c.byteLength));
  const h = await crypto.subtle.digest('SHA-256', all);
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

window.renderStems = async () => {
  const t0 = performance.now();
  const kick = await group(['kick']);
  const hats = await group(['hats']);
  const pluck = await group(['pluck']);
  const track = await group([], true);
  // reverb send: pluck * 0.25 through the convolver with the same seeded impulse, as its own pass
  const reverbIn = sum([pluck], [0.25]);
  const wet = await pass(async (ctx) => {
    const rnd = (() => { let a = 1101 >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
    const ir = ctx.createBuffer(2, Math.round(SR * 1.8), SR);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / d.length, 3); }
    const src = new AudioBufferSourceNode(ctx, { buffer: bufferFrom(ctx, reverbIn) });
    src.connect(new ConvolverNode(ctx, { buffer: ir })).connect(ctx.destination);
    src.start(0);
  });
  const dry = sum([kick, hats, pluck, track, wet], [1, 1, 1, 1, 1]);
  const master = await pass(async (ctx) => {
    const src = new AudioBufferSourceNode(ctx, { buffer: bufferFrom(ctx, dry) });
    const comp = new DynamicsCompressorNode(ctx, { threshold: -18, ratio: 4, attack: 0.003, release: 0.2 });
    src.connect(comp).connect(new GainNode(ctx, { gain: 0.8 })).connect(ctx.destination);
    src.start(0);
  });
  return { ms: Math.round(performance.now() - t0), hash: await sha(master) };
};

/** Max |a-b| between two renders of the reference (single-graph) mix, to size the nondeterminism. */
window.diffReference = async () => {
  const a = await pass((ctx) => build(ctx, {}));
  const b = await pass((ctx) => build(ctx, {}));
  let max = 0;
  let count = 0;
  for (let c = 0; c < 2; c++)
    for (let i = 0; i < LEN; i++) {
      const d = Math.abs(a[c][i] - b[c][i]);
      if (d > 0) count++;
      if (d > max) max = d;
    }
  return { maxAbsDiff: max, dBFS: 20 * Math.log10(max || 1e-30), differingSamples: count };
};
window.stemsReady = true;
