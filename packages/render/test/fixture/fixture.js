// Minimal reelPage for developing/testing the render pipeline without a real style engine.
// Draws each section's REEL items centred, landing each one at its `at` with a short pure-t ramp.
(() => {
  const R = window.REEL;
  const { w, h } = R.format;
  const stage = document.getElementById('stage');
  stage.style.width = `${w}px`;
  stage.style.height = `${h}px`;
  stage.style.background = R.palette.bg;
  document.documentElement.lang = R.spec.language;

  const LAND = 0.25;
  const sections = R.cues.sections.map((s) => {
    const el = document.createElement('div');
    el.className = 'section';
    el.dir = R.spec.language === 'he' ? 'rtl' : 'ltr';
    const items = s.items.map((it, i) => {
      let node;
      if (it.kind === 'logos') {
        node = document.createElement('div');
        node.className = 'logos';
        for (const l of R.logos) {
          const img = document.createElement('img');
          img.src = l.url;
          img.width = Math.round((140 * l.w) / l.h);
          img.height = 140;
          node.append(img);
        }
      } else {
        node = document.createElement('span');
        node.className = 'item';
        if (it.ltr) node.dir = 'ltr';
        node.textContent = it.text;
        node.style.color = it.emphasis ? R.palette.accents[0] : R.palette.text;
      }
      if (i > 0) el.append(document.createTextNode(' '));
      el.append(node);
      return { it, i, node };
    });
    stage.append(el);
    return { s, el, items };
  });

  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const painted = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  let now = 0;

  window.reelPage = {
    width: w,
    height: h,
    async ready() {
      await document.fonts.ready;
      await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
    },
    async seek(t) {
      now = t;
      for (const { s, el, items } of sections) {
        const on = t >= s.timing.in && t < s.timing.out;
        el.style.visibility = on ? 'visible' : 'hidden';
        for (const { it, node } of items) {
          const k = clamp01((t - it.at) / LAND);
          node.style.opacity = String(k);
        }
      }
      await painted();
    },
    boxes() {
      const out = [];
      for (const { s, items } of sections) {
        if (!(now >= s.timing.in && now < s.timing.out)) continue;
        for (const { it, i, node } of items) {
          if (now < it.at) continue;
          const r = node.getBoundingClientRect();
          out.push({ section: s.id, unit: i, text: it.kind === 'logos' ? '' : node.textContent, x: r.x, y: r.y, w: r.width, h: r.height });
        }
      }
      return out;
    },
    fingerprint(t0, t1) {
      return {
        format: R.format,
        palette: R.palette,
        sections: R.cues.sections
          .filter((s) => s.timing.in < t1 && s.timing.out > t0)
          .map((s) => ({ id: s.id, timing: s.timing, items: s.items })),
      };
    },
    /** One pop per landing: enough to drive the SFX stem through the real pipeline. */
    soundCues() {
      return R.cues.cues.filter((c) => c.type === 'land').map((c) => ({ t: c.t, kind: 'pop', weight: c.weight, section: c.section }));
    },
  };
})();
