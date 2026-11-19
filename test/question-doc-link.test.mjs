// A repo doc named in an owner question opens for the owner (kit-327). Reported from another
// instance (q-20261119-143912078): "arrangements.nyc/docs/booking-to-leads-automation.md on
// ticket/arrangements-230-booking-copy-to-leads" drew the ticket id as a link to the ticket in the
// middle of the branch name, and the file itself was no link at all. linkify and fileHref run here on
// their own source, against a DATA of our own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHA_A = 'a'.repeat(40), SHA_B = 'b'.repeat(40), SHA_C = 'c'.repeat(40);
const DATA = {
  tickets: [
    { id: 'arrangements-230-booking-copy-to-leads', title: 'Booking copy goes to leads', repo: 'arrangements', merge_sha: null },
    { id: 'arr-7', title: 'An earlier one', repo: 'arrangements', merge_sha: SHA_B },
    { id: 'kit-9-done', title: 'A home ticket, merged', repo: 'home', merge_sha: SHA_A },
    { id: 'kit-12', title: 'A home ticket', repo: 'home', merge_sha: null },
  ],
  library: {
    links: [
      // the repo's name (arrangements.nyc) is not its link id (arrangements): either names it
      { id: 'arrangements', kind: 'repo', remote: 'git@github.com:acme/arrangements.nyc.git', url: null, path: null },
      { id: 'console', kind: 'repo', remote: 'acme/console', url: null, path: null },
      { id: 'mirror', kind: 'repo', remote: 'https://gitlab.com/acme/mirror.git', url: null, path: null },
      // a local remote looks like org/repo shorthand but is no GitHub repo
      { id: 'local', kind: 'repo', remote: '../local', url: null, path: null },
      { id: 'docs-site', kind: 'url', remote: null, url: 'https://example.com', path: null },
    ],
  },
};

function dashboard(data = DATA) {
  const html = fs.readFileSync(path.join(ROOT, 'docs/devteam/dashboard/index.html'), 'utf8');
  const src = html.slice(html.indexOf('<script>', html.indexOf('</style>')) + '<script>'.length, html.lastIndexOf('</script>'));
  // a name the page lacks takes its stand-in (repoDocHref is new: on main it is a home path's null,
  // so the tests fail there for the bug, not for a missing name)
  const take = (name, missing) => {
    const fn = src.indexOf(`\nfunction ${name}(`), arrow = src.indexOf(`\nconst ${name} =`);
    const at = (fn >= 0 ? fn : arrow) + 1;
    if (at === 0 && missing) return missing;
    assert.ok(at > 0, name);
    if (fn < 0) return src.slice(at, src.indexOf(';\n', at) + 1);
    let depth = 0, i = src.indexOf('{', at);
    for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
    return src.slice(at, i + 1);
  };
  const ctx = { DATA: data, URLSearchParams };
  vm.createContext(ctx);
  vm.runInContext([
    take('esc'), take('ticketMap'), take('tlink'), take('repoDocHref', 'const repoDocHref = () => null;'), take('fileHref'), take('linkify'),
    'const qlink = (id) => `<a href="#q/${id}">q</a>`;',
    'const idLink = (k, id) => `<a href="#id/${id}">${id}</a>`;',
    'this.linkify = linkify; this.fileHref = fileHref;',
  ].join('\n'), ctx);
  return ctx;
}
const anchors = (h) => [...h.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({ attrs: m[1], text: m[2], href: (/href="([^"]*)"/.exec(m[1]) || [])[1] }));
const unesc = (s) => s.replace(/&amp;/g, '&');

test('the reported question: one whole link to the doc, on GitHub, in a new tab; the branch stays whole', () => {
  const { linkify } = dashboard();
  const h = linkify('The flow is written up in arrangements.nyc/docs/booking-to-leads-automation.md on ticket/arrangements-230-booking-copy-to-leads; read it before you answer.');
  const a = anchors(h);
  assert.equal(a.length, 1, `one link, got: ${h}`);
  assert.equal(unesc(a[0].href), 'https://github.com/acme/arrangements.nyc/blob/ticket/arrangements-230-booking-copy-to-leads/docs/booking-to-leads-automation.md');
  assert.match(a[0].attrs, /target="_blank"/);
  assert.match(a[0].attrs, /rel="noopener noreferrer"/);
  assert.equal(a[0].text, 'arrangements.nyc/docs/booking-to-leads-automation.md');
  assert.ok(h.includes(' on ticket/arrangements-230-booking-copy-to-leads; read it'), `the branch whole, as written: ${h}`);
  assert.ok(!h.includes('#ticket/'), 'no ticket link inside the branch name');
});

test('a doc at a known sha: a merged ticket\'s merge commit in its own repo, or a sha written out', () => {
  const { linkify } = dashboard();
  // the link id names the repo too; the ticket merged there, so its branch may be gone: its merge commit
  let a = anchors(linkify('See arrangements/docs/x.md on ticket/arr-7.'));
  assert.equal(a.length, 1);
  assert.equal(unesc(a[0].href), `https://github.com/acme/arrangements.nyc/blob/${SHA_B}/docs/x.md`);
  a = anchors(linkify(`See console/README.md at ${SHA_C}.`));
  assert.equal(a.length, 1);
  assert.equal(unesc(a[0].href), `https://github.com/acme/console/blob/${SHA_C}/README.md`);
  // a ticket merged in home holds nothing of console: the branch name, not home's merge commit
  a = anchors(linkify('See console/README.md on ticket/kit-9-done.'));
  assert.equal(unesc(a[0].href), 'https://github.com/acme/console/blob/ticket/kit-9-done/README.md');
  // named with no branch: the repo's default branch
  a = anchors(linkify('See console/docs/setup.md.'));
  assert.equal(a.length, 1);
  assert.equal(unesc(a[0].href), 'https://github.com/acme/console/blob/HEAD/docs/setup.md');
});

test('a home doc on a branch opens in the file peek at that branch (its merge commit once merged)', () => {
  const { linkify } = dashboard();
  let a = anchors(linkify('Read docs/devteam/project/tickets/kit-12/spec.md on ticket/kit-12 first.'));
  assert.equal(a.length, 1, 'one link');
  assert.equal(a[0].text, 'docs/devteam/project/tickets/kit-12/spec.md');
  const p = new URLSearchParams(unesc(a[0].href).replace(/^#file\?/, ''));
  assert.ok(unesc(a[0].href).startsWith('#file?'));
  assert.equal(p.get('path'), 'docs/devteam/project/tickets/kit-12/spec.md');
  assert.equal(p.get('ref'), 'ticket/kit-12');
  assert.doesNotMatch(a[0].attrs, /target=/, 'the peek opens here');
  a = anchors(linkify('Read docs/devteam/project/tickets/kit-9-done/spec.md on ticket/kit-9-done.'));
  assert.equal(new URLSearchParams(unesc(a[0].href).replace(/^#file\?/, '')).get('ref'), SHA_A);
  // a repo with no GitHub remote: the peek, of that repo
  a = anchors(linkify('See mirror/docs/x.md on ticket/kit-12.'));
  const m = new URLSearchParams(unesc(a[0].href).replace(/^#file\?/, ''));
  assert.deepEqual([m.get('repo'), m.get('path'), m.get('ref')], ['mirror', 'docs/x.md', 'ticket/kit-12']);
  a = anchors(linkify('See local/docs/x.md on main.'));
  const lo = new URLSearchParams(unesc(a[0].href).replace(/^#file\?/, ''));
  assert.deepEqual([lo.get('repo'), lo.get('path'), lo.get('ref')], ['local', 'docs/x.md', 'main']);
});

test('a ticket id inside a path, branch or filename is never a link of its own; a bare one still is', () => {
  const { linkify } = dashboard();
  for (const s of ['the branch ticket/kit-12 is pushed', 'kit-12/x.md holds it', 'docs/kit-12.md holds it', 'pre-kit-12 and kit-12-old are other names', 'docs/kit-12.md', 'plan/kit-12']) {
    assert.equal(anchors(linkify(s)).length, 0, `no link in "${s}": ${linkify(s)}`);
    assert.equal(linkify(s), s, `"${s}" as written`);
  }
  for (const s of ['kit-12', 'see kit-12.', '(kit-12)', 'kit-12, then kit-9-done', 'kit-12: done']) {
    const a = anchors(linkify(s));
    assert.ok(a.length >= 1 && a.every((x) => x.href.startsWith('#ticket/')), `"${s}" links: ${linkify(s)}`);
  }
  assert.equal(anchors(linkify('kit-12, then kit-9-done')).length, 2);
});

test('what linkify did before stays: a bare path is text, other ids still link, text is escaped', () => {
  const { linkify } = dashboard();
  assert.equal(linkify('see docs/x.md and src/**/x'), 'see docs/x.md and src/**/x', 'a home path with no branch is not guessed at');
  assert.equal(linkify('see https://github.com/acme/console/blob/main/docs/x.md'), 'see https://github.com/acme/console/blob/main/docs/x.md', 'a URL is not taken apart');
  assert.match(linkify('asked in q-20261119-143912078-supervisor'), /href="#q\/q-20261119-143912078-supervisor"/);
  assert.equal(linkify(`at ${SHA_C}`), `at <code>${SHA_C.slice(0, 12)}</code>`);
  assert.equal(linkify('<b>x</b> & docs/x.md'), '&lt;b&gt;x&lt;/b&gt; &amp; docs/x.md');
  // a path inside a URL's query, an address, or numbers is not a doc
  for (const s of ['https://x.example/?a=1&b=console/docs/x.md', 'see ?a=1&console/docs/x.md on main', 'mail ops@console/x.md', 'about 1/2.5 on main', 'see console/docs/x.md-old']) assert.equal(anchors(linkify(s)).length, 0, `no link in "${s}": ${linkify(s)}`);
  // a path left as text keeps the ids inside it that link today
  assert.match(linkify('see q-20261119-143912078-supervisor/notes.md'), /href="#q\/q-20261119-143912078-supervisor"/);
});

test('the ref is read whole or not at all, and ../<repo>/ names the repo as <repo>/ does', () => {
  const { linkify } = dashboard();
  // a ref that runs on is no ref: never a shorter branch than was written
  for (const s of ['console/docs/x.md on ticket/kit-12/sub', 'console/docs/x.md on main-line']) {
    const a = anchors(linkify(s));
    assert.equal(a.length, 1, s);
    assert.equal(unesc(a[0].href), 'https://github.com/acme/console/blob/HEAD/docs/x.md', s);
  }
  let a = anchors(linkify('console/docs/x.md on ticket/kit-12-Foo.'));
  assert.equal(unesc(a[0].href), 'https://github.com/acme/console/blob/ticket/kit-12-Foo/docs/x.md');
  a = anchors(linkify('Read ../arrangements.nyc/docs/x.md on ticket/arrangements-230-booking-copy-to-leads.'));
  assert.equal(a.length, 1);
  assert.equal(unesc(a[0].href), 'https://github.com/acme/arrangements.nyc/blob/ticket/arrangements-230-booking-copy-to-leads/docs/x.md');
  assert.equal(a[0].text, '../arrangements.nyc/docs/x.md');
  // any other .. stays text
  assert.equal(anchors(linkify('see docs/../x.md on main')).length, 0);
});

test('fileHref: a link into a GitHub repo link is its blob URL; every other link opens the peek as before', () => {
  const { fileHref } = dashboard();
  assert.equal(fileHref({ title: 'Booking to leads', path: 'arrangements.nyc/docs/booking-to-leads-automation.md', ref: 'ticket/arrangements-230-booking-copy-to-leads' }),
    'https://github.com/acme/arrangements.nyc/blob/ticket/arrangements-230-booking-copy-to-leads/docs/booking-to-leads-automation.md');
  assert.equal(fileHref({ title: 'x', path: 'arrangements/docs/x.md', ref: 'ticket/arr-7' }), `https://github.com/acme/arrangements.nyc/blob/${SHA_B}/docs/x.md`);
  // unchanged: home paths, and a link that names its repo (read through this machine's checkout)
  assert.equal(fileHref({ title: 'The design', path: 'docs/devteam/project/designs/x.md' }), '#file?path=docs%2Fdevteam%2Fproject%2Fdesigns%2Fx.md&title=The+design');
  assert.equal(fileHref({ title: 'Spec', path: 'docs/spec.md', ref: 'ticket/c-1', repo: 'console' }), '#file?path=docs%2Fspec.md&ref=ticket%2Fc-1&repo=console&title=Spec');
  assert.equal(fileHref({ path: 'docs/x.md', ref: 'ticket/kit-12' }), '#file?path=docs%2Fx.md&ref=ticket%2Fkit-12&title=docs%2Fx.md');
  // no DATA yet (the first paint): as before
  const bare = dashboard({});
  assert.equal(bare.fileHref({ path: 'console/README.md' }), '#file?path=console%2FREADME.md&title=console%2FREADME.md');
});

test('a question\'s see line (linkOf): a doc on GitHub opens in a new tab; a peek link opens here as before', () => {
  const ctx = dashboard();
  vm.runInContext([
    'const previewLinkHtml = () => "<preview>"; const previewHere = () => null; const PREVIEWS = null; const location = {}; const artLinkOf = () => "<art>";',
    (() => { const html = fs.readFileSync(path.join(ROOT, 'docs/devteam/dashboard/index.html'), 'utf8'); const at = html.indexOf('\nconst linkOf =') + 1; return html.slice(at, html.indexOf(';\n', at) + 1); })(),
    'this.linkOf = linkOf;',
  ].join('\n'), ctx);
  const a = anchors(ctx.linkOf({ title: 'Booking to leads', path: 'arrangements.nyc/docs/booking-to-leads-automation.md', ref: 'ticket/arrangements-230-booking-copy-to-leads' }));
  assert.equal(a.length, 1);
  assert.equal(unesc(a[0].href), 'https://github.com/acme/arrangements.nyc/blob/ticket/arrangements-230-booking-copy-to-leads/docs/booking-to-leads-automation.md');
  assert.match(a[0].attrs, /target="_blank" rel="noopener noreferrer"/);
  assert.equal(a[0].text, 'Booking to leads');
  const here = anchors(ctx.linkOf({ title: 'The spec', path: 'docs/spec.md', ref: 'ticket/kit-12' }));
  assert.ok(here[0].href.startsWith('#file?'));
  assert.doesNotMatch(here[0].attrs, /target=/);
});
