/* imports start */
import fs from 'node:fs';
import path from 'node:path';
import { artifactLinksMoved } from './log-sync.mjs';
import { covered } from './observe.mjs';
import { detachedWorktree } from './pr-checks.mjs';
import { die } from './base.mjs';
import { draftBlobs } from './self-model.mjs';
import { fencedBlocks } from './self-model.mjs';
import { flags } from './base.mjs';
import { git } from './base.mjs';
import { gitReadCache } from './base.mjs';
import { gitRun } from './reviews.mjs';
import { isObj } from './artifact-notes.mjs';
import { json } from './base.mjs';
import { lastRepoVisibility } from './self-model.mjs';
import { linksSelf } from './self-model.mjs';
import { logGet } from './log-sync.mjs';
import { mainLogCache } from './repos.mjs';
import { mainRef } from './log.mjs';
import { mainRefCache } from './log.mjs';
import { mainRoot } from './state.mjs';
import { mainSha } from './log.mjs';
import { mergeShaCache } from './repos.mjs';
import { namesAllowedText } from './self-model.mjs';
import { namesChecked } from './self-model.mjs';
import { namesHoldLines } from './self-model.mjs';
import { namesWhole } from './self-model.mjs';
import { out } from './base.mjs';
import { pathMatches } from './graph.mjs';
import { positional } from './base.mjs';
import { projectDir } from './state.mjs';
import { projectInRepo } from './settings.mjs';
import { projectRel } from './settings.mjs';
import { projectRoot } from './settings.mjs';
import { questionView } from './log-sync.mjs';
import { questions } from './log-sync.mjs';
import { readText } from './base.mjs';
import { recurringRegistry } from './recurring.mjs';
import { repo } from './repos.mjs';
import { repoVisibility } from './self-model.mjs';
import { resolveCommit } from './log-sync.mjs';
import { selfPlain } from './self-model.mjs';
import { selfPlainVersion } from './self-model.mjs';
import { selfRel } from './self-model.mjs';
import { slug } from './base.mjs';
import { strategyMainText } from './self-model.mjs';
import { strategyRel } from './pr-checks.mjs';
import { strategyState } from './pr-checks.mjs';
import { warn } from './base.mjs';
import { weight } from './graph.mjs';
import { worldDocErrors } from './self-model.mjs';
import { worldFileFails } from './pr-checks.mjs';
import { worldMissingSeverity } from './self-model.mjs';
/* imports end */
/* world-model start */
// project/exterior.md, what the project relates to: since kit-863 a plain document
// (log.schema.json#exterior2), judged by the self-plain region's checkExterior, which follows
// test/fixtures/world2/check.mjs rule for rule: one # title, ### entries, a dated source for each, and
// on a repo not known to be private the names rule (every heading, in any form: one of level 3 to 6
// named whole in origin main's strategy or dependency names, a # or ## one each capitalised word in
// it, else refused; every capitalised word and every link host held until named on the chore). A draft must be one. Version 1 (log.schema.json#exterior@1, one fenced
// `exterior` block) still validates on main, by kit-135's rules below, and raises one exterior-drift.
export const EXTERIOR_REL = () => `${projectRel}/exterior.md`;
export const EXTERIOR_NOT_DRAFTED = 'exterior.md is not drafted yet: the supervisor drafts it from the strategy and self.md (supervisor.md, Monitoring)';
// The day a read date is judged against: today, in UTC.
export const exteriorToday = () => new Date().toISOString().slice(0, 10);
// An exterior.md's text in, as validate reads it: { version, block, errors }. Version 2 (no fenced self
// or exterior block, selfPlainVersion) against exterior@2's form: the title, and no block. Version 1
// against exterior@1, its block parsed when it holds; one whose block exterior@1's reader can't find (a
// ~~~ fence, one indented or in a list item) gets exterior@2's block error. Past exterior@1's schema:
// an id shared across entities and signals (8), relation_word only and always for other (9), and the
// prose outside the block naming each entity, as whole words in any case (10).
export function exteriorDoc(text) {
  const version = selfPlainVersion(text);
  const plain = () => ({ version, block: null, errors: selfPlain.checkExterior(text, { today: exteriorToday(), visibility: 'private', allowed: { names: '', words: '' } }).errors });
  if (version === 2) return plain();
  const fb = fencedBlocks(text);
  if (!fb.unclosed && !fb.blocks.some((x) => x.info === 'self' || x.info === 'exterior')) return plain();
  const errors = worldDocErrors(text, 'exterior');
  if (errors.length) return { version, block: null, errors };
  const v = JSON.parse(fb.blocks.find((x) => x.info === 'exterior').body);
  const seen = new Set();
  const ids = v.entities.flatMap((e, i) => [[`exterior.entities[${i}].id`, e.id], ...e.signals.map((x, j) => [`exterior.entities[${i}].signals[${j}].id`, x.id])]);
  for (const [where, id] of ids) {
    if (seen.has(id)) errors.push(`${where} "${id}" is shared`);
    seen.add(id);
  }
  v.entities.forEach((e, i) => {
    if (e.relation === 'other' && e.relation_word === undefined) errors.push(`exterior.entities[${i}].relation_word is required when relation is other`);
    if (e.relation !== 'other' && e.relation_word !== undefined) errors.push(`exterior.entities[${i}].relation_word is only for relation other`);
    if (!namesWhole(fb.prose, e.name)) errors.push(`exterior.entities[${i}] "${e.name}": the prose outside the block never names it`);
  });
  return { version, block: errors.length ? null : v, errors };
}
export const exteriorTreeText = () => readText(path.join(projectDir, 'exterior.md'));
// A version 1 file's checks past its contract, for validate: the working tree's strategy.md and
// self.md blobs (git hash-object, so an uncommitted draft counts; null for no file) and the strategy's
// text.
export function headBlobs() {
  const tree = (name) => { const f = path.join(projectDir, name); return fs.existsSync(f) ? git(['hash-object', '--', f], mainRoot) : null; };
  return { strategyBlob: tree('strategy.md'), selfBlob: tree('self.md'), strategyText: readText(path.join(projectDir, 'strategy.md')) };
}
// Whether validate is at the draft: main can be read and the working tree's exterior.md is not
// main's (none on main counts as differing). With no main (a depth-1 CI checkout) it is not.
export function exteriorAtDraft() {
  if (!projectInRepo || !mainRef()) return false;
  const f = path.join(projectDir, 'exterior.md');
  if (!fs.existsSync(f)) return false;
  return git(['hash-object', '--', f], mainRoot) !== git(['rev-parse', '--verify', '--quiet', `${mainRef()}:${EXTERIOR_REL()}`], mainRoot);
}
// A version 1 block's quotes, each a verbatim part of its strategy_blob's text; a strategy_blob the
// repo can't read is an error at the draft and a warning otherwise. At the draft, strategy_blob and
// self_blob are the head's strategy.md and self.md.
export function exteriorBlobLines(block, { draft, strategyBlob, selfBlob, strategyText = null }) {
  const errors = [];
  const warnings = [];
  const sb = block.strategy_blob;
  const text = strategyText !== null && sb === strategyBlob ? strategyText : git(['cat-file', 'blob', sb], mainRoot);
  if (text === null) (draft ? errors : warnings).push(`strategy_blob ${sb.slice(0, 12)}: the repo can't read it, so its quotes go unchecked`);
  else block.entities.forEach((e, i) => e.strategy.forEach((q, j) => {
    if (!String(text).includes(q)) errors.push(`exterior.entities[${i}].strategy[${j}] "${q}" is not found in strategy.md at ${sb.slice(0, 8)}`);
  }));
  if (draft) {
    if (sb !== strategyBlob) errors.push(`strategy_blob is not the head's strategy.md: draft from it (it names ${sb.slice(0, 12)}; the head's is ${strategyBlob ? strategyBlob.slice(0, 12) : 'missing'})`);
    if (!selfBlob) errors.push('there is no self.md at the head: draw self.md first');
    else if (block.self_blob !== selfBlob) errors.push(`self_blob is not the head's self.md: draw from it (it names ${block.self_blob.slice(0, 12)}; the head's is ${selfBlob.slice(0, 12)})`);
  }
  return { errors, warnings };
}
// A file at ref (the repo root's rel), or null: with ref null, nothing; with the project outside the
// repo, the working tree's (as namesAllowedText reads it).
export const fileAtRef = (rel, ref) => (!ref ? null : projectInRepo ? git(['show', `${ref}:${rel}`], mainRoot) : readText(path.join(projectRoot, rel)));
// The dependency names at ref, one per line (text): the keys of package.json's dependencies and
// devDependencies (each only when a plain object), each Gemfile gem (quoted either way, with or
// without parentheses), each requirements.txt name (comments stripped, cut at the first of =<>!~[;@
// or a space). A file missing gives no names; a package.json that isn't JSON gives none and a warning.
export function dependencyNames(ref = mainRef()) {
  const names = [];
  const warnings = [];
  const pkg = fileAtRef('package.json', ref);
  if (pkg !== null) {
    let v;
    try { v = JSON.parse(pkg); } catch { warnings.push(`package.json at ${ref} is not JSON: its dependencies allow no names`); }
    for (const k of ['dependencies', 'devDependencies']) if (isObj(v) && isObj(v[k])) names.push(...Object.keys(v[k]));
  }
  for (const line of (fileAtRef('Gemfile', ref) ?? '').split(/\r?\n/)) {
    const m = /^\s*gem\s*\(?\s*(['"])([^'"]+)\1/.exec(line);
    if (m) names.push(m[2]);
  }
  for (const line of (fileAtRef('requirements.txt', ref) ?? '').split(/\r?\n/)) {
    const name = line.replace(/#.*/, '').trim().split(/[=<>!~[;@\s]/)[0];
    if (name) names.push(name);
  }
  return { text: names.join('\n'), warnings };
}
// What the names rule allows at ref (origin main; the branch's own files never count): names, which
// judge every heading (main's strategy.md and its dependency names), and words, which
// hold every other capitalised word and every link host (main's strategy.md and its dependency files'
// whole text, namesAllowedText); warnings, the dependency files'.
export function exteriorAllowed(ref = mainRef()) {
  const deps = dependencyNames(ref);
  return { names: `${fileAtRef(strategyRel, ref) ?? ''}\n${deps.text}`, words: namesAllowedText(ref), warnings: deps.warnings };
}
// The one judgment of an exterior.md draft (exterior@2): the self-plain region's checkExterior, as on a
// repo not known to be private: { errors, warnings, refused, held, hosts }. A caller on a private repo
// drops refused, held and hosts; a version 1 block is an error, alone.
export function exteriorDraft(text, allowed) {
  return selfPlain.checkExterior(text, { today: exteriorToday(), visibility: 'public', allowed });
}
// A refused heading's line: a level-3 ATX heading of text's (an entry) as kit-863 words it; any other
// form or level as a heading.
export const exteriorRefusedLine = (name, text) => (selfPlain.notPlain(text).includes(name)
  ? `"${name}" (a heading) is not plain text: a top-level heading must be plain text; put options, placeholders and markup in backticks (outside a code span a # or ## heading, or an HTML <h1> to <h6> one, holds no raw HTML, character reference, control, format or invisible character, mark left after NFC, ~~, [ or ]; * or _ emphasis is fine)`
  : selfPlain.headings(text).some((h) => h.level === 3 && h.text === name)
  ? `"${name}" (a ### heading) is not named whole in origin main's strategy.md or its dependency names: on a repo not known to be private an entry is headed only by a name they give; head it as a group or a topic, or have the strategy name it first`
  : `"${name}" (a heading) is not named in origin main's strategy.md or its dependency names: on a repo not known to be private a heading of level 3 to 6 is only a name they give whole, and a # or ## heading holds no capitalised word or link host they don't name; name it in the strategy first, or reword it (a # or ## heading may lower-case the word, or use one the strategy holds)`);
export const exteriorWordLine = (w) => `"${w.word}" (${w.where}) is in neither origin main's strategy.md nor its dependency files: on a repo not known to be private, the draft is public once its branch is pushed; reword it, or check it and name it on the chore (chore pr --names-checked)`;
// The draft's history (every version is pushed): the contract and dated sources on head ({ text }, or
// null when there is no exterior.md at the head), then the names rule on each version ([{ commit,
// text }], commit null for the head's own): each refused heading and each held word or link host kept
// at its first version. { errors, warns, named: [{ name, line, commit }], words: [{ word, where, commit }] }.
export function exteriorVersionsScan(head, versions, allowed) {
  const judged = new Map();
  const judge = (t) => { if (!judged.has(t)) judged.set(t, exteriorDraft(t, allowed)); return judged.get(t); };
  const errors = [];
  const warns = [];
  if (head) { const d = judge(head.text); errors.push(...d.errors); warns.push(...d.warnings); }
  const named = [];
  const words = [];
  const seen = new Set();
  for (const { commit, text } of versions) {
    const d = judge(text);
    for (const name of d.refused) if (!seen.has(`n:${name}`)) { seen.add(`n:${name}`); named.push({ name, line: exteriorRefusedLine(name, text), commit }); }
    for (const [list, where] of [[d.held, 'word'], [d.hosts, 'link host']]) for (const word of list) if (!seen.has(`w:${word}`)) { seen.add(`w:${word}`); words.push({ word, where, commit }); }
  }
  warns.push(...allowed.warnings);
  return { errors, warns, named, words };
}
// A line's tail naming the commit that carries it, for a version that isn't the head's own.
export const exteriorCarries = (commit) => (commit ? `; commit ${commit.slice(0, 12)} carries it: rewrite the branch (once pushed, chore drop <slug> --reason "…" first; then git reset --soft origin/main and chore pr again)` : '');
export const EXTERIOR_NO_BASE = "no merge base with main: exterior.md's drafts can't be checked";
// check-pr's hold on a PR changing exterior.md, for checkPr in home: with exterior.md at sha and a
// commit in merge-base..sha changing it, the contract at sha (a fail) and its dated sources (warnings),
// and over every version since the base the names rule: a refused heading a fail on a public repo and
// a warning on an unknown one, each held word or link host namesHoldLines' (public a fail, unknown a
// warning, cleared by a names-checked act on the chore), a private repo nothing. With no exterior.md at
// sha the contract is skipped (a deletion of main's is kit-138's gate) but every version is still read:
// one added then deleted would land in main's history. With no main, one warning. { fails, warns }.
export function exteriorDraftLines(base, sha, branch) {
  const rel = EXTERIOR_REL();
  const none = { fails: [], warns: [] };
  if (!projectInRepo) return none;
  const headBlob = git(['rev-parse', '--verify', '--quiet', `${sha}:${rel}`], mainRoot);
  if (!mainRef()) return headBlob ? { fails: [], warns: ["no main to compare with: exterior.md's drafts are not checked here; merge checks them"] } : none;
  if (!base) return headBlob ? { fails: [EXTERIOR_NO_BASE], warns: [] } : none;
  const blobs = draftBlobs(base, sha, rel);
  if (!blobs.length) return none;
  const read = (b) => git(['cat-file', 'blob', b], mainRoot) ?? '';
  const versions = [...(headBlob ? [{ commit: null, text: read(headBlob) }] : []), ...blobs.filter((b) => b.blob !== headBlob).map((b) => ({ commit: b.commit, text: read(b.blob) }))];
  const x = exteriorVersionsScan(headBlob ? { text: read(headBlob) } : null, versions, exteriorAllowed());
  let vis;
  const visibility = () => (vis ??= repoVisibility());
  const fails = x.errors.map((e) => `${rel} breaks exterior@2 at ${sha.slice(0, 12)}: ${e}`);
  const warns = x.warns.map((w) => `${rel}: ${w}`);
  if (x.named.length) {
    const lines = x.named.map((n) => `${rel}: ${n.line}${exteriorCarries(n.commit)}`);
    if (visibility() === 'public') fails.push(...lines);
    else if (visibility() === 'unknown') warns.push(...lines);
  }
  const act = worldFileFails.actOf(branch);
  const ct = git(['show', '-s', '--format=%ct', base], mainRoot);
  const since = ct && /^\d+$/.test(ct) ? Number(ct) * 1000 : NaN;
  const h = namesHoldLines({ rel, words: x.words, act, checked: namesChecked(act, 'exterior', since), visibility });
  return { fails: [...fails, ...h.fails], warns: [...warns, ...h.warns] };
}
// chore pr's hold on an exterior.md draft, every read in the chore's worktree wt. phase 'tree', before
// git add: the working tree's exterior.md and every blob already committed since base, so a name in a
// hand commit refuses before anything new is committed. phase 'range', after the commit and before the
// push: every blob since base, the head's first. At the draft only: the tree's file differs from
// main's, a commit since base changes it, or there is no origin main (then only the tree and HEAD's
// blob are read). The contract at the head fails; on a repo not known to be private (unknown counts as
// not private) a refused heading fails, whatever --names-checked says, and so does a held word or link
// host checkedWords doesn't name. A private repo holds no name. { fails, warns (the dated sources and
// the dependency files', printed once pushed), words (to log once named), changed }.
export function exteriorChoreLines(wt, phase, { base, checkedWords }) {
  const rel = EXTERIOR_REL();
  const none = { fails: [], warns: [], words: [], changed: false };
  if (!projectInRepo) return none;
  const head = git(['rev-parse', 'HEAD'], wt);
  const at = (ref) => (ref ? git(['rev-parse', '--verify', '--quiet', `${ref}:${rel}`], wt) : null);
  const headBlob = at(head);
  const treeFile = path.join(wt, rel);
  const treeText = phase === 'tree' ? readText(treeFile) : null;
  const main = mainRef();
  if (main && !base) return headBlob || treeText !== null ? { ...none, fails: [EXTERIOR_NO_BASE] } : none;
  const blobs = main ? draftBlobs(base, head, rel) : headBlob ? [{ commit: head, blob: headBlob }] : [];
  const treeDraft = treeText !== null && (!main || git(['hash-object', '--', treeFile], wt) !== at(main));
  if (!treeDraft && !blobs.length) return none;
  const read = (b) => git(['cat-file', 'blob', b], wt) ?? '';
  let versions;
  let headDoc;
  if (phase === 'tree') {
    versions = [...blobs.map((b) => ({ commit: b.commit, text: read(b.blob) })), ...(treeText !== null ? [{ commit: null, text: treeText }] : [])];
    headDoc = treeText !== null ? { text: treeText } : null;
  } else {
    versions = [...(headBlob ? [{ commit: null, text: read(headBlob) }] : []), ...blobs.filter((b) => b.blob !== headBlob).map((b) => ({ commit: b.commit, text: read(b.blob) }))];
    headDoc = headBlob ? { text: read(headBlob) } : null;
  }
  const x = exteriorVersionsScan(headDoc, versions, exteriorAllowed());
  const fails = x.errors.map((e) => `exterior.md: ${e}`);
  const warns = [...x.warns];
  let vis;
  const visibility = () => (vis ??= repoVisibility());
  const unknown = "the repo's visibility is unknown, which counts as not private";
  if (x.named.length && visibility() !== 'private') fails.push(...x.named.map((n) => `${n.line}${visibility() === 'unknown' ? ` (${unknown})` : ''}${exteriorCarries(n.commit)}`));
  const shown = (w) => `"${w.word}" (${w.where})${w.commit ? ` in ${w.commit.slice(0, 12)}` : ''}`;
  const open = x.words.filter((w) => !checkedWords?.has(w.word));
  if (open.length && visibility() !== 'private') {
    // --names-checked splits at commas, so a word or host holding one can't be named: only rewording clears it
    const nameable = x.words.filter((w) => !w.word.includes(','));
    const commas = open.filter((w) => w.word.includes(','));
    fails.push(`exterior.md names words origin main's strategy.md and dependency files don't, and ${visibility() === 'public' ? 'this repo is public' : unknown}, so the draft is public once pushed: ${open.map(shown).join(', ')}; reword them, or check each and name it${nameable.length ? `: --names-checked ${nameable.map((w) => w.word).join(',')}` : ''}`);
    if (commas.length) fails.push(`${commas.map(shown).join(', ')} ${commas.length > 1 ? 'hold' : 'holds'} a comma, which --names-checked can't name: reword ${commas.length > 1 ? 'them' : 'it'}`);
    for (const c of [...new Set(open.map((w) => w.commit).filter(Boolean))]) fails.push(`${c.slice(0, 12)} carries a word: rewrite the branch (once pushed, chore drop ${path.basename(wt).replace(/^chore-/, '')} --reason "…" first; then git reset --soft origin/main and chore pr again), or check and name the word`);
  }
  return { fails, warns, words: open.length ? [] : x.words.map((w) => w.word), changed: true };
}
// main's exterior.md: { text, blob }, or null when main has none; with no main, or the project
// outside the repo, the working tree's (as selfMainText reads self.md).
export function exteriorOnMain() {
  if (projectInRepo && mainRef()) {
    const text = git(['show', `${mainRef()}:${EXTERIOR_REL()}`], mainRoot);
    return text === null ? null : { text, blob: git(['rev-parse', '--verify', '--quiet', `${mainRef()}:${EXTERIOR_REL()}`], mainRoot) };
  }
  const text = exteriorTreeText();
  return text === null ? null : { text, blob: null };
}
// The commit main's exterior.md (blob) was drawn at, whose strategy.md and self.md it stands on (the
// design's Staleness, from git): 1. the pinned commit of the latest exterior-change question the owner
// answered with its recommendation whose pinned blob is blob (a refused one never counts), when this
// clone has that commit; 2. else the commit that last changed the file on main, unless it is a
// shallow clone's boundary (whose change can't be read); 3. else unknown. { commit, from } or
// { commit: null, why }.
export function exteriorBase(main, blob) {
  const rel = EXTERIOR_REL();
  const pins = questions().filter((v) => v.class === 'exterior-change' && v.status === 'answered' && v.answered_by === 'owner' && v.matched === true)
    .map((v) => ({ id: v.id, at: String(v.answered_at ?? ''), pin: (v.links ?? []).find((l) => isObj(l) && l.path === rel && l.blob === blob && typeof l.ref === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(l.ref)) }))
    .filter((x) => x.pin).sort((a, b) => a.at.localeCompare(b.at));
  const last = pins.pop();
  if (last && git(['cat-file', '-e', `${last.pin.ref}^{commit}`], mainRoot) !== null) return { commit: last.pin.ref, from: `${last.id}'s draft` };
  const changed = git(['log', '-1', '--format=%H', main, '--', rel], mainRoot);
  if (!changed) return { commit: null, why: 'no commit on main changes it' };
  if (git(['rev-parse', '--is-shallow-repository'], mainRoot) === 'true') {
    const shallow = readText(path.resolve(mainRoot, git(['rev-parse', '--git-path', 'shallow'], mainRoot) ?? '.git/shallow')) ?? '';
    if (shallow.split('\n').includes(changed)) return { commit: null, why: `the last commit changing it, ${changed.slice(0, 12)}, is this shallow clone's boundary` };
  }
  return { commit: changed, from: 'the last commit changing it on main' };
}
// metrics' exterior findings, read from main with no network call (none with no main), each keyed so
// observeFindings keeps one observation per name or blob pair. A version 1 exterior.md: one
// exterior-drift (key exterior@1) asking for the plain version, and no other. A plain one:
// exterior-drift once per heading the names rule refuses against main's strategy.md and dependency names, only
// where the repo was last known public (a machine with no record says nothing); exterior-stale while
// main's strategy.md or self.md blob isn't the one at its base (exteriorBase; unknown raises none);
// both low. exterior-missing while main has self.md, a written strategy linking it, and no
// exterior.md: high until an exterior-change question is asked, medium while it is open
// (worldMissingSeverity, kit-814).
export function exteriorFindings(add) {
  const main = projectInRepo ? mainRef() : null;
  if (!main) return;
  const blobAt = (c, rel) => git(['rev-parse', '--verify', '--quiet', `${c}:${rel}`], mainRoot);
  const strategyBlob = blobAt(main, strategyRel);
  const selfBlob = blobAt(main, selfRel());
  const pair = `${strategyBlob}-${selfBlob}`;
  const m = exteriorOnMain();
  if (!m) {
    if (selfBlob && strategyState() === 'written' && linksSelf(strategyMainText())) add(worldMissingSeverity('exterior-change'), 'exterior-missing', 'exterior', 'main has self.md and a strategy linking it, and no exterior.md', 'draft exterior.md from the strategy and self.md (supervisor.md, Monitoring) in a chore, run exterior check, and ask exterior-change', { key: pair });
    return;
  }
  if (selfPlainVersion(m.text) === 1) {
    add('low', 'exterior-drift', 'exterior', "main's exterior.md is version 1 (a fenced exterior block)", 'draft exterior.md as a plain document in a chore (exterior check, then chore pr and ask exterior-change; supervisor.md, Monitoring)', { key: 'exterior@1' });
    return;
  }
  if (lastRepoVisibility() === 'public') {
    const allowed = exteriorAllowed(main);
    const seen = new Set();
    for (const name of exteriorDraft(m.text, allowed).refused) {
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      add('low', 'exterior-drift', 'exterior', `exterior.md's heading "${name}" is named in neither main's strategy.md nor its dependency names`, 'draft a new version of exterior.md that heads it in plain words, as a group or a topic, or have the strategy name it; run exterior check before chore pr', { key: name.toLowerCase() });
    }
  }
  const base = exteriorBase(main, m.blob);
  if (!base.commit) return;
  const sb = blobAt(base.commit, strategyRel);
  const fb = blobAt(base.commit, selfRel());
  if (sb !== strategyBlob || fb !== selfBlob) add('low', 'exterior-stale', 'exterior', `exterior.md drew from ${sb !== strategyBlob ? 'a strategy.md' : 'a self.md'} main has moved on from (at ${base.commit.slice(0, 12)}, ${base.from})`, 're-read self.md first and draft a new one if it no longer holds; then draft a new version of exterior.md from the strategy and that self.md', { key: pair });
}
// exterior check's lines for the working tree's exterior.md, the draft: the contract (errors) and its
// dated sources (warnings); then, on a repo not known to be private (gh asked only when a name is
// refused or held), each refused heading an error and each held word or link host a warning; and,
// with a plain exterior.md on main whose base can't be read, a warning that its staleness is unknown.
export function exteriorCheckLines() {
  const text = exteriorTreeText();
  if (text === null) return { errors: [], warnings: [] };
  const allowed = exteriorAllowed();
  const d = exteriorDraft(text, allowed);
  const errors = [...d.errors];
  const warnings = [...d.warnings, ...allowed.warnings];
  if (d.refused.length || d.held.length || d.hosts.length) {
    const v = repoVisibility();
    if (v !== 'private') {
      const tail = v === 'unknown' ? " (the repo's visibility is unknown, which counts as not private)" : '';
      errors.push(...[...new Set(d.refused)].map((n) => `${exteriorRefusedLine(n, text)}${tail}`)); // a heading written twice is one line
      warnings.push(...[...d.held.map((word) => ({ word, where: 'word' })), ...d.hosts.map((word) => ({ word, where: 'link host' }))].map(exteriorWordLine));
    }
  }
  const main = projectInRepo ? mainRef() : null;
  const m = main ? exteriorOnMain() : null;
  if (m && selfPlainVersion(m.text) === 2) {
    const base = exteriorBase(main, m.blob);
    if (!base.commit) warnings.push(`whether main's exterior.md is stale is unknown: ${base.why}, and no answered exterior-change question pins a commit this clone has`);
  }
  return { errors, warnings };
}
// validate's lines for the working tree's exterior.md: the contract (either version), and for a
// version 1 file its quotes, and its blobs at the draft (exteriorAtDraft); none when there is no file.
// Never the names rule, nor the dated sources.
export function exteriorValidateLines() {
  const text = exteriorTreeText();
  if (text === null) return { errors: [], warnings: [] };
  const { block, errors } = exteriorDoc(text);
  if (!block) return { errors, warnings: [] };
  return exteriorBlobLines(block, { draft: exteriorAtDraft(), ...headBlobs() });
}
// dashboard-data's exterior block (log.schema.json#exterior@1 dashboard), for a version 1 file whose
// block holds: file order, relation_word or null, each signal's score weight×value. kit-868 drops it.
export function exteriorDashboard(block) {
  return {
    entities: block.entities.map((e) => ({
      entity: e.id, relation: e.relation, relation_word: e.relation_word ?? null, kind: e.kind, name: e.name, matters: e.matters, weight: e.weight,
      signals: e.signals.map((x) => ({ signal: x.id, what: x.what, value: x.value, score: e.weight * x.value })),
    })),
  };
}
// exterior show [--json]: main's exterior.md, printed as it is, either version (--json: a version 1
// block's dashboard data, else null). exterior check: the working tree's, the draft
// (exteriorCheckLines: errors exit 1; warnings leave the exit as it is).
export function cmdExterior() {
  const sub = positional[0];
  if (sub === 'show') {
    gitReadCache = new Map();
    const m = exteriorOnMain();
    if (m === null) return flags.json ? json(null) : out(EXTERIOR_NOT_DRAFTED);
    if (flags.json) { const d = exteriorDoc(m.text); return json(d.block ? exteriorDashboard(d.block) : null); }
    out(`Exterior: ${EXTERIOR_REL()} ${projectInRepo && mainRef() ? 'on main' : 'in the working tree'}`);
    out('');
    out(String(m.text).replace(/\s+$/, ''));
    return;
  }
  if (sub === 'check') {
    if (exteriorTreeText() === null) return out('no exterior.md: nothing to check');
    gitReadCache = new Map();
    const { errors, warnings } = exteriorCheckLines();
    for (const e of errors) out(`error: exterior.md: ${e}`);
    for (const w of warnings) out(`warn: exterior.md: ${w}`);
    process.exit(errors.length ? 1 : 0);
  }
  die('usage: exterior show [--json] | exterior check');
}
/* world-model end */
export function ownerAnswer(qid, what) {
  const q = logGet(qid);
  const v = q?.type === 'question' ? questionView(q) : null;
  if (!v || v.status !== 'answered') die(`${what}: ${qid} is not a question the owner answered`);
  reviewApproves(v, what);
  { const moved = artifactLinksMoved(v); if (moved) die(`${what}: ${moved}`); }
  // An answer approves what it said yes to: the owner's answer must be the question's
  // recommendation (a review, its verified result). Answered any other way, the owner declined or
  // changed it, and the supervisor asks again; a secrets question approves by what was posted.
  // Words alone approve nothing until the supervisor reads them as one choice, citing them.
  // a job change takes only the owner's own pick: no reading is offered (d-20261120-195829274-supervisor)
  if (v.in_words && v.class === 'recurring-edit') die(`${what}: ${qid} was answered in the owner's own words ("${String(v.words).slice(0, 80)}"), not a choice: only the owner's own pick of Yes approves a job change; ask back in its thread, or ask again`);
  if (v.in_words && !v.reading) die(`${what}: ${qid} was answered in the owner's own words ("${String(v.words).slice(0, 80)}"), not a choice: read them with answer ${qid} --read "<label>" --cite "<their words>" --class ${v.class ?? v.kind}, or ask back in its thread when they fit more than one choice`);
  if (!(v.secrets ?? []).length && v.kind !== 'review' && !v.matched) die(`${what}: ${qid} was answered "${String(v.answer ?? '').slice(0, 80)}", not its recommendation${v.recommendation ? ` ("${v.recommendation}")` : ' (it has none)'}: that approves nothing; ask again for what the owner wants`);
  return v;
}
// A review approves something only through a result the owner gave that still verifies.
export function reviewApproves(v, what) {
  if (v?.kind !== 'review') return;
  if (v.declined) die(`${what}: ${v.id} is a review the owner sent back; it approves nothing`);
  if (v.result_status !== 'verified') die(`${what}: ${v.id} is a review whose result is ${v.result_status}; it approves nothing until it verifies (review show ${v.id})`);
}

// settings release (home's, or a repo link's): 'tag', 'merge', { branch: '<name>' }, or
// { on: 'merge', paths: [globs] }. Anything else is a problem. One that could mean deploy-on-merge
// ("merge", or an object with on: "merge") fails closed at merge, since a misread shape would let a
// release through unchecked; any other is a warning (it never meant merging deploys).
export const releaseMayBeOnMerge = (r) => r === 'merge' || (isObj(r) && r.on === 'merge');
export function releaseProblem(r, at = 'release') {
  if (r === undefined || r === 'tag' || r === 'merge') return null;
  const shapes = `"tag", "merge", { "branch": "<name>" } or { "on": "merge", "paths": ["<glob>", …] }`;
  if (!isObj(r)) return `${at}: ${shapes}`;
  const keys = Object.keys(r);
  if (keys.includes('branch') && !keys.includes('on')) return keys.length === 1 && typeof r.branch === 'string' && r.branch ? null : `${at}: { "branch": "<name>" } takes nothing else (${shapes})`;
  if (r.on !== 'merge') return `${at}: ${keys.includes('paths') ? 'paths needs "on": "merge" (without it nothing is checked as a release)' : `"on" is "merge"`}; ${shapes}`;
  const extra = keys.filter((k) => !['on', 'paths'].includes(k));
  if (extra.length) return `${at}: ${extra.join(', ')} is not a release field (on, paths)`;
  if (r.paths !== undefined && !(Array.isArray(r.paths) && r.paths.length && r.paths.every((g) => typeof g === 'string' && g && !g.startsWith('!')))) return `${at}.paths: a non-empty list of globs, no negations (leave paths out when every merge deploys)`;
  return null;
}
// Files that deploy whatever paths says: a platform rebuilds the app when its build setup changes.
// A list with gaps by nature: the owner lists anything else that deploys in paths (quality.md §5).
export const DEPLOY_MANIFESTS = ['Procfile', 'app.json', 'heroku.yml', 'Aptfile', '.slugignore', '.buildpacks', '.profile.d/**', 'bin/pre_compile', 'bin/post_compile', 'Dockerfile', 'Dockerfile.*', '.dockerignore', 'docker-compose.yml', 'fly.toml', 'render.yaml', 'vercel.json', 'netlify.toml', 'nixpacks.toml', 'railway.json', 'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', '.yarnrc', '.yarnrc.yml', '.yarn/**', '.npmrc', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'bun.lockb', 'bun.lock', 'tsconfig.json', 'next.config.*', 'vite.config.*', 'Gemfile', 'Gemfile.lock', 'requirements.txt', 'Pipfile', 'Pipfile.lock', 'pyproject.toml', 'poetry.lock', 'uv.lock', 'go.mod', 'go.sum', 'Cargo.toml', 'Cargo.lock', 'composer.json', 'composer.lock', 'runtime.txt', '.node-version', '.nvmrc', '.ruby-version', '.python-version', '.tool-versions'];
// On a repo that deploys when main changes, the files of a PR that deploy: those outside the kit's
// line, or with release.paths those matching it plus the build files above (never the kit's line:
// the log and records don't deploy). { files: [] } when merging deploys nothing; { problem } when
// it can't be told (fail closed); { warning } beside either.
export function deployingFiles(R, base, sha) {
  const S = R.settings;
  const r = S.release;
  const bad = releaseProblem(r, R.name === 'home' ? 'settings release' : `links.${R.name}.release`);
  if (bad && releaseMayBeOnMerge(r)) return { problem: `${bad}; merge can't tell what deploys` };
  const warning = bad ? `${bad}; read as not deploying on merge` : undefined;
  const onMerge = !bad && (r === 'merge' || r?.on === 'merge' || (r?.branch && r.branch === S.main_branch));
  if (!onMerge) return { files: [], warning };
  const where = R.name === 'home' ? '' : ` in ${R.name}`;
  if (!base) return { problem: `release is on merge and there is no merge base with ${S.main_branch}${where}; merge can't tell what deploys` };
  // the diff itself, not changedFiles (which reads a failed diff as no files)
  const diff = R.git(['diff', '-z', '--name-only', '--no-renames', base, sha]);
  if (diff === null) return { problem: `release is on merge and the diff ${base.slice(0, 12)}..${sha.slice(0, 12)}${where} failed; merge can't tell what deploys` };
  const kit = R.devteamLine();
  const files = diff.split('\0').filter(Boolean).filter((f) => !kit.some((g) => pathMatches(g, f)));
  if (Array.isArray(r?.paths)) return { files: files.filter((f) => DEPLOY_MANIFESTS.some((g) => pathMatches(g, f)) || r.paths.some((g) => pathMatches(g, f))) };
  return { files };
}

// A release decision made on the owner's answer (or a default) releases only what that question
// named: its ticket, or the targets it approves (a batch: ask --approves). A question naming
// neither releases nothing, so one yes can't be spread over tickets the owner never saw.
export function releaseAnswerGap(d, targets) {
  if (!['answer', 'default'].includes(d.authority)) return null;
  const q = d.approved_by?.startsWith('q-') ? logGet(d.approved_by) : null;
  const v = q?.type === 'question' ? questionView(q) : null;
  if (!v) return `rests on ${d.approved_by ?? 'no question'}, which is not a question`;
  const named = [v.ticket, ...(v.approves ?? [])].filter(Boolean);
  if (!named.length) return `rests on ${v.id}, which names no ticket or target (ask --ticket <id>, or --approves <ids> for a batch); a release answer releases only what it named`;
  return targets.some((t) => named.includes(t)) ? null : `rests on ${v.id}, which was about ${named.join(', ')}, not ${targets[0]}; ask about this one`;
}
// The merge word, as a command: verify everything at the PR's exact head, run the project's gates
// there, then merge refusing a moved head, then log the act. Only the supervisor runs it.
// --dry-run runs every check and gate and stops; without a PR it checks the branch's local head.
// One entry of gh's statusCheckRollup, read the one way both merge's check and covered_by read it:
// a status (StatusContext, or anything with a state) by its state; a check run by its conclusion
// once COMPLETED. Uppercased; anything empty or unknown is PENDING, so it is never green.
export function rollupState(c) {
  const state = c.__typename === 'StatusContext' || c.state ? String(c.state ?? '').toUpperCase() : (c.status === 'COMPLETED' ? String(c.conclusion ?? '').toUpperCase() : 'PENDING');
  return { name: c.name ?? c.context ?? '?', state: state || 'PENDING' };
}
// Whether a gate's covered_by (settings gates.<name>.covered_by, the owner's gate-change) is met by
// the forge's checks in this rollup, read at the exact head: "ci" needs every check (ignored ones
// too: ignored_checks never counts as coverage) to be SUCCESS, and at least one check; a list needs
// each named check present and every entry of that name SUCCESS. SKIPPED or NEUTRAL didn't run the
// suite, so they aren't coverage. { covered: true, checks } or { covered: false, why, bad? }.
export function forgeCoverage(coveredBy, rollup, ignored = []) {
  if (coveredBy !== 'ci' && !(Array.isArray(coveredBy) && coveredBy.length && coveredBy.every((n) => typeof n === 'string' && n))) return { covered: false, bad: true, why: 'covered_by is not "ci" or a list of check names' };
  const entries = (rollup ?? []).map(rollupState);
  const notGreen = (e) => `${e.name} is ${e.state.toLowerCase()}${ignored.includes(e.name) ? ' (ignored_checks never counts as coverage)' : ''}`;
  if (coveredBy === 'ci') {
    if (!entries.length) return { covered: false, why: 'the forge reports no checks' };
    const bad = entries.find((e) => e.state !== 'SUCCESS');
    return bad ? { covered: false, why: notGreen(bad) } : { covered: true, checks: [...new Set(entries.map((e) => e.name))] };
  }
  for (const n of coveredBy) {
    const mine = entries.filter((e) => e.name === n);
    if (!mine.length) return { covered: false, why: `${n} is missing` };
    const bad = mine.find((e) => e.state !== 'SUCCESS');
    if (bad) return { covered: false, why: notGreen(bad) };
  }
  return { covered: true, checks: [...coveredBy] };
}
// The forge's own checks on a PR at its head: pending is not passed and failing fails; the names in
// ignored are skipped. what names the PR in the message (the records PR in home, say).
export function forgeCheckFails(pr, ignoredChecks, sha, what = "the forge's checks") {
  const ignored = new Set(ignoredChecks ?? []);
  const pending = [], failing = [];
  for (const c of pr.statusCheckRollup ?? []) {
    const { name, state } = rollupState(c);
    if (ignored.has(name)) continue;
    if (['PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED'].includes(state)) pending.push(name);
    else if (!['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(state)) failing.push(`${name} (${state.toLowerCase()})`);
  }
  return [
    ...(pending.length ? [`${what} are still running at ${sha.slice(0, 12)}: ${pending.join(', ')}; wait for them, then merge`] : []),
    ...(failing.length ? [`${what} failed at ${sha.slice(0, 12)}: ${failing.join(', ')}`] : []),
  ];
}
// A records-in-home ticket's records, pinned for merge: the one home commit merge checks and lands.
// Home's ticket/<id> is fetched as origin has it now; whether it is there is that fetch's answer,
// never a stale origin ref. Records already landed (a rerun after the code failed to land) are
// recognized first: forge git, the fetched head is in home's main; otherwise the newest merged home
// PR from ticket/<id> whose head is the fetched head (the newest of any, when the branch is gone),
// fetched from refs/pull/<n>/head, since a squash or rebase merge never puts that head in main.
// Else an open home PR whose head is the fetched one, not a draft, up to date, its checks green.
// { sha, landed, pr } or { problems }.
export function pinRecords(id) {
  const HR = repo('home');
  const HS = HR.settings;
  const ref = `refs/remotes/origin/ticket/${id}`;
  const fetched = gitRun(['fetch', '--quiet', 'origin', `+refs/heads/ticket/${id}:${ref}`]).status === 0;
  const tip = fetched ? resolveCommit(ref) : null;
  const none = [`no records for ${id} in home: commit them under ${projectRel}/tickets/${id}/ on home's ticket/${id} and push it`];
  if (HS.forge === 'git') {
    if (!tip) return { problems: none };
    git(['fetch', '--quiet', 'origin', HS.main_branch]);
    return { sha: tip, landed: git(['merge-base', '--is-ancestor', tip, `origin/${HS.main_branch}`]) !== null };
  }
  // Both gh reads below are killed at 15 s, as merge's other reads are (kit-793; DEVTEAM_GH_TIMEOUT_MS,
  // a positive whole number of ms, sets it only while DEVTEAM_TEST is set): a killed read is no answer,
  // so no merged PR is found, and no open one, and merge refuses before its gates
  const ghMs = process.env.DEVTEAM_TEST ? Math.trunc(Number(process.env.DEVTEAM_GH_TIMEOUT_MS)) : NaN;
  const ghSet = Number.isSafeInteger(ghMs) && ghMs > 0;
  const ghRead = { timeout: ghSet ? ghMs : 15000, killSignal: 'SIGKILL' };
  let merged = [];
  try { merged = JSON.parse(HR.gh(['pr', 'list', '--head', `ticket/${id}`, '--state', 'merged', '--json', 'number,headRefOid,mergedAt'], ghRead) ?? '[]'); } catch {}
  merged = (Array.isArray(merged) ? merged : []).sort((a, b) => String(b.mergedAt ?? '').localeCompare(String(a.mergedAt ?? '')));
  const m = tip ? merged.find((p) => p.headRefOid === tip) : merged[0];
  if (m) {
    if (!resolveCommit(m.headRefOid)) gitRun(['fetch', '--quiet', 'origin', `refs/pull/${m.number}/head`]);
    if (!resolveCommit(m.headRefOid)) return { problems: [`home's records PR #${m.number} merged at ${String(m.headRefOid).slice(0, 12)}, which can't be fetched (refs/pull/${m.number}/head)`] };
    return { sha: m.headRefOid, landed: true, pr: m.number };
  }
  if (!tip) return { problems: none };
  const j = HR.gh(['pr', 'view', `ticket/${id}`, '--json', 'number,headRefOid,isDraft,mergeStateStatus,state,statusCheckRollup'], ghRead);
  let p = null;
  try { p = j ? JSON.parse(j) : null; } catch {}
  if (!p || (p.state && p.state !== 'OPEN')) return { problems: [`no open home PR from ticket/${id} (its records): open one in home with the ticket's PR title`] };
  const problems = [];
  if (p.isDraft) problems.push(`home's records PR #${p.number} is a draft`);
  if (['BEHIND', 'DIRTY'].includes(p.mergeStateStatus)) problems.push(`home's records PR #${p.number} is ${p.mergeStateStatus.toLowerCase()} relative to home's main; the author merges home's main into ticket/${id} and asks again`);
  if (p.headRefOid !== tip) problems.push(`home's records PR #${p.number} is at ${String(p.headRefOid).slice(0, 12)}, not home's ticket/${id} as fetched (${tip.slice(0, 12)})`);
  problems.push(...forgeCheckFails(p, HS.ignored_checks, tip, "home's records PR checks"));
  return problems.length ? { problems } : { sha: tip, landed: false, pr: p.number };
}
// Land a records-in-home ticket's pinned records on home's main, with merge's own message (never
// run/pr/, which is the link PR's). Home's mergeShaFor is never asked about a link ticket
// (factsRepo routes it to its link), so the subject needn't avoid what findMergeSha reads; don't
// add a fallback to home there. null, or why it didn't land.
export function landRecords(id, rec, linkName) {
  const HR = repo('home');
  const HS = HR.settings;
  const [subject, body] = recurringRegistry.recordsMessage(id, rec.sha, linkName).split('\n\n');
  if (HS.forge === 'git') {
    // Onto the home main the checks judged (recordsBranchFails, at mainSha()), as the code lands
    // (cmdMerge's landCode): no hook runs, directory renames are a conflict, the merge must be
    // exactly the records onto that main with main's jobs, and it is pushed by sha, only while
    // origin's main is still that commit. The merge, its checks, the push and the fetch after a
    // failed push are bounded (recurringRegistry.git), and so is the fetch after landing (kit-791); the
    // worktree's add and remove are not (final-12 F5).
    const checked = mainSha();
    if (!checked) return `no home ${HS.main_branch} to land on`;
    const lg = (args, cwd) => recurringRegistry.git(args, { cwd });
    const noHooks = ['-c', 'core.hooksPath=/dev/null'];
    const wt = detachedWorktree(checked, `land-records-${slug(id)}`, HR, { seed: false });
    try {
      const m = lg([...noHooks, ...recurringRegistry.MERGE_FLAGS, 'merge', '--no-ff', '--quiet', '-m', `${subject}\n\n${body}`, rec.sha], wt);
      if (!m.ok) return m.timedOut ? `the merge of home's ticket/${id} at ${rec.sha.slice(0, 12)} onto home's ${HS.main_branch} timed out; nothing pushed` : `home's ticket/${id} at ${rec.sha.slice(0, 12)} does not merge onto home's ${HS.main_branch}`;
      const h = lg(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], wt);
      const head = h.ok ? h.out.trim() : '';
      const p = head ? lg(['rev-list', '--parents', '-n', '1', head], wt) : null;
      const parents = p?.ok ? p.out.trim().split(' ').slice(1) : [];
      if (parents.length !== 2 || parents[0] !== checked || parents[1] !== rec.sha) return `the records merge${head ? ` at ${head.slice(0, 12)}` : ''} is not home's ticket/${id} at ${rec.sha.slice(0, 12)} onto home's ${HS.main_branch} at ${checked.slice(0, 12)}; nothing pushed`;
      const M = recurringRegistry.read(checked);
      const H = recurringRegistry.read(head);
      if (!recurringRegistry.keepsJobs(M, H)) return `the records merge at ${head.slice(0, 12)} lands other jobs (recurring.json) than home's ${HS.main_branch} has; records never change them; nothing pushed`;
      // the merge's own sha, before its push: the only records merge a rerun adopts (final-15 F1)
      const noted = recurringRegistry.recordLanding(recurringRegistry.landingFile('home', `records-${id}`, rec.sha), head, checked);
      if (noted) return `couldn't record the records merge ${head.slice(0, 12)} before its push (${noted}); nothing pushed`;
      const pushed = lg([...noHooks, 'push', '--quiet', '--no-verify', `--force-with-lease=${HS.main_branch}:${checked}`, 'origin', `${head}:refs/heads/${HS.main_branch}`], wt);
      if (!pushed.ok) {
        // origin may have taken it and only its answer failed or timed out (a slow post-receive): when
        // origin's main, fetched again with a bound, is exactly the merge built and checked here, the
        // records landed, and their act is logged as for any landing (final-12 F3, as landCode's final-11 F3)
        const f = lg(['fetch', '--quiet', 'origin', HS.main_branch], wt);
        const o = f.ok ? lg(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${HS.main_branch}^{commit}`], wt) : null;
        // killed at the timeout, origin may still take it (a slow pre-receive): it may have landed, and
        // the rerun recognises the kit's own merge and logs the act then (final-13 F1)
        if (!(o?.ok && o.out.trim() === head)) {
          if (pushed.timedOut) return { maybe: `the push to home's ${HS.main_branch} timed out before origin answered, and its ${HS.main_branch} isn't the records merge yet` };
          // a main that moved since the checks says so, with both shas, as landCode's moved() does (kit-332)
          if (o?.ok && o.out.trim() !== checked) return `push to home's ${HS.main_branch} refused: home's ${HS.main_branch} moved since the checks (${checked.slice(0, 12)} to ${o.out.trim().slice(0, 12)}); run merge again`;
          return `push to home's ${HS.main_branch} refused (did main move?)`;
        }
        out(`the push of the records to home's ${HS.main_branch} ${recurringRegistry.why(pushed)}, but origin's ${HS.main_branch} is the records merge the kit built and checked (${head.slice(0, 12)}): landed`);
      }
    } finally {
      git(['worktree', 'remove', '--force', wt], mainRoot);
    }
  } else {
    // GitHub has no lease on the base: home's main is read again just before gh pr merge, and must
    // still be the main the checks judged (mainSha(), read before this fetch), as landCode's moved()
    // does for the code (kit-332). The fetch is bounded (recurringRegistry.git); one that fails refuses.
    // Each gh call here is killed at its bound, as landCode's are (kit-787): gh pr merge at 60 s, each
    // state read at 15 s (DEVTEAM_GH_TIMEOUT_MS, a positive whole number of ms, sets both, only while
    // DEVTEAM_TEST is set: kit-793), so the records' gh calls wait at most 60 + 3 x 15 + 2 x 2 = 109 s
    // here, after pinRecords' two reads (15 s each) before the gates; a killed call reads as failed.
    // Both git fetches are bounded (120 s): the one below, and the one after landing (kit-791).
    const ghMs = process.env.DEVTEAM_TEST ? Math.trunc(Number(process.env.DEVTEAM_GH_TIMEOUT_MS)) : NaN;
    const ghSet = Number.isSafeInteger(ghMs) && ghMs > 0;
    const ghMerge = { timeout: ghSet ? ghMs : 60000, killSignal: 'SIGKILL' };
    const ghRead = { timeout: ghSet ? ghMs : 15000, killSignal: 'SIGKILL' };
    const checked = mainSha();
    if (!checked) return `no home ${HS.main_branch} to land on`;
    if (!recurringRegistry.git(['fetch', '--quiet', 'origin', HS.main_branch], { cwd: mainRoot }).ok) return `couldn't fetch home's ${HS.main_branch} to check it hasn't moved since the checks; run merge again`;
    const tip = resolveCommit(`refs/remotes/origin/${HS.main_branch}`);
    if (tip !== checked) return `home's ${HS.main_branch} moved since the checks (${String(checked).slice(0, 12)} to ${String(tip).slice(0, 12)}); run merge again`;
    if (HR.gh(['pr', 'merge', String(rec.pr), `--${HS.merge_method}`, ...(HS.merge_admin === true ? ['--admin'] : []), '--match-head-commit', rec.sha, '--subject', subject, '--body', body], ghMerge) === null) {
      // gh can exit non-zero after GitHub merged (an error or a timeout in its answer, a slow GitHub):
      // GitHub's own state says, read while it still says OPEN, three times at most, 2 s apart. The PR
      // was open (pinRecords); MERGED at the pinned records now is their landing, as a clean merge's (kit-782)
      let st = null;
      for (let i = 0; i < 3; i++) {
        if (i) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
        st = null;
        try { st = JSON.parse(HR.gh(['pr', 'view', String(rec.pr), '--json', 'state,headRefOid'], ghRead) ?? 'null'); } catch {}
        if (st?.state !== 'OPEN') break;
      }
      if (!(st?.state === 'MERGED' && st.headRefOid === rec.sha)) return `gh pr merge of home's records PR #${rec.pr} refused (did its head move?)`;
      out(`gh pr merge of home's records PR #${rec.pr} exited non-zero, but GitHub has #${rec.pr} merged at ${rec.sha.slice(0, 12)}: landed`);
    }
  }
  // The fetch after the landing only refreshes origin/<main> here: the records have landed. It is
  // bounded (recurringRegistry.git: 120 s, then SIGKILL; DEVTEAM_GIT_TIMEOUT_MS for tests), and one
  // that fails or times out is said, never a refusal: their act is written next, and the code lands (kit-791)
  const fetched = recurringRegistry.git(['fetch', '--quiet', 'origin', HS.main_branch], { cwd: mainRoot });
  if (!fetched.ok) warn(`the records landed, but the fetch of home's ${HS.main_branch} after them ${recurringRegistry.why(fetched)}; origin/${HS.main_branch} in ${mainRoot} may not show them yet: check with git fetch origin ${HS.main_branch} there`);
  mainRefCache = undefined; mainLogCache = undefined; mergeShaCache.clear();
  return null;
}
