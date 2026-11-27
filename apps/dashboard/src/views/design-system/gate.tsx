'use client';
// apps-src@2 (APPS.md, Routes): the / route's root. It renders the shell, except when the page loads at
// #design-system (or one of its anchors, #design-system/<name>) on the app's /: then the shell's
// server-rendered markup is never hydrated (its boundary waits on a promise that never settles, so none
// of its effects runs: no data loop, no /api/ call, no socket), and once the page has loaded the
// design-system view, loaded by a dynamic import (a chunk of its own that / never fetches), takes its
// place. The choice is made once, at load: a later hash change doesn't switch.
import { Suspense, use, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { appPath } from '../../shared/paths';

export const HASH = '#design-system';

/** Whether a page at this path (within the app) and hash shows the design-system view. */
export function isDesignSystem(pathname: string, hash: string): boolean {
  return pathname === '/' && (hash === HASH || hash.startsWith(`${HASH}/`));
}

// Never settles: a Suspense boundary that suspends on it while hydrating keeps the server's markup as it
// is and runs nothing inside it.
const NEVER: Promise<never> = new Promise<never>(() => {});
function Hold(): null {
  use(NEVER);
  return null;
}

export default function Root({ children }: { children: ReactNode }) {
  // read once: false on the server (no location), so the export holds the shell
  const [ds] = useState(() => typeof location !== 'undefined' && isDesignSystem(appPath(), location.hash));
  const [View, setView] = useState<ComponentType | null>(null);
  useEffect(() => {
    if (!ds) return;
    let live = true;
    import('./index').then((m) => { if (live) setView(() => m.default); });
    return () => { live = false; };
  }, [ds]);
  if (View) return <View />;
  return <Suspense fallback={null}>{ds ? <Hold /> : null}{children}</Suspense>;
}
