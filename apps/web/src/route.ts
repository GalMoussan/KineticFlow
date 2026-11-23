/** Minimal history-API routing: `/` (projects) and `/p/:projectId` (editor). */
import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  addEventListener('popstate', fn);
  return () => {
    listeners.delete(fn);
    removeEventListener('popstate', fn);
  };
}

export function navigate(path: string, replace = false): void {
  if (path === location.pathname) return;
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  for (const fn of listeners) fn();
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => location.pathname);
}

export function projectIdOf(path: string): string | null {
  const m = /^\/p\/([^/]+)\/?$/.exec(path);
  return m ? decodeURIComponent(m[1]!) : null;
}
