// Spike M0a: GPU-heavy page (fullscreen 6-octave fbm domain-warp shader + DOM type with glow) as a pure function of t.
(() => {
  const W = window.REEL_W || 1080, H = window.REEL_H || 1920;
  const canvas = document.getElementById('gl');
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
  const vs = `#version 300 es
  in vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`;
  const fs = `#version 300 es
  precision highp float; uniform float t; uniform vec2 res; out vec4 o;
  float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
  float fbm(vec2 p){ float v = 0., a = .5; for (int k = 0; k < 6; k++) { v += a*n(p); p *= 2.03; a *= .5; } return v; }
  void main(){ vec2 uv = gl_FragCoord.xy / res.y * 3.;
    vec2 q = vec2(fbm(uv + t*.2), fbm(uv + vec2(5.2, 1.3) - t*.15));
    float f = fbm(uv + 4.*q + t*.1);
    o = vec4(mix(vec3(.95,.3,.5), vec3(.1,.5,.55), f) * (.6 + .6*q.x), 1.); }`;
  const prog = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(prog, s);
  }
  gl.linkProgram(prog); gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uT = gl.getUniformLocation(prog, 't'); gl.uniform2f(gl.getUniformLocation(prog, 'res'), W, H);

  const words = [...document.querySelectorAll('.w')];
  const fontReady = new FontFace('Rubik', 'url(fonts/Rubik.ttf)', { weight: '300 900' }).load().then((f) => document.fonts.add(f));
  const OFFSET = window.REEL_OFFSET || 0;
  window.openkatanaPage = {
    width: W, height: H, fps: 30, frames: window.REEL_FRAMES || 390,
    async render(tLocal) {
      const t = tLocal + OFFSET;
      await fontReady;
      gl.viewport(0, 0, W, H); gl.uniform1f(uT, t); gl.drawArrays(gl.TRIANGLES, 0, 3);
      words.forEach((w, i) => {
        const k = Math.max(0, Math.min(1, (t - i * 0.6) / 0.5));
        const e = 1 - Math.pow(2, -10 * k);
        w.style.transform = `translateY(${(1 - e) * 300}px) rotate(${Math.sin(t * 2 + i) * 4}deg) scale(${0.6 + 0.4 * e})`;
        w.style.opacity = String(k);
        w.style.fontVariationSettings = `'wght' ${300 + 600 * (0.5 + 0.5 * Math.sin(t * 3 + i))}`;
      });
      await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    },
  };
})();
