/** One shared `AudioContext` for previews, samples and waveform decoding. */
let ctx: AudioContext | null = null;

export function audioContext(): AudioContext {
  ctx ??= new AudioContext({ latencyHint: 'interactive' });
  return ctx;
}

const decoded = new Map<string, Promise<AudioBuffer>>();

export function decodeUrl(url: string): Promise<AudioBuffer> {
  let p = decoded.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`audio ${r.status}`);
        return r.arrayBuffer();
      })
      .then((b) => audioContext().decodeAudioData(b));
    p.catch(() => decoded.delete(url));
    decoded.set(url, p);
  }
  return p;
}

/** Peak envelope (max |sample| per column) over both channels. */
export function peaks(buf: AudioBuffer, columns: number): Float32Array {
  const out = new Float32Array(columns);
  const per = Math.max(1, Math.floor(buf.length / columns));
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let c = 0; c < columns; c++) {
      let m = out[c]!;
      const end = Math.min(d.length, (c + 1) * per);
      for (let i = c * per; i < end; i += 4) {
        const v = Math.abs(d[i]!);
        if (v > m) m = v;
      }
      out[c] = m;
    }
  }
  return out;
}
