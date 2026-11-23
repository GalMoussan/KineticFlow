// Spike M0e: a production-like Web Audio graph rendered offline. Everything random comes from a seeded PRNG.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function load(ctx, url) {
  return ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
}

/** Builds the full graph on `ctx` (offline or real-time), 26 s, 100 bpm. */
export async function build(ctx, { seed = 1101, withTrack = true, off = [] } = {}) {
  const rnd = mulberry32(seed);
  const sr = ctx.sampleRate;
  const beat = 60 / 100;
  const T0 = 0.5;

  // bus: compressor -> master gain -> destination; reverb send via convolver with seeded impulse
  const comp = off.includes('comp')
    ? new GainNode(ctx, { gain: 1 })
    : new DynamicsCompressorNode(ctx, { threshold: -18, ratio: 4, attack: 0.003, release: 0.2 });
  const master = new GainNode(ctx, { gain: 0.8 });
  comp.connect(master).connect(ctx.destination);
  const ir = ctx.createBuffer(2, Math.round(sr * 1.8), sr);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / d.length, 3);
  }
  const reverb = new ConvolverNode(ctx, { buffer: ir });
  const send = new GainNode(ctx, { gain: 0.25 });
  if (!off.includes('reverb')) send.connect(reverb).connect(comp);

  // noise buffer (hats/snare), seeded
  const noise = ctx.createBuffer(1, sr, sr);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = rnd() * 2 - 1;

  const pluck = await load(ctx, 'pluck.wav');

  const bars = Math.floor((26 - T0) / (4 * beat));
  for (let b = 0; b < bars * 4; b++) {
    const t = T0 + b * beat;
    // kick: pitched-down sine
    const k = new OscillatorNode(ctx, { type: 'sine', frequency: 120 });
    k.frequency.setValueAtTime(120, t);
    k.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    const kg = new GainNode(ctx, { gain: 0 });
    kg.gain.setValueAtTime(0.9, t);
    kg.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    k.connect(kg).connect(comp);
    if (!off.includes('kick')) {
      k.start(t);
      k.stop(t + 0.32);
    }
    // hat: band-passed noise on the swung offbeat
    const h = new AudioBufferSourceNode(ctx, { buffer: noise });
    const hf = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 7000, Q: 0.7 });
    const hg = new GainNode(ctx, { gain: 0 });
    const ht = t + beat * 0.58;
    hg.gain.setValueAtTime(0.25, ht);
    hg.gain.exponentialRampToValueAtTime(0.001, ht + 0.06);
    const hp = new StereoPannerNode(ctx, { pan: rnd() * 0.6 - 0.3 });
    h.connect(hf).connect(hg).connect(hp).connect(comp);
    const hatOffset = rnd() * 0.5;
    if (!off.includes('hats')) h.start(ht, hatOffset, 0.08);
    // sample pluck, pitched by playbackRate, every other beat, into reverb too
    if (b % 2 === 0) {
      const s = new AudioBufferSourceNode(ctx, { buffer: pluck, playbackRate: [1, 1.25, 1.5, 2][b % 4 === 0 ? 0 : 2] });
      const sg = new GainNode(ctx, { gain: 0.4 });
      s.connect(sg);
      sg.connect(comp);
      sg.connect(send);
      if (!off.includes('pluck')) s.start(t);
    }
  }
  if (withTrack) {
    const track = new AudioBufferSourceNode(ctx, { buffer: await load(ctx, 'track.mp3') });
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 2500 });
    const tg = new GainNode(ctx, { gain: 0.3 });
    track.connect(lp).connect(tg).connect(comp);
    track.start(0);
  }
}

async function sha(buffers) {
  const parts = buffers.map((b) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (all.set(p, o), (o += p.length));
  const h = await crypto.subtle.digest('SHA-256', all);
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

window.renderOffline = async (opts = {}) => {
  const sampleRate = 48000;
  const duration = 26;
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: duration * sampleRate, sampleRate });
  const t0 = performance.now();
  await build(ctx, opts);
  const out = await ctx.startRendering();
  const ms = performance.now() - t0;
  const chans = [out.getChannelData(0), out.getChannelData(1)];
  let peak = 0;
  for (const c of chans) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
  // 16-bit PCM WAV for the export path
  const pcm = new Int16Array(out.length * 2);
  for (let i = 0; i < out.length; i++)
    for (let c = 0; c < 2; c++) pcm[i * 2 + c] = Math.max(-32768, Math.min(32767, Math.round(chans[c][i] * 32767)));
  return {
    ms: Math.round(ms),
    length: out.length,
    seconds: out.length / sampleRate,
    peak,
    floatHash: await sha(chans),
    pcmHash: await sha([pcm]),
    pcm: opts.returnPcm ? toBase64(new Uint8Array(pcm.buffer)) : undefined,
  };
};
