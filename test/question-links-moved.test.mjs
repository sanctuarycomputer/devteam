// An open question says when a page it links changed since it was asked (links_moved, the same
// words answer refuses with), computed once per log read, and metrics tells the supervisor to
// withdraw it and ask again (kit-81).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PORTS, write, dashboardOnFreePort, threadsFixture } from './lib/kit.mjs';

const mock = (title) => ({ 'artifact.json': JSON.stringify({ v: 1, title, summary: 'A page to ask about', by: 'supervisor', for: [] }), 'index.html': `<!doctype html><html><head><title>${title}</title></head><body><p>${title}</p></body></html>\n` });
// Counts each read of an artifact's own folder, only in the dashboard's dashboard-data runs: the
// dashboard's other children (hello every 10 s) read questions too, at times the test doesn't set.
const COUNTER = `import fs from 'node:fs';
if (process.argv.includes('dashboard-data')) {
  const read = fs.readdirSync;
  fs.readdirSync = function (p, ...rest) {
    const m = /\\/artifacts\\/([a-z0-9-]+)$/.exec(String(p));
    if (m) fs.appendFileSync(process.env.LM_COUNT, m[1] + '\\n');
    return read.call(this, p, ...rest);
  };
}
`;

test('an open question says when its linked page moved, once per log read', { timeout: 300000 }, async (t) => {
  const undo = [];
  t.after(async () => { let err = null; for (const f of undo.reverse()) { try { await f(); } catch (e) { err ??= e; } } if (err) throw err; });
  const F = threadsFixture('links-moved');
  undo.push(() => F.done());
  const draft = (wt, slug) => path.join(F.old, '.worktrees', wt, 'docs/devteam/project/artifacts', slug);
  for (const slug of ['moved-mock', 'still-mock']) for (const [rel, text] of Object.entries(mock(slug))) write(path.join(draft('demo-01-draft', slug), rel), text);
  // in a worktree of its own, so removing it removes nothing else
  for (const [rel, text] of Object.entries(mock('gone-mock'))) write(path.join(draft('demo-02-gone', 'gone-mock'), rel), text);
  const counter = path.join(F.base, 'count-reads.mjs');
  const counts = path.join(F.base, 'reads.txt');
  write(counter, COUNTER);
  write(counts, '');
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({
    DEVTEAM_HUB_PORT: String(PORTS + 2), DEVTEAM_PORT_BASE: String(PORTS + 3),
    CLAUDE_CONFIG_DIR: path.join(F.base, 'claude'), CODEX_HOME: path.join(F.base, 'codex'),
    // every GET waits for its own run, never the last run's data
    DEVTEAM_DATA_WAIT_MS: '600000',
    LM_COUNT: counts, NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import ${pathToFileURL(counter).href}`].filter(Boolean).join(' '),
  }));
  undo.push(() => dash.stop());
  // one GET is one finished dashboard-data run: its data, and its reads per slug
  const get = async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/data`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-devteam-stale'), null, 'its own run, not the last one');
    const data = await r.json();
    const reads = {};
    for (const s of fs.readFileSync(counts, 'utf8').split('\n').filter(Boolean)) reads[s] = (reads[s] ?? 0) + 1;
    fs.writeFileSync(counts, '');
    return { data, reads };
  };

  const base = await get();
  assert.deepEqual([base.reads['moved-mock'], base.reads['still-mock'], base.reads['gone-mock']], [1, 1, 1], "the Library's own read of each draft");

  const ask = (slug) => /\bq-\S+/.exec(F.sup(['ask', '--question', 'Does [[mock]] read right?', '--choices', '[{"label":"Yes"},{"label":"No"}]', '--links', JSON.stringify([{ name: 'mock', title: 'The mock', artifact: slug }]), '--stake', '1', '--urgency', '1']))[0];
  const qm = ask('moved-mock');
  const qs = ask('still-mock');
  const qg = ask('gone-mock');
  // a line more: the size changes, whatever the clock's granularity
  fs.appendFileSync(path.join(draft('demo-01-draft', 'moved-mock'), 'index.html'), '<p>changed</p>\n');
  fs.rmSync(path.join(F.old, '.worktrees', 'demo-02-gone'), { recursive: true, force: true });

  const MOVED = `${qm} links the artifact moved-mock, which changed since it was asked; ask again about the page as it is now`;
  const GONE = `${qg} links the artifact gone-mock, which is no longer available; ask again`;
  for (const n of [1, 2]) {
    const { data, reads } = await get();
    const q = (id) => data.questions.find((x) => x.id === id);
    assert.equal(q(qm)?.links_moved, MOVED, `call ${n}: the moved page, in answer's words`);
    assert.equal(q(qs)?.links_moved, null, `call ${n}: the unchanged page`);
    assert.equal(q(qg)?.links_moved, GONE, `call ${n}: the gone page`);
    // the Library's read, and one for the open question linking it: a second resolution makes it 3
    assert.deepEqual([reads['moved-mock'], reads['still-mock'], reads['gone-mock'] ?? 0], [2, 2, 0], `call ${n}: reads per slug`);
  }
});
