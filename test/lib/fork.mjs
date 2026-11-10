// A child of the "devteam kit" run (kit.test.mjs): runs the steps a fork was made for, on the copy
// of the fixture in DEVTEAM_FORK, and writes each step's outcome there for the parent to report.
// Run any other way (no DEVTEAM_FORK) it does nothing.
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { steps, restore, tmp } from './chain.mjs';

const dir = process.env.DEVTEAM_FORK;
if (dir) {
  const mine = restore(dir);
  // (lib/kit.mjs stops this process's tmux server on exit)
  process.on('exit', () => {
    if (!process.env.DEVTEAM_TEST_KEEP) for (const e of fs.readdirSync(tmp)) if (!/^(result-\d+\.json|fork\.log)$/.test(e)) fs.rmSync(path.join(tmp, e), { recursive: true, force: true });
  });
  const plain = (v) => { try { return JSON.parse(JSON.stringify(v ?? null)); } catch { return String(v); } };
  for (const i of mine) {
    test(steps[i].name, async (t) => {
      const said = { skip: null, diagnostics: [] };
      // the step's own calls on its context go through; skip and diagnostic are also passed up
      const ctx = new Proxy(t, {
        get(o, k) {
          if (k === 'skip') return (m) => { said.skip = m ?? ''; return o.skip(m); };
          if (k === 'diagnostic') return (m) => { said.diagnostics.push(m); return o.diagnostic(m); };
          const v = o[k];
          return typeof v === 'function' ? v.bind(o) : v;
        },
      });
      const out = path.join(dir, `result-${i}.json`);
      try {
        await steps[i].fn(ctx);
        fs.writeFileSync(out, JSON.stringify({ ok: true, ...said }));
      } catch (e) {
        fs.writeFileSync(out, JSON.stringify({ ok: false, ...said, error: { name: e?.name, message: e?.message, stack: e?.stack, code: e?.code, actual: plain(e?.actual), expected: plain(e?.expected), operator: e?.operator } }));
        throw e;
      }
    });
  }
}
