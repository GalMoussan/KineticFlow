/** Editor state: the spec draft with undo/redo, autosave, assets, brand kits, selection and toasts. */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { Asset, BrandKit, Catalog, CheckResult, Project, Validation } from '@reel/api';
import type { FormatId } from '@reel/core';
import { api, errorMessage } from './api.ts';
import type { Draft } from './spec.ts';

export type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

export interface Toast {
  id: number;
  text: string;
  tone?: 'error' | 'ok';
  action?: { label: string; run: () => void };
}

export interface Studio {
  catalog: Catalog;
  refreshCatalog(): Promise<void>;
  projectId: string;
  spec: Draft;
  /** Bumps on every spec edit (and undo/redo). */
  version: number;
  update(fn: (d: Draft) => Draft, coalesceKey?: string): void;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
  validation: Validation | null;
  save: SaveState;
  saveError: string | null;
  flush(): Promise<void>;
  brandKit: string | null;
  setBrandKit(id: string | null): void;
  assets: Asset[];
  refreshAssets(): Promise<void>;
  kits: BrandKit[];
  refreshKits(): Promise<void>;
  /** Scrolls to and focuses the control bound to a spec path (`data-path`). */
  select(path: (string | number)[]): void;
  check: CheckResult | null;
  checking: boolean;
  runCheck(): Promise<void>;
  previewFormat: FormatId;
  setPreviewFormat(f: FormatId): void;
  toast(text: string, opts?: Omit<Toast, 'id' | 'text'>): void;
  toasts: Toast[];
  dismissToast(id: number): void;
  renderSheet: boolean;
  setRenderSheet(open: boolean): void;
  /** Render whose live panel is shown in step 5. */
  activeRender: string | null;
  setActiveRender(id: string | null): void;
}

const Ctx = createContext<Studio | null>(null);

export function useStudio(): Studio {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStudio outside <StudioProvider>');
  return s;
}

interface History {
  past: Draft[];
  present: Draft;
  future: Draft[];
  key: string;
  at: number;
  version: number;
}

const COALESCE_MS = 900;
const SAVE_DEBOUNCE_MS = 700;

export function StudioProvider({
  catalog: initialCatalog,
  project,
  initialValidation,
  children,
}: {
  catalog: Catalog;
  project: Project;
  initialValidation: Validation | null;
  children: ReactNode;
}) {
  const [catalog, setCatalog] = useState(initialCatalog);
  const hist = useRef<History>({ past: [], present: project.spec, future: [], key: '', at: 0, version: 0 });
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [validation, setValidation] = useState<Validation | null>(initialValidation);
  const [save, setSave] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [brandKit, setBrandKitState] = useState<string | null>(project.brandKit ?? null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [renderSheet, setRenderSheet] = useState(false);
  const [activeRender, setActiveRender] = useState<string | null>(null);
  const firstFormat = (project.spec.formats?.[0] ?? '9:16') as FormatId;
  const [previewFormat, setPreviewFormat] = useState<FormatId>(firstFormat);

  const savedVersion = useRef(0);
  const saveVersion = useRef(0);
  const brandKitRef = useRef(brandKit);
  const inflight = useRef<Promise<void> | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const toastId = useRef(0);

  const toast = useCallback((text: string, opts: Omit<Toast, 'id' | 'text'> = {}) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-1), { id, text, ...opts }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts.action ? 6000 : 3500);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const doSave = useCallback(async () => {
    const h = hist.current;
    const version = saveVersion.current;
    setSave('saving');
    try {
      const res = await api.saveProject(project.id, h.present, brandKitRef.current);
      savedVersion.current = Math.max(savedVersion.current, version);
      setValidation(res.validation);
      setSaveError(null);
      setSave(savedVersion.current >= saveVersion.current ? 'saved' : 'dirty');
    } catch (e) {
      setSave('error');
      setSaveError(errorMessage(e));
    }
  }, [project.id]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (inflight.current) await inflight.current;
    if (savedVersion.current < saveVersion.current) {
      inflight.current = doSave();
      await inflight.current;
      inflight.current = null;
    }
  }, [doSave]);

  const schedule = useCallback(() => {
    saveVersion.current++;
    setSave('dirty');
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      void flush();
    }, SAVE_DEBOUNCE_MS);
  }, [flush]);

  const update = useCallback(
    (fn: (d: Draft) => Draft, key = '') => {
      const h = hist.current;
      const next = fn(h.present);
      if (next === h.present) return;
      const now = Date.now();
      const coalesce = key !== '' && key === h.key && now - h.at < COALESCE_MS;
      hist.current = {
        past: coalesce ? h.past : [...h.past.slice(-149), h.present],
        present: next,
        future: [],
        key,
        at: now,
        version: h.version + 1,
      };
      bump();
      schedule();
    },
    [schedule],
  );

  const undo = useCallback(() => {
    const h = hist.current;
    const prev = h.past.at(-1);
    if (!prev) return;
    hist.current = { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future], key: '', at: 0, version: h.version + 1 };
    bump();
    schedule();
  }, [schedule]);

  const redo = useCallback(() => {
    const h = hist.current;
    const next = h.future[0];
    if (!next) return;
    hist.current = { past: [...h.past, h.present], present: next, future: h.future.slice(1), key: '', at: 0, version: h.version + 1 };
    bump();
    schedule();
  }, [schedule]);

  const setBrandKit = useCallback(
    (id: string | null) => {
      brandKitRef.current = id;
      setBrandKitState(id);
      schedule();
    },
    [schedule],
  );

  const refreshAssets = useCallback(async () => setAssets(await api.assets()), []);
  const refreshKits = useCallback(async () => setKits(await api.brandKits()), []);
  const refreshCatalog = useCallback(async () => setCatalog(await api.catalog()), []);

  useEffect(() => {
    refreshAssets().catch((e) => toast(`Could not load uploads: ${errorMessage(e)}`, { tone: 'error' }));
    refreshKits().catch(() => {});
  }, [refreshAssets, refreshKits, toast]);

  // Save before the tab closes; warn when that cannot finish.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (savedVersion.current < saveVersion.current) {
        void flush();
        e.preventDefault();
      }
    };
    addEventListener('beforeunload', onUnload);
    return () => removeEventListener('beforeunload', onUnload);
  }, [flush]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const select = useCallback((path: (string | number)[]) => {
    for (let n = path.length; n > 0; n--) {
      const el = document.querySelector<HTMLElement>(`[data-path="${path.slice(0, n).join('.')}"]`);
      if (!el) continue;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const target = el.matches('input,select,textarea,button') ? el : el.querySelector<HTMLElement>('input,select,textarea,button');
      target?.focus({ preventScroll: true });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1200);
      return;
    }
  }, []);

  const runCheck = useCallback(async () => {
    setChecking(true);
    try {
      await flush();
      const res = await api.check(project.id);
      setCheck(res);
      const fails = res.gates.filter((g) => g.level === 'fail').length;
      const warns = res.gates.filter((g) => g.level === 'warn').length;
      toast(fails ? `Check: ${fails} problem${fails > 1 ? 's' : ''} to fix` : warns ? `Check passed with ${warns} warning${warns > 1 ? 's' : ''}` : 'Check passed: ready to render', {
        tone: fails ? 'error' : 'ok',
      });
    } catch (e) {
      toast(`Check failed: ${errorMessage(e)}`, { tone: 'error' });
    } finally {
      setChecking(false);
    }
  }, [flush, project.id, toast]);

  const h = hist.current;
  const value = useMemo<Studio>(
    () => ({
      catalog,
      refreshCatalog,
      projectId: project.id,
      spec: h.present,
      version: h.version,
      update,
      undo,
      redo,
      canUndo: h.past.length > 0,
      canRedo: h.future.length > 0,
      validation,
      save,
      saveError,
      flush,
      brandKit,
      setBrandKit,
      assets,
      refreshAssets,
      kits,
      refreshKits,
      select,
      check,
      checking,
      runCheck,
      previewFormat,
      setPreviewFormat,
      toast,
      toasts,
      dismissToast,
      renderSheet,
      setRenderSheet,
      activeRender,
      setActiveRender,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, h.present, h.version, h.past.length, h.future.length, validation, save, saveError, brandKit, assets, kits, check, checking, previewFormat, toasts, renderSheet, activeRender],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
