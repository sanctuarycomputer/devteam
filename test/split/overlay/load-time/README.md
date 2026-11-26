# load-time (kit-891)

In the tree, the CLI's modules do no work while they load (`cutover-tree@1`, then `cli-modules@1`). `cli.mjs` imports every module, then runs `await init();` and `dispatch();`. `rules.mjs` has four rules, applied in this order, each one seeing what the ones before it wrote:

1. **`entry`:** every `fileURLToPath(import.meta.url)` in code under `lib/` becomes `ENTRY`, the path of `cli.mjs`, which `lib/state.mjs` exports. A comment or a string is left alone. Each item gets one site: `N uses of fileURLToPath(import.meta.url) -> ENTRY`, or `(head) N use -> ENTRY`.
2. **`init`:** load-time work moves into `export async function init()` in `lib/state.mjs`, in source order. What moves:
   - every top-level statement outside the dispatch;
   - the values the design names (`NAMED`: argv and its flags, `REPLY_FD`, and the locations `here` through `runDir`);
   - anything that spawns, writes, prints, exits or reads `process.argv` while it loads;
   - to a fixed point, anything that reads a moved name or reaches into another module while it loads.

   A moved declaration keeps its name: `export let X;` in state, assigned only by `init()`. The argv block (`argv` through `flagNum`) moves whole. `init()` is async because the `bash-ok` hook's fast path awaits its stdin. It runs synchronously up to its first `await`, and only that path reaches one.
3. **`dispatch`:** the `dispatch start` region's statements become `export function dispatch()`. The entry gets its two imports, then `await init();` and `dispatch();`.
4. **`setters`:** each top-level `let` that another module writes gets `export function setX(v) { return (X = v); }` beside it, and every such write becomes a call to it. `X = e` becomes `setX((e))`, `X op= e` becomes `setX(X op (e))`, `X ??= e` becomes `X ?? setX((e))`, and a destructuring statement goes through temporaries.
   - Writes are found by a parse: node's own acorn (`--expose-internals`), in one child process, with every name resolved to its scope.
   - Some writes are refused at their site and left as written:
     - `++`/`--`;
     - a destructuring used as a value;
     - a for-in/of target;
     - a local `setX` in scope;
     - a pattern whose default or computed key reads a name it writes;
     - a let whose setter's name is already taken, by a top-level name or a global such as `setTimeout`;
     - a write through a renamed import (`import { X as Q }`, then `Q = 1`).
   - If acorn can't be loaded, the rule is refused as a whole and says so (`node's acorn (--expose-internals) failed: …`). Any other failure of the child is named `the writes child failed: …`.

Then two checks run, after every area's rules. Whatever they refuse is reported stale, and the tree is still written.
- **`load-time`:** refuses any initializer or statement under `lib/` that, while its module loads, does one of these, directly or through a function of its own module it calls:
  - calls an imported function;
  - reads an imported `const`, `let` or `class`;
  - spawns, writes, prints, exits or reads `process.argv`.

  Referencing an imported function declaration (the COMMANDS tables) is allowed.
- **`shared-state`:** refuses every write left to another module's `let`, in any form, in every `lib/` module and in `cli.mjs`. A write through a renamed import names both the local and the let it is.

**kit-892** (ruling `m-20261126-175631334-supervisor`): this ticket owns `cli.mjs` and `init()`. kit-892 changes the guard inside this area, and its touches include it. Until then, the guard runs from `init()` with `self` = `ENTRY` = `cli.mjs`. In a project, it re-runs main's `devteam.mjs`, so `test/split-load-time.test.mjs`'s T7b sets `DEVTEAM_OWN_KIT=1`.

## What the checks can't see

`load-time` reads blanked code without a parser. `shared-state` and `setters` parse. The kit has none of the shapes below. Running the tree is what would catch them: T1 imports every module alone, and T7/T7b run commands.
- **A call through a reference:** a function passed to something not on the iteration list, a getter, or a tagged template of a const. If such a call throws or does builtin work, T1 fails. If it only reads an init-assigned `let`, it gets `undefined` and can pass silently, unless T7/T7b's commands run it.
- **State changed outside a binding:** `delete process.env.X`, the `stdout.write` patch, `Object.assign`, or a property write on a module's own `const`. Neither the check nor the fixed point tracks these. A load-time read that came after such a statement at the source now runs before it.
- **`locals()`:** it reads each item by regex. It can take a module's name for a local, and a load-time read of that name then goes unchecked. It can also take a local for the module's name, and then it refuses, loudly.
- **A write no parse sees:** `eval`, `new Function` or `with`. T5's scanner follows the same design as the child, so a scope mistake both share would pass both.
- **Setters change the order of writes** (spec-4 F1). A destructuring's targets are set after the whole pattern has run, so a pattern can change meaning with nothing refused:
  - a default that calls a function that reads a target: `[X, Y = rd()] = [1]`, with `rd = () => X`;
  - a getter on the source object that reads a target: `({ X, Y } = { X: 5, get Y() { return X; } })`;
  - a pattern that throws partway: at the source the targets before the throw are written, and rewritten none are.
- **Name inference:** `X = () => …` gives the function the name `X`. Once rewritten as `setX((() => …))`, its `.name` is `''`.
