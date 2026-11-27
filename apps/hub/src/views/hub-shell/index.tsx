// apps-src@1 view stub: hub-shell, the root view of the hub's / route. kit-1008 (its port) replaces this folder.
// It shows its name. Below it, typed, is every function another view of the page calls from it (APPS.md,
// The view stubs): each throws "not ported: hub-shell" until the port replaces it.
export default function HubShell() {
  return (
    <main className="view-stub" data-view="hub-shell">
      <h1>hub-shell</h1>
    </main>
  );
}

// ---- called by other views (compat-scan --stubs) ----
export function bindFleetSwitch(..._args: unknown[]): never {
  throw new Error('not ported: hub-shell');
}

export function fleetSwitch(..._args: unknown[]): never {
  throw new Error('not ported: hub-shell');
}

export function frameFor(..._args: unknown[]): never {
  throw new Error('not ported: hub-shell');
}

export function hubAddr(..._args: unknown[]): never {
  throw new Error('not ported: hub-shell');
}

export function select(..._args: unknown[]): never {
  throw new Error('not ported: hub-shell');
}

export function setFleet(..._args: unknown[]): never {
  throw new Error('not ported: hub-shell');
}

export function tlHash(..._args: unknown[]): never {
  throw new Error('not ported: hub-shell');
}
