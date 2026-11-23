/**
 * The sample kit (PLAN.md §11): CC0 one-shots from stargatedaw/stargate-sample-pack, pinned to one commit. Three
 * drum kits (lo-fi/acoustic `lofi-*`, electronic/808 `e-*` + `808-kick`, pop `pop-*`), percussion and FX hits.
 * `reelgen setup samples` downloads them into `assets/samples/<id>.wav` and checks the SHA-256 of the file bytes.
 * `gainDb` peak-normalises each file (0 dBFS); `trim.start` removes leading silence so hits land on their sample.
 */
import { dbToGain } from './dmath.ts';
import type { SampleBank, SampleEntry, Stereo } from './types.ts';

const COMMIT = 'dbfd6ec52d4ed53b60bdbea5fc6adf295127c027';
const BASE = `https://raw.githubusercontent.com/stargatedaw/stargate-sample-pack/${COMMIT}/stargate-sample-pack/`;

function pack(id: string, path: string, sha256: string, gainDb = 0, trim?: SampleEntry['trim']): SampleEntry {
  return {
    id,
    url: BASE + path.split('/').map(encodeURIComponent).join('/'),
    sha256,
    license: 'CC0-1.0',
    source: `stargatedaw/stargate-sample-pack@${COMMIT.slice(0, 7)}:stargate-sample-pack/${path}`,
    ...(gainDb ? { gainDb } : {}),
    ...(trim ? { trim } : {}),
  };
}

export const SAMPLE_MANIFEST: SampleEntry[] = [
  pack('lofi-kick', 'karoryfer/kicks/kick_Szpaderski_24_dampened.wav', 'ac4da8e7ac947578637264b561152a99b2bab05fdd6a2aa824d279b65a0d6d05', 0.2),
  pack('lofi-snare', 'freesound/drums/snare/212211__alexthegr81__tapesnare-18.wav', 'b27935c89f2e38db9bcdda1b8f367081a1bfda4aba9f41ad1b8483df7b7ff979', 0.2),
  pack('lofi-rim', 'sgossner/VCSL/Membranophones/Snare Drum, Modern 3/Snare4_Xstick_v2_rr1_Mid.wav', '547988ba9c75ac4cb54222c240f0ee56f6224b0578fa87a044e182b9cfd8c135', 27.9, { start: 0.0125 }),
  pack('lofi-brush', 'sgossner/VCSL/Membranophones/Snare Drum, Modern 3/Snare4_taps_v4_rr1_Mid.wav', '7435b05a02cc71e791709e83c1550194ef8f932a6025df30f46903b7b75b9a33', 19.8, { start: 0.0073 }),
  pack('lofi-hat', 'karoryfer/hihats/hihat_BRD_tight.wav', 'e41a734cf0b8994c9202e7839fc2d7f8f57799395e7a2b235518bc6f3225b1d8', 1.1),
  pack('lofi-hat-open', 'karoryfer/hihats/hihat_BRD_open.wav', '0a36e768b9161cea7f2fcb89ffc1792f7676d75469bf03b71ef92b15d4b68298', 0, { end: 1.6 }),
  pack('lofi-ride', 'karoryfer/cymbals/ride_BRD_22.wav', 'e272f70a76ec3ce7ad90168fa068fe2bfb112862edcd793bed8a0fc5196bb3ba', 0, { end: 2.5 }),
  pack('shaker', 'fugue-state-audio/drums/percussion/x0xproc2-maracas.wav', '4730d893f35c3699f0d1a3b3cf379d11353a23bd42c3c4758e864bb358599bd4', 0.7),
  pack('conga', 'sgossner/VCSL/Membranophones/Conga/Conga_HitN_v2_rr1_Sum.wav', '13d322c0e7a830cdbcbdc5a6e05566dfe3f5a073b7b82a3262d3f6fc10f96764', 20.2),
  pack('808-kick', 'fugue-state-audio/drums/kicks/x0xproc2-kick.wav', '1a60f67895ae09f6a7bef418d0ec6dfc2f4c5b25123d55988cef2195a90a4694', 1),
  pack('e-kick', 'fugue-state-audio/drums/kicks/x0xproc1-kick.wav', 'debd64498f2912701f9d7b1948a00840a5ca3ee424111945d2be5601c7cf735e', 1),
  pack('e-snare', 'fugue-state-audio/drums/snares/x0xproc1-snare.wav', '5c5b35d9565e53500a6bc5524ab1d4f249fe3d91878b1d1c103d95c87acdfe6b', 1),
  pack('e-clap', 'fugue-state-audio/drums/claps/x0xproc1-clap.wav', 'dcd9ccb8d2f860deadd57f82206f9621d24ce1d0db8020842f609a889e236965', 1),
  pack('e-hat', 'fugue-state-audio/drums/hihats/x0xproc1-hatclsd.wav', 'a43d2df5a21845c5256fb09ff3f1b97105514ef18b2a57bbc33d80c8892efc11', 1),
  pack('e-hat-open', 'fugue-state-audio/drums/hihats/x0xproc1-hatopen.wav', 'c6a17e715380911a708f6a2ce9b15dea5eac78a3a2ffc89404dfd04aef9e1c05', 1),
  pack('e-crash', 'fugue-state-audio/drums/cymbals/x0xproc1-crash.wav', 'df1f91e5bdc418a2d9441385ca12e9e1e9703992e5c3d1b1e9f9eca88878301f', 1),
  pack('e-rim', 'fugue-state-audio/drums/percussion/x0xproc1-rimshot.wav', 'eb6206d6b5a510121f45091fa7a5b87a5c968c0db97fa514c05cee1ba62b5413', 1),
  pack('e-ride', 'fugue-state-audio/drums/cymbals/x0xproc1-ride.wav', '2bfd5db6fdc170f9282d718a462f8eeb206a9644e9aca74dcde4ac6f1b891bc3', 1),
  pack('pop-kick', 'stargate/kicks/kick-1-A.wav', '8e2beaa2f050289bdf925699a38d3ad63f1a57eb214daa1f06ab06a4b437aef6', 4),
  pack('pop-snare', 'freesound/drums/snare/501249__veiler__brian-snare-loud.wav', 'b5451d19d7a2f20ffc4b0a92d3d57c887237d8a4dd796e741482962aa085c104'),
  pack('pop-clap', 'freesound/drums/clap/493707__bastianpusch__handclap01.wav', '9be7f695ceb6d9aa0289c9c683f9184d4fd6c87416b1c27c583ef6eb33cf760f', 8.6),
  pack('pop-hat', 'freesound/drums/cymbal/closed/439766__twentytwentymusic__electronic-closed-hat-9.wav', 'a48ab57d2d8c228f3cff35f3c35e034e7bc548755402f173d80ec733d6f58ba2', 5.6),
  pack('pop-hat-open', 'fugue-state-audio/drums/hihats/x0xproc2-hatopen.wav', '2d60e6765c607af31a6e246c248f446cbefead8610be88a20bb61630584b8aa6', 1),
  pack('pop-crash', 'freesound/drums/cymbal/crash/261413__veiler__crash.wav', 'b79b3c0de4b1c1c1601a2d91441fd5f9f5f0f104cfdc21ba7a35e44474cd1d2f', 7.8),
  pack('pop-rim', 'freesound/drums/rimshot/455640__uberproduktion__fd808a-rimshot.wav', '60d51e18ab1d2f06a04dde5c60b472d4358e974b5d20abce043a8ea42d2bf556'),
  pack('fx-glass', 'fugue-state-audio/found-sounds/glass-hit.wav', 'bd6c8adbeb5c6f903fc16f4f6ae9e642ef87deda96613e5bad8f842fbc1bb4ee', 1),
  pack('fx-bowl', 'fugue-state-audio/found-sounds/bowlhit.wav', '8ca69b42bedb23e937f31e27ba3f7c7e18579d6eeacb2cbfdbb09c328e8ab8c2', 1),
  pack('fx-cymbal', 'freesound/drums/cymbal/crash/140153__stomachache__analog-cymbal.wav', '69d87a29aa40c9da701feff04b321d974cc75bcb559a9edbf8f63be98ccb8919', 0.1),
];

const ENTRIES = new Map(SAMPLE_MANIFEST.map((e) => [e.id, e]));
const prepared = new WeakMap<SampleBank, Map<string, Stereo>>();

/**
 * Looks up a one-shot with its manifest gain and trim applied (cached per bank). Throws a setup hint when the bank
 * does not have it.
 */
export function kitSample(bank: SampleBank, id: string): Stereo {
  let cache = prepared.get(bank);
  if (!cache) prepared.set(bank, (cache = new Map()));
  const hit = cache.get(id);
  if (hit) return hit;
  const entry = ENTRIES.get(id);
  const raw = bank.get(id);
  if (!raw) throw new Error(`sample "${id}" is not loaded${entry ? ' (run `reelgen setup samples`)' : ' and is not in SAMPLE_MANIFEST'}`);
  const sr = raw.sampleRate;
  const from = Math.min(raw.l.length, Math.round((entry?.trim?.start ?? 0) * sr));
  const to = Math.min(raw.l.length, entry?.trim?.end !== undefined ? Math.round(entry.trim.end * sr) : raw.l.length);
  const fade = entry?.trim?.end !== undefined ? Math.min(to - from, Math.round(0.01 * sr)) : 0;
  const g = dbToGain(entry?.gainDb ?? 0);
  const l = new Float32Array(Math.max(0, to - from));
  const r = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) {
    const f = i >= l.length - fade ? (l.length - i) / fade : 1;
    l[i] = raw.l[from + i]! * g * f;
    r[i] = raw.r[from + i]! * g * f;
  }
  const out = { l, r, sampleRate: sr };
  cache.set(id, out);
  return out;
}
