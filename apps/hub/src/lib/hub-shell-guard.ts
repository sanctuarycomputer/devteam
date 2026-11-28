// kit-1008 ruling 3: the shell's call into a stubbed view. A stub's throw (an Error whose message, read once,
// is a string starting "not ported: ") gives the fallback and one warning per function name; anything else
// is rethrown as it was thrown. Compiled to lib-dist/lib/hub-shell-guard.js and unit-tested on Node.

const warned = new Set<string>();

export function ported<R>(name: string, call: () => R, fallback: () => R): R;
export function ported<R>(name: string, call: () => R): R | undefined;
export function ported<R>(name: string, call: () => R, fallback?: () => R): R | undefined {
  try {
    return call();
  } catch (e) {
    const m = stubMessage(e);
    if (m === null) throw e;
    if (!warned.has(name)) { warned.add(name); console.warn(`hub-shell: ${name}: ${m}`); }
    return fallback?.();
  }
}

// the stub's message, read once and typeof checked before it is matched; null for any other throw
function stubMessage(e: unknown): string | null {
  try {
    const m = e instanceof Error ? e.message : undefined;
    return typeof m === 'string' && m.startsWith('not ported: ') ? m : null;
  } catch {
    return null;
  }
}
