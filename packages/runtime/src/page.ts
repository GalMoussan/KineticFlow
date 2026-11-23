import type { ReelPage } from '@reel/core';

/** What a style implements; `defineReelPage` adds readiness gating and the paint barrier. */
export interface ReelPageImpl {
  readonly width: number;
  readonly height: number;
  /** One-time setup (fonts, images, layout). Called once; its promise is shared. */
  ready(): Promise<void>;
  /** Writes the frame state for `t`. Must be a pure function of `t`. */
  seek(t: number): void | Promise<void>;
  boxes: ReelPage['boxes'];
  fingerprint: ReelPage['fingerprint'];
  /** Called only after `ready()` resolved. */
  soundCues: ReelPage['soundCues'];
  destroy?(): void;
}

/** Resolves after two animation frames, i.e. once the current DOM state has been painted. */
export function painted(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  return promise;
}

/**
 * Registers the page as `window.reelPage`. Setup starts immediately; `ready()` resolves when it is done and
 * `seek(t)` resolves only after the frame for `t` has been painted.
 */
export function defineReelPage(impl: ReelPageImpl): ReelPage {
  let setup: Promise<void> | undefined;
  const ready = () => (setup ??= impl.ready());
  const page: ReelPage = {
    width: impl.width,
    height: impl.height,
    ready,
    async seek(t: number) {
      await ready();
      await impl.seek(t);
      await painted();
    },
    boxes: () => impl.boxes(),
    fingerprint: (t0, t1) => impl.fingerprint(t0, t1),
    soundCues: () => impl.soundCues(),
    ...(impl.destroy ? { destroy: () => impl.destroy?.() } : {}),
  };
  window.reelPage = page;
  void ready().catch(() => {}); // start setup now; callers observe failures through ready()/seek()
  return page;
}
