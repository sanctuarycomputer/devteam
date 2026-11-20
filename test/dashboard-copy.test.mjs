// kit-95: no obvious explanatory copy on the dashboard or the hub (design: Everywhere, "Obvious copy goes").
// Heading sub-lines, .loop-intro paragraphs, hints that restate a control and explanatory empty states go;
// an empty state reads None. Question context, consequences on a confirm, errors and the How it changes
// property stay. The Loop's copy is kit-96's: its parts of index.html are left out here, found with the
// kit's own parts reader (devteam.mjs /* parts */), so a renamed part can't widen what is skipped.
// Comments and tooltips (title="…", .title = …) are not copy on the page and are left out too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (rel) => fs.readFileSync(new URL(`../docs/devteam/${rel}`, import.meta.url), 'utf8');
function fileParts() {
  const src = read('scripts/devteam.mjs');
  const a = src.indexOf('/* parts start */'), b = src.indexOf('/* parts end */');
  assert.ok(a >= 0 && b > a, 'devteam.mjs has a /* parts */ region');
  return vm.runInContext(`${src.slice(a, b)}\n;({ fileParts })`, vm.createContext({})).fileParts;
}
// kit-96's parts of index.html (its touches), and the Loop's own styles and learning charts (learningSection is
// called only from ooda-learning, and kit-96 removes the charts from the Loop)
const LOOP_PARTS = [
  'html-loop', 'ooda-learning', 'ooda-observe', 'ooda-orient', 'ooda-decide', 'ooda-act', 'renderDecisions', 'decideRows',
  'DEC_KIND', 'howItChanges', 'openLesson', 'openAct', 'openDecision', 'css-loop', 'css-loop-tabs', 'learningSection',
];
// a file's lines with comment lines blanked (kept as empty lines, so line numbers in messages hold)
const uncommented = (lines) => lines.map((l) => (/^\s*(\/\/|\/\*|\*)/.test(l) ? '' : l));
// index.html with the Loop's lines blanked too
function indexOutsideLoop(text = read('dashboard/index.html')) {
  const P = fileParts()(text, 'index.html');
  const lines = P.lines.slice();
  for (const name of LOOP_PARTS) {
    const places = P.places.get(name);
    assert.ok(places?.length, `index.html has the Loop's part ${name}`);
    for (const { from, to } of places) for (let i = from; i <= to; i++) lines[i - 1] = '';
  }
  return uncommented(lines).join('\n');
}
const hubText = () => uncommented(read('dashboard/hub.html').split('\n')).join('\n');
// what a tooltip says is left out: title="…" and `.title = '…'`
const noTitles = (t) => t.replace(/\btitle="[^"]*"/g, 'title=""').replace(/\.title = (['`])(?:(?!\1).)*\1/g, ".title = ''");

// the list (spec § The list): each phrase's fixed text, so a count inside it can't hide it
const GONE_INDEX = [
  'Hold Shift and click anything', 'Nothing resolved yet.', 'Nothing is sent until you do', 'Say what you want done about it',
  'Shift+Enter sends', 'Enter is a new line', 'Started from the dock, about nothing on the page', 'Nothing needs you right now',
  'Decisions and actions only you can take show here', 'Nothing answered yet', 'No tickets yet', 'The chart starts when',
  'The chart and the forecast start at the first merge', 'No goals yet', 'The supervisor asks the owner for them first',
  'Nothing proposed yet', 'Work through the page above', 'Nothing logged yet', 'Not committed yet', 'Not judged yet',
  'Its questions are ordered as if it were worth having', 'No readings yet', 'The supervisor reads the measure on its tick',
  'Cumulative dollars by role', 'No planner is working on it', 'its plan may have landed already',
  'The tickets its plan holds so far', '>Publishing happens on the cloud box', 'With what it teaches, or a ruling that it is noise',
  'None unexplained', 'No figures on this record', 'For each lesson a worker or planner was given',
  'No lesson was given to a worker or planner', 'It has no TL;DR yet', 'No checks in this range yet', 'Quiet: nothing ran',
  'Nothing merged yet', 'Its write-up has no numbers block', 'None yet.', 'Nothing yet.', 'Nothing merged in the last 8 weeks',
  'drawn by the dashboard from the stored result', 'drawn by the dashboard, not the page', 'The supervisor redraws the page and asks again',
  'sizes only, dates once tickets merge', 'Nothing is posted', 'Or reply instead: a note for the supervisor',
];
const GONE_HUB = [
  'Hold Shift and click anything', 'or start one here', 'Enter sends', 'Shift+Enter is a new line',
  'No devteam dashboards are running on this machine', '<span class="small muted">with the operator</span>',
];
// a hint that restates a key or a click, in any words
const KEY_HINT = /Shift\+Enter|Enter (?:sends|is a new line|to send)|Press Enter|Hold Shift and click|Shift\+click anything/;
// a heading sub-line: a heading or a panel head's name followed by a quieter span
const SUB_LINE = /class="(?:sub|loop-intro)"|<h[1-6][^>]*>[^<]*<span class="[^"]*\b(?:dim|muted|sub)\b|<b>[A-Za-z][^<$]*<\/b><span class="[^"]*\b(?:dim|muted)\b[^"]*">[a-z]/;
// the keep list (spec K1-K7)
const KEPT_INDEX = [
  '<div class="ctx">${qblock(q.context, q.links)}</div>', 'Opening it lets this question’s page open',
  'Nothing is planned or built for it; any planning stops.',
  'Workers finish what they have; nothing new starts', 'Every session stops where it is',
  'Could not load it just now.', "The settings list can't be read from this dashboard's server", 'No kind of decision by that name.',
  'The page or data changed since the supervisor asked.', 'Nothing can be answered here. Tell the supervisor to ask again.',
  "'How it changes', 'Shift+click it and say so in a thread'",
];
const KEPT_HUB = [
  'Workers finish what they have; nothing new starts', 'Every session stops where it is',
  'This has too many quotation marks, backslashes or control characters to keep; shorten it.',
  'An operator needs tmux, and there is none on this machine.',
];
// Text that starts as an empty state does (No…, Nothing…, None…, Not…) must read exactly None, or be one of
// these: errors and not-found lines, field values and labels, states, and confirm consequences (spec C3, C5).
// A string matches the whole text (as far as a quote, a tag or a ${…}); a pattern is anchored at both ends, so
// "No such tickets yet: a planner adds them." or "Not yet. The chart starts at the first merge." fails (spec-2
// F2-2). A new "Nothing here yet." fails until it reads None.
const NOT_EMPTY_STATES = [
  // errors, refusals, not found
  'No kind of decision by that name.', /^No such [a-z]+( [a-z]+)?( in the Library)?\.$/, 'No sensor by that name in the settings.', 'Not saved:', 'Not sent:',
  'Not started:', /^Not delivered: no supervisor terminal took it\. The supervisor (has checked since \(|sees it only when it next checks)/,
  /^Not done yet\. Change them above, or pick Can’t right now and say in the note why you’re leaving them\.$/, 'Not found',
  'Nothing can be answered here. Tell the supervisor to ask again.', 'Nothing recurs on this key now: it was explained, or never recurred.',
  'Not sent from this page: written on the box as yours', 'No operator is running on this machine. Your first message starts one.',
  // values, labels and states
  'Not answering', 'Not agreed', 'None missing', 'None this week', 'No goal:', 'No default, because:', 'No page given', 'No result recorded',
  'No limit', 'Nothing left before a move', 'Not in scope', 'No reason given', 'Not on the roadmap.', 'No wave', 'Not oriented yet', 'Not on',
  'Not public', 'Not yet', 'Not the published version: this is the one on main', 'Not the draft: this is the one on main',
  'No measured rate yet', 'Nothing measured: spend shows only what agents reported', 'No goal approved yet', 'No tickets planned yet',
  'No readings from', 'No projects running',
  // consequences, and where to act instead
  'Nothing is planned or built for it; any planning stops.',
  /^Nothing to click here\. With account rotation set up, the dashboard restarts it once an account has room; otherwise answer it in the terminal\.$/,
];
const allowed = (s) => NOT_EMPTY_STATES.some((k) => (typeof k === 'string' ? s === k : k.test(s)));
// the text after a quote (single, double or backtick) or a tag's end, as far as the next quote, tag or ${
const EMPTY_START = /(?:['"`>])((?:No|Nothing|None|Not)\b[^'"`<$]{0,160})/g;

const lineOf = (text, i) => text.slice(0, i).split('\n').length;
const found = (text, phrases) => phrases.filter((s) => text.includes(s)).map((s) => `${s} (line ${lineOf(text, text.indexOf(s))})`);
const matches = (text, re) => [...text.matchAll(new RegExp(re.source, 'g'))].map((m) => `line ${lineOf(text, m.index)}: ${m[0].slice(0, 80)}`);

test('the explanatory copy is gone from the dashboard (outside the Loop) and the hub', () => {
  const ix = noTitles(indexOutsideLoop()), hub = noTitles(hubText());
  // every finding at once, so one run names them all
  const bad = {
    'index.html: on the list': found(ix, GONE_INDEX), 'hub.html: on the list': found(hub, GONE_HUB),
    'index.html: a hint that restates a key or a click': matches(ix, KEY_HINT), 'hub.html: a hint that restates a key or a click': matches(hub, KEY_HINT),
    'index.html: a heading sub-line': matches(ix, SUB_LINE), 'hub.html: a heading sub-line': matches(hub, SUB_LINE),
  };
  assert.deepEqual(Object.fromEntries(Object.entries(bad).filter(([, v]) => v.length)), {});
});

test('every empty state outside the Loop reads None', () => {
  const ix = noTitles(indexOutsideLoop()), hub = noTitles(hubText());
  const bad = [];
  for (const [name, t] of [['index.html', ix], ['hub.html', hub]]) {
    // any text that starts as an empty state does
    for (const m of t.matchAll(EMPTY_START)) {
      const s = m[1].trim();
      if (s === 'None' || ['No', 'Not', 'Nothing'].includes(s) || allowed(s)) continue;
      bad.push(`${name}:${lineOf(t, m.index)} ${s.slice(0, 80)}`);
    }
    // an element of class empty, drawn as markup or with el(), holds None (or the helper's own argument)
    for (const m of t.matchAll(/class="[^"]*\bempty\b[^"]*">([^<]*)</g)) if (!['None', '${html}', '${s}', 'Reading the threads…', 'Loading…'].includes(m[1].trim())) bad.push(`${name}:${lineOf(t, m.index)} ${m[1].slice(0, 80)}`);
    for (const m of t.matchAll(/el\('[a-z0-9]+', '[^']*\bempty\b[^']*', ([^)]*)\)/g)) if (m[1].trim() !== "'None'") bad.push(`${name}:${lineOf(t, m.index)} ${m[1].slice(0, 80)}`);
  }
  // empty(<arg>) and effNone(<arg>) on the dashboard: a literal None (the helpers' definitions have no `empty(`)
  for (const m of ix.matchAll(/\b(empty|effNone)\(([^)]*)\)/g)) {
    const a = m[2].trim();
    if ((m[1] === 'effNone' && a === '') || ["'None'", "'None this week'", "'Could not load it just now.'"].includes(a)) continue;
    bad.push(`index.html:${lineOf(ix, m.index)} ${m[1]}(${a.slice(0, 80)})`);
  }
  // the hub's page-wide #empty, with no heading over it: once it has looked, with no project listed, it names its subject in
  // the Overview's own words (spec H3)
  for (const m of hub.matchAll(/empty\.textContent = ([^;]*);/g)) if (m[1].trim() !== "'No projects running'") bad.push(`hub.html:${lineOf(hub, m.index)} ${m[1].slice(0, 80)}`);
  assert.deepEqual(bad, []);
});

test('what a decision needs stays: question context, confirm consequences, errors, How it changes', () => {
  const ix = read('dashboard/index.html'), hub = read('dashboard/hub.html');
  assert.deepEqual(KEPT_INDEX.filter((s) => !ix.includes(s)), [], 'index.html');
  assert.deepEqual(KEPT_HUB.filter((s) => !hub.includes(s)), [], 'hub.html');
});

test("the Loop's parts are found, so only they are left out", () => {
  const ix = read('dashboard/index.html');
  const out = indexOutsideLoop(ix);
  assert.ok(ix.includes('class="loop-intro"') ? !out.includes('class="loop-intro"') : true);
  assert.ok(out.includes('<!-- html-goals start -->'));
  assert.throws(() => indexOutsideLoop(ix.replace('<!-- html-loop start -->', '<!-- html-lop start -->')), /html-loop/);
});
