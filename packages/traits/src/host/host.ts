/**
 * The generic page host: implements `ReelPage` for any combination of traits (PLAN.md §5). It builds scene layers
 * from `REEL.scenes`, units from the cue sheet's items, runs the traits' hooks in axis order every frame and commits
 * all channels in one pass. Every frame is a pure function of t. Guide: `packages/traits/README.md`.
 */
import type { ResolvedPalette, SoundCue, TextBox, TraitAxis } from '@reel/core';
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
import { finishCues } from '../lib/sound.ts';

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
type Owned = HTMLElement | SVGElement;
/** One trait instance (per layer for layer axes, per section otherwise) and the DOM it owns. */
interface Instance<T, C> {
  trait: T;
  c: C;
  /** Elements created through `host.el` / registered with `host.own` during this instance's hooks. */
  owned: Owned[];
  /** Owned elements the host hid while the instance was idle → their inline `display` before that. */
  parked: Map<Owned, string>;
}
type AnyInstance = Instance<AnyTrait, LayerCtx<Record<string, number>>>;
interface SectionState extends Mutable<Section> {
  units: Unit[];
  ctx: { [A in SectionAxis]: Instance<TraitByAxis[A], SectionCtx<Record<string, number>>> };
}
interface LayerState extends Mutable<Layer> {
  sections: SectionState[];
  ctx: { [A in LayerAxis]: Instance<TraitByAxis[A], LayerCtx<Record<string, number>>> };
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
  /** The trait instance whose setup/layout/mount hook is running: it owns the elements created meanwhile. */
  let owner: AnyInstance | null = null;
  const el: Host['el'] = (tag, cls, parent, style = {}) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    for (const [k, v] of Object.entries(style)) e.style.setProperty(k, v);
    parent?.appendChild(e);
    owner?.owned.push(e);
    return e;
  };

  // ── metrics (Canvas2D, deterministic in Chromium) ──
  const mctx = document.createElement('canvas').getContext('2d')!;
  const metricCache = new Map<string, Metrics>();
  const families = { display: REEL.fonts.display.family, text: REEL.fonts.text.family };
  /**
   * Weight clamped to what the font file has. Layouts ask for fixed weights (900); a static or narrower font would
   * otherwise get Chromium's synthetic bold, which smears the face and no longer matches harfbuzz outlines.
   */
  const fontWeight = (family: 'display' | 'text', w: number): number => {
    const [lo, hi] = REEL.fonts[family].weights;
    return w < lo ? lo : w > hi ? hi : w;
  };
  const metrics: Host['metrics'] = (text, weight, ltr, family = 'display') => {
    weight = fontWeight(family, weight);
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
  /** Beats come from track analysis (own or AI track), not from `t0 + n · 60/bpm`. */
  const DETECTED = REEL.spec.music.source === 'track' || REEL.spec.music.source === 'ai';
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
      color: section.palette.text,
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
    accent: (i, of) => {
      const a = of.palette.accents;
      return a[((i % a.length) + a.length) % a.length]!;
    },
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
    own(e) {
      if (!owner) throw new Error('host.own: call it from a trait’s setup, layout or mount hook');
      if (!owner.owned.includes(e)) owner.owned.push(e);
    },
    async freeze(canvas) {
      const by = owner;
      const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('host.freeze: toBlob failed')))));
      const img = new Image();
      img.decoding = 'sync';
      img.src = URL.createObjectURL(blob);
      await img.decode();
      img.className = canvas.className;
      img.style.cssText = canvas.style.cssText;
      if (!canvas.style.width) img.style.width = `${canvas.width}px`;
      if (!canvas.style.height) img.style.height = `${canvas.height}px`;
      canvas.replaceWith(img);
      const k = by?.owned.indexOf(canvas) ?? -1;
      if (by && k >= 0) by.owned[k] = img;
      return img;
    },
    beatPulse,
    pan(u, t = u.at) {
      const s = u.section as SectionState;
      const L = s.layer as LayerState;
      const v = L.ctx.camera.trait.view(L.ctx.camera.c, Number.isFinite(t) ? t : s.timing.holdStart);
      const ink = u.inkBox;
      const gx = u.box.x + (ink ? u.textAt.x + ink.x + ink.w / 2 : u.box.w / 2);
      const gy = u.box.y + (ink ? u.textAt.y + ink.y + ink.h / 2 : u.box.h / 2);
      const pr = (s.place.rot * Math.PI) / 180;
      const lx = s.place.x + gx * Math.cos(pr) - gy * Math.sin(pr);
      const ly = s.place.y + gx * Math.sin(pr) + gy * Math.cos(pr);
      const vr = (-v.r * Math.PI) / 180;
      const x = host.safe.cx + v.s * ((lx - v.x) * Math.cos(vr) - (ly - v.y) * Math.sin(vr));
      const p = ((x - W / 2) / (W / 2)) * 0.7;
      return p < -0.7 ? -0.7 : p > 0.7 ? 0.7 : p;
    },
  };
  const { cx: CX, cy: CY } = host.safe;
  const IDENTITY: View = { x: CX, y: CY, r: 0, s: 1 };

  // ── scene skeleton: layers, sections, content units (synchronous: needs no fonts) ──
  /** Palette custom properties (`--bg --text --a0…--a7`, accents wrapping around) on `target`. */
  function paletteVars(target: CSSStyleDeclaration, p: ResolvedPalette): void {
    target.setProperty('--bg', p.bg);
    target.setProperty('--text', p.text);
    for (let i = 0; i < 8; i++) target.setProperty(`--a${i}`, p.accents[i % p.accents.length]!);
  }

  // ── scene skeleton: layers, sections, content units (synchronous: needs no fonts) ──
  function skeleton(): void {
    const root = document.documentElement.style;
    paletteVars(root, PAL);
    root.setProperty('--display', `"${families.display}"`);
    root.setProperty('--textfont', `"${families.text}"`);
    Object.assign(stage.style, { width: `${W}px`, height: `${H}px` });

    const cueSections = new Map(REEL.cues.sections.map((s) => [s.id, s]));
    const order = REEL.cues.sections.map((s) => s.id);
    const scenes = REEL.scenes;
    if (scenes.flatMap((s) => s.sections).join('\n') !== order.join('\n')) throw new Error('REEL.scenes does not cover the sections in order');

    scenes.forEach((scene, li) => {
      const lel = el('div', 'layer', stage);
      // one palette per layer (world chains require equal palettes): its custom properties scope every trait's CSS
      const palette = REEL.styles[scene.sections[0]!]!.palette;
      paletteVars(lel.style, palette);
      const under = el('div', 'under', lel);
      const cam = el('div', 'cam', lel);
      const back = el('div', 'back', cam);
      const content = el('div', 'content', cam);
      const over = el('div', 'over', lel);
      const layer = {
        index: li,
        world: scene.world,
        palette,
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
          palette: REEL.styles[id]!.palette,
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
        ctx[axis] = {
          trait: traitFor(axis, st.traits[axis]),
          c: { host, layer: L, params: axisParams(st.params, axis) },
          owned: [],
          parked: new Map(),
        };
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
          owned: [],
          parked: new Map(),
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

  /** Every trait instance of `axis`: one per layer for layer axes, one per section otherwise. */
  const instancesOf = (axis: TraitAxis): AnyInstance[] =>
    isLayerAxis(axis) ? layers.map((L) => L.ctx[axis] as AnyInstance) : sections.map((s) => s.ctx[axis] as AnyInstance);

  /** Runs `fn` for one instance, which owns the elements created meanwhile. */
  async function as(i: AnyInstance, fn: () => unknown): Promise<void> {
    owner = i;
    try {
      await fn();
    } finally {
      owner = null;
    }
  }

  /** Runs `fn` for every instance of `axis`, as its owner. */
  async function each(axis: TraitAxis, fn: (trait: AnyTrait, c: LayerCtx<Record<string, number>>) => unknown): Promise<void> {
    for (const i of instancesOf(axis)) await as(i, () => fn(i.trait, i.c));
  }

  // ── setup (once): fonts → motion/rhythm → unit.prepare → layout → ordinals → prepares → setups → DOM → mounts ──
  async function setup(): Promise<void> {
    skeleton();
    const [, imgs] = await Promise.all([loadFonts(REEL.fonts), decodeImages(REEL.logos.map((l) => l.url))]);
    REEL.logos.forEach((l, i) => images.set(l.url, imgs[i]!));

    for (const s of sections) {
      s.motion = s.ctx.motion.trait.curves(s.ctx.motion.c);
      await as(s.ctx.rhythm as AnyInstance, () => s.ctx.rhythm.trait.setup?.(s.ctx.rhythm.c));
    }
    for (const s of sections) for (const u of [...s.units]) s.ctx.unit.trait.prepare?.(s.ctx.unit.c, u);
    for (const L of layers) await as(L.ctx.layout as AnyInstance, () => L.ctx.layout.trait.layout(L.ctx.layout.c));
    for (const s of sections) for (const u of s.units) if (u.font.size) u.font.weight = fontWeight(u.font.family, u.font.weight);

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
    sounds = collectSounds();
  }

  // ── sound cues (once, after mount) ──
  let sounds: SoundCue[] | null = null;

  /** Every instance's `sounds`, plus the host's landing sounds for sections whose reveal has none; thinned. */
  function collectSounds(): SoundCue[] {
    const raw: SoundCue[] = [];
    for (const axis of AXES) {
      for (const i of instancesOf(axis)) {
        const own = (i.c as Partial<SectionCtx<unknown>>).section?.id;
        for (const c of i.trait.sounds?.(i.c as never) ?? []) raw.push(c.section === undefined && own ? { ...c, section: own } : c);
      }
    }
    for (const s of sections) {
      if (s.ctx.reveal.trait.sounds) continue;
      for (const u of s.units) {
        if (u.item < 0 || !Number.isFinite(u.at)) continue;
        const pan = host.pan(u);
        raw.push(
          u.hit
            ? { t: u.hit.t, kind: 'impact', weight: Math.min(1, 0.35 + u.hit.amp / 40), pan, section: s.id }
            : { t: u.at, kind: 'pop', weight: u.emphasis ? 0.55 : 0.35, pan, section: s.id },
        );
      }
    }
    return finishCues(raw, REEL.cues.duration);
  }

  function soundCues(): SoundCue[] {
    if (!sounds) throw new Error('reelPage.soundCues(): call it after ready()');
    return sounds.map((c) => ({ ...c }));
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
        // `clip`, not `hidden`: an overflow:hidden box is a scroll container, which Chromium composites
        ...(u.masked ? { overflow: 'clip' } : {}),
        ...u.style,
      });
      u.el = e;
      if (!u.text && u.html === null && !u.mount) continue;
      const fam = u.font.family === 'text' ? 'var(--textfont)' : 'var(--display)';
      const inner = el('div', ['t', u.innerCls, u.ltr ? 'ltr' : ''].filter(Boolean).join(' '), e, {
        left: px(u.textAt.x),
        top: px(u.textAt.y),
        'font-family': `${fam}, sans-serif`,
        ...(u.font.size ? { 'font-size': px(u.font.size), 'font-weight': String((u.font.weight = fontWeight(u.font.family, u.font.weight))) } : {}),
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
    // Every instance gets a frame-time hook on every seek: `frame` when its layer/section is evaluated, otherwise
    // `idle` or, by default, the host hides the elements it owns (so nothing from an earlier seek can linger).
    for (const axis of AXES) {
      for (const i of instancesOf(axis)) {
        const L = i.c.layer as LayerState;
        const evaluated = active.includes(L);
        if (evaluated) unpark(i);
        else if (i.trait.idle) i.trait.idle(i.c as never, t);
        else park(i);
        if (!evaluated) continue;
        if (axis === 'camera') L.view = L.ctx.camera.trait.view(L.ctx.camera.c, t);
        i.trait.frame?.(i.c as never, t);
      }
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

  /** Hides an idle instance's owned elements (once), remembering their inline `display`. */
  function park(i: AnyInstance): void {
    for (const e of i.owned) {
      if (i.parked.has(e)) continue;
      i.parked.set(e, e.style.display);
      e.style.display = 'none';
    }
  }

  /** Restores what `park` hid, before the instance's `frame` rewrites its elements. */
  function unpark(i: AnyInstance): void {
    for (const [e, display] of i.parked) e.style.display = display;
    i.parked.clear();
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
      // a generated grid is fully given by t0 + bpm; a detected one (own/AI track) drifts, so it is keyed whole
      beats: { t0: REEL.cues.t0, bpm: REEL.cues.bpm ?? null, ...(DETECTED ? { grid: REEL.cues.beats } : {}) },
      layers: layersOut,
    };
  }

  defineReelPage({ width: W, height: H, ready: setup, seek, boxes, fingerprint, soundCues });
}
