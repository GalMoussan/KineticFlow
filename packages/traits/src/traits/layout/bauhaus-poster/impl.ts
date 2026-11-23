/**
 * Bauhaus poster layout (port of dilemma-reel `reel12.js`). Every section is one screen: a vertical stack of large
 * lines inside the safe area, built from the role and the item count only (never per spec):
 *
 * - Line breaking: emphasised words, every title word (≤ 4 words) and every body word (≤ 6 words) get their own
 *   line; other words fill lines up to `chars` graphemes; a lone word of ≤ 3 graphemes joins its neighbour's line.
 * - Line size: as wide as the safe width allows, capped per role/line (`scale` × cap × the shorter safe side), then
 *   the whole stack is scaled down until it fits the safe height (at the rhythm/camera's largest hold zoom).
 * - Alignment by role: title/tagline/heading/question/list hug the start edge with full-width rules (title: above and
 *   below, others between lines); body/answer/quote alternate start/end lines under a top rule; teaser/cta/stat/
 *   countdown/location/endcard are centred with mid rules; datetime = weekday (start) · date · time (room for a pill).
 * - Decorations: rules (`deco: 'rule'`, revealed: the reveal grows them), the location pin (revealed), the logo badge
 *   (layout-animated). Multi-item lines are placed in `visualOrder`.
 */
import { clamp01, lerp, visualOrder } from '@reel/runtime';
import { defineLayout, type Metrics, type Unit } from '../../../contract.ts';
import { logoBadge, PIN_METRICS, pinSVG } from '../../../lib/deco.ts';
import { surface } from '../../../lib/bauhaus.ts';
import { meta } from './meta.ts';

type Align = 'start' | 'end' | 'center';
interface Piece {
  u: Unit;
  pin: boolean;
  wt: number;
  mt: Metrics;
}
interface LineE {
  t: 'line';
  pieces: Piece[];
  align: Align;
  /** Size cap as a fraction of the shorter safe side. */
  cap: number;
  /** Extra room above/below (× the line's size), e.g. for a pill behind it. */
  padBefore: number;
  padAfter: number;
}
interface RuleE {
  t: 'rule';
  w: 'full' | 'mid' | 'short';
}
interface BadgeE {
  t: 'badge';
  u: Unit;
}
type Entry = LineE | RuleE | BadgeE;

const FIT_MARGIN = 12;
const WORD_GAP = 0.25; // × size between items on one line
/** Roles whose lines hug the start edge with rules between them / alternate start and end lines. */
const STACK: Partial<Record<string, 'start' | 'alt'>> = {
  tagline: 'start', heading: 'start', question: 'start', body: 'alt', answer: 'alt', quote: 'alt',
};

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const rtl = host.dir === 'rtl';
    const ink = surface(host, layer).ink;
    const panel = surface(host, layer).panel;

    for (const s of layer.sections) {
      const [, zoomHi] = host.zoomRange(s);
      const AW = (host.safe.w - 2 * FIT_MARGIN) / zoomHi;
      const AH = (host.safe.h - 2 * FIT_MARGIN) / zoomHi;
      const U = Math.min(AW, AH) * params.scale;
      const X0 = host.safe.cx - AW / 2;
      const X1 = host.safe.cx + AW / 2;
      const TH = Math.max(2, Math.round(0.0058 * Math.min(AW, 1080) * params.rule * 10) / 10);

      const content = s.units.filter((u) => u.item >= 0);
      const of = (...kinds: string[]) => content.filter((u) => kinds.includes(u.kind));
      const P = (u: Unit, wt = 900): Piece => ({ u, pin: false, wt, mt: host.metrics(u.text, wt, u.ltr) });
      const L = (pieces: Piece[], align: Align, cap: number, o: Partial<LineE> = {}): LineE => ({
        t: 'line', pieces, align, cap, padBefore: 0, padAfter: 0, ...o,
      });
      const R = (w: RuleE['w']): RuleE => ({ t: 'rule', w });

      /** Emphasis (and `solo`) words alone; others fill up to `chars` graphemes; tiny lone words join a neighbour. */
      const group = (us: Unit[], solo = false): Unit[][] => {
        const lines: Unit[][] = [];
        let cur: Unit[] = [];
        let n = 0;
        for (const u of us) {
          if (solo || u.emphasis) {
            if (cur.length) lines.push(cur);
            lines.push([u]);
            cur = [];
            n = 0;
          } else if (cur.length && n + 1 + u.graphemes > params.chars) {
            lines.push(cur);
            cur = [u];
            n = u.graphemes;
          } else {
            cur.push(u);
            n += (cur.length > 1 ? 1 : 0) + u.graphemes;
          }
        }
        if (cur.length) lines.push(cur);
        for (let i = 0; i < lines.length && lines.length > 1; i++) {
          const l = lines[i]!;
          if (l.length !== 1 || l[0]!.emphasis || l[0]!.graphemes > 3 || solo) continue;
          if (i + 1 < lines.length) lines[i + 1]!.unshift(l[0]!);
          else lines[i - 1]!.push(l[0]!);
          lines.splice(i--, 1);
        }
        return lines;
      };
      const hasEmph = (us: Unit[]) => us.some((u) => u.emphasis);

      const entries: Entry[] = [];
      const words = of('word');
      const role = s.role;
      if (role === 'title') {
        const lines = group(words, words.length <= 4);
        if (words.length) words.at(-1)!.tags.hero = true;
        entries.push(R('full'), ...lines.map((l) => L(l.map((u) => P(u)), 'start', 0.36)), R('full'));
      } else if (STACK[role] === 'start') {
        const lines = group(words);
        const n = lines.length;
        if (n <= 2) entries.push(R('full'));
        lines.forEach((l, i) => {
          entries.push(L(l.map((u) => P(u)), 'start', hasEmph(l) || i === n - 1 ? 0.32 : 0.22));
          if (i < n - 2) entries.push(R('full'));
        });
      } else if (STACK[role] === 'alt') {
        const lines = group(words, words.length <= 6);
        entries.push(R('full'));
        lines.forEach((l, i) => entries.push(L(l.map((u) => P(u)), i % 2 ? 'end' : 'start', hasEmph(l) ? 0.3 : 0.24)));
      } else if (role === 'datetime') {
        for (const u of content) {
          if (u.kind === 'weekday') entries.push(R('full'), L([P(u, 800)], 'start', 0.17));
          else if (u.kind === 'date') entries.push(L([P(u)], 'center', 0.34));
          else entries.push(L([P(u, 800)], 'center', 0.21, { padBefore: 0.4, padAfter: 0.36 }));
        }
      } else if (role === 'location') {
        const place = of('place');
        const lines = group(place);
        if (place.length) {
          const pin = host.deco(s, { deco: 'pin', at: Math.max(s.timing.in, place[0]!.at - 0.3), revealed: true });
          entries.push(L([{ u: pin, pin: true, wt: 0, mt: PIN_METRICS }], 'center', 0.17));
        }
        for (const l of lines) entries.push(L(l.map((u) => P(u)), 'center', 0.24));
        for (const u of of('city')) entries.push(R('mid'), L([P(u, 800)], 'center', 0.15));
      } else if (role === 'list') {
        for (const u of of('list-title')) entries.push(L([P(u, 700)], 'start', 0.13), R('full'));
        const items = of('list-item');
        items.forEach((u, i) => {
          entries.push(L([P(u, 800)], 'start', 0.17));
          if (i < items.length - 1) entries.push(R('full'));
        });
      } else if (role === 'stat' || role === 'countdown') {
        for (const u of of('stat', 'countdown')) entries.push(L([P(u)], 'center', 0.42));
        const lines = group(words);
        if (lines.length) entries.push(R('mid'));
        for (const l of lines) entries.push(L(l.map((u) => P(u, 800)), 'center', 0.15));
      } else {
        // teaser, cta, endcard and anything else textual: a centred stack
        const lines = group(words);
        const end = role === 'endcard';
        if (end && words.length) words.at(-1)!.tags.hero = true;
        lines.forEach((l, i) => {
          const big = hasEmph(l) || (end && i === lines.length - 1);
          entries.push(L(l.map((u) => P(u)), 'center', role === 'cta' ? 0.34 : big ? 0.32 : 0.24));
          if (role === 'teaser') entries.push(R('mid'));
        });
        const logos = of('logos');
        if (logos.length && lines.length) entries.push(R('short'));
        for (const u of logos) entries.push({ t: 'badge', u });
      }

      // ── sizes at stack scale k (rules keep their thickness) ──
      const inkAt1 = (p: Piece) => p.mt.bl + p.mt.br;
      const lineSize = (l: LineE) =>
        Math.min(l.cap * U, AW / (l.pieces.reduce((a, p) => a + inkAt1(p), 0) + WORD_GAP * (l.pieces.length - 1)));
      const sizeOf = new Map<LineE, number>(entries.filter((e): e is LineE => e.t === 'line').map((l) => [l, lineSize(l)]));
      const badgeAt = (k: number) =>
        logoBadge(host, s, host.reel.logos, AW * 0.9, {
          logoH: 0.2 * U * k, pad: 0.045 * U * k, gap: 0.06 * U * k, radius: 0.05 * U * k,
          fill: '#FEF2E2', border: '#FEF2E2', shadow: null,
        });
      const lineH = (l: LineE, k: number) => {
        const S = sizeOf.get(l)! * k;
        return {
          S,
          asc: Math.max(...l.pieces.map((p) => p.mt.ia)) * S,
          desc: Math.max(...l.pieces.map((p) => p.mt.id)) * S,
        };
      };
      /** Vertical slots of every entry at scale k: [top, height] plus the gap rule before each. */
      const stack = (k: number) => {
        const slots: { y: number; h: number }[] = [];
        let y = 0;
        let prevS = 0;
        entries.forEach((e, i) => {
          const nextLine = entries.slice(i + 1).find((x): x is LineE => x.t === 'line');
          const near = Math.max(prevS, nextLine ? sizeOf.get(nextLine)! * k : 0);
          let h: number;
          if (e.t === 'rule') {
            if (i) y += 0.14 * near;
            h = TH;
            slots.push({ y, h });
            y += h + 0.14 * near;
            return;
          }
          if (e.t === 'badge') {
            if (i) y += 0.18 * U * k;
            h = badgeAt(k).h;
          } else {
            const m = lineH(e, k);
            if (i && entries[i - 1]!.t !== 'rule') y += params.gap * Math.max(prevS, m.S);
            y += e.padBefore * m.S;
            h = m.asc + m.desc;
            prevS = m.S;
          }
          slots.push({ y, h });
          y += h + (e.t === 'line' ? e.padAfter * prevS : 0);
        });
        return { slots, total: y };
      };
      let k = 1;
      let st = stack(1);
      for (let guard = 0; guard < 8 && st.total > AH; guard++) {
        const fixed = entries.filter((e) => e.t === 'rule').length * TH;
        k *= Math.max(0.05, (AH - fixed) / Math.max(1, st.total - fixed)) * 0.998;
        st = stack(k);
      }
      const top = host.safe.cy - st.total / 2;

      // ── place ──
      const lines = entries.map((e) =>
        e.t === 'line' ? { ats: e.pieces.map((p) => p.u.at).filter(Number.isFinite) } : null,
      );
      const ruleAt = (i: number) => {
        const prev = lines.slice(0, i).reverse().find((l) => l && l.ats.length);
        if (prev) return Math.max(...prev!.ats) + 0.08;
        const next = lines.slice(i + 1).find((l) => l && l.ats.length);
        return next ? Math.max(s.timing.in, Math.min(...next.ats) - 0.3) : s.timing.in;
      };
      const widths: number[] = [];
      entries.forEach((e, i) => {
        const slot = st.slots[i]!;
        if (e.t === 'badge') {
          const b = badgeAt(k);
          Object.assign(e.u, {
            box: { x: host.safe.cx - b.w / 2, y: top + slot.y, w: b.w, h: b.h },
            innerStyle: { width: `${b.w.toFixed(2)}px`, height: `${b.h.toFixed(2)}px` },
            mount: b.mount,
            mountKey: b.key,
            revealed: false,
            z: 1,
          });
          e.u.data.layout = { anim: 'badge', at: e.u.at };
          widths[i] = b.w;
          return;
        }
        if (e.t === 'rule') return;
        const { S, asc } = lineH(e, k);
        const base = top + slot.y + asc;
        const inkW = e.pieces.map((p) => inkAt1(p) * S);
        const gap = WORD_GAP * S;
        const total = inkW.reduce((a, b) => a + b, 0) + gap * (e.pieces.length - 1);
        widths[i] = total;
        const startLeft = rtl ? X1 - total : X0;
        const endLeft = rtl ? X0 : X1 - total;
        let x = e.align === 'center' ? host.safe.cx - total / 2 : e.align === 'start' ? startLeft : endLeft;
        const order = visualOrder(e.pieces.map((p) => (p.pin ? (rtl ? '\u200F' : '\u200E') : p.u.text)), host.dir);
        const lineIndex = lines.slice(0, i).filter(Boolean).length;
        for (const j of order) {
          const p = e.pieces[j]!;
          const w = inkW[j]!;
          const u = p.u;
          const padX = 0.08 * S;
          const padY = 0.12 * S;
          const ia = p.mt.ia * S;
          const id = p.mt.id * S;
          u.box = { x: x - padX, y: base - ia - padY, w: w + 2 * padX, h: ia + id + 2 * padY };
          u.baseline = base;
          u.tags.line = lineIndex;
          u.tags.align = e.align === 'center' ? null : e.align;
          if (p.pin) {
            u.textAt = { x: padX, y: padY + ia - 0.864 * S };
            u.html = pinSVG(S, { body: ink, hole: panel, shadow: 'rgba(0,0,0,0.22)' });
            u.origin = '50% 100%';
          } else {
            u.font = { family: 'display', size: S, weight: p.wt };
            const mid = S / 2 + ((p.mt.fa - p.mt.fd) * S) / 2;
            u.textAt = { x: x + p.mt.bl * S - u.box.x, y: base - mid - u.box.y };
            u.inkBox = { x: -p.mt.bl * S, y: -ia + mid, w, h: ia + id };
          }
          x += w + gap;
        }
      });

      // rules: full width (start-origin), or centred mid/short ones sized to their neighbours
      const startOrigin = rtl ? '100% 50%' : '0 50%';
      entries.forEach((e, i) => {
        if (e.t !== 'rule' || !params.rule) return;
        const slot = st.slots[i]!;
        const near = Math.max(widths[i - 1] ?? 0, widths[i + 1] ?? 0);
        const w = e.w === 'full' ? AW : e.w === 'mid' ? Math.min(AW, Math.max(0.3 * AW, near * 1.05)) : 0.3 * Math.min(AW, U);
        const x = e.w === 'full' ? X0 : host.safe.cx - w / 2;
        host.deco(s, {
          deco: 'rule',
          cls: 'prule',
          box: { x, y: top + slot.y, w, h: TH },
          style: { background: ink },
          origin: e.w === 'full' ? startOrigin : '50% 50%',
          at: ruleAt(i),
          revealed: true,
          z: -1,
        });
      });

      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const u of s.units) {
        if (!u.box.w) continue;
        x0 = Math.min(x0, u.box.x);
        y0 = Math.min(y0, u.box.y);
        x1 = Math.max(x1, u.box.x + u.box.w);
        y1 = Math.max(y1, u.box.y + u.box.h);
      }
      s.bounds = Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
    }
  },

  frame({ layer }, t) {
    for (const s of layer.sections) {
      for (const u of s.units) {
        const a = u.data.layout as { anim: 'badge'; at: number } | undefined;
        if (!a) continue;
        // the badge rises out of a mask under the rule, deblurring (reel12 end card)
        const st = a.at - 0.12;
        const k = clamp01((t - st) / 0.4);
        const e = s.motion.enter(k);
        u.ch.visible &&= t >= st;
        u.ch.ty += (1 - e) * u.box.h * 0.9;
        u.ch.opacity *= clamp01(k * 4);
        u.ch.blur += k < 1 ? (1 - e) * 12 : 0;
        const sc = lerp(0.94, 1, e);
        u.ch.sx *= sc;
        u.ch.sy *= sc;
      }
    }
  },
});

