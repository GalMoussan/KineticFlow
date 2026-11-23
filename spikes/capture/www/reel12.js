// Dilemma Cafe reel #12 — kinetic Swiss/Bauhaus title reveal.
// Solid palette panels wipe across a navy base on the beat (120 bpm, beats on every 0.5 s) and reveal
// the Hebrew copy through line masks. Pure function of t: every style is rewritten on every frame.
(() => {
  const W = 1080, H = 1920, FPS = 30, DUR = 26;
  const OFFSET = window.REEL_OFFSET || 0, FRAMES = window.REEL_FRAMES || DUR * FPS;
  const BEAT = 0.5, T0 = 0.5;
  const C = { pink: '#F2849E', teal: '#2A8C8C', navy: '#1B2A4A', sage: '#A3B18A', cream: '#F5EBDD', peach: '#F4A37C', deep: '#E8794A' };

  const fontReady = new FontFace('Rubik', 'url(fonts/Rubik.ttf)', { weight: '300 900' })
    .load().then(f => { document.fonts.add(f); return document.fonts.ready; });

  // ---------- math ----------
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const prog = (t, a, d) => clamp01((t - a) / d);
  const expo = k => k >= 1 ? 1 : 1 - Math.pow(2, -10 * k);
  const expoIn = k => k <= 0 ? 0 : Math.pow(2, 10 * k - 10);
  const expoInOut = k => k <= 0 ? 0 : k >= 1 ? 1 : k < 0.5 ? Math.pow(2, 20 * k - 10) / 2 : (2 - Math.pow(2, -20 * k + 10)) / 2;
  const backOut = (k, c = 1.7) => k >= 1 ? 1 : 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);
  const quart = k => 1 - Math.pow(1 - k, 4);
  const hash = n => { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
  const beatPulse = t => t < T0 ? 0 : Math.exp(-((t - T0) % BEAT) * 10);
  const px = v => v.toFixed(1) + 'px';
  const blurF = b => b > 0.3 ? `blur(${b.toFixed(1)}px)` : 'none';

  // ---------- DOM helpers ----------
  const stage = document.getElementById('stage');
  function mk(tag, cls, parent, css) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (css) Object.assign(e.style, css);
    if (parent) parent.appendChild(e);
    return e;
  }
  function fillChars(parent, text) {
    const chars = [];
    for (const c of Array.from(text)) {
      if (c === ' ') { mk('span', 'sp', parent); continue; }
      const s = mk('span', 'ch', parent); s.textContent = c; chars.push(s);
    }
    return chars;
  }
  // A masked text line. y = visual centre of the glyph box; align r/l use margin x, c spans the full width.
  function place(m, o) {
    m.style.fontSize = o.size + 'px';
    m.style.top = px(o.y - o.size * 0.64);
    if (o.align === 'c') { m.style.left = '0'; m.style.right = '0'; m.style.textAlign = 'center'; }
    else if (o.align === 'l') m.style.left = px(o.x ?? 80);
    else m.style.right = px(o.x ?? 80);
    if (o.bg) m.style.background = o.bg;
    if (o.padX) { m.style.paddingLeft = o.padX + 'em'; m.style.paddingRight = o.padX + 'em'; }
  }
  function line(parent, text, o) {
    const m = mk('div', 'mask', parent); place(m, o);
    const inner = mk('div', 'inner' + (o.ltr ? ' ltr' : ''), m, { color: o.color });
    return { m, inner, chars: fillChars(inner, text), o };
  }
  // odometer line: digits spin inside their own column masks
  function counter(parent, text, o) {
    const m = mk('div', 'mask', parent); place(m, o);
    const inner = mk('div', 'inner ltr', m, { color: o.color, lineHeight: '1.1' });
    const chars = [], cols = [];
    Array.from(text).forEach(c => {
      if (/[0-9]/.test(c)) {
        const col = mk('span', 'col', inner), strip = mk('span', 'strip', col);
        const d = +c, n = 14 + cols.length * 3;
        for (let k = 0; k <= n; k++) mk('span', null, strip).textContent = String(((d - n + k) % 10 + 10) % 10);
        cols.push({ col, strip, n }); chars.push(col);
      } else { const s = mk('span', 'ch', inner, { lineHeight: '1.1' }); s.textContent = c; chars.push(s); }
    });
    return { m, inner, chars, cols, o };
  }
  function circle(parent, cx, cy, r, css) {
    return mk('div', 'circle', parent, { left: px(cx - r), top: px(cy - r), width: px(2 * r), height: px(2 * r), ...css });
  }
  function half(parent, cx, cy, r, color, css) { // flat edge at the bottom, rotate for other orientations
    return mk('div', 'abs', parent, { left: px(cx - r), top: px(cy - r), width: px(2 * r), height: px(r), background: color,
      borderRadius: `${r}px ${r}px 0 0`, transformOrigin: '50% 100%', ...css });
  }
  function stripes(parent, x, y, w, h, color, bar = 14, gap = 22, angle = 90) {
    return mk('div', 'abs', parent, { left: px(x), top: px(y), width: px(w), height: px(h),
      background: `repeating-linear-gradient(${angle}deg, ${color} 0 ${bar}px, transparent ${bar}px ${bar + gap}px)` });
  }
  function rule(parent, x, y, w, color, th = 6) {
    return mk('div', 'abs', parent, { left: px(x), top: px(y - th / 2), width: px(w), height: px(th), background: color });
  }
  // coffee cup seen from above: saucer ring, cup body, coffee, handle ring
  function cup(parent, cx, cy, R, o) {
    const g = mk('div', 'abs', parent, { left: px(cx - R), top: px(cy - R), width: px(2 * R), height: px(2 * R) });
    const saucer = circle(g, R, R, R, { border: `${o.ring || 10}px solid ${o.saucer}` });
    const hr = R * 0.24, hx = o.handleLeft ? R * 0.1 : R * 1.9;
    const handle = circle(g, hx, R, hr, { border: `${(R * 0.09).toFixed(1)}px solid ${o.body}` });
    const body = circle(g, R, R, R * 0.76, { background: o.body });
    const coffee = o.coffee ? circle(g, R, R, R * 0.58, { background: o.coffee }) : null;
    return { g, saucer, handle, body, coffee };
  }
  const PIN = `<svg width="180" height="225" viewBox="0 0 100 125" style="display:block;overflow:visible">
    <path d="M50 4 C 25 4, 8 22, 8 46 C 8 76, 50 120, 50 120 C 50 120, 92 76, 92 46 C 92 22, 75 4, 50 4 Z" fill="${C.navy}"/>
    <circle cx="50" cy="45" r="17" fill="${C.cream}"/></svg>`;

  // element animation helpers
  function setT(el, tf, blur = 0, op = 1) {
    el.style.transform = tf || 'none';
    el.style.filter = blurF(blur);
    el.style.opacity = op >= 1 ? '' : op.toFixed(3);
  }
  function pop(el, t, at, d = 0.45, { rot = 0, c = 1.7 } = {}) { // scale-in with overshoot
    const k = prog(t, at, d), e = backOut(k, c);
    el.style.visibility = k > 0 ? 'visible' : 'hidden';
    setT(el, `scale(${Math.max(0, e).toFixed(4)}) rotate(${((1 - e) * rot).toFixed(2)}deg)`, (1 - expo(k)) * 6 * (k > 0 ? 1 : 0));
  }
  function grow(el, t, at, d = 0.4, origin = '100% 50%', axis = 'X') { // rule draw-in
    const e = expoInOut(prog(t, at, d));
    el.style.transformOrigin = origin;
    el.style.transform = `scale${axis}(${e.toFixed(4)})`;
  }
  function wipeIn(el, t, at, d = 0.35, from = 'r') { // clip reveal of a block
    const e = expoInOut(prog(t, at, d)), r = ((1 - e) * 100).toFixed(2) + '%';
    el.style.clipPath = e >= 1 ? 'none' : from === 'r' ? `inset(0 0 0 ${r})` : from === 'l' ? `inset(0 ${r} 0 0)` : from === 'b' ? `inset(${r} 0 0 0)` : `inset(0 0 ${r} 0)`;
  }
  function rise(L, t, at, { st = 0.045, d = 0.5, from = 1.3, back = 0 } = {}) { // letters rise from behind the baseline mask
    L.chars.forEach((ch, i) => {
      const k = prog(t, at + i * st, d), e = back ? backOut(k, back) : expo(k);
      const v = (1 - e) * from, b = k > 0 && k < 1 ? (1 - expo(k)) * 8 : 0;
      setT(ch, Math.abs(v) > 1e-4 ? `translateY(${v.toFixed(4)}em)` : '', b);
    });
  }
  function slide(L, t, at, dir = 1, d = 0.5) { // whole line slides out from behind its mask edge (dir +1 = from the right)
    const k = prog(t, at, d), e = expo(k), dist = L.o.align === 'c' ? `${((1 - e) * dir * W * 1.05).toFixed(1)}px` : `${((1 - e) * dir * 112).toFixed(2)}%`;
    setT(L.inner, k >= 1 ? '' : `translateX(${dist})`, k > 0 && k < 1 ? (1 - e) * 16 : 0);
  }

  // ---------- sections ----------
  const SECS = [];
  function section(T, bg, geom, acc, extra = {}) {
    const accLayers = acc.map(c => mk('div', 'layer', stage, { background: c }));
    const layer = mk('div', 'layer', stage, { background: bg });
    const content = mk('div', 'content', layer);
    const s = { T, bg, geom, accLayers, layer, content, ...extra };
    SECS.push(s);
    return s;
  }
  const WIPE_LEAD = [0.36, 0.28, 0.20], WIPE_DUR = 0.30;   // accent, accent, panel start before the beat T

  // S0 — cold open on flamingo pink
  const s0 = section(-1, C.pink, null, []);
  {
    const c = s0.content;
    s0.cup = cup(c, 540, 900, 250, { saucer: C.navy, body: C.navy, coffee: C.peach, ring: 12 });
    s0.rule = rule(c, 240, 1290, 600, C.navy, 8);
    s0.dot = circle(c, 540, 1420, 22, { background: C.navy });
    s0.update = t => {
      pop(s0.cup.g, t, 0.0, 0.42, { rot: -120 });
      pop(s0.cup.coffee, t, 0.12, 0.35);
      grow(s0.rule, t, 0.06, 0.36, '50% 50%');
      pop(s0.dot, t, 0.22, 0.3);
    };
  }

  // S1 — title: outline letters rise, fill sweeps in, offset-print kick
  const s1 = section(0.5, C.navy, 'up', [C.peach, C.teal]);
  {
    const c = s1.content;
    s1.ruleTop = rule(c, 80, 330, 920, C.cream, 5);
    s1.half = half(c, 170, 300, 170, C.sage);
    s1.stripes = stripes(c, 640, 1560, 360, 230, C.peach, 16, 22);
    s1.cup = cup(c, 250, 1700, 250, { saucer: C.sage, body: C.teal, coffee: C.cream, ring: 12, handleLeft: false });
    s1.dot = circle(c, 900, 1440, 30, { background: C.pink });
    s1.ruleLow = rule(c, 80, 1400, 920, C.cream, 5);
    const T = [['קפה', C.cream], ['דילמה', C.cream], ['וג׳אם', C.pink]];
    s1.lines = T.map(([text, fill], i) => {
      const m = mk('div', 'mask', c); place(m, { size: 300, y: 560 + i * 300, align: 'r', x: 70 });
      const inner = mk('div', 'inner', m);
      const ol = mk('div', 'tl-o', inner), oc = fillChars(ol, text);
      const fl = mk('div', 'tl-f', inner, { color: fill }), fc = fillChars(fl, text);
      const hl = mk('div', 'hl', inner, { background: C.peach });
      return { m, inner, ol, fl, oc, fc, hl, i };
    });
    s1.update = t => {
      s1.lines.forEach(L => {
        const at = 0.5 + L.i * 0.5;
        L.oc.forEach((ch, j) => {
          const k = prog(t, at + j * 0.06, 0.5), e = expo(k), v = (1 - e) * 1.3;
          const tf = v > 1e-4 ? `translateY(${v.toFixed(4)}em)` : '';
          const b = k > 0 && k < 1 ? (1 - e) * 8 : 0;
          setT(ch, tf, b); setT(L.fc[j], tf, b);
        });
        // fill sweep right→left with a peach highlighter on the edge
        const fk = prog(t, 2.0 + L.i * 0.125, 0.38), fe = expoInOut(fk), x = (1 - fe) * 100;
        L.fl.style.clipPath = fe >= 1 ? 'none' : `inset(-0.2em -0.2em -0.2em ${x.toFixed(2)}%)`;
        L.hl.style.display = fk > 0 && fk < 1 ? 'block' : 'none';
        L.hl.style.left = `calc(${x.toFixed(2)}% - 0.055em)`;
        // offset-print kick on the downbeat at 3.0
        const ok = prog(t, 3.0 + L.i * 0.06, 0.4), oe = backOut(ok, 2.2), off = -0.04 * oe;
        L.fl.style.transform = ok > 0 ? `translate(${off.toFixed(4)}em, ${off.toFixed(4)}em)` : 'none';
        L.inner.style.setProperty('--stroke', t >= 3.0 ? (L.i === 2 ? C.cream : C.pink) : C.cream);
      });
      grow(s1.ruleTop, t, 0.62, 0.45, '100% 50%');
      grow(s1.ruleLow, t, 1.9, 0.45, '100% 50%');
      const p = beatPulse(t) * clamp01((t - 3.0) / 0.2);
      pop(s1.cup.g, t, 2.5, 0.5, { rot: -160 });
      s1.cup.g.style.transform += ` scale(${(1 + 0.03 * p).toFixed(4)})`;
      const hk = expo(prog(t, 2.6, 0.45));
      s1.half.style.transform = `rotate(${((1 - hk) * -180).toFixed(2)}deg) scale(${hk.toFixed(4)})`;
      wipeIn(s1.stripes, t, 2.7, 0.35, 'r');
      pop(s1.dot, t, 2.75, 0.35);
      s1.dot.style.transform += ` scale(${(1 + 0.25 * p).toFixed(4)})`;
    };
  }

  // S2 — topics on cream
  const s2 = section(4.5, C.cream, 'rtl', [C.pink, C.teal]);
  {
    const c = s2.content;
    s2.dot = circle(c, 170, 250, 70, { background: C.pink });
    s2.l1 = line(c, 'הנושאים הכי', { size: 150, y: 470, align: 'r', x: 80, color: C.navy });
    s2.r1 = rule(c, 80, 600, 920, C.navy, 6);
    s2.l2 = line(c, 'מעניינים', { size: 215, y: 735, align: 'r', x: 80, color: C.navy });
    s2.r2 = rule(c, 80, 880, 920, C.navy, 6);
    s2.l3 = line(c, 'וחמים', { size: 250, y: 1060, align: 'r', x: 60, color: C.navy, bg: C.peach, padX: 0.22 });
    s2.l4 = line(c, 'היום!', { size: 330, y: 1420, align: 'r', x: 80, color: C.navy });
    s2.half = half(c, 220, 1920, 260, C.teal);
    s2.stripes = stripes(c, 560, 1700, 440, 40, C.teal, 12, 18);
    s2.update = t => {
      pop(s2.dot, t, 4.62, 0.4);
      rise(s2.l1, t, 5.0);
      grow(s2.r1, t, 5.08, 0.45);
      rise(s2.l2, t, 5.5, { st: 0.04 });
      grow(s2.r2, t, 5.58, 0.45);
      wipeIn(s2.l3.m, t, 6.0, 0.28, 'r');
      rise(s2.l3, t, 6.12, { st: 0.05 });
      rise(s2.l4, t, 7.0, { st: 0.06, d: 0.45, from: -1.35, back: 1.9 });
      const hk = expo(prog(t, 7.1, 0.5));
      s2.half.style.transform = `scaleY(${hk.toFixed(4)})`;
      wipeIn(s2.stripes, t, 7.2, 0.35, 'l');
      const p = beatPulse(t) * clamp01(t - 7.0);
      s2.dot.style.transform += ` scale(${(1 + 0.2 * p).toFixed(4)})`;
    };
  }

  // S3 — "come, sit, talk, drink coffee" on teal: one word per beat
  const s3 = section(8.5, C.teal, 'down', [C.sage, C.cream]);
  {
    const c = s3.content;
    s3.r = rule(c, 80, 260, 920, C.cream, 5);
    s3.w = [
      line(c, 'בואו,', { size: 210, y: 430, align: 'r', x: 80, color: C.cream }),
      line(c, 'נשב,', { size: 210, y: 670, align: 'l', x: 80, color: C.cream }),
      line(c, 'נדבר', { size: 210, y: 910, align: 'r', x: 80, color: C.cream }),
      line(c, 'ונשתה', { size: 210, y: 1150, align: 'l', x: 80, color: C.cream }),
    ];
    s3.dot = circle(c, 960, 1150, 34, { background: C.peach });
    s3.cup = cup(c, 540, 1560, 280, { saucer: C.cream, body: C.cream, ring: 12, handleLeft: true });
    s3.word = line(c, 'קפה', { size: 160, y: 1560, align: 'c', color: C.navy });
    s3.update = t => {
      grow(s3.r, t, 8.62, 0.45);
      slide(s3.w[0], t, 9.0, 1);
      slide(s3.w[1], t, 9.5, -1);
      rise(s3.w[2], t, 10.0);
      slide(s3.w[3], t, 10.5, -1);
      pop(s3.dot, t, 10.6, 0.35);
      pop(s3.cup.g, t, 10.9, 0.5, { rot: 140 });
      rise(s3.word, t, 11.05, { st: 0.07, back: 1.6 });
      const p = beatPulse(t) * clamp01((t - 11.4) / 0.2);
      s3.cup.g.style.transform += ` scale(${(1 + 0.03 * p).toFixed(4)})`;
    };
  }

  // S4 — surprises on pink: boxes pop open letter by letter
  const s4 = section(12.0, C.pink, 'diag', [C.peach, C.navy]);
  {
    const c = s4.content;
    s4.conf = Array.from({ length: 12 }, (_, i) => {
      const kind = i % 4, col = [C.navy, C.cream, C.teal, C.deep, C.sage][i % 5], r = 32 + hash(i + 3) * 30;
      const css = kind === 0 ? { background: col, borderRadius: '50%' } : kind === 1 ? { border: `${(r * 0.35).toFixed(0)}px solid ${col}`, borderRadius: '50%', boxSizing: 'border-box' }
        : kind === 2 ? { background: col, borderRadius: `${r}px ${r}px 0 0`, height: px(r) } : { background: col };
      const el = mk('div', 'abs', c, { left: px(540 - r), top: px(990 - r), width: px(2 * r), height: px(2 * r), ...css });
      return { el, a: (i % 2 ? -Math.PI / 2 : Math.PI / 2) + (hash(i + 7) - 0.5) * 2.2, d: 430 + hash(i + 21) * 280, spin: (hash(i + 5) - 0.5) * 540 };
    });
    s4.l1 = line(c, 'יהיו', { size: 170, y: 640, align: 'c', color: C.navy });
    const m = mk('div', 'mask', c); place(m, { size: 200, y: 990, align: 'c' });
    m.style.overflow = 'visible';
    const inner = mk('div', 'inner', m, { color: C.navy });
    s4.boxes = Array.from('הפתעות').map(ch => {
      const box = mk('span', 'box', inner), letter = mk('span', 'ch', box); letter.textContent = ch;
      const cover = mk('span', 'cover', box, { background: C.cream });
      return { box, letter, cover };
    });
    s4.ring = circle(c, 540, 990, 420, { border: `6px solid ${C.navy}` });
    s4.rTop = rule(c, 160, 805, 760, C.navy, 6);
    s4.rBot = rule(c, 160, 1180, 760, C.navy, 6);
    s4.half = half(c, 880, 1920, 240, C.cream);
    s4.stripes = stripes(c, 80, 250, 320, 40, C.navy, 10, 16);
    s4.update = t => {
      rise(s4.l1, t, 12.5);
      grow(s4.rTop, t, 12.6, 0.4, '50% 50%');
      grow(s4.rBot, t, 12.7, 0.4, '50% 50%');
      s4.half.style.transform = `scaleY(${expo(prog(t, 12.25, 0.5)).toFixed(4)})`;
      wipeIn(s4.stripes, t, 12.35, 0.35, 'r');
      s4.boxes.forEach((b, i) => {
        const dk = prog(t, 12.55 + i * 0.06, 0.4), de = backOut(dk, 2.0);
        setT(b.box, `translateY(${((1 - de) * -120).toFixed(1)}px) scale(${Math.max(0, de).toFixed(4)}) rotate(${((1 - de) * (i % 2 ? 25 : -25)).toFixed(2)}deg)`, dk > 0 && dk < 1 ? (1 - expo(dk)) * 6 : 0, dk > 0 ? 1 : 0);
        const ok = prog(t, 13.0 + i * 0.125, 0.26), oe = expo(ok);
        b.cover.style.transform = `translateY(${(-oe * 105).toFixed(2)}%)`;
        const lk = prog(t, 13.0 + i * 0.125, 0.4);
        b.letter.style.transform = `scale(${lerp(0.35, 1, backOut(lk, 2.4)).toFixed(4)})`;
      });
      const bk = prog(t, 14.0, 0.7), be = expo(bk);
      s4.conf.forEach(q => {
        q.el.style.visibility = bk > 0 ? 'visible' : 'hidden';
        setT(q.el, `translate(${(Math.cos(q.a) * q.d * be).toFixed(1)}px, ${(Math.sin(q.a) * q.d * be).toFixed(1)}px) rotate(${(q.spin * be).toFixed(1)}deg) scale(${lerp(0.3, 1, be).toFixed(3)})`, bk > 0 && bk < 1 ? (1 - be) * 10 : 0);
      });
      const rk = prog(t, 14.0, 0.45);
      s4.ring.style.visibility = rk > 0 && rk < 1 ? 'visible' : 'hidden';
      setT(s4.ring, `scale(${lerp(0.4, 1.6, expo(rk)).toFixed(4)})`, 0, 1 - rk);
    };
  }

  // S5 — date on sage: odometer counters
  const s5 = section(14.5, C.sage, 'ltr', [C.navy, C.cream]);
  {
    const c = s5.content;
    s5.half = half(c, 180, 1920, 300, C.cream);
    s5.ring = circle(c, 1040, 1640, 210, { border: `16px solid ${C.navy}` });
    s5.r = rule(c, 80, 335, 920, C.navy, 6);
    s5.day = line(c, 'יום שלישי', { size: 170, y: 470, align: 'r', x: 80, color: C.navy });
    s5.date = counter(c, '01.12', { size: 300, y: 860, align: 'c', color: C.navy });
    s5.pill = mk('div', 'abs', c, { left: px(540 - 360), top: px(1250 - 145), width: '720px', height: '290px', borderRadius: '145px', background: C.navy });
    s5.time = counter(c, '19:30', { size: 210, y: 1250, align: 'c', color: C.cream });
    s5.dot = circle(c, 230, 1600, 40, { background: C.deep });
    s5.stripes = stripes(c, 80, 1700, 360, 36, C.navy, 10, 16);
    const spin = (L, t, at, land0, step) => {
      rise(L, t, at, { st: 0.04, d: 0.45 });
      L.cols.forEach((q, j) => {
        const land = land0 + j * step, k = prog(t, at, land - at), e = quart(k);
        const v = q.n * 4 * Math.pow(1 - k, 3) / (land - at) * L.o.size * 1.1 / FPS;
        q.strip.style.transform = `translateY(${(-e * q.n * 1.1).toFixed(4)}em)`;
        q.strip.style.filter = blurF(k < 1 ? Math.min(14, v * 0.12) : 0);
      });
    };
    s5.update = t => {
      grow(s5.r, t, 14.72, 0.45);
      rise(s5.day, t, 15.0);
      spin(s5.date, t, 15.5, 16.0, 0.125);
      grow(s5.pill, t, 16.75, 0.32, '100% 50%');
      spin(s5.time, t, 17.0, 17.25, 0.125);
      const hk = expo(prog(t, 15.2, 0.5));
      s5.half.style.transform = `scaleY(${hk.toFixed(4)})`;
      pop(s5.ring, t, 15.3, 0.5);
      pop(s5.dot, t, 17.8, 0.35);
      wipeIn(s5.stripes, t, 16.2, 0.35, 'l');
      const p = beatPulse(t) * clamp01(t - 17.8);
      s5.ring.style.transform += ` scale(${(1 + 0.04 * p).toFixed(4)})`;
    };
  }

  // S6 — location on peach: pin drops, ripples, masked lines
  const IRIS = { x: 540, y: 560 };
  const s6 = section(18.5, C.peach, 'iris', [C.cream, C.pink]);
  {
    const c = s6.content;
    s6.big = circle(c, 990, 190, 220, { background: C.cream });
    s6.shadow = mk('div', 'abs', c, { left: '470px', top: '682px', width: '140px', height: '36px', borderRadius: '50%', background: 'rgba(27,42,74,0.28)' });
    s6.rip = [0, 1].map(() => mk('div', 'abs', c, { left: '540px', top: '700px', width: '0', height: '0', borderRadius: '50%', border: `6px solid ${C.navy}`, boxSizing: 'border-box' }));
    s6.pin = mk('div', 'abs', c, { left: '450px', top: '475px', width: '180px', height: '225px', transformOrigin: '50% 100%' });
    s6.pin.innerHTML = PIN;
    s6.l1 = line(c, 'בית החאן,', { size: 200, y: 960, align: 'c', color: C.navy });
    s6.r = rule(c, 280, 1115, 520, C.navy, 6);
    s6.l2 = line(c, 'קרית שמונה', { size: 150, y: 1250, align: 'c', color: C.navy });
    s6.half = half(c, 540, 1920, 320, C.teal);
    s6.stripes = stripes(c, 80, 1440, 280, 40, C.navy, 10, 16);
    s6.update = t => {
      pop(s6.big, t, 18.7, 0.5);
      const dk = prog(t, 18.6, 0.4), de = dk < 1 ? expoIn(dk) : 1;            // fall, land on 19.0
      const sq = t >= 19.0 ? Math.exp(-(t - 19.0) * 9) * Math.cos((t - 19.0) * 30) : 0;
      setT(s6.pin, `translateY(${((1 - de) * -1100).toFixed(1)}px) scale(${(1 + 0.12 * sq).toFixed(4)}, ${(1 - 0.16 * sq).toFixed(4)})`, dk > 0 && dk < 1 ? de * 14 : 0);
      s6.shadow.style.transform = `scaleX(${lerp(0.2, 1, de).toFixed(4)})`;
      s6.shadow.style.opacity = de.toFixed(3);
      s6.rip.forEach((r, i) => {
        const k = prog(t, 19.0 + i * 0.25, 0.8), e = expo(k), w = 140 + e * 620, h = w * 0.26;
        r.style.visibility = k > 0 && k < 1 ? 'visible' : 'hidden';
        Object.assign(r.style, { left: px(540 - w / 2), top: px(700 - h / 2), width: px(w), height: px(h), opacity: (1 - k).toFixed(3) });
      });
      rise(s6.l1, t, 19.5);
      grow(s6.r, t, 19.9, 0.4, '50% 50%');
      slide(s6.l2, t, 20.0, 1, 0.55);
      const hk = expo(prog(t, 20.3, 0.5));
      s6.half.style.transform = `scaleY(${hk.toFixed(4)})`;
      wipeIn(s6.stripes, t, 20.5, 0.35, 'l');
    };
  }

  // S7 — call to action on teal, then the words split apart for the end card
  const s7 = section(21.5, C.teal, 'up', [C.pink, C.sage]);
  {
    const c = s7.content;
    s7.cup = cup(c, 210, 330, 120, { saucer: C.cream, body: C.cream, coffee: C.peach, ring: 7, handleLeft: false });
    s7.l1 = line(c, 'בואו', { size: 330, y: 790, align: 'c', color: C.cream });
    s7.l2 = line(c, 'לדבר!', { size: 300, y: 1170, align: 'c', color: C.navy, bg: C.pink });
    s7.stripes = stripes(c, 80, 1560, 920, 120, C.cream, 6, 22, 0);
    s7.update = t => {
      pop(s7.cup.g, t, 21.6, 0.45, { rot: 120 });
      rise(s7.l1, t, 21.75, { st: 0.06 });
      wipeIn(s7.l2.m, t, 22.0, 0.28, 'r');
      rise(s7.l2, t, 22.1, { st: 0.05 });
      wipeIn(s7.stripes, t, 22.2, 0.3, 't');
      const pk = prog(t, 22.5, 0.35), punch = 1 + 0.07 * (1 - expo(pk)) * (pk > 0 ? 1 : 0);
      const xk = expoInOut(prog(t, 22.6, 0.38));
      setT(s7.l1.m, `translateX(${(xk * 1150).toFixed(1)}px) scale(${punch.toFixed(4)})`, xk * 26);
      setT(s7.l2.m, `translateX(${(xk * -1150).toFixed(1)}px) scale(${punch.toFixed(4)})`, xk * 26);
    };
  }

  // S8 — end card on navy: title + cream logo badge, settled by 23.5 s and held
  const s8 = section(23.0, C.navy, 'doors', [C.peach, C.pink]);
  {
    const c = s8.content;
    s8.cupL = cup(c, 150, 1780, 190, { saucer: C.sage, body: C.teal, coffee: C.cream, ring: 10 });
    s8.half = half(c, 960, 0, 200, C.peach, { transform: 'rotate(180deg)' });
    s8.dot = circle(c, 930, 1700, 36, { background: C.pink });
    s8.l1 = line(c, 'קפה דילמה', { size: 170, y: 560, align: 'c', color: C.cream });
    s8.l2 = line(c, 'וג׳אם', { size: 270, y: 825, align: 'c', color: C.pink });
    s8.r = rule(c, 390, 1035, 300, C.cream, 6);
    const bm = mk('div', 'abs', c, { left: '0', right: '0', top: '1110px', height: '480px', overflow: 'hidden', textAlign: 'center' });
    const bw = mk('div', 'abs', bm, { left: '0', right: '0', top: '50px', textAlign: 'center' });
    bw.innerHTML = `<div class="badge"><img src="assets/kiryat-shmona.png" style="height:210px"><img src="assets/ayalim.png" style="height:230px"></div>`;
    s8.badge = bw;
    s8.imgs = [...bw.querySelectorAll('img')];
    s8.update = t => {
      rise(s8.l1, t, 23.05, { st: 0.03, d: 0.4 });
      rise(s8.l2, t, 23.12, { st: 0.04, d: 0.38 });
      grow(s8.r, t, 23.15, 0.3, '50% 50%');
      const bk = prog(t, 23.15, 0.34), be = expo(bk);
      setT(s8.badge, `translateY(${((1 - be) * 470).toFixed(1)}px)`, bk < 1 ? (1 - be) * 12 : 0);
      pop(s8.cupL.g, t, 23.1, 0.4, { rot: -120 });
      const hk = expo(prog(t, 23.15, 0.4));
      s8.half.style.transform = `rotate(180deg) scaleY(${hk.toFixed(4)})`;
      pop(s8.dot, t, 23.25, 0.3);
      // gentle hold motion on the accents only (text and badge stay still)
      s8.cupL.g.style.transform += ` rotate(${((t - 23.5) * 6).toFixed(2)}deg)`;
    };
  }
  const imgsReady = Promise.all(s8.imgs.map(i => i.decode().catch(() => null)));

  // ---------- wipes ----------
  function clipFor(geom, p) {
    if (p >= 1) return 'none';
    const q = ((1 - p) * 100).toFixed(3) + '%';
    switch (geom) {
      case 'up': return `inset(${q} 0 0 0)`;
      case 'down': return `inset(0 0 ${q} 0)`;
      case 'rtl': return `inset(0 0 0 ${q})`;
      case 'ltr': return `inset(0 ${q} 0 0)`;
      case 'doors': { const h = ((1 - p) * 50).toFixed(3) + '%'; return `inset(0 ${h} 0 ${h})`; }
      case 'iris': return `circle(${(p * 2200).toFixed(1)}px at ${IRIS.x}px ${IRIS.y}px)`;
      case 'diag': { // half-plane (W-x) + (H-y)*S <= L sweeping from bottom-right to top-left
        const S = 0.55, L = p * (W + H * S);
        const f = ([x, y]) => (W - x) + (H - y) * S - L;
        const rect = [[0, 0], [W, 0], [W, H], [0, H]], out = [];
        rect.forEach((a, i) => {
          const b = rect[(i + 1) % 4], fa = f(a), fb = f(b);
          if (fa <= 0) out.push(a);
          if ((fa <= 0) !== (fb <= 0)) { const k = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]); }
        });
        if (out.length < 3) return 'polygon(0 0, 0 0, 0 0)';
        return `polygon(${out.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(', ')})`;
      }
    }
    return 'none';
  }
  const PUSH = { // where the outgoing content is shoved while the next panel wipes over it
    up: p => `translateY(${(-p * 260).toFixed(1)}px)`, down: p => `translateY(${(p * 260).toFixed(1)}px)`,
    rtl: p => `translateX(${(-p * 260).toFixed(1)}px)`, ltr: p => `translateX(${(p * 260).toFixed(1)}px)`,
    diag: p => `translate(${(-p * 180).toFixed(1)}px, ${(-p * 260).toFixed(1)}px)`,
    iris: p => `scale(${(1 + p * 0.18).toFixed(4)})`,
  };
  const wp = (t, T, j) => expoInOut(prog(t, T - WIPE_LEAD[j], WIPE_DUR));

  window.openkatanaPage = {
    width: W, height: H, fps: FPS, frames: FRAMES,
    async render(tLocal, f) {
      const t = tLocal + OFFSET;
      await fontReady; await imgsReady;
      SECS.forEach((s, i) => {
        const next = SECS[i + 1];
        const pNext = next ? wp(t, next.T, 2) : 0;
        const pMain = i === 0 ? 1 : wp(t, s.T, 2);
        const visible = (i === 0 || t >= s.T - WIPE_LEAD[2]) && pNext < 1;
        s.layer.style.display = visible ? 'block' : 'none';
        s.accLayers.forEach((a, j) => {
          const p = wp(t, s.T, j);
          const on = t >= s.T - WIPE_LEAD[j] && pMain < 1 && p > 0;
          a.style.display = on ? 'block' : 'none';
          if (on) a.style.clipPath = clipFor(s.geom, p);
        });
        if (!visible) return;
        if (i > 0) s.layer.style.clipPath = clipFor(s.geom, pMain);
        if (next && next.geom !== 'doors' && pNext > 0) {
          s.content.style.transformOrigin = `${IRIS.x}px ${IRIS.y}px`;
          s.content.style.transform = PUSH[next.geom](pNext);
          s.content.style.filter = blurF(Math.sin(Math.PI * pNext) * 14);
        } else { s.content.style.transform = 'none'; s.content.style.filter = 'none'; }
        s.update(t);
      });
      await document.fonts.ready;
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    }
  };
})();
