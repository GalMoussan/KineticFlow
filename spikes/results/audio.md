# M0e: OfflineAudioContext determinism

**Verdict: PASS WITH CAVEATS.** A single Web Audio graph is *not* bit-deterministic. A **stem-pass mix is
bit-identical** across runs, launches and Chromium builds.

## Measured

Graph: 26 s at 48 kHz, stereo, 100 bpm. It contains:
- a sine kick with exponential pitch/gain ramps
- seeded-noise hats → highpass biquad → stereo panner
- a decoded WAV pluck at varying `playbackRate`
- a decoded MP3 track → lowpass
- a ConvolverNode reverb (seeded 1.8 s impulse)
- a DynamicsCompressor

| Test | Result |
|---|---|
| Single graph, 2 renders × 5 launches (shell, shell, shell-nogpu, system Chrome 157, headed) | **10 distinct hashes** (float and 16-bit PCM both differ) |
| Drift size between two single-graph renders | max \|Δ\| = 1.8e-7 (**≈ −133 dBFS**, inaudible); ~400k of 2.5M samples differ |
| Bisection, 4 renders each | Each instrument alone: 1 hash. Pluck + reverb: 1. Kick + compressor: 1. Any mix where **several sources overlap at one node input**: 4 hashes |
| Stem passes + JS sum + bus passes, 8 renders over 4 launches (shell ×2, Chrome 157, shell-nogpu) | **1 hash** (`02598ea05f36e367…`), even across Chromium 159 and Chrome 157 |
| Offline render time | single graph ≈ 0.86–0.95 s; stem pipeline ≈ 1.95–2.06 s (26 s of audio) |
| Length exactness | `length = 26·48000 = 1 248 000` samples; the exported WAV probes at `26.000000` s |
| Seed sanity | seed 7 → different hash |

**Cause [INFERENCE from the bisection]:** Chromium sums the connections at a node input in a non-fixed order, and
float addition is not associative. A single source, or sources that never overlap in time, sum exactly.

## Reproduce
```
cd spikes && node audio/run.ts      # single graph across launch modes, WAV export → out/graph.wav
node audio/bisect.ts                # which components break determinism
node audio/stems.ts                 # stem-pass mix: hash stability across launches
```

## Recommendation for `packages/audio`
1. **Preview** (real-time `AudioContext`) uses the plain single graph. Drift is ~−133 dBFS, so the preview is
   audibly identical to the render.
2. **Render** uses a **pass DAG**:
   - each instrument/voice group renders alone in its own `OfflineAudioContext`
   - stems are summed in JS in a fixed order with fixed gains
   - every bus effect (reverb send, master compressor, limiter) runs as its own pass with one `AudioBufferSourceNode`
     input
   
   The same graph-builder functions serve both paths. The builder takes a `{ only: group }` filter.
3. **Rule for preset authors:** voices *within* one group may overlap only if the group is a single chain fed by one
   source. Otherwise split them into separate groups. Add a determinism check that renders twice and compares hashes.
   It costs about 2 s and belongs in the QA gates.
4. Loudness normalisation (`loudnorm`) and AAC encoding stay in ffmpeg after the deterministic WAV.
