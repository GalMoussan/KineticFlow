(() => {
  const W = 1080, H = 1920, FPS = 30, DUR = 26;
  const OFFSET = window.REEL_OFFSET || 0, FRAMES = window.REEL_FRAMES || DUR * FPS;
  const BPM = 120, BEAT = 60 / BPM, T0 = 0.5;          // first downbeat
  const CX = 540, CY = 900;
  const P = { mag: '#E5007E', teal: '#43B9B3', yel: '#FCC000', org: '#F07D00', pur: '#B04FE0', lime: '#9DC31A', sky: '#67C5E4', white: '#FFFFFF' };

  const fontReady = new FontFace('Rubik', 'url(fonts/Rubik.ttf)', { weight: '300 900' })
    .load().then(f => { document.fonts.add(f); return document.fonts.ready; });

  // ---------- math ----------
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const smooth = k => k * k * (3 - 2 * k);
  const expo = k => k >= 1 ? 1 : 1 - Math.pow(2, -10 * k);
  const backOut = k => { const c = 2.2; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
  const hash = n => { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
  const beatPulse = t => t < T0 ? 0 : Math.exp(-(((t - T0) % BEAT)) * 9);
  const rainbow = (i, t, l = 62) => `hsl(${((i * 47 + t * 140) % 360 + 360) % 360}, 100%, ${l}%)`;

  // ---------- script (only the client's text) ----------
  // anim: slam | rise | drop | track | letters | scramble | slot ; exit: whip | zoom | cut | none
  const ITEMS = [
    // S1 — title
    { s: 'קפה', at: 0.5, out: 3.9, y: 640, size: 280, anim: 'slam', color: P.white, glow: P.mag, exit: 'whip' },
    { s: 'דילמה', at: 1.0, out: 3.9, y: 920, size: 280, anim: 'slam', color: P.yel, glow: P.org, exit: 'whip' },
    { s: 'וג׳אם', at: 2.0, out: 3.9, y: 1210, size: 250, anim: 'letters', color: 'rainbow', glow: P.pur, exit: 'whip' },
    // S2 — description line 1
    { s: 'הנושאים', at: 4.0, out: 7.9, y: 520, size: 170, anim: 'rise', color: P.white, glow: P.teal, exit: 'zoom' },
    { s: 'הכי', at: 4.5, out: 7.9, y: 720, size: 170, anim: 'rise', color: P.teal, glow: P.teal, exit: 'zoom' },
    { s: 'מעניינים', at: 5.0, out: 7.9, y: 920, size: 170, anim: 'track', color: P.white, glow: P.sky, exit: 'zoom' },
    { s: 'וחמים', at: 6.0, out: 7.9, y: 1140, size: 210, anim: 'slam', color: P.org, glow: P.mag, wobble: true, exit: 'zoom' },
    { s: 'היום!', at: 7.0, out: 7.9, y: 1400, size: 270, anim: 'slam', color: P.mag, glow: P.mag, exit: 'zoom' },
    // S3 — one word per beat-pair
    { s: 'בואו,', at: 8.0, out: 9.0, y: 900, size: 320, anim: 'slam', color: P.white, glow: P.teal, exit: 'cut' },
    { s: 'נשב', at: 9.0, out: 10.0, y: 900, size: 340, anim: 'drop', color: P.yel, glow: P.org, exit: 'cut' },
    { s: 'נדבר', at: 10.0, out: 11.0, y: 900, size: 340, anim: 'letters', color: 'rainbow', glow: P.mag, exit: 'cut' },
    { s: 'ונשתה', at: 11.0, out: 12.0, y: 790, size: 260, anim: 'slam', color: P.white, glow: P.org, exit: 'cut' },
    { s: 'קפה', at: 11.25, out: 12.0, y: 1060, size: 300, anim: 'slam', color: P.org, glow: P.yel, exit: 'cut' },
    // S4 — surprises
    { s: 'יהיו', at: 12.0, out: 14.4, y: 700, size: 170, anim: 'rise', color: P.white, glow: P.pur, exit: 'zoom' },
    { s: 'הפתעות', at: 12.5, out: 14.4, y: 960, size: 260, anim: 'scramble', color: 'rainbow', glow: P.mag, exit: 'zoom' },
    // S5 — when
    { s: 'יום שלישי', at: 14.5, out: 18.4, y: 560, size: 150, anim: 'track', color: P.white, glow: P.teal, exit: 'whip' },
    { s: '24.11', at: 15.0, out: 18.4, y: 870, size: 285, anim: 'slot', ltr: true, color: P.yel, glow: P.mag, exit: 'whip' },
    { s: '19:30', at: 16.5, out: 18.4, y: 1190, size: 230, anim: 'slot', ltr: true, color: P.teal, glow: P.teal, exit: 'whip' },
    // S6 — where
    { html: 'pin', at: 18.5, out: 21.4, y: 560, size: 200, anim: 'drop', exit: 'zoom' },
    { s: 'בית החאן', at: 19.0, out: 21.4, y: 870, size: 200, anim: 'letters', color: P.white, glow: P.mag, exit: 'zoom' },
    { s: 'קרית שמונה', at: 19.75, out: 21.4, y: 1110, size: 150, anim: 'track', color: P.teal, glow: P.teal, exit: 'zoom' },
    // S7 — call to action + logos
    { s: 'בואו', at: 21.5, out: 99, y: 600, size: 290, anim: 'slam', color: P.white, glow: P.mag, exit: 'none' },
    { s: 'לדבר!', at: 22.0, out: 99, y: 880, size: 290, anim: 'slam', color: 'rainbow', glow: P.pur, exit: 'none' },
    { s: 'קפה דילמה וג׳אם', at: 23.0, out: 99, y: 1110, size: 92, anim: 'rise', color: P.yel, glow: P.org, exit: 'none' },
    { html: 'logos', at: 23.4, out: 99, y: 1390, size: 1, anim: 'rise', exit: 'none' },
  ];
  // camera shake + flash on impacts
  const HITS = ITEMS.filter(it => it.anim === 'slam' || it.anim === 'drop').map(it => ({ t: it.at + (it.anim === 'drop' ? 0.32 : 0.12), amp: it.size / 14 }));
  const FLASHES = [0.62, 7.12, 11.37, 13.25, 16.1, 22.12];
  const BURSTS = [ // ring/particle explosions from a point
    { t: 0.62, x: CX, y: 780, n: 70, hue: 320 }, { t: 7.12, x: CX, y: 1400, n: 60, hue: 330 },
    { t: 13.25, x: CX, y: 960, n: 140, hue: 50 }, { t: 16.1, x: CX, y: 870, n: 80, hue: 45 },
    { t: 18.82, x: CX, y: 600, n: 50, hue: 175 }, { t: 22.12, x: CX, y: 880, n: 110, hue: 290 },
  ];

  // ---------- build DOM ----------
  const cam = document.getElementById('cam');
  const PIN = `<svg width="200" height="250" viewBox="0 0 100 125" style="overflow:visible">
      <defs><linearGradient id="pg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${P.mag}"/><stop offset="1" stop-color="${P.org}"/></linearGradient></defs>
      <path d="M50 4 C 25 4, 8 22, 8 46 C 8 76, 50 120, 50 120 C 50 120, 92 76, 92 46 C 92 22, 75 4, 50 4 Z" fill="url(#pg)" stroke="#fff" stroke-width="4"/>
      <circle cx="50" cy="45" r="15" fill="#fff"/></svg>`;
  const LOGOS = `<div class="badge"><img src="assets/kiryat-shmona.png" style="height:230px"><img src="assets/ayalim.png" style="height:240px"></div>`;
  const imgs = [];
  ITEMS.forEach((it, idx) => {
    const item = document.createElement('div');
    item.className = 'item';
    item.style.top = it.y + 'px';
    const word = document.createElement('div');
    word.className = 'word' + (it.ltr ? ' ltr' : '');
    word.style.fontSize = it.size + 'px';
    if (it.html === 'pin') word.innerHTML = PIN;
    else if (it.html === 'logos') { word.innerHTML = LOGOS; word.querySelectorAll('img').forEach(i => imgs.push(i)); }
    else {
      Array.from(it.s).forEach(c => {
        const sp = document.createElement('span');
        sp.className = c === ' ' ? 'sp' : 'ch';
        if (c !== ' ') sp.textContent = c;
        word.appendChild(sp);
      });
    }
    item.appendChild(word);
    cam.appendChild(item);
    it.el = item; it.word = word; it.chars = [...word.querySelectorAll('.ch')]; it.idx = idx;
  });
  const imgsReady = Promise.all(imgs.map(i => i.decode().catch(() => null)));

  // static grain
  (() => {
    const c = document.getElementById('grain'), g = c.getContext('2d');
    const im = g.createImageData(c.width, c.height);
    for (let i = 0; i < c.width * c.height; i++) { const v = Math.floor(hash(i) * 255); im.data.set([v, v, v, 255], i * 4); }
    g.putImageData(im, 0, 0);
  })();

  // ---------- text animation ----------
  function glowShadow(glow, split, extra) {
    const s = [];
    if (split > 0.3) s.push(`${split.toFixed(1)}px 0 rgba(255,43,214,0.85)`, `${(-split).toFixed(1)}px 0 rgba(34,229,255,0.85)`);
    s.push(`0 0 ${(18 + extra * 20).toFixed(0)}px ${glow}`, `0 0 ${(55 + extra * 50).toFixed(0)}px ${glow}`, `0 6px 0 rgba(0,0,0,0.35)`);
    return s.join(', ');
  }

  function animateItem(it, t, pulse) {
    const el = it.el, w = it.word;
    const visible = t >= it.at - 0.001 && t < it.out;
    if (!visible) { el.style.opacity = '0'; return; }
    el.style.opacity = '1';
    const dt = t - it.at;
    let tx = 0, ty = 0, sc = 1, rot = 0, op = 1, blur = 0, split = 0, ls = 0;

    if (it.anim === 'slam') {
      const k = clamp01(dt / 0.28), e = expo(k);
      sc = lerp(3.2, 1, e) * (1 + 0.07 * Math.exp(-Math.max(0, dt - 0.28) * 9) * Math.sin(Math.max(0, dt - 0.28) * 30));
      op = clamp01(k * 6); blur = (1 - e) * 22; split = 16 * Math.exp(-dt * 5);
    } else if (it.anim === 'rise') {
      const k = clamp01(dt / 0.45), e = expo(k);
      ty = (1 - e) * 170; op = clamp01(k * 3); blur = (1 - e) * 14; rot = (1 - e) * -4;
    } else if (it.anim === 'drop') {
      const k = clamp01(dt / 0.42), e = k < 1 ? backOut(k) : 1;
      ty = (1 - e) * -760; rot = (1 - e) * -18; op = clamp01(k * 4); blur = (1 - clamp01(k * 1.3)) * 16;
      split = 12 * Math.exp(-Math.max(0, dt - 0.3) * 6) * (dt > 0.3 ? 1 : 0);
    } else if (it.anim === 'track') {
      const k = clamp01(dt / 0.6), e = expo(k);
      ls = (1 - e) * 0.55; op = clamp01(k * 2.5); blur = (1 - e) * 16; sc = lerp(1.15, 1, e);
    }

    // exits
    const EXIT = { whip: 0.32, zoom: 0.3, cut: 0.09, none: 0 }[it.exit] || 0;
    if (EXIT > 0) {
      const ko = clamp01((t - (it.out - EXIT)) / EXIT), q = ko * ko;
      if (it.exit === 'whip') { ty -= q * 620; blur += q * 26; op *= 1 - q; sc *= 1 + q * 0.2; }
      else if (it.exit === 'zoom') { sc *= 1 + q * 1.8; blur += q * 22; op *= 1 - ko; }
      else { sc *= 1 - ko * 0.15; op *= 1 - ko; }
    }

    const breathe = 1 + 0.028 * pulse * clamp01(dt / 0.5);
    w.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) rotate(${rot.toFixed(2)}deg) scale(${(sc * breathe).toFixed(4)})`;
    w.style.opacity = op.toFixed(3);
    w.style.filter = blur > 0.3 ? `blur(${blur.toFixed(1)}px)` : 'none';
    w.style.letterSpacing = ls > 0.002 ? `${ls.toFixed(3)}em` : '0';
    if (it.html) {
      w.style.filter = (blur > 0.3 ? `blur(${blur.toFixed(1)}px) ` : '') + `drop-shadow(0 0 ${(24 + pulse * 20).toFixed(0)}px ${it.html === 'pin' ? P.mag : 'rgba(255,255,255,0.0)'})`;
      return;
    }

    // per-letter work
    it.chars.forEach((ch, i) => {
      const n = it.chars.length;
      const color = it.color === 'rainbow' ? rainbow(i + it.idx, t) : it.color;
      const glow = it.color === 'rainbow' ? rainbow(i + it.idx + 2, t, 55) : it.glow;
      let cx = 0, cy = 0, cs = 1, cr = 0, co = 1, cblur = 0, csplit = split;
      if (it.anim === 'letters') {
        const kc = clamp01((dt - i * 0.06) / 0.38);
        cs = kc < 1 ? Math.max(0, backOut(kc)) : 1; cr = (1 - kc) * (hash(i + it.idx) - 0.5) * 140; cy = (1 - kc) * -90; co = clamp01(kc * 4);
        csplit = 12 * Math.exp(-Math.max(0, dt - i * 0.06) * 6);
      } else if (it.anim === 'scramble') {
        const kc = clamp01((dt - i * 0.08) / 0.55), e = expo(kc);
        cx = (1 - e) * (hash(i * 3 + 1) - 0.5) * 1500; cy = (1 - e) * (hash(i * 5 + 2) - 0.5) * 1700;
        cr = (1 - e) * (hash(i + 9) - 0.5) * 900; cs = lerp(0.2, 1, e); co = clamp01(kc * 3); cblur = (1 - e) * 20;
        csplit = 14 * Math.exp(-Math.max(0, dt - i * 0.08 - 0.55) * 5) * (kc >= 1 ? 1 : 0.4);
      } else if (it.anim === 'slot') {
        const land = it.at + 0.3 + i * 0.22;
        const target = it.s.replace(/ /g, '')[i];
        const spinning = t < land && /[0-9]/.test(target);
        ch.textContent = spinning ? String(Math.floor(hash(Math.floor(t * 30) * 7 + i * 13) * 10)) : target;
        const kin = clamp01((dt - i * 0.05) / 0.2);
        co = clamp01(kin * 4); cy = (1 - expo(kin)) * 120;
        if (spinning) { cblur = 7; cy += Math.sin(t * 90 + i) * 14; }
        else { const ka = clamp01((t - land) / 0.22); cs = lerp(1.7, 1, expo(ka)); csplit = 14 * Math.exp(-(t - land) * 6); }
      }
      if (it.wobble) cy += Math.sin(t * 9 + i * 0.9) * 9 * clamp01(dt / 0.4);
      ch.style.transform = (cx || cy || cs !== 1 || cr) ? `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px) rotate(${cr.toFixed(1)}deg) scale(${cs.toFixed(3)})` : 'none';
      ch.style.opacity = co.toFixed(3);
      ch.style.filter = cblur > 0.3 ? `blur(${cblur.toFixed(1)}px)` : 'none';
      ch.style.color = color;
      ch.style.textShadow = glowShadow(glow, csplit, pulse);
    });
  }

  // ---------- background: psychedelic science ----------
  const bg = document.getElementById('bg').getContext('2d');
  const fx = document.getElementById('fx').getContext('2d');
  const STARS = Array.from({ length: 160 }, (_, i) => ({ x: hash(i) * W, y: hash(i + 500) * H, v: 30 + hash(i + 900) * 140, r: 0.8 + hash(i + 1300) * 2.4, ph: hash(i + 1700) * 6.28 }));
  const ORBS = [
    { c: '229,0,126', r: 760, sp: 0.23, ox: 300, oy: 420, ph: 0 },
    { c: '67,185,179', r: 700, sp: -0.19, ox: 340, oy: 520, ph: 2.1 },
    { c: '240,125,0', r: 560, sp: 0.31, ox: 260, oy: 380, ph: 4.0 },
    { c: '110,36,132', r: 900, sp: 0.11, ox: 120, oy: 200, ph: 1.0 },
  ];

  function drawBackground(t, pulse, energy) {
    const g = bg;
    g.globalCompositeOperation = 'source-over';
    const base = g.createRadialGradient(CX, CY, 50, CX, CY, 1300);
    base.addColorStop(0, '#1F0F4A'); base.addColorStop(0.55, '#0E0730'); base.addColorStop(1, '#05030F');
    g.fillStyle = base; g.fillRect(0, 0, W, H);

    g.globalCompositeOperation = 'lighter';
    // drifting colour orbs
    ORBS.forEach(o => {
      const a = t * o.sp + o.ph;
      const x = CX + Math.cos(a) * o.ox, y = CY + Math.sin(a * 1.3) * o.oy;
      const grd = g.createRadialGradient(x, y, 0, x, y, o.r);
      grd.addColorStop(0, `rgba(${o.c},${(0.20 + 0.10 * pulse).toFixed(3)})`); grd.addColorStop(1, `rgba(${o.c},0)`);
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
    });

    // rotating light rays
    const RAYS = 20, rotA = t * 0.18;
    for (let i = 0; i < RAYS; i++) {
      if (i % 2) continue;
      const a0 = rotA + (i / RAYS) * Math.PI * 2, a1 = a0 + Math.PI / RAYS;
      g.beginPath(); g.moveTo(CX, CY);
      g.lineTo(CX + Math.cos(a0) * 2400, CY + Math.sin(a0) * 2400);
      g.lineTo(CX + Math.cos(a1) * 2400, CY + Math.sin(a1) * 2400); g.closePath();
      g.fillStyle = `hsla(${(i * 18 + t * 50) % 360}, 100%, 60%, ${(0.035 + 0.05 * pulse * energy).toFixed(3)})`;
      g.fill();
    }

    // phyllotaxis spiral (sunflower / galaxy) — slowly rotating, breathing
    const N = 420, golden = Math.PI * (3 - Math.sqrt(5)), spin = t * 0.25, scale = 30 + 4 * pulse;
    for (let i = 1; i < N; i++) {
      const r = Math.sqrt(i) * scale;
      const a = i * golden + spin;
      const x = CX + Math.cos(a) * r, y = CY + Math.sin(a) * r;
      const s = 2 + (i / N) * 5;
      g.fillStyle = `hsla(${(i * 1.6 + t * 90) % 360}, 100%, 65%, ${(0.16 + 0.12 * energy).toFixed(3)})`;
      g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
    }

    // atom: three orbits with electrons
    g.save(); g.translate(CX, CY); g.lineWidth = 3;
    for (let k = 0; k < 3; k++) {
      g.save(); g.rotate(k * Math.PI / 3 + t * 0.12);
      g.strokeStyle = `hsla(${(k * 120 + t * 60) % 360}, 100%, 70%, ${(0.20 + 0.15 * pulse).toFixed(3)})`;
      g.beginPath(); g.ellipse(0, 0, 470, 150, 0, 0, Math.PI * 2); g.stroke();
      const ea = t * (2.2 + k * 0.5) + k * 2;
      const ex = Math.cos(ea) * 470, ey = Math.sin(ea) * 150;
      const eg = g.createRadialGradient(ex, ey, 0, ex, ey, 34);
      eg.addColorStop(0, 'rgba(255,255,255,0.95)'); eg.addColorStop(0.3, `hsla(${(k * 120 + 40) % 360},100%,65%,0.8)`); eg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = eg; g.beginPath(); g.arc(ex, ey, 34, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    g.restore();

    // beat rings
    if (t >= T0) {
      const nb = Math.floor((t - T0) / BEAT);
      for (let b = nb; b >= Math.max(0, nb - 3); b--) {
        const age = t - (T0 + b * BEAT);
        const r = 80 + age * 1500;
        const a = Math.max(0, 0.55 - age * 0.32) * energy;
        if (a <= 0) continue;
        g.strokeStyle = `hsla(${(b * 55) % 360}, 100%, 62%, ${a.toFixed(3)})`;
        g.lineWidth = 14 * Math.max(0.15, 1 - age * 0.5);
        g.beginPath(); g.arc(CX, CY, r, 0, Math.PI * 2); g.stroke();
      }
    }

    // rising stars
    STARS.forEach((s, i) => {
      const y = ((s.y - t * s.v) % H + H) % H;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 2.4 + s.ph));
      g.fillStyle = `rgba(255,255,255,${(0.6 * tw).toFixed(3)})`;
      g.beginPath(); g.arc(s.x, y, s.r, 0, Math.PI * 2); g.fill();
    });
    g.globalCompositeOperation = 'source-over';
  }

  function drawFx(t) {
    const g = fx;
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    BURSTS.forEach((b, bi) => {
      const age = t - b.t;
      if (age < 0 || age > 1.6) return;
      // shock ring
      const rr = 40 + expo(clamp01(age / 0.8)) * 900;
      g.strokeStyle = `hsla(${b.hue}, 100%, 70%, ${(0.8 * (1 - clamp01(age / 0.8))).toFixed(3)})`;
      g.lineWidth = 22 * (1 - clamp01(age / 0.8)) + 1;
      g.beginPath(); g.arc(b.x, b.y, rr, 0, Math.PI * 2); g.stroke();
      // sparks
      for (let i = 0; i < b.n; i++) {
        const a = hash(i + bi * 97) * Math.PI * 2;
        const sp = 500 + hash(i * 7 + bi) * 1300;
        const d = sp * (1 - Math.exp(-age * 2.6)) / 2.6;
        const x = b.x + Math.cos(a) * d, y = b.y + Math.sin(a) * d + age * age * 260;
        const life = 1 - clamp01(age / (0.9 + hash(i + 31) * 0.7));
        if (life <= 0) continue;
        const tail = 26 * life;
        g.strokeStyle = `hsla(${(b.hue + hash(i + 3) * 120) % 360}, 100%, ${65 + 25 * life}%, ${life.toFixed(3)})`;
        g.lineWidth = 2 + 4 * life;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - Math.cos(a) * tail, y - Math.sin(a) * tail); g.stroke();
      }
    });
    g.globalCompositeOperation = 'source-over';
  }

  // section energy (drives ring / ray intensity)
  const energyAt = t => t < 0.5 ? 0.3 : t < 12 ? 1 : t < 14.5 ? 0.85 + 0.15 * Math.sin(t * 20) : t < 21.5 ? 1 : 0.9;

  const camEl = cam, flash = document.getElementById('flash');
  window.openkatanaPage = {
    width: W, height: H, fps: FPS, frames: FRAMES,
    async render(tLocal, f) {
      const t = tLocal + OFFSET;
      await fontReady; await imgsReady;
      const pulse = beatPulse(t), energy = energyAt(t);
      drawBackground(t, pulse, energy);
      drawFx(t);

      // camera: shake on hits, gentle drift, punch-in on beats
      let sx = 0, sy = 0, sr = 0;
      HITS.forEach((h, i) => {
        const a = t - h.t; if (a < 0 || a > 0.6) return;
        const d = Math.exp(-a * 11) * h.amp;
        sx += Math.sin(a * 71 + i) * d; sy += Math.cos(a * 59 + i * 2) * d; sr += Math.sin(a * 43 + i) * d * 0.04;
      });
      const punch = 1 + 0.012 * pulse;
      camEl.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) rotate(${sr.toFixed(3)}deg) scale(${punch.toFixed(4)})`;

      let fl = 0;
      FLASHES.forEach(ft => { const a = t - ft; if (a >= 0 && a < 0.35) fl = Math.max(fl, Math.exp(-a * 14) * 0.5); });
      if (t < 0.5) fl = Math.max(fl, 0);
      flash.style.opacity = fl.toFixed(3);

      ITEMS.forEach(it => animateItem(it, t, pulse));
      await document.fonts.ready;
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    }
  };
})();
