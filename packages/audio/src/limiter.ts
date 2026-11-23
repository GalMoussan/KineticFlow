/**
 * Deterministic look-ahead peak limiter for the master bus. Browser-safe, no transcendental Math, so it is
 * bit-identical everywhere. Lowers the crest factor so ffmpeg `loudnorm` can normalise linearly (PLAN.md §8.2).
 */

export interface LimitOptions {
  /** Ceiling as a fraction of the input's peak (e.g. 0.63 ≈ −4 dB of peak reduction). */
  ceiling: number;
  /** Look-ahead (= attack) in seconds. */
  lookahead: number;
  /** Time for the gain to recover from full reduction to unity, in seconds (linear ramp). */
  release: number;
}

/**
 * Limits interleaved stereo `mix` in place (linked channels) so no sample exceeds `ceiling · peak(mix)`.
 * Gain: per-frame target → linear release → sliding minimum over the look-ahead → moving average over the
 * look-ahead. The min-then-average pair guarantees the gain at every frame is ≤ its target, with a smooth attack.
 */
export function limit(mix: Float64Array, sampleRate: number, o: LimitOptions): void {
  const frames = mix.length >> 1;
  let peak = 0;
  for (let i = 0; i < mix.length; i++) peak = Math.max(peak, Math.abs(mix[i]!));
  if (peak === 0 || o.ceiling >= 1) return;
  const ceil = peak * o.ceiling;
  const W = Math.max(1, Math.round(o.lookahead * sampleRate));
  const rise = 1 / Math.max(1, Math.round(o.release * sampleRate));

  // Required gain per frame.
  const g = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    const a = Math.max(Math.abs(mix[2 * i]!), Math.abs(mix[2 * i + 1]!));
    g[i] = a > ceil ? ceil / a : 1;
  }
  // Sliding minimum over [i, i + W) (monotonic deque), so the gain starts dropping W frames before a peak.
  const m = new Float64Array(frames);
  const dq = new Int32Array(frames);
  let head = 0;
  let tail = 0;
  for (let j = frames - 1; j >= 0; j--) {
    while (tail > head && g[dq[tail - 1]!]! >= g[j]!) tail--;
    dq[tail++] = j;
    while (dq[head]! >= j + W) head++;
    m[j] = g[dq[head]!]!;
  }
  // Linear release: the gain may fall instantly but rises at most `rise` per frame.
  for (let i = 1; i < frames; i++) m[i] = Math.min(m[i]!, m[i - 1]! + rise);
  // Moving average over [i − W + 1, i]: smooth attack; still ≤ target because m ≤ g[i] on the whole window.
  let sum = 0;
  for (let i = 0; i < frames; i++) {
    sum += m[i]!;
    if (i >= W) sum -= m[i - W]!;
    const gain = sum / Math.min(i + 1, W);
    mix[2 * i]! *= gain;
    mix[2 * i + 1]! *= gain;
  }
}
