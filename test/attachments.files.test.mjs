// Dropped files on an answer or a thread action: carried, a path refused, the shape checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { askQuestion, laptop, LAPTOP, logLineCount, newFolderName, newThread, ownerLogFile, questionOf, R, SUP, upload } from './lib/attachments-fixture.mjs';

const turnsOf = (L, tid) => fs.readFileSync(ownerLogFile(L), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((o) => o.type === 'turn' && o.thread === tid);

test('files: an answer and both thread actions carry the dropped files, real paths and real sizes; the schema refuses a loose one (B1, B2, B6)', LAPTOP, async (t) => {
  const L = await laptop(t);
  const png = await upload(L, 'Shot 1.png', crypto.randomBytes(2000));
  const pdf = await upload(L, 'notes.pdf', crypto.randomBytes(3000));
  // the page's sizes are wrong on purpose: the log says the real ones
  const given = [{ name: 'Shot 1.png', path: png, bytes: 1 }, { name: 'notes.pdf', path: pdf, bytes: 1 }];
  const want = [{ name: 'Shot 1.png', path: fs.realpathSync(png), bytes: 2000 }, { name: 'notes.pdf', path: fs.realpathSync(pdf), bytes: 3000 }];
  // B1
  const qid = askQuestion(L);
  const a = await L.api('answer', { id: qid, answer: 'This one', files: given });
  assert.equal(a.status, 200, a.text);
  const set = questionOf(L, qid).updates.find((u) => u.answer !== undefined);
  assert.deepEqual(set.files, want, 'the answer line has both files');
  // B2
  const n = await L.api('thread-new', { title: 'Look at these', text: 'see the shots', files: given });
  assert.equal(n.status, 200, n.text);
  const tid = n.json.out.split('\n')[0];
  assert.deepEqual(turnsOf(L, tid).map((u) => u.files), [want], 'the first turn has the files');
  const s = await L.api('thread-say', { id: tid, text: 'and again', files: [given[1]] });
  assert.equal(s.status, 200, s.text);
  assert.deepEqual(turnsOf(L, tid).map((u) => u.files), [want, [want[1]]], 'the said turn has its file');
  // with no files, a turn is as before
  assert.equal((await L.api('thread-say', { id: tid, text: 'no files', files: [] })).status, 200);
  assert.equal(turnsOf(L, tid).pop().files, undefined, 'files: [] is no files');
  // a folder named as ours that links to another of ours is inside the root, so it is taken; what is
  // recorded is the real path, the file it names, never the path as given (final review 1b F2)
  const alias = path.join(L.folder(), newFolderName());
  fs.symlinkSync(path.dirname(png), alias);
  const viaLink = [{ name: 'Shot 1.png', path: path.join(alias, path.basename(png)), bytes: 1 }];
  const qid2 = askQuestion(L, 'Which link?');
  assert.equal((await L.api('answer', { id: qid2, answer: 'Yes', files: viaLink })).status, 200);
  assert.deepEqual(questionOf(L, qid2).updates.find((u) => u.answer !== undefined).files, [want[0]], 'the answer records the real path');
  assert.equal((await L.api('thread-say', { id: tid, text: 'via a link', files: viaLink })).status, 200);
  assert.deepEqual(turnsOf(L, tid).pop().files, [want[0]], 'the turn records the real path');
  // B6: log-check holds every line to the schema
  const ok = L.dt(['log-check']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const file = ownerLogFile(L);
  const kept = fs.readFileSync(file, 'utf8');
  const said = JSON.parse(kept.split('\n').filter(Boolean).find((l) => { const o = JSON.parse(l); return o.type === 'turn' && o.text === 'and again'; }));
  const at = new Date(Date.now() + 5000).toISOString();
  const forged = (files) => `${JSON.stringify({ ...said, id: `u-${at.slice(0, 10).replace(/-/g, '')}-${at.slice(11, 23).replace(/[:.]/g, '')}-owner`, at, files })}\n`;
  for (const [what, files] of [['an extra key', [{ ...want[0], extra: 1 }]], ['11 files', Array.from({ length: 11 }, () => want[0])]]) {
    fs.appendFileSync(file, forged(files));
    const r = L.dt(['log-check']);
    assert.notEqual(r.status, 0, `${what}: log-check passed`);
    assert.match(r.stdout + r.stderr, /files/, `${what}: names files`);
    fs.writeFileSync(file, kept);
  }
  assert.equal(L.dt(['log-check']).status, 0, 'restored');
});

test('files: a path that isn\'t a dropped file in this machine\'s folder is refused, naming it, with nothing written (B3)', LAPTOP, async (t) => {
  const L = await laptop(t);
  const stored = await upload(L, 'a.txt', Buffer.from('a'));
  const root = L.folder();
  const folder = path.dirname(stored);
  const mk = (p) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'); return p; };
  const outside = mk(path.join(L.base, 'outside.txt'));
  const link = path.join(folder, 'link.txt');
  fs.symlinkSync(outside, link);
  const ours = path.join(root, newFolderName());
  // a folder named as ours that is itself a link out of the root, to a plain file with a safe name:
  // only the realpath of the whole path sees it is outside (final review F1)
  const linkedFolder = path.join(root, newFolderName());
  fs.symlinkSync(path.dirname(mk(path.join(L.base, 'away', 'x.txt'))), linkedFolder);
  const cases = [
    `${folder}${'/..'.repeat(folder.split('/').length - 1)}/etc/passwd`,
    '/etc/hosts',
    link,
    'a.txt',
    folder,
    path.join(folder, 'missing.txt'),
    mk(path.join(root, 'top.txt')),
    mk(path.join(folder, 'sub', 'x.txt')),
    mk(path.join(ours, R.part)),
    mk(path.join(ours, 'A B.txt')),
    mk(path.join(root, 'not-ours', 'x.txt')),
    // a sibling named with the root's name as a prefix: a startsWith without the separator would pass it
    mk(path.join(`${root}-evil`, path.basename(folder), 'x.txt')),
    path.join(linkedFolder, 'x.txt'),
  ];
  const qid = askQuestion(L);
  const tid = newThread(L);
  const before = logLineCount(L);
  for (const p of cases) {
    const files = [{ name: 'x.txt', path: p, bytes: 1 }];
    for (const [name, body] of [['answer', { id: qid, answer: 'Yes', files }], ['thread-say', { id: tid, text: 'look', files }], ['thread-new', { title: 'T', text: 'look', files }]]) {
      const r = await L.api(name, body);
      assert.equal(r.status, 400, `${name} ${p}: ${r.text}`);
      assert.ok(r.json?.error?.includes(p), `${name} ${p}: the error names it: ${r.text}`);
      assert.match(r.json.error, p === 'a.txt' ? /is not an absolute path/ : /is not a dropped file in this machine's folder/, `${name} ${p}`);
    }
    assert.equal(logLineCount(L), before, `${p}: nothing written`);
  }
  // a missing root names it
  fs.rmSync(root, { recursive: true, force: true });
  const gone = L.dt(['answer', qid, 'Yes', '--files', JSON.stringify([{ name: 'a.txt', path: stored, bytes: 1 }])]);
  assert.notEqual(gone.status, 0);
  assert.match(gone.stderr, /refused: this machine has no dropped-files folder \(/);
  assert.equal(logLineCount(L), before);
});

test('files: the shape is checked, by the action and by the command, with nothing written (B4, the refused modes)', LAPTOP, async (t) => {
  const L = await laptop(t);
  const stored = await upload(L, 'a.png', Buffer.from('png'));
  const one = { name: 'a.png', path: stored, bytes: 3 };
  const qid = askQuestion(L);
  const tid = newThread(L);
  const before = logLineCount(L);
  const shapes = [
    ['11 files', Array.from({ length: 11 }, () => one)],
    ['an extra key', [{ ...one, extra: 1 }]],
    ['a key missing', [{ name: 'a.png', path: stored }]],
    ['a name with a newline', [{ ...one, name: 'a\n.png' }]],
    // a bidi override would have the owner's card read the name reversed (task review T5-2)
    ['a name with a bidi override', [{ ...one, name: 'a\u202egnp.txt' }]],
    ['a name with a zero-width mark', [{ ...one, name: 'a\u200e.png' }]],
    ['an empty name', [{ ...one, name: '' }]],
    ['a name of 201 characters', [{ ...one, name: 'n'.repeat(201) }]],
    ['bytes -1', [{ ...one, bytes: -1 }]],
    ['bytes 1.5', [{ ...one, bytes: 1.5 }]],
    ['bytes as text', [{ ...one, bytes: '3' }]],
    ['a path over 1024 bytes', [{ ...one, path: `/${'p'.repeat(1024)}` }]],
    ['not an array', 'a.png'],
    ['an object', one],
    ['null in the list', [null]],
  ];
  for (const [what, files] of shapes) {
    for (const [name, body] of [['answer', { id: qid, answer: 'Yes', files }], ['thread-say', { id: tid, text: 'look', files }], ['thread-new', { title: 'T', text: 'look', files }]]) {
      const r = await L.api(name, body);
      assert.equal(r.status, 400, `${name} ${what}: ${r.text}`);
      assert.ok(r.json?.error, `${name} ${what}: a reason`);
    }
    assert.equal(logLineCount(L), before, `${what}: nothing written`);
  }
  // the command's own refusals: a bare --files, JSON that isn't, and the modes that carry none
  const json = JSON.stringify([one]);
  for (const [what, args, env] of [
    ['a bare --files', ['answer', qid, 'Yes', '--files']],
    ['not JSON', ['answer', qid, 'Yes', '--files', '[nope']],
    ['an empty list', ['answer', qid, 'Yes', '--files', '[]']],
    ['a bare --files on a turn', ['thread', 'say', tid, '--files', '--', 'look']],
  ]) {
    const r = L.dt(args, env);
    assert.notEqual(r.status, 0, what);
    assert.match(r.stderr, /--files is a JSON array of 1 to 10 dropped files/, `${what}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /SyntaxError|at JSON\.parse/, `${what}: no stack`);
  }
  for (const [what, args, env] of [
    ['--defaulted', ['answer', qid, '--defaulted', '--files', json], SUP],
    ['--from-chat', ['answer', qid, 'Yes', '--from-chat', '--said', 'yes', '--files', json], SUP],
    ['--from-turn', ['answer', qid, 'Yes', '--from-turn', 'u-20261117-000000000-owner', '--files', json], SUP],
    ['--decline', ['answer', qid, 'why', '--decline', '--files', json]],
    ['--review-result', ['answer', qid, '--review-result', '-', '--files', json]],
  ]) {
    const r = L.dt(args, env);
    assert.notEqual(r.status, 0, what);
    assert.match(r.stderr, /--files go with the owner's own answer/, `${what}: ${r.stderr}`);
  }
  // the supervisor's reply carries none
  const reply = L.dt(['thread', 'reply', tid, '--files', json, '--', 'ok'], SUP);
  assert.notEqual(reply.status, 0);
  assert.match(reply.stderr, /--files go with the owner's own turn/);
  // refused before its value is read: a bare --files on a reply names the owner's turn, not the shape (task review T5-3)
  const bareReply = L.dt(['thread', 'reply', tid, '--files', '--', 'ok'], SUP);
  assert.notEqual(bareReply.status, 0);
  assert.match(bareReply.stderr, /--files go with the owner's own turn/);
  assert.equal(logLineCount(L), before, 'nothing written');
  // reopen carries none, and says so rather than dropping them (task review T5-4)
  assert.equal(L.dt(['thread', 'resolve', tid, '--outcome', 'done']).status, 0);
  const resolved = logLineCount(L);
  const reopen = L.dt(['thread', 'reopen', tid, '--files', json, '--', 'again']);
  assert.notEqual(reopen.status, 0, 'reopen took --files');
  assert.match(reopen.stderr, /--files go with the owner's own turn/);
  assert.equal(logLineCount(L), resolved, 'reopen wrote nothing');
});
