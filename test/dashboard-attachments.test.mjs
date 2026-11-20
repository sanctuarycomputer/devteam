// kit-171: files dropped into the dashboard's text boxes. An Inbox answer's note, a thread's reply and a new
// thread's composer light up under a drag of files, upload each dropped file through POST /upload (kit-170's
// laptop route, on a throwaway HOME with DEVTEAM_BOX=off), show it as a pill inside the box, and send the taken
// files with the words, or alone. The posted turn and the answered card show each file as a chip: an image opens
// in the artifact viewer as an <img> in the dashboard's own page, any other file downloads.
// Real headless Chrome over a real dashboard; the page's fetch is wrapped only to record what it posts, to hold
// one thread-say while its pending turn is looked at, and (A5 alone) to stand in for one 403.
// Run: /usr/local/bin/node --test --test-concurrency=2 test/dashboard-attachments.test.mjs (Node 22: on 18 the
// Chrome tests skip)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PORTS, bareProject, dashboardOnFreePort } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
// a real 1x1 PNG, so the viewer's <img> decodes it (naturalWidth 1)
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.from(PNG_B64, 'base64').length;
const UPLOAD_MAX = 4096; // the test-only cap (kit-170), so a 6 KB file is refused for real
const FORBIDDEN = "dropped files only from this dashboard's own page";

// The page's fetch: every POST recorded (an upload's name and its body's size), a thread-say held while
// window.__hold is set (released by window.__release()), and with window.__forbid an upload answered 403 as the
// laptop route answers a page whose browser sent no Sec-Fetch-Site. window.__insecure makes isSecureContext false.
const initScript = `(() => {
  const si = window.setInterval;
  window.setInterval = (f, ms, ...a) => si(f, ms === 10000 ? 300 : ms, ...a);
  window.__posts = [];
  window.__uploads = [];
  window.__forbid = false;
  window.__insecure = false;
  const secure = window.isSecureContext;
  Object.defineProperty(window, 'isSecureContext', { configurable: true, get: () => (window.__insecure ? false : secure) });
  let release = null;
  window.__hold = false;
  window.__release = () => { const r = release; release = null; if (r) r(); };
  const real = window.fetch;
  window.fetch = async (u, o) => {
    const url = String(u && u.url ? u.url : u);
    if (o?.method === 'POST' && url.startsWith('/upload')) {
      window.__uploads.push({ url, size: o.body?.size ?? null });
      if (window.__forbid) return new Response(${JSON.stringify(FORBIDDEN)}, { status: 403, headers: { 'content-type': 'text/plain' } });
    }
    if (o?.method === 'POST' && url.startsWith('/api/')) {
      window.__posts.push({ url, body: o.body });
      if (url === '/api/thread-say' && window.__hold) await new Promise((r) => { release = r; });
    }
    return real(u, o);
  };
  // a drop as a drag from the desktop delivers it: dragenter, dragover and drop, each carrying a DataTransfer of
  // Files. files: [{ name, png } | { name, text } | { name, size }]; kinds: which of the three to send.
  window.__dt = (files) => {
    const dt = new DataTransfer();
    for (const f of files) {
      const body = f.png ? Uint8Array.from(atob(${JSON.stringify(PNG_B64)}), (c) => c.charCodeAt(0)) : f.size !== undefined ? new Uint8Array(f.size) : (f.text ?? '');
      dt.items.add(new File([body], f.name, { type: f.png ? 'image/png' : f.name.endsWith('.txt') ? 'text/plain' : '' }));
    }
    return dt;
  };
  window.__drag = (el, kinds, dt) => { for (const k of kinds) el.dispatchEvent(new DragEvent(k, { bubbles: true, cancelable: true, dataTransfer: dt })); };
  window.__drop = (sel, files) => { const el = document.querySelector(sel); if (!el) throw new Error('no ' + sel); window.__drag(el, ['dragenter', 'dragover', 'drop'], window.__dt(files)); };
})();`;

const soonIn = (p, ms = 20000, server = null) => async (expr, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v, err = null;
    try { v = await p.ev(expr); } catch (e) { err = e; }
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out: ${what}${err ? `; last: ${err.message}` : ''}${server ? `; the server said, last: ${JSON.stringify(String(server()).slice(-600))}` : ''}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

// A real dashboard on a throwaway HOME, with the laptop's upload route on (DEVTEAM_BOX=off) and the test-only cap.
async function laptop(t, later) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-attach-ui-'));
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const home = path.join(base, 'home');
  fs.mkdirSync(home);
  const env = { ...process.env, HOME: home, DEVTEAM_BOX: 'off', DEVTEAM_UPLOAD_MAX: String(UPLOAD_MAX), DEVTEAM_HUB_PORT: String(PORTS + 62), DEVTEAM_PORT_BASE: String(PORTS + 63), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'DEVTEAM_HOME', 'DEVTEAM_GATEWAY', 'DEVTEAM_UPLOADS_DIR', 'DEVTEAM_UPLOAD_TOTAL', 'DEVTEAM_UPLOAD_FREE', 'DEVTEAM_UPLOAD_STALL_MS', 'DEVTEAM_UPLOAD_BODY_MS', 'TMUX', 'TMUX_PANE']) delete env[k];
  const root = bareProject(base, 'attachui');
  const dt = (args, role = {}) => { const r = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: root, env: { ...env, ...role }, encoding: 'utf8', timeout: 120000 }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const ask = (q, choices = null) => dt(['ask', '--question', q, ...(choices ? ['--choices', JSON.stringify(choices.map((label) => ({ label })))] : ['--kind', 'owner-decision'])], SUP).split('\n')[0];
  const thread = (words) => dt(['thread', 'new', '--title', words, '--', words]).split('\n')[0];
  const { dash, port } = await dashboardOnFreePort(root, env);
  later(() => dash.stop());
  const uploads = () => { const d = path.join(home, '.devteam', 'uploads'); const out = []; const walk = (x) => { for (const e of fs.existsSync(x) ? fs.readdirSync(x, { withFileTypes: true }) : []) { const f = path.join(x, e.name); if (e.isDirectory()) walk(f); else out.push(f); } }; walk(d); return out; };
  const question = (id) => JSON.parse(dt(['log', '--type', 'question', '--json'])).find((q) => q.id === id);
  const answerLine = (id) => question(id).updates.filter((u) => u.answer !== undefined).pop();
  const turns = (tid) => { const d = path.join(root, 'docs/devteam/run/log'); return fs.readdirSync(d).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(d, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))).filter((o) => o.type === 'turn' && o.thread === tid).sort((a, b) => a.at.localeCompare(b.at)); };
  const threadsNamed = (title) => JSON.parse(dt(['thread', 'list', '--all', '--json'])).filter((x) => x.title === title);
  const api = (name, body) => request(port, `/api/${name}`, 'POST', { origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, JSON.stringify(body));
  const upload = (name, bytes) => request(port, `/upload?name=${encodeURIComponent(name)}`, 'POST', { origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' }, bytes);
  return { base, home, root, env, dash, port, dt, ask, thread, uploads, question, answerLine, turns, threadsNamed, api, upload };
}
function request(port, route, method, headers, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: route, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    r.on('error', reject);
    r.end(body);
  });
}

// --- the server: files alone, and files sent back to the page (B5) --------------------------------------------
test('files alone: the actions and the commands take files with no words, as "N file(s) dropped" (B5)', { timeout: 240000 }, async (t) => {
  const later = cleanup(t);
  const L = await laptop(t, later);
  const up = await L.upload('Shot 1.png', Buffer.from(PNG_B64, 'base64'));
  assert.equal(up.status, 200, up.text);
  const file = { name: 'Shot 1.png', path: up.json.path, bytes: up.json.size };
  // an answer of files alone, from the action and from the CLI
  const q1 = L.ask('Which shot?');
  const a = await L.api('answer', { id: q1, files: [file] });
  assert.equal(a.status, 200, a.text);
  assert.equal(L.answerLine(q1).answer, '1 file dropped', 'the answer names the count');
  assert.equal(L.answerLine(q1).files.length, 1);
  const q2 = L.ask('Pick one', ['Red', 'Blue']);
  assert.equal((await L.api('answer', { id: q2, choice: null, answer: '', files: [file] })).status, 200, 'words alone on a choice card, with files and no words');
  assert.equal(L.answerLine(q2).answer, '1 file dropped');
  const q3 = L.ask('From the terminal?');
  L.dt(['answer', q3, '--files', JSON.stringify([file, file])]);
  assert.equal(L.answerLine(q3).answer, '2 files dropped', 'the CLI with no words');
  // the same with no files: refused as today
  const q4 = L.ask('Nothing at all?');
  assert.equal((await L.api('answer', { id: q4 })).status, 400, 'no words, no choice, no files');
  assert.equal((await L.api('answer', { id: q4, files: [] })).status, 400, 'an empty list is no files');
  // turns of files alone: say, new, and the CLI
  const tid = L.thread('About the shots');
  assert.equal((await L.api('thread-say', { id: tid, text: '', files: [file] })).status, 200);
  assert.equal(L.turns(tid).pop().text, '1 file dropped');
  assert.equal((await L.api('thread-say', { id: tid, files: [file] })).status, 200, 'text missing');
  assert.equal((await L.api('thread-say', { id: tid, text: '' })).status, 400, 'no words, no files');
  const n = await L.api('thread-new', { title: 'Shot 1.png', files: [file] });
  assert.equal(n.status, 200, n.text);
  const nid = n.json.out.split('\n')[0];
  assert.deepEqual(L.turns(nid).map((u) => [u.text, u.files.length]), [['1 file dropped', 1]]);
  assert.equal((await L.api('thread-new', { title: 'Empty', text: '' })).status, 400, 'a new thread with neither');
  L.dt(['thread', 'say', tid, '--files', JSON.stringify([file])]);
  assert.equal(L.turns(tid).pop().text, '1 file dropped', 'thread say from the CLI with no words');
  const cli = L.dt(['thread', 'new', '--files', JSON.stringify([file])]).split('\n')[0];
  assert.equal(JSON.parse(L.dt(['thread', 'show', cli, '--json'])).title, 'Shot 1.png', 'a new thread of files alone is titled by its first file');
  // and the page gets them back: /api/threads' turns and /api/data's answered questions carry files
  const threads = JSON.parse((await request(L.port, '/api/threads', 'GET', { 'sec-fetch-site': 'same-origin' })).text);
  const said = threads.threads.find((x) => x.id === tid).turns.filter((u) => u.files?.length);
  assert.ok(said.length >= 2 && said.every((u) => u.files[0].name === 'Shot 1.png' && u.files[0].bytes === PNG_BYTES), 'turns carry files');
  assert.deepEqual(threads.threads.find((x) => x.id === tid).turns[0].files, [], 'a turn with none: []');
  const data = JSON.parse((await request(L.port, '/api/data', 'GET', { 'sec-fetch-site': 'same-origin' })).text);
  assert.deepEqual(data.ooda.answered.find((x) => x.id === q3).files.map((f) => f.name), ['Shot 1.png', 'Shot 1.png'], 'answered questions carry files');
});

// --- the page --------------------------------------------------------------------------------------------------
test('the page: drop files into the Inbox answer, a reply and a new thread; pills, sending, chips, the viewer', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 300000 }, async (t) => {
  const later = cleanup(t);
  const L = await laptop(t, later);
  const Q1 = L.ask('Ship it?', ['Yes', 'No']);
  const Q2 = L.ask('Which build?');
  const Q3 = L.ask('Which logo?');
  const Q4 = L.ask('Any of these?', ['This', 'That']);
  const T1 = L.thread('Where do we start?');
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: initScript });
  await p.send('Page.navigate', { url: `http://127.0.0.1:${L.port}/#questions` });
  const soon = soonIn(p, 20000, () => L.dash.out());
  const box = (key) => `document.querySelector('.dropbox[data-drop="${key}"]')`;
  const pills = (key) => `[...(${box(key)}?.querySelectorAll('.pill') ?? [])]`;
  const posted = (url) => p.ev(`window.__posts.filter((x) => x.url === ${JSON.stringify(url)}).map((x) => JSON.parse(x.body))`);
  const card = (q) => `document.querySelector('#questions [data-qcard="${q}"]')`;
  await soon(`!!${card(Q1)} && !!${card(Q4)}`, 'the question cards');
  await soon("document.body.classList.contains('threads-open') && getComputedStyle(document.getElementById('threads')).transform === 'none'", 'the panel on Inbox, at rest');
  // what a box's highlight looks like now: its class, border style and colour, and --blue's colour
  const lit = (key) => p.ev(`(() => { const b = ${box(key)}; const s = getComputedStyle(b); const probe = document.createElement('i'); probe.style.color = 'var(--blue)'; b.append(probe); const blue = getComputedStyle(probe).color; probe.remove(); return { on: b.classList.contains('drop-over'), style: s.borderTopStyle, colour: s.borderTopColor, blue }; })()`);
  const highlight = async (key, target) => {
    await p.ev(`window.__drag(${target}, ['dragenter', 'dragover'], window.__dt([{ name: 'a.txt', text: 'a' }])); void 0`);
    const on = await lit(key);
    assert.equal(on.on, true, `${key}: lit under a drag of files`);
    assert.equal(on.style, 'dashed', `${key}: dashed`);
    assert.equal(on.colour, on.blue, `${key}: blue`);
    await p.ev(`${box(key)}.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true, relatedTarget: document.body, dataTransfer: window.__dt([]) })); void 0`);
    assert.equal((await lit(key)).on, false, `${key}: off after dragleave`);
    await p.ev(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'words'); window.__drag(${target}, ['dragenter', 'dragover'], dt); })()`);
    assert.equal((await lit(key)).on, false, `${key}: a drag of text alone lights nothing`);
  };
  // a pill's parts, as the owner sees them
  const pillsOf = (key) => p.ev(`${pills(key)}.map((x) => ({ state: x.dataset.pillState, icon: x.querySelector('i')?.className ?? '', name: x.querySelector('.pill-name')?.textContent ?? '', size: x.querySelector('.pill-size')?.textContent ?? '', why: x.querySelector('.pill-why')?.textContent ?? '', remove: !!x.querySelector('button[data-pill-remove]') }))`);

  await t.test('A1: each of the three boxes lights up, dashed blue, under a drag of files, and not under text', async () => {
    await highlight(`q:${Q1}`, `${card(Q1)}.querySelector('textarea[data-q]')`);
    await p.ev(`location.hash = '#talk/${T1}'; void 0`);
    await soon("!!document.querySelector('#tl-card:not([hidden]) #tl-c-text')", 'the thread card');
    const key = await soon("document.querySelector('#tl-c-text')?.closest('.dropbox')?.dataset.drop", 'the composer in a drop box');
    assert.equal(key, `tl:${T1}`);
    await highlight(key, "document.getElementById('tl-c-text')");
    await p.ev("document.querySelector('[data-tl-new]').click(); void 0");
    const nkey = await soon("(() => { const k = document.querySelector('#tl-c-text')?.closest('.dropbox')?.dataset.drop; return k && k.startsWith('tl:new:') ? k : null; })()", 'the new-thread composer in a drop box');
    await highlight(nkey, "document.getElementById('tl-c-text')");
    await p.ev("document.querySelector('[data-tl-close]')?.click(); location.hash = '#questions'; void 0");
    await soon(`!!${card(Q1)}`, 'back on the Inbox');
  });

  await t.test('A2, A3, B1: an Inbox answer: two uploads, two pills inside the box under the text, one removed, sent with the words', async () => {
    await p.ev(`window.__drop('#questions [data-qcard="${Q1}"] textarea[data-q]', [{ name: 'Shot 1.png', png: true }, { name: 'notes.txt', text: 'hello notes' }]); void 0`);
    await soon(`${pills(`q:${Q1}`)}.length === 2 && ${pills(`q:${Q1}`)}.every((x) => x.dataset.pillState === 'ok')`, 'two taken pills');
    assert.deepEqual(await p.ev('window.__uploads.map((x) => [decodeURIComponent(x.url.split("name=")[1]), x.size])'), [['Shot 1.png', PNG_BYTES], ['notes.txt', 11]], 'one POST /upload per file, its bytes');
    assert.equal(L.uploads().length, 2, 'both stored in the project\'s uploads folder');
    const got = await pillsOf(`q:${Q1}`);
    assert.deepEqual(got.map((x) => [x.name, x.size, x.remove]), [['Shot 1.png', `${PNG_BYTES} B`, true], ['notes.txt', '11 B', true]]);
    assert.match(got[0].icon, /\bicon-image\b/);
    assert.match(got[1].icon, /\bicon-file-text\b/);
    const where = await p.ev(`(() => { const b = ${box(`q:${Q1}`)}.getBoundingClientRect(), ta = ${box(`q:${Q1}`)}.querySelector('textarea').getBoundingClientRect(); return ${pills(`q:${Q1}`)}.map((x) => { const r = x.getBoundingClientRect(); return r.top >= ta.bottom - 0.5 && r.left >= b.left && r.right <= b.right && r.bottom <= b.bottom; }); })()`);
    assert.deepEqual(where, [true, true], 'each pill inside the box, under the text');
    await p.ev(`${pills(`q:${Q1}`)}[1].querySelector('button[data-pill-remove]').click(); void 0`);
    await soon(`${pills(`q:${Q1}`)}.length === 1`, 'the .txt removed');
    await p.ev(`(() => { const c = ${card(Q1)}; c.querySelector('input[data-pick][value="Yes"]').click(); const ta = c.querySelector('textarea[data-q]'); ta.value = 'see the shot'; ta.dispatchEvent(new Event('input', { bubbles: true })); c.querySelector('[data-answer]').click(); })()`);
    await soon(`window.__posts.some((x) => x.url === '/api/answer')`, 'the answer posted');
    const body = (await posted('/api/answer')).find((b) => b.id === Q1);
    assert.equal(body.files.length, 1, 'only the pill left is sent');
    assert.equal(body.files[0].name, 'Shot 1.png');
    assert.equal(body.files[0].bytes, PNG_BYTES);
    assert.match(body.files[0].path, /\/\.devteam\/uploads\/.+\/Shot-1\.png$/);
    const line = await (async () => { for (let i = 0; i < 200; i++) { const l = L.answerLine(Q1); if (l) return l; await new Promise((r) => setTimeout(r, 100)); } return null; })();
    assert.ok(line, 'the answer line written');
    assert.deepEqual(line.files.map((f) => [f.name, f.bytes]), [['Shot 1.png', PNG_BYTES]], 'the log has the file');
  });

  await t.test('A4: a refused upload shows the server\'s reason on its pill, and holds the answer until removed', async () => {
    const before = await p.ev("window.__posts.filter((x) => x.url === '/api/answer').length");
    await p.ev(`window.__drop('#questions [data-qcard="${Q2}"] textarea[data-q]', [{ name: 'big.bin', size: 6144 }]); void 0`);
    await soon(`${pills(`q:${Q2}`)}.some((x) => x.dataset.pillState === 'refused')`, 'the refused pill');
    const [pill] = await pillsOf(`q:${Q2}`);
    assert.ok(pill.why.trim().length > 0, 'a reason');
    assert.doesNotMatch(pill.why, /^HTTP \d+$/, "the server's own words, not a bare status");
    await p.ev(`(() => { const c = ${card(Q2)}; const ta = c.querySelector('textarea[data-q]'); ta.value = 'the second'; ta.dispatchEvent(new Event('input', { bubbles: true })); c.querySelector('[data-answer]').click(); })()`);
    await soon(`(document.getElementById('e-${Q2}')?.textContent ?? '').includes("Remove the files that weren't taken first.")`, 'the refusal line');
    assert.equal(await p.ev("window.__posts.filter((x) => x.url === '/api/answer').length"), before, 'nothing posted');
    await p.ev(`${pills(`q:${Q2}`)}[0].querySelector('button[data-pill-remove]').click(); ${card(Q2)}.querySelector('[data-answer]').click(); void 0`);
    await soon(`window.__posts.filter((x) => x.url === '/api/answer').length === ${before + 1}`, 'posted once removed');
  });

  await t.test('A5: a 403 on a plain-http page says why in plain words; on a secure page, the server\'s words', async () => {
    await p.ev('window.__forbid = true; window.__insecure = true; void 0');
    await p.ev(`window.__drop('#questions [data-qcard="${Q3}"] textarea[data-q]', [{ name: 'a.txt', text: 'a' }]); void 0`);
    await soon(`${pills(`q:${Q3}`)}.some((x) => x.dataset.pillState === 'refused')`, 'refused');
    const [plain] = await pillsOf(`q:${Q3}`);
    assert.match(plain.why, /^This browser doesn't say which page an upload comes from over plain http/);
    assert.ok(plain.why.includes(`http://127.0.0.1:${L.port}`), 'names the address to open');
    await p.ev(`${pills(`q:${Q3}`)}[0].querySelector('button[data-pill-remove]').click(); window.__insecure = false; void 0`);
    await p.ev(`window.__drop('#questions [data-qcard="${Q3}"] textarea[data-q]', [{ name: 'b.txt', text: 'b' }]); void 0`);
    await soon(`${pills(`q:${Q3}`)}.some((x) => x.dataset.pillState === 'refused')`, 'refused again');
    assert.equal((await pillsOf(`q:${Q3}`))[0].why, FORBIDDEN, 'a secure page shows the server\'s words');
    await p.ev(`window.__forbid = false; ${pills(`q:${Q3}`)}[0].querySelector('button[data-pill-remove]').click(); void 0`);
  });

  await t.test('A6: an 11th file is refused without an upload; a drop outside every box does nothing', async () => {
    const n0 = await p.ev('window.__uploads.length');
    await p.ev(`window.__drop('#questions [data-qcard="${Q3}"] textarea[data-q]', Array.from({ length: 11 }, (_, i) => ({ name: 'f' + i + '.txt', text: String(i) }))); void 0`);
    await soon(`${pills(`q:${Q3}`)}.length === 11 && ${pills(`q:${Q3}`)}.filter((x) => x.dataset.pillState === 'ok').length === 10`, 'ten taken, one refused');
    const refused = (await pillsOf(`q:${Q3}`)).filter((x) => x.state === 'refused');
    assert.deepEqual(refused.map((x) => [x.name, x.why]), [['f10.txt', 'At most 10 files go with one message']]);
    assert.equal(await p.ev('window.__uploads.length'), n0 + 10, 'ten uploads, not eleven');
    for (let i = 0; i < 11; i++) await p.ev(`${pills(`q:${Q3}`)}[0]?.querySelector('button[data-pill-remove]').click(); void 0`);
    const href = await p.ev('location.href');
    const n1 = await p.ev('window.__uploads.length');
    const ev = await p.ev("(() => { const dt = window.__dt([{ name: 'stray.txt', text: 'x' }]); const e = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }); const o = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }); document.querySelector('.pagebar').dispatchEvent(o); document.querySelector('.pagebar').dispatchEvent(e); return [o.defaultPrevented, e.defaultPrevented]; })()");
    assert.deepEqual(ev, [true, true], 'the stray drop is held, so the browser never opens the file');
    assert.equal(await p.ev('location.href'), href);
    assert.equal(await p.ev('window.__uploads.length'), n1, 'nothing uploaded');
  });

  await t.test('B2: an Inbox answer of files alone, no pick and no note', async () => {
    await p.ev(`window.__drop('#questions [data-qcard="${Q4}"] textarea[data-q]', [{ name: 'Only.png', png: true }]); void 0`);
    await soon(`${pills(`q:${Q4}`)}.length === 1 && ${pills(`q:${Q4}`)}[0].dataset.pillState === 'ok'`, 'taken');
    await p.ev(`${card(Q4)}.querySelector('[data-answer]').click(); void 0`);
    await soon(`window.__posts.some((x) => x.url === '/api/answer' && JSON.parse(x.body).id === ${JSON.stringify(Q4)})`, 'posted');
    const body = (await posted('/api/answer')).find((b) => b.id === Q4);
    assert.equal(body.files.length, 1);
    assert.equal((body.answer ?? '').trim(), '', 'no words');
    const line = await (async () => { for (let i = 0; i < 200; i++) { const l = L.answerLine(Q4); if (l) return l; await new Promise((r) => setTimeout(r, 100)); } return null; })();
    assert.equal(line?.answer, '1 file dropped');
  });

  await t.test('A2, A3, B1, B3: a reply with words and two files, one removed; its pending turn and its turn show chips', async () => {
    await p.ev(`location.hash = '#talk/${T1}'; void 0`);
    await soon("!!document.querySelector('#tl-card:not([hidden]) #tl-c-text')", 'the thread card');
    const key = `tl:${T1}`;
    await p.ev(`window.__drop('#tl-c-text', [{ name: 'Look.png', png: true }, { name: 'list.txt', text: 'one\\ntwo' }]); void 0`);
    await soon(`${pills(key)}.length === 2 && ${pills(key)}.every((x) => x.dataset.pillState === 'ok')`, 'two taken pills in the composer');
    const where = await p.ev(`(() => { const b = ${box(key)}.getBoundingClientRect(), ta = document.getElementById('tl-c-text').getBoundingClientRect(); return ${pills(key)}.map((x) => { const r = x.getBoundingClientRect(); return r.top >= ta.bottom - 0.5 && r.left >= b.left && r.right <= b.right && r.bottom <= b.bottom; }); })()`);
    assert.deepEqual(where, [true, true], 'inside the composer, under the text');
    await p.ev(`${pills(key)}[1].querySelector('button[data-pill-remove]').click(); void 0`);
    await soon(`${pills(key)}.length === 1`, 'removed');
    await p.ev(`window.__drop('#tl-c-text', [{ name: 'list.txt', text: 'one\\ntwo' }]); void 0`);
    await soon(`${pills(key)}.length === 2 && ${pills(key)}.every((x) => x.dataset.pillState === 'ok')`, 'dropped again');
    await p.ev(`${pills(key)}[1].querySelector('button[data-pill-remove]').click(); void 0`);
    await soon(`${pills(key)}.length === 1`, 'removed again');
    await p.ev("window.__hold = true; (() => { const ta = document.getElementById('tl-c-text'); ta.value = 'here it is'; ta.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-tl-send]').click(); })()");
    await soon("window.__posts.some((x) => x.url === '/api/thread-say')", 'the reply posted');
    const body = (await posted('/api/thread-say')).pop();
    assert.equal(body.text, 'here it is');
    assert.deepEqual(body.files.map((f) => f.name), ['Look.png'], 'only the pill left');
    // pending: the turn is in the card, with its chip, before the server answers
    await soon("[...document.querySelectorAll('#tl-c-turns .tl-turn')].some((u) => u.textContent.includes('here it is') && u.querySelector('.file-chip'))", 'the pending turn with its chip');
    assert.equal(await p.ev(`${pills(key)}.length`), 0, 'the pills left the box with the words');
    await p.ev('window.__hold = false; window.__release(); void 0');
    const turn = await (async () => { for (let i = 0; i < 200; i++) { const u = L.turns(T1).find((x) => x.text === 'here it is'); if (u) return u; await new Promise((r) => setTimeout(r, 100)); } return null; })();
    assert.deepEqual(turn?.files?.map((f) => [f.name, f.bytes]), [['Look.png', PNG_BYTES]], 'the log has the file');
    await soon(`[...document.querySelectorAll('#tl-c-turns .tl-turn')].some((u) => u.textContent.includes('here it is') && u.querySelector('.file-chip .chip-name')?.textContent === 'Look.png') && !(TL.pend || []).some((x) => !x.confirmed)`, "the server's turn, with its chip");
  });

  await t.test('B2, B3: a reply of files alone shows its chips and not the words the kit gave it', async () => {
    await p.ev(`window.__drop('#tl-c-text', [{ name: 'report.pdf', text: '%PDF-1.4' }]); void 0`);
    await soon(`${pills(`tl:${T1}`)}.length === 1 && ${pills(`tl:${T1}`)}[0].dataset.pillState === 'ok'`, 'taken');
    await p.ev("document.querySelector('[data-tl-send]').click(); void 0");
    await soon("window.__posts.some((x) => x.url === '/api/thread-say' && !JSON.parse(x.body).text)", 'posted with no words');
    const turn = await (async () => { for (let i = 0; i < 200; i++) { const u = L.turns(T1).find((x) => x.files?.[0]?.name === 'report.pdf'); if (u) return u; await new Promise((r) => setTimeout(r, 100)); } return null; })();
    assert.equal(turn?.text, '1 file dropped');
    await soon("[...document.querySelectorAll('#tl-c-turns .tl-turn')].some((u) => u.querySelector('.file-chip .chip-name')?.textContent === 'report.pdf')", 'its chip');
    const shown = await p.ev("[...document.querySelectorAll('#tl-c-turns .tl-turn')].find((u) => u.querySelector('.file-chip .chip-name')?.textContent === 'report.pdf').textContent");
    assert.doesNotMatch(shown, /1 file dropped/, 'the words the kit filled in are not shown');
  });

  await t.test('B4: an image chip opens the viewer with an <img> in the page; another file is a download', async () => {
    const img = "[...document.querySelectorAll('#tl-c-turns .file-chip')].find((c) => c.querySelector('.chip-name')?.textContent === 'Look.png')";
    assert.equal(await p.ev(`${img}?.tagName`), 'BUTTON');
    await p.ev(`${img}.click(); void 0`);
    await soon("!document.getElementById('artifact-view').hidden && !!document.getElementById('av-img')?.complete && document.getElementById('av-img').naturalWidth > 0", 'the image shown, loaded');
    const v = await p.ev("(() => { const i = document.getElementById('av-img'); return { inStage: !!i.closest('#av-stage'), own: i.ownerDocument === document, src: i.getAttribute('src'), frames: ['av-frame', 'pv-frame'].map((id) => [document.getElementById(id).hidden, document.getElementById(id).getAttribute('src')]) }; })()");
    assert.equal(v.inStage, true);
    assert.equal(v.own, true, "the dashboard's own document");
    assert.match(v.src, /^\/upload\/\d{4}-\d{2}-\d{2}-[0-9a-f]{24}\/Look\.png$/);
    assert.deepEqual(v.frames, [[true, null], [true, null]], 'both frames hidden, empty');
    await p.ev("document.getElementById('av-close').click(); void 0");
    await soon("document.getElementById('artifact-view').hidden && !document.getElementById('av-img')", 'closed, the <img> gone');
    const dl = await p.ev("(() => { const a = [...document.querySelectorAll('#tl-c-turns .file-chip')].find((c) => c.querySelector('.chip-name')?.textContent === 'report.pdf'); return a && { tag: a.tagName, download: a.getAttribute('download'), href: a.getAttribute('href') }; })()");
    assert.equal(dl?.tag, 'A');
    assert.equal(dl.download, 'report.pdf');
    assert.match(dl.href, /^\/upload\/\d{4}-\d{2}-\d{2}-[0-9a-f]{24}\/report\.pdf$/);
    const head = await p.ev(`fetch(${JSON.stringify(dl.href)}).then((r) => [r.status, r.headers.get('content-disposition')])`);
    assert.equal(head[0], 200);
    assert.match(head[1] ?? '', /^attachment/);
  });

  await t.test('A2, A3, B1, B2: new threads, one with words and a file removed, one of files alone, titled by its file', async () => {
    await p.ev("document.querySelector('[data-tl-close]')?.click(); document.querySelector('[data-tl-new]').click(); void 0");
    const key = await soon("(() => { const k = document.querySelector('#tl-c-text')?.closest('.dropbox')?.dataset.drop; return k && k.startsWith('tl:new:') ? k : null; })()", 'the new-thread composer');
    await p.ev(`window.__drop('#tl-c-text', [{ name: 'Plan.png', png: true }, { name: 'drop-me.txt', text: 'x' }]); void 0`);
    await soon(`${pills(key)}.length === 2 && ${pills(key)}.every((x) => x.dataset.pillState === 'ok')`, 'two pills');
    await p.ev(`${pills(key)}[1].querySelector('button[data-pill-remove]').click(); void 0`);
    await p.ev("(() => { const ta = document.getElementById('tl-c-text'); ta.value = 'a new plan'; ta.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-tl-send]').click(); })()");
    await soon("window.__posts.some((x) => x.url === '/api/thread-new' && JSON.parse(x.body).text === 'a new plan')", 'posted');
    const body = (await posted('/api/thread-new')).find((b) => b.text === 'a new plan');
    assert.deepEqual(body.files.map((f) => f.name), ['Plan.png']);
    await soon("!!document.querySelector('[data-tl-close]')", 'its card');
    await p.ev("document.querySelector('[data-tl-close]').click(); document.querySelector('[data-tl-new]').click(); void 0");
    const k2 = await soon("(() => { const k = document.querySelector('#tl-c-text')?.closest('.dropbox')?.dataset.drop; return k && k.startsWith('tl:new:') ? k : null; })()", 'a fresh composer');
    assert.equal(await p.ev(`${pills(k2)}.length`), 0, 'no pills carried into a new draft');
    await p.ev(`window.__drop('#tl-c-text', [{ name: 'Alone.png', png: true }]); void 0`);
    await soon(`${pills(k2)}.length === 1 && ${pills(k2)}[0].dataset.pillState === 'ok'`, 'taken');
    await p.ev("document.querySelector('[data-tl-send]').click(); void 0");
    await soon("window.__posts.some((x) => x.url === '/api/thread-new' && JSON.parse(x.body).title === 'Alone.png')", 'a new thread of files alone, titled by its file');
    const made = await (async () => { for (let i = 0; i < 200; i++) { const m = L.threadsNamed('Alone.png'); if (m.length) return m[0]; await new Promise((r) => setTimeout(r, 100)); } return null; })();
    assert.ok(made, 'the thread made');
    assert.deepEqual(L.turns(made.id).map((u) => [u.text, u.files?.map((f) => f.name)]), [['1 file dropped', ['Alone.png']]]);
  });

  await t.test('B3: the answered card shows each file as a chip', async () => {
    await p.ev("document.querySelector('[data-tl-close]')?.click(); location.hash = '#questions'; void 0");
    const chips = await soon(`(() => { const a = document.getElementById('a-${Q1}'); const c = a ? [...a.querySelectorAll('.file-chip .chip-name')].map((x) => x.textContent) : []; return c.length ? c : null; })()`, 'the answered card with its chip');
    assert.deepEqual(chips, ['Shot 1.png']);
    const alone = await soon(`(() => { const a = document.getElementById('a-${Q4}'); return a && a.querySelector('.file-chip') ? a.textContent : null; })()`, 'the files-alone answer');
    assert.doesNotMatch(alone, /1 file dropped/, 'its filled-in words are not shown');
  });
});
