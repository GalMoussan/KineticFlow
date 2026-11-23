/**
 * The generic page host: implements `ReelPage` for any combination of traits (PLAN.md §5). It builds scene layers
 * from `REEL.scenes`, units from the cue sheet's items, runs the traits' hooks in axis order every frame and commits
 * all channels in one pass. Every frame is a pure function of t. Guide: `packages/traits/README.md`.
 */
import type { TextBox, TraitAxis } from '@reel/core';
import { decodeImages, defineReelPage, loadFonts, splitMeasured } from '@reel/runtime';
import type {
  AnyTrait,
  Channels,
  Host,
  Layer,
  LayerChannels,
  LayerCtx,
  Metrics,
  Motion,
  Part,
  PartChannels,
  Section,
  SectionCtx,
  StageChannels,
  TraitByAxis,
  Unit,
  View,
} from '../contract.ts';
import { commitLayer, commitStage, commitUnit, drawn, resetChannels, resetPart } from './commit.ts';

/** Bump when host behaviour changes pixels for the same inputs (it is part of every fingerprint). */
const HOST_VERSION = 'traits-host@1';

/** Per-frame order (PLAN.md §5.2). Kept here, not imported from core, so the page bundle does not pull in zod. */
const AXES = [
  'rhythm',
  'camera',
  'layout',
  'unit',
  'reveal',
  'motion',
  'axis',
  'material',
  'background',
  'transition',
] as const satisfies readonly TraitAxis[];
type LayerAxis = 'camera' | 'layout' | 'background';
type SectionAxis = Exclude<TraitAxis, LayerAxis>;
const isLayerAxis = (a: TraitAxis): a is LayerAxis => a === 'camera' || a === 'layout' || a === 'background';

const NUMERIC: Partial<Record<string, true>> = { date: true, time: true, stat: true, countdown: true };

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
interface SectionState extends Mutable<Section> {
  units: Unit[];
  ctx: { [A in SectionAxis]: { trait: TraitByAxis[A]; c: SectionCtx<Record<string, number>> } };
}
interface LayerState extends Mutable<Layer> {
  sections: SectionState[];
  ctx: { [A in LayerAxis]: { trait: TraitByAxis[A]; c: LayerCtx<Record<string, number>> } };
}

/** Params of one axis, unprefixed. */
function axisParams(params: Record<string, number>, axis: TraitAxis): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(params)) if (k.startsWith(`${axis}.`)) out[k.slice(axis.length + 1)] = v;
  return out;
}

export function runHost(traits: readonly AnyTrait[]): void {
  const REEL = window.REEL;
  const { w: W, h: H, safe: S } = REEL.format;
  const PAL = REEL.palette;
  const registry = new Map(traits.map((t) => [`${t.meta.axis}/${t.meta.id}`, t]));
  const traitFor = <A extends TraitAxis>(axis: A, id: string): TraitByAxis[A] => {
    const t = registry.get(`${axis}/${id}`);
    if (!t) throw new Error(`trait ${axis}:${id} is not in this bundle`);
    return t as TraitByAxis[A];
  };

  const stage = document.getElementById('stage') as HTMLDivElement;
  const el: Host['el'] = (tag, cls, parent, style = {}) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    for (const [k, v] of Object.entries(style)) e.style.setProperty(k, v);
    parent?.appendChild(e);
    return e;
  };

  // ── metrics (Canvas2D, deterministic in Chromium) ──
  const mctx = document.createElement('canvas').getContext('2d')!;
  const metricCache = new Map<string, Metrics>();
  const families = { display: REEL.fonts.display.family, text: REEL.fonts.text.family };
  const metrics: Host['metrics'] = (text, weight, ltr, family = 'display') => {
    const key = `${family}|${weight}|${ltr}|${text}`;
    let m = metricCache.get(key);
    if (!m) {
      mctx.font = `${weight} 100px "${families[family]}"`;
      mctx.direction = ltr ? 'ltr' : 'rtl';
      mctx.textAlign = 'left';
      mctx.textBaseline = 'alphabetic';
      mctx.fontKerning = 'normal';
      const t = mctx.measureText(text);
      m = {
        bl: t.actualBoundingBoxLeft / 100,
        br: t.actualBoundingBoxRight / 100,
        ia: t.actualBoundingBoxAscent / 100,
        id: t.actualBoundingBoxDescent / 100,
        fa: t.fontBoundingBoxAscent / 100,
        fd: t.fontBoundingBoxDescent / 100,
      };
      metricCache.set(key, m);
    }
    return m;
  };

  const beats = REEL.cues.beats;
  const beatPulse: Host['beatPulse'] = (t, decay = 10) => {
    let lo = 0;
    let hi = beats.length - 1;
    if (hi < 0 || t < beats[0]!) return 0;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (beats[mid]! <= t) lo = mid;
      else hi = mid - 1;
    }
    return Math.exp(-(t - beats[lo]!) * decay);
  };

  const stageCh: StageChannels = { kick: 0, shakeX: 0, shakeY: 0, shakeRot: 0, flash: 0, flashColor: '#FFFFFF' };
  const sections: SectionState[] = [];
  const layers: LayerState[] = [];
  const images = new Map<string, HTMLImageElement>();
  let nextUnitId = 0;
  let building = true;

  const makeUnit = (section: SectionState, item: number, kind: Unit['kind'], init: Partial<Unit>): Unit => {
    const u: Unit = {
      id: nextUnitId++,
      section,
      item,
      kind,
      deco: null,
      text: '',
      emphasis: false,
      ltr: false,
      graphemes: 0,
      at: NaN,
      tags: { hero: false, align: null, line: -1, ordinal: -1, numeric: false },
      font: { family: 'display', size: 0, weight: 400 },
      box: { x: 0, y: 0, w: 0, h: 0 },
      textAt: { x: 0, y: 0 },
      inkBox: null,
      baseline: NaN,
      cls: '',
      innerCls: '',
      style: {},
      innerStyle: {},
      html: null,
      mount: null,
      mountKey: '',
      z: 0,
      split: 'none',
      masked: false,
      revealed: item >= 0,
      color: PAL.text,
      origin: '50% 50%',
      innerOrigin: '50% 50%',
      hit: null,
      data: {},
      el: null,
      inner: null,
      ink: null,
      parts: [],
      els: {},
      ch: {} as Channels,
      ...init,
    };
    resetChannels(u.ch);
    section.units.push(u);
    return u;
  };

  const host: Host = {
    reel: REEL,
    W,
    H,
    safe: {
      ...S,
      w: W - S.left - S.right,
      h: H - S.top - S.bottom,
      cx: S.left + (W - S.left - S.right) / 2,
      cy: S.top + (H - S.top - S.bottom) / 2,
    },
    palette: PAL,
    accent: (i) => PAL.accents[((i % PAL.accents.length) + PAL.accents.length) % PAL.accents.length]!,
    dir: REEL.spec.language === 'he' ? 'rtl' : 'ltr',
    families,
    stage,
    sections,
    layers,
    stageCh,
    images,
    metrics,
    deco(section, init) {
      if (!building) throw new Error('host.deco: decorations can only be created during layout/setup');
      return makeUnit(section as SectionState, -1, 'deco', { revealed: false, ...init });
    },
    zoomRange(section) {
      const s = section as SectionState;
      const L = s.layer as LayerState;
      const cam = L.ctx.camera.trait.range?.(L.ctx.camera.c, s) ?? [1, 1];
      const kick = s.ctx.rhythm.trait.headroom?.(s.ctx.rhythm.c) ?? 1;
      return [cam[0], cam[1] * kick];
    },
    el,
    beatPulse,
  };
  const { cx: CX, cy: CY } = host.safe;
  const IDENTITY: View = { x: CX, y: CY, r: 0, s: 1 };

  // ── scene skeleton: layers, sections, content units (synchronous: needs no fonts) ──
  function skeleton(): void {
    const root = document.documentElement.style;
    root.setProperty('--bg', PAL.bg);
    root.setProperty('--text', PAL.text);
    PAL.accents.forEach((a, i) => root.setProperty(`--a${i}`, a));
    for (let i = PAL.accents.length; i < 8; i++) root.setProperty(`--a${i}`, host.accent(i));
    root.setProperty('--display', `"${families.display}"`);
    root.setProperty('--textfont', `"${families.text}"`);
    Object.assign(stage.style, { width: `${W}px`, height: `${H}px` });

    const cueSections = new Map(REEL.cues.sections.map((s) => [s.id, s]));
    const order = REEL.cues.sections.map((s) => s.id);
    const scenes = REEL.scenes;
    if (scenes.flatMap((s) => s.sections).join('\n') !== order.join('\n')) throw new Error('REEL.scenes does not cover the sections in order');

    scenes.forEach((scene, li) => {
      const lel = el('div', 'layer', stage);
      const under = el('div', 'under', lel);
      const cam = el('div', 'cam', lel);
      const back = el('div', 'back', cam);
      const content = el('div', 'content', cam);
      const over = el('div', 'over', lel);
      const layer = {
        index: li,
        world: scene.world,
        sections: [] as SectionState[],
        start: 0,
        end: REEL.cues.duration,
        el: lel,
        under,
        cam,
        back,
        content,
        over,
        intro: null,
        view: { ...IDENTITY },
        ch: {} as LayerChannels,
        data: {},
      } as unknown as LayerState;
      layers.push(layer);
      for (const id of scene.sections) {
        const cue = cueSections.get(id)!;
        const index = sections.length;
        const prev = sections[index - 1] ?? null;
        const s = {
          index,
          id,
          role: cue.role,
          cue,
          timing: cue.timing,
          style: REEL.styles[id]!,
          layer,
          dir: host.dir,
          prev,
          next: null,
          window: prev ? { t0: prev.timing.out, t1: cue.timing.in } : null,
          units: [],
          group: el('div', 'group', content),
          place: { x: 0, y: 0, rot: 0 },
          frame: { ...IDENTITY },
          bounds: null,
          motion: null as unknown as Motion,
          pulse: (t: number) => s.ctx.rhythm.trait.pulse?.(s.ctx.rhythm.c, t) ?? beatPulse(t),
          travel: (a: View, b: View, k: number) =>
            s.ctx.transition.trait.move?.(s.ctx.transition.c, a, b, k) ?? {
              x: a.x + (b.x - a.x) * k,
              y: a.y + (b.y - a.y) * k,
              r: a.r + (b.r - a.r) * k,
              s: a.s + (b.s - a.s) * k,
            },
          data: {},
          ctx: {} as SectionState['ctx'],
        } as SectionState;
        if (prev) prev.next = s;
        sections.push(s);
        layer.sections.push(s);
      }
    });
    // Layer windows: from its incoming transition's start to the end of the next layer's transition.
    layers.forEach((L, i) => {
      const first = L.sections[0]!;
      const next = layers[i + 1]?.sections[0];
      Object.assign(L, { start: first.window?.t0 ?? 0, end: next ? next.window!.t1 : REEL.cues.duration });
    });

    // Trait instances: layer-scoped axes from the layer's first section (a world chain shares them by construction).
    for (const L of layers) {
      const st = L.sections[0]!.style;
      const ctx = {} as Record<LayerAxis, unknown>;
      for (const axis of ['camera', 'layout', 'background'] as const) {
        ctx[axis] = { trait: traitFor(axis, st.traits[axis]), c: { host, layer: L, params: axisParams(st.params, axis) } };
      }
      L.ctx = ctx as LayerState['ctx'];
    }
    for (const s of sections) {
      const ctx = {} as Record<SectionAxis, unknown>;
      for (const axis of AXES) {
        if (isLayerAxis(axis)) continue;
        ctx[axis] = {
          trait: traitFor(axis, s.style.traits[axis]),
          c: { host, layer: s.layer, section: s, params: axisParams(s.style.params, axis) },
        };
      }
      s.ctx = ctx as SectionState['ctx'];
      s.cue.items.forEach((it, i) =>
        makeUnit(s, i, it.kind, {
          text: it.text,
          emphasis: it.emphasis,
          ltr: it.ltr,
          graphemes: it.graphemes,
          at: it.at,
          tags: { hero: false, align: null, line: -1, ordinal: -1, numeric: !!NUMERIC[it.kind] },
        }),
      );
    }
  }

  /** Runs `fn` for every trait of `axis` (per layer or per section). */
  async function each(axis: TraitAxis, fn: (trait: AnyTrait, c: LayerCtx<Record<string, number>>) => unknown): Promise<void> {
    if (isLayerAxis(axis)) for (const L of layers) await fn(L.ctx[axis].trait, L.ctx[axis].c);
    else for (const s of sections) await fn(s.ctx[axis].trait, s.ctx[axis].c);
  }

  // ── setup (once): fonts → motion/rhythm → unit.prepare → layout → ordinals → prepares → setups → DOM → mounts ──
  async function setup(): Promise<void> {
    skeleton();
    const [, imgs] = await Promise.all([loadFonts(REEL.fonts), decodeImages(REEL.logos.map((l) => l.url))]);
    REEL.logos.forEach((l, i) => images.set(l.url, imgs[i]!));

    for (const s of sections) {
      s.motion = s.ctx.motion.trait.curves(s.ctx.motion.c);
      await s.ctx.rhythm.trait.setup?.(s.ctx.rhythm.c);
    }
    for (const s of sections) for (const u of [...s.units]) s.ctx.unit.trait.prepare?.(s.ctx.unit.c, u);
    for (const L of layers) await L.ctx.layout.trait.layout(L.ctx.layout.c);

    let ordinal = 0;
    for (const s of sections) {
      for (const u of s.units) {
        if (u.item >= 0 && u.emphasis && !u.tags.hero && !u.tags.numeric && u.kind !== 'logos') u.tags.ordinal = ordinal++;
      }
    }
    for (const s of sections) {
      for (const u of [...s.units]) if (u.revealed) s.ctx.reveal.trait.prepare?.(s.ctx.reveal.c, u);
      for (const u of [...s.units]) s.ctx.material.trait.prepare?.(s.ctx.material.c, u);
    }
    for (const axis of AXES) if (axis !== 'rhythm') await each(axis, (t, c) => t.setup?.(c as never));
    building = false;

    for (const s of sections) buildSection(s);
    for (const axis of AXES) await each(axis, (t, c) => t.mount?.(c as never));
    for (const L of layers) commitLayer(L, stageCh, IDENTITY, false);
  }

  function buildSection(s: SectionState): void {
    const units = [...s.units].sort((a, b) => a.z - b.z || a.id - b.id);
    for (const u of units) {
      const px = (v: number) => `${v.toFixed(2)}px`;
      const e = el('div', u.cls ? `u ${u.cls}` : 'u', s.group, {
        left: px(u.box.x),
        top: px(u.box.y),
        width: px(u.box.w),
        height: px(u.box.h),
        'transform-origin': u.origin,
        ...(u.masked ? { overflow: 'hidden' } : {}),
        ...u.style,
      });
      u.el = e;
      if (!u.text && u.html === null && !u.mount) continue;
      const fam = u.font.family === 'text' ? 'var(--textfont)' : 'var(--display)';
      const inner = el('div', ['t', u.innerCls, u.ltr ? 'ltr' : ''].filter(Boolean).join(' '), e, {
        left: px(u.textAt.x),
        top: px(u.textAt.y),
        'font-family': `${fam}, sans-serif`,
        ...(u.font.size ? { 'font-size': px(u.font.size), 'font-weight': String(u.font.weight) } : {}),
        color: u.color,
        'transform-origin': u.innerOrigin,
        ...u.innerStyle,
      });
      u.inner = inner;
      if (u.html !== null) inner.innerHTML = u.html;
      else if (u.mount) u.mount(inner);
      else inner.textContent = u.text;
      if (u.split !== 'none' && u.text) {
        u.parts = splitMeasured(inner, u.split)
          .filter((m) => m.wordLike)
          .map((m, index): Part => {
            const ch = {} as PartChannels;
            resetPart(ch);
            return { index, text: m.text, span: m.span, x: m.x, y: m.y, w: m.w, h: m.h, ch };
          });
      }
      if (u.inkBox) {
        u.ink = el('div', 'ink', inner, {
          left: px(u.inkBox.x),
          top: px(u.inkBox.y),
          width: px(u.inkBox.w),
          height: px(u.inkBox.h),
        });
      }
    }
    // Place the group only after splitMeasured has measured untransformed text.
    s.group.style.transform = `translate(${s.place.x}px, ${s.place.y}px) rotate(${s.place.rot}deg)`;
  }

  // ── frame ──
  const activeAt = (L: LayerState, t: number) => t >= L.start && (t < L.end || L.index === layers.length - 1);

  function seek(t: number): void {
    Object.assign(stageCh, { kick: 0, shakeX: 0, shakeY: 0, shakeRot: 0, flash: 0, flashColor: '#FFFFFF' });
    const active = layers.filter((L) => activeAt(L, t));
    const live = active.flatMap((L) => L.sections);
    for (const L of layers) Object.assign(L.ch, { visible: active.includes(L), opacity: 1, clip: null, tx: 0, ty: 0, s: 1, blur: 0 });
    for (const s of live) {
      for (const u of s.units) {
        resetChannels(u.ch);
        for (const p of u.parts) resetPart(p.ch);
      }
    }
    for (const axis of AXES) {
      if (axis === 'camera') {
        for (const L of active) {
          L.view = L.ctx.camera.trait.view(L.ctx.camera.c, t);
          L.ctx.camera.trait.frame?.(L.ctx.camera.c, t);
        }
      } else if (isLayerAxis(axis)) for (const L of active) L.ctx[axis].trait.frame?.(L.ctx[axis].c as never, t);
      else for (const s of live) s.ctx[axis].trait.frame?.(s.ctx[axis].c as never, t);
    }
    for (const L of active) {
      const first = L.sections[0]!;
      const w = first.window;
      if (L.index === 0 || !w || t < w.t0 || t >= w.t1) continue;
      first.ctx.transition.trait.between?.(first.ctx.transition.c, { ...w, incoming: L, outgoing: layers[L.index - 1]! }, t);
    }
    commitStage(stage, stageCh);
    for (const L of layers) {
      commitLayer(L, stageCh, IDENTITY, activeAt(L, t));
      if (!L.ch.visible || !activeAt(L, t)) continue;
      for (const s of L.sections) for (const u of s.units) commitUnit(u);
    }
  }

  // ── QA read-back ──
  function boxes(): TextBox[] {
    const out: TextBox[] = [];
    for (const L of layers) {
      if (!L.ch.visible || L.el.style.display === 'none') continue;
      for (const s of L.sections) {
        for (const u of s.units) {
          if (u.item < 0 || !u.el || !drawn(u.ch)) continue;
          const r = (u.ink ?? u.el).getBoundingClientRect();
          if (r.right <= 0 || r.bottom <= 0 || r.left >= W || r.top >= H) continue;
          const text = u.kind === 'logos' ? '' : (u.inner?.textContent ?? '').normalize('NFC');
          out.push({ section: s.id, unit: u.item, text, x: r.x, y: r.y, w: r.width, h: r.height });
        }
      }
    }
    return out;
  }

  // ── cache fingerprint ──
  const unitSnapshot = (u: Unit) => ({
    item: u.item,
    kind: u.kind,
    deco: u.deco,
    text: u.text,
    at: u.at,
    emphasis: u.emphasis,
    ltr: u.ltr,
    tags: u.tags,
    font: u.font,
    box: u.box,
    textAt: u.textAt,
    inkBox: u.inkBox,
    baseline: u.baseline,
    cls: u.cls,
    innerCls: u.innerCls,
    style: u.style,
    innerStyle: u.innerStyle,
    html: u.html,
    mountKey: u.mountKey,
    z: u.z,
    split: u.split,
    masked: u.masked,
    revealed: u.revealed,
    color: u.color,
    origin: u.origin,
    innerOrigin: u.innerOrigin,
    hit: u.hit,
    data: u.data,
  });

  /** World layers: sections whose bounds can enter the view at any sub-frame of [t0, t1] (or that are live then). */
  function shownInWorld(L: LayerState, t0: number, t1: number): Set<SectionState> {
    const shown = new Set<SectionState>();
    for (const s of L.sections) {
      if (!s.bounds || (s.timing.in < t1 && s.timing.out >= t0)) shown.add(s);
    }
    const M = 80; // screen px of slack (shake, blur, kicks only zoom in)
    const corners = [
      [-CX - M, -CY - M],
      [W - CX + M, -CY - M],
      [-CX - M, H - CY + M],
      [W - CX + M, H - CY + M],
    ] as const;
    const step = 1 / (REEL.cues.fps * 4);
    for (let t = t0; t <= t1 + 1e-9; t += step) {
      const v = L.ctx.camera.trait.view(L.ctx.camera.c, t);
      const a = (v.r * Math.PI) / 180;
      const [c, sn] = [Math.cos(a), Math.sin(a)];
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const [sx, sy] of corners) {
        const vx = sx / v.s;
        const vy = sy / v.s;
        const px = v.x + vx * c - vy * sn;
        const py = v.y + vx * sn + vy * c;
        x0 = Math.min(x0, px);
        x1 = Math.max(x1, px);
        y0 = Math.min(y0, py);
        y1 = Math.max(y1, py);
      }
      for (const s of L.sections) {
        const b = s.bounds;
        if (b && b.x1 + 40 > x0 && b.x0 - 40 < x1 && b.y1 + 40 > y0 && b.y0 - 40 < y1) shown.add(s);
      }
    }
    return shown;
  }

  function fingerprint(t0: number, t1: number): unknown {
    const layersOut = layers
      .filter((L) => L.start < t1 && (L.end > t0 || L.index === layers.length - 1))
      .map((L) => {
        const shown = L.world ? shownInWorld(L, t0, t1) : new Set(L.sections);
        const layerTraits = Object.fromEntries(
          (['camera', 'layout', 'background'] as const).map((axis) => {
            const { trait, c } = L.ctx[axis];
            return [axis, { id: trait.meta.id, params: c.params, fp: trait.fingerprint?.(c as never, t0, t1) ?? null }];
          }),
        );
        return {
          index: L.index,
          world: L.world,
          start: L.start,
          end: L.end,
          intro: L.intro,
          data: L.data,
          traits: layerTraits,
          sections: L.sections.map((s) => {
            const hooks = Object.fromEntries(
              AXES.filter((a): a is SectionAxis => !isLayerAxis(a)).map((axis) => {
                const { trait, c } = s.ctx[axis];
                return [axis, trait.fingerprint?.(c as never, t0, t1) ?? null];
              }),
            );
            const brief = { id: s.id, role: s.role, timing: s.timing, window: s.window, style: s.style, hooks };
            if (!shown.has(s)) return brief;
            return { ...brief, place: s.place, frame: s.frame, bounds: s.bounds, data: s.data, units: s.units.map(unitSnapshot) };
          }),
        };
      });
    return {
      host: HOST_VERSION,
      format: REEL.format,
      palette: PAL,
      fonts: REEL.fonts,
      dir: host.dir,
      beats: { t0: REEL.cues.t0, bpm: REEL.cues.bpm ?? null },
      layers: layersOut,
    };
  }

  defineReelPage({ width: W, height: H, ready: setup, seek, boxes, fingerprint });
}
