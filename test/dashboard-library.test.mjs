// The dashboard's Library (kit-92): the library-items block (LIB_KINDS, libraryGoalIndex, linkHost,
// libraryItems and libraryKeep), run alone in vm with the preview-cards block beside it, over
// libraryFixture()'s /api/data parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { libraryFixture } from './lib/kit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX = fs.readFileSync(path.join(here, '..', 'docs', 'devteam', 'dashboard', 'index.html'), 'utf8');
const block = (src, name) => {
  const a = src.indexOf(`/* ${name} start */`), b = src.indexOf(`/* ${name} end */`);
  assert.ok(a >= 0 && b > a, `the ${name} block is in the page`);
  assert.equal(src.indexOf(`/* ${name} start */`, a + 1), -1, `one ${name} block`);
  return src.slice(a, b + `/* ${name} end */`.length);
};

test('library-items: kinds, order, goals and keep', () => {
  // the two blocks alone, with no page globals but URL and URLSearchParams
  const vctx = vm.createContext({ URL, URLSearchParams });
  vm.runInContext(`${block(INDEX, 'preview-cards')}\n${block(INDEX, 'library-items')}\nthis.previewState = previewState; this.LIB_KINDS = LIB_KINDS; this.libraryGoalIndex = libraryGoalIndex; this.linkHost = linkHost; this.libraryItems = libraryItems; this.libraryKeep = libraryKeep;`, vctx);
  const { previewState, LIB_KINDS, libraryGoalIndex, linkHost, libraryItems, libraryKeep } = vctx;
  // stubs for the page's href helpers, so an href that isn't theirs shows
  const ctx = {
    previewState,
    artHref: (s, at) => `#artifact/${at}/${s}`,
    artViewer: (s, at) => `/view/artifact/${s}?at=${at}`,
    pvViewer: (n) => `/view/preview/${n}`,
    fileHref: (l) => `#file?path=${l.path}`,
  };
  const now = Date.parse('2026-11-19T12:00:00Z');
  const { patch: data, ids } = libraryFixture({ now });
  const plain = (x) => JSON.parse(JSON.stringify(x));

  assert.deepEqual(plain(LIB_KINDS), [['mock', 'Mock', 'layout-dashboard'], ['diagram', 'Diagram', 'workflow'], ['docs', 'Docs', 'book-open'], ['review', 'Review page', 'list-checks'], ['preview', 'Preview', 'monitor-play'], ['link', 'Link', 'link']]);
  const before = JSON.stringify(data);
  // in this realm, so deepEqual compares values, not the vm's prototypes
  const items = plain(libraryItems(data, now, ctx));
  assert.equal(JSON.stringify(data), before, 'the data is not changed');
  const byId = new Map(items.map((x) => [x.id, x]));
  assert.equal(byId.size, items.length, 'one item per id');

  // kind order, every kind held; the fixture lists them out of order
  const order = LIB_KINDS.map((k) => k[0]);
  const kinds = items.map((x) => x.kind);
  assert.ok(kinds.every((k, i) => i === 0 || order.indexOf(kinds[i - 1]) <= order.indexOf(k)), `kind order: ${kinds.join(' ')}`);
  for (const k of order) assert.ok(kinds.includes(k), `a ${k} item`);
  const rawKinds = data.library.artifacts.map((a) => a.kind ?? 'mock');
  assert.ok(rawKinds.some((k, i) => i > 0 && order.indexOf(rawKinds[i - 1]) > order.indexOf(k === 'x' ? 'mock' : k)), 'the fixture lists artifacts out of kind order');
  // artifacts in the server's order within a kind (first row of each slug)
  const slugsOf = (k) => [...new Set(data.library.artifacts.filter((a) => (['mock', 'diagram', 'docs'].includes(a.kind) ? a.kind : 'mock') === k).map((a) => a.slug))];
  for (const k of ['mock', 'diagram', 'docs']) assert.deepEqual(items.filter((x) => x.kind === k).map((x) => x.id), slugsOf(k).map((s) => `artifact:${s}`), `${k}: one per slug, in the server's order`);

  // an unknown kind and a missing one read as Mock
  assert.equal(byId.get(`artifact:${ids.unknownKind}`).kind, 'mock');
  assert.equal(byId.get(`artifact:${ids.noKind}`).kind, 'mock');
  assert.equal(byId.get(`artifact:${ids.diagram}`).kind, 'diagram');
  assert.equal(byId.get(`artifact:${ids.docs}`).kind, 'docs');

  // every item's hrefs are the page's helpers' (the block builds none of its own)
  for (const x of items) {
    if (x.kind === 'review') { assert.equal(x.href, `#review/${x.review.id}`); assert.equal(x.tab, null); continue; }
    if (x.kind === 'preview') { assert.equal(x.href, `#preview/${x.preview.name}`); assert.equal(x.tab, ctx.pvViewer(x.preview.name)); continue; }
    if (x.kind === 'link') {
      const l = x.link;
      assert.equal(x.href, l.url ? l.url : l.path && !l.remote ? ctx.fileHref(l) : null, `${x.id} href`);
      assert.equal(x.tab, l.url || null, `${x.id} tab`);
      continue;
    }
    if (x.error) { assert.equal(x.href, null, `${x.id}: a broken row opens nothing`); assert.equal(x.tab, null); continue; }
    assert.equal(x.href, ctx.artHref(x.art.slug, x.art.at), `${x.id} href`);
    assert.equal(x.tab, ctx.artViewer(x.art.slug, x.art.at), `${x.id} tab`);
  }

  // a slug landed with drafts in two worktrees: one item, the newer draft shown
  const drafted = items.filter((x) => x.id === `artifact:${ids.drafted}`);
  assert.equal(drafted.length, 1, 'one item for the drafted slug');
  const d = drafted[0];
  assert.equal(d.at, ids.wt2, 'the newer worktree\'s draft');
  assert.equal(d.art.at, ids.wt2);
  assert.equal(d.drafts.length, 2);
  assert.deepEqual(d.drafts.map((r) => r.at).sort(), [ids.wt1, ids.wt2].sort());
  assert.equal(d.landed?.at, 'main', 'its landed row');
  assert.equal(d.href, `#artifact/${ids.wt2}/${ids.drafted}`);
  assert.equal(d.title, data.library.artifacts.find((a) => a.slug === ids.drafted && a.at === ids.wt2).title, 'the draft\'s title');
  // a draft of a slug that never landed
  const only = byId.get(`artifact:${ids.draftOnly}`);
  assert.equal(only.landed, null);
  assert.equal(only.drafts.length, 1);
  assert.equal(only.at, ids.wt1);
  // a landed row with no drafts
  const pub = byId.get(`artifact:${ids.public}`);
  assert.equal(pub.at, 'main');
  assert.deepEqual(pub.landed, pub.art);
  assert.deepEqual(plain(pub.drafts), []);
  // a broken row: its slug and its error
  const broken = byId.get(`artifact:${ids.broken}`);
  assert.ok(broken.error, 'the broken row carries its error');
  assert.equal(broken.title, ids.broken, 'a broken row shows its slug');
  for (const x of items.filter((y) => y.art && y.id !== `artifact:${ids.broken}`)) assert.equal(x.error, null, `${x.id} not broken`);

  // reviews: one per open review question, none for a plain question
  const reviewQs = data.questions.filter((q) => q.kind === 'review');
  assert.equal(reviewQs.length, 2);
  assert.ok(data.questions.length > reviewQs.length, 'plain questions beside them');
  assert.deepEqual(items.filter((x) => x.kind === 'review').map((x) => x.id), reviewQs.map((q) => `review:${q.id}`));
  const rv = byId.get(`review:${ids.reviewQ}`);
  assert.equal(rv.href, `#review/${ids.reviewQ}`);
  assert.equal(rv.tab, null);
  assert.equal(rv.title, reviewQs.find((q) => q.id === ids.reviewQ).review.title);
  const rv2 = items.find((x) => x.kind === 'review' && x.id !== `review:${ids.reviewQ}`);
  assert.equal(rv2.title, rv2.review.question, 'no review title: the question');

  // previews: as served, each with its state
  assert.deepEqual(items.filter((x) => x.kind === 'preview').map((x) => x.preview.name), data.library.previews.map((p) => p.name));
  const st = (n) => byId.get(`preview:${n}`).pstate.state;
  assert.equal(st(ids.pvLive), 'live');
  assert.equal(st(ids.pvChecking), 'checking');
  assert.equal(st(ids.pvNotRunning), 'not-running');
  assert.equal(st(ids.pvDown), 'not-answering');
  assert.ok(byId.get(`preview:${ids.pvDown}`).pstate.since, 'down since');
  assert.equal(st(ids.pvExpired), 'expired');
  for (const p of data.library.previews) assert.match(p.name, /^[a-z]{3,7}-[a-z]{3,7}(-[1-9]\d?)?$/, 'a name openPreview accepts');

  // links: as served, each with its host
  assert.deepEqual(items.filter((x) => x.kind === 'link').map((x) => x.link.id), data.library.links.map((l) => l.id));
  assert.equal(byId.get(`link:${ids.linkUrl}`).host, new URL(data.library.links.find((l) => l.id === ids.linkUrl).url).host);
  assert.equal(byId.get(`link:${ids.linkRemote}`).host, 'github.com');
  assert.equal(byId.get(`link:${ids.linkRemote}`).href, null, 'a remote-only link opens nothing here');
  assert.equal(byId.get(`link:${ids.linkPath}`).host, null);
  assert.match(byId.get(`link:${ids.linkPath}`).href, /^#file\?path=/);

  // goals: a ref's goals
  const goalsOf = libraryGoalIndex(data);
  const sorted = (xs) => [...xs].sort();
  assert.deepEqual(plain(goalsOf(`goal:${ids.goal2}`)), [ids.goal2]);
  assert.deepEqual(plain(goalsOf(`ticket:${ids.tBuilding}`)), [ids.goal1], 'a ticket through its feature');
  assert.deepEqual(plain(goalsOf(ids.tMergedReceipts)), [ids.goal2], 'a bare ticket id (a session)');
  assert.deepEqual(plain(goalsOf(`feature:${ids.feat1}`)), [ids.goal1]);
  assert.deepEqual(plain(goalsOf(`feature:${ids.feat2}`)), [ids.goal2]);
  assert.deepEqual(plain(goalsOf(`plan-${ids.feat1}`)), [ids.goal1], 'a planner session by its feature');
  assert.deepEqual(plain(goalsOf(`plan-${ids.planPromptQ}`)), [ids.goal2], 'a planner session by its planner row');
  assert.deepEqual(plain(goalsOf(`ticket:${ids.tPlain}`)), [], 'a ticket of a feature in no goal');
  assert.deepEqual(plain(goalsOf('component:x')), []);
  assert.deepEqual(plain(goalsOf('supervisor')), []);
  assert.deepEqual(plain(goalsOf('ticket:nope')), []);
  // each item's goals
  assert.deepEqual(sorted(byId.get(`artifact:${ids.diagram}`).goals), [ids.goal2]);
  assert.deepEqual(sorted(byId.get(`artifact:${ids.public}`).goals), [ids.goal1]);
  assert.deepEqual(plain(byId.get(`artifact:${ids.noGoal}`).goals), [], 'an artifact for nothing');
  assert.deepEqual(plain(byId.get(`review:${ids.reviewQ}`).goals), [ids.goal2], 'a review question\'s goal');
  assert.deepEqual(plain(rv2.goals), [ids.goal1], 'a review question\'s ticket\'s goal');
  assert.deepEqual(plain(byId.get(`preview:${ids.pvLive}`).goals), [ids.goal1], 'a preview\'s session (a ticket)');
  assert.deepEqual(plain(byId.get(`preview:${ids.pvChecking}`).goals), [ids.goal2], 'a preview\'s session (a planner)');
  assert.deepEqual(plain(byId.get(`link:${ids.linkPath}`).goals), [ids.goal1], 'a link for a feature');

  // libraryKeep: by kind, by goal, both; no goal kept only with no goal filter
  const keep = (f) => items.filter((x) => libraryKeep(x, f)).map((x) => x.id);
  assert.deepEqual(keep({}), items.map((x) => x.id), 'no filter: everything');
  assert.deepEqual(keep({ kind: 'diagram' }), items.filter((x) => x.kind === 'diagram').map((x) => x.id));
  assert.ok(keep({ kind: 'diagram' }).length > 0);
  assert.deepEqual(keep({ goal: ids.goal1 }), items.filter((x) => x.goals.includes(ids.goal1)).map((x) => x.id));
  assert.ok(keep({ goal: ids.goal1 }).length > 0 && keep({ goal: ids.goal1 }).length < items.length);
  assert.deepEqual(keep({ kind: 'preview', goal: ids.goal2 }), [`preview:${ids.pvChecking}`], 'kind and goal');
  const none = { kind: 'mock', goals: [] };
  assert.equal(libraryKeep(none, {}), true);
  assert.equal(libraryKeep(none, { kind: 'mock' }), true);
  assert.equal(libraryKeep(none, { goal: ids.goal1 }), false);
  assert.equal(libraryKeep(none, { kind: 'mock', goal: ids.goal1 }), false);
  assert.equal(libraryKeep({ kind: 'docs', goals: [ids.goal1] }, { kind: 'mock', goal: ids.goal1 }), false);

  // linkHost: a url, then a remote, else none
  assert.equal(linkHost({ url: 'https://github.com/a/b' }), 'github.com');
  assert.equal(linkHost({ remote: 'git@github.com:a/b.git' }), 'github.com');
  assert.equal(linkHost({ remote: 'ssh://git@gitlab.com/a/b' }), 'gitlab.com');
  assert.equal(linkHost({ remote: 'https://bitbucket.org/a/b.git' }), 'bitbucket.org');
  assert.equal(linkHost({ url: 'https://docs.example.com/x', remote: 'git@github.com:a/b.git' }), 'docs.example.com');
  assert.equal(linkHost({ path: 'x' }), null);
  assert.equal(linkHost({ url: 'not a url' }), null);

  // artifacts: n adds n landed mocks bulk-<i>
  const big = libraryFixture({ now, artifacts: 3 });
  assert.deepEqual(big.patch.library.artifacts.filter((a) => a.slug.startsWith('bulk-')).map((a) => [a.slug, a.at]), [['bulk-0', 'main'], ['bulk-1', 'main'], ['bulk-2', 'main']]);
  assert.equal(libraryItems(big.patch, now, ctx).length, items.length + 3);
});
