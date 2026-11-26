/* imports start */
import fs from 'node:fs';
import path from 'node:path';
import { ARTIFACTS_REL } from '../artifacts.mjs';
import { ARTIFACT_AT } from '../artifacts.mjs';
import { BRANCH_AT } from '../artifacts.mjs';
import { DATA_WAIT_MS } from '../accounts.mjs';
import { FILES_MAX } from '../hub/operator.mjs';
import { LINK_ID } from '../links.mjs';
import { OPERATOR_PROOF_MS } from '../hub/operator.mjs';
import { OUTCOME_MAX } from '../threads.mjs';
import { PERSON_MALFORMED } from '../orient.mjs';
import { PREVIEW_NAME } from '../previews.mjs';
import { READY_AT } from '../threads.mjs';
import { REPO_PATH } from '../lens.mjs';
import { REVIEW_MAX } from '../lens.mjs';
import { THREAD_ID } from '../threads.mjs';
import { THREAD_TITLE_MAX } from '../threads.mjs';
import { TREE_ID } from '../links.mjs';
import { TURN_ENCODED_MAX } from '../threads.mjs';
import { TURN_MAX } from '../threads.mjs';
import { UNSAFE_TEXT } from '../links.mjs';
import { artifactHeaders } from '../artifacts.mjs';
import { artifactPathOk } from '../artifacts.mjs';
import { artifactSource } from '../artifacts.mjs';
import { artifactTreeOk } from '../artifacts.mjs';
import { askableProblem } from '../settings.mjs';
import { dashboardData } from '../orient.mjs';
import { draftDirOk } from '../artifacts.mjs';
import { draftWorktree } from '../artifacts.mjs';
import { encodedBytes } from '../threads.mjs';
import { execFile } from 'node:child_process';
import { fingerprint } from '../artifacts.mjs';
import { frameProblem } from '../artifacts.mjs';
import { git } from '../base.mjs';
import { isObj } from '../artifact-notes.mjs';
import { kitDir } from '../state.mjs';
import { mainRef } from '../log.mjs';
import { mainRoot } from '../state.mjs';
import { noteSource } from '../artifacts.mjs';
import { noteToCheck } from '../artifacts.mjs';
import { nowIso } from '../base.mjs';
import { out } from '../base.mjs';
import { ownerSettingProofProblem } from '../sessions.mjs';
import { paneAnswerShape } from '../sessions.mjs';
import { paneProofProblem } from '../sessions.mjs';
import { previewServed } from '../previews.mjs';
import { previewUp } from '../previews.mjs';
import { readPreviews } from '../previews.mjs';
import { receiveLaptopUpload } from '../hub/operator.mjs';
import { repo } from '../repos.mjs';
import { repoReadable } from '../repos.mjs';
import { requestPerson } from '../orient.mjs';
import { rest } from '../base.mjs';
import { reviewPageCsp } from '../lens.mjs';
import { schemaDocs } from '../lineage.mjs';
import { serveLaptopUpload } from '../hub/operator.mjs';
import { sha256 } from '../lens.mjs';
import { shotFolder } from '../artifacts.mjs';
import { shotHolds } from '../artifacts.mjs';
import { slug } from '../base.mjs';
import { subjectProblem } from '../threads.mjs';
import { supervisorCheckedAt } from '../threads.mjs';
import { threadWorking } from '../threads.mjs';
import { threadsNeedGateway } from '../hub/operator.mjs';
import { uncapped } from '../threads.mjs';
import { undeliveredTurns } from '../threads.mjs';
import { withArtifactLens } from '../lens.mjs';
/* imports end */
/* dashboardRoutes start */
// What a route group returns when none of its routes matched the request.
export const DASH_NEXT = Symbol('next route');
// The routes' context: a name a group reads from it that cmdDashboard did not pass throws, not undefined.
// A symbol or the key "then" reads through unchecked, so logging or awaiting it never throws.
export function dashContext(o) {
  return new Proxy(o, { get(t, k, r) { if (typeof k === 'string' && k !== 'then' && !(k in t)) throw new Error(`dashboard route context has no ${k}`); return Reflect.get(t, k, r); } });
}
// The owner actions the dashboard takes at POST /api/<name>, each a body check that gives the argv or
// null, with what they share. A new owner action is an entry here.
export function dashboardActions() {
  const ID = /^[a-z]-\d{8}-\d{9}-[a-z0-9]+(-[a-z0-9]+)*$/;
  // no string an action puts in argv holds a NUL: no process can be given one
  const text = (x, max = 4000) => typeof x === 'string' && x.trim() && x.length <= max && !x.includes('\0');
  const autonomyArgs = (b) => ([1, 2, 3].includes(b.autonomy) ? ['--autonomy', String(b.autonomy), ...(text(b.scope, 100) ? [`--scope=${b.scope.trim()}`] : [])] : []);
  const turnOk = (x) => typeof x === 'string' && !!x.trim() && !x.includes('\0') && Buffer.byteLength(x.trim()) <= TURN_MAX && encodedBytes(x.trim()) <= TURN_ENCODED_MAX;
  const lineOk = (x, max, bytes = false) => typeof x === 'string' && !!x.trim() && !UNSAFE_TEXT.test(x) && (bytes ? Buffer.byteLength(x.trim()) : x.trim().length) <= max;
  // The files dropped with an answer or a turn, passed on whole: only the list's shape is checked
  // here, the command checks everything (attachedFiles). None, or an empty list, is no files; any
  // other value is no action (null).
  // files alone (kit-171): a non-empty list stands in for the words, which the command fills
  const hasFiles = (b) => Array.isArray(b.files) && b.files.length > 0;
  const filesArgs = (b) => (b.files === undefined || (Array.isArray(b.files) && !b.files.length) ? [] : Array.isArray(b.files) && b.files.length <= FILES_MAX ? [`--files=${JSON.stringify(b.files)}`] : null);
  const ACTIONS = {
    answer: (b) => {
      // choice, from a card with choices (kit-313): the label picked, the words in answer optional, or
      // null for the words alone. Without the key (an older page, a goal or owner-action card) the
      // answer is the text as typed.
      const picked = Object.hasOwn(b, 'choice');
      if (!ID.test(b.id ?? '')) return null;
      if (picked && (b.decline !== undefined || (b.choice !== null && !text(b.choice, 300)))) return null;
      const words = text(b.answer) ? b.answer.trim() : '';
      if (!words && !((typeof b.choice === 'string' || hasFiles(b)) && (b.answer === undefined || (typeof b.answer === 'string' && !b.answer.trim())))) return null;
      if (b.decline !== undefined && b.decline !== true) return null;
      const files = filesArgs(b);
      if (!files) return null;
      // the owner's words, and a label, go as values no flag can be read from: the words after "--",
      // the label and the rule inside their flag (--choice=<label>), so "--rule=…" typed is words
      const args = ['answer', b.id, ...(!picked ? [] : b.choice === null ? ['--in-words'] : [`--choice=${b.choice.trim()}`]), ...autonomyArgs(b), ...(/^[0-9a-f]{16}$/.test(b.seen ?? '') ? ['--seen', b.seen] : []), ...files];
      // "Send it back" on a review: the owner's reason, no result
      if (b.decline === true) args.push('--decline');
      else if (text(b.rule, 600)) args.push(`--rule=${b.rule.trim()}`);
      return [...args, ...(words ? ['--', words] : [])];
    },
    correct: (b) => (ID.test(b.id ?? '') && text(b.reason, 600) && (b.impact === undefined || [1, 2, 3, 4].includes(b.impact)) ? ['correct', b.id, '--reason', b.reason.trim(), ...(b.impact !== undefined ? ['--impact', String(b.impact)] : [])] : null),
    'goal-hold': (b) => ((ID.test(b.id ?? '') || b.id === 'upkeep') && ['run', 'drain', 'park'].includes(b.mode) && (b.reason === undefined || b.reason === '' || text(b.reason, 300)) ? ['goal', 'hold', b.id, b.mode, '--owner', ...(b.reason ? ['--reason', b.reason.trim()] : [])] : null),
    fleet: (b) => (['drain', 'park', 'undrain', 'unpark', 'resume'].includes(b.op) && (b.reason === undefined || b.reason === '' || text(b.reason, 300)) && (b.move === undefined || typeof b.move === 'boolean') ? ['fleet', b.op, '--owner', ...(b.move === true && ['drain', 'park'].includes(b.op) ? ['--move'] : []), ...(b.reason && ['drain', 'park'].includes(b.op) ? ['--reason', b.reason.trim()] : [])] : null),
    // the card's Mark met: goal status met, which reads a repo or prod check again first
    'goal-met': (b) => (ID.test(b.id ?? '') ? ['goal', 'status', b.id, 'met'] : null),
    // the owner's goal order (kit-234's drag to reorder): the goals named, first to last
    'goal-order': (b) => (Array.isArray(b.ids) && b.ids.length >= 1 && b.ids.length <= 50 && b.ids.every((x) => typeof x === 'string' && ID.test(x)) ? ['goal', 'order', ...b.ids] : null),
    'goal-decide': (b) => (ID.test(b.id ?? '') && ['approve', 'refine', 'let-go', 'restore'].includes(b.verdict) && (b.notes === undefined || text(b.notes, 4000)) ? ['goal', 'decide', b.id, b.verdict, ...(b.notes ? ['--notes', b.notes.trim()] : [])] : null),
    knowledge: (b) => (ID.test(b.id ?? '') && ['accepted', 'retired', 'stale'].includes(b.status) && (b.note === undefined || b.note === '' || (text(b.note, 600) && !/[\r\n]/.test(b.note))) ? ['knowledge', 'set', b.id, '--status', b.status, ...(b.note?.trim() ? ['--note', b.note.trim()] : []), '--owner'] : null),
    ack: (b) => (/^[a-z][a-z-]*$/.test(b.kind ?? '') && text(b.subject, 200) && text(b.reason, 600) ? ['ack', b.kind, b.subject, '--reason', b.reason.trim(), '--owner'] : null),
    // Only the cloud gateway calls it, after the owner confirmed on its own page (and the Library's
    // Forget, for a record the owner doesn't want restored); the Library has no button that publishes.
    // Like every owner action here it can't tell who asks: anything on the box can reach it, so a
    // line it writes is a claim, and the gateway's confirm page never takes it for the owner's click.
    'artifact-publish': (b) => (LINK_ID.test(b.slug ?? '') && (b.op === 'unpublish' || (b.op === 'publish' && TREE_ID.test(b.tree ?? ''))) ? ['artifact', b.op, b.slug, '--owner', ...(b.op === 'publish' ? ['--tree', b.tree] : [])] : null),
    'preview-stop': (b) => (typeof b.name === 'string' && PREVIEW_NAME.test(b.name) ? ['preview', 'stop', b.name] : null),
    'preview-start': (b) => (typeof b.name === 'string' && PREVIEW_NAME.test(b.name) ? ['preview', 'start', b.name] : null),
    // Threads, from the layer. The owner's words always go after --, so words that start with -- stay
    // words; the title, subject and outcome as --key=value, kept whole whatever they hold. A subject
    // is checked here before anything is spawned (any kind the log takes: an item or a spot on the
    // dashboard, a spot on an artifact or a preview from a viewer), and thread new checks it again.
    // A capability is cut from the title and subject first, so not even the argv holds one.
    'thread-new': (b) => {
      const [title, subject, frame, files] = [uncapped(b.title), uncapped(b.subject), uncapped(b.frame), filesArgs(b)];
      return files && (frame == null || !frameProblem(frame, subject)) && lineOk(title, THREAD_TITLE_MAX) && (turnOk(b.text) || (hasFiles(b) && (b.text === undefined || (typeof b.text === 'string' && !b.text.trim())))) && (subject == null || !subjectProblem(subject)) ? ['thread', 'new', `--title=${title.trim()}`, ...(subject ? [`--subject=${JSON.stringify(subject)}`] : []), ...(frame ? [`--frame=${JSON.stringify(frame)}`] : []), ...files, ...(turnOk(b.text) ? ['--', b.text.trim()] : [])] : null;
    },
    'thread-say': (b) => { const files = filesArgs(b); return files && (typeof b.id === 'string' && THREAD_ID.test(b.id)) && (turnOk(b.text) || (hasFiles(b) && (b.text === undefined || (typeof b.text === 'string' && !b.text.trim())))) ? ['thread', 'say', b.id, ...files, ...(turnOk(b.text) ? ['--', b.text.trim()] : [])] : null; },
    'thread-resolve': (b) => ((typeof b.id === 'string' && THREAD_ID.test(b.id)) && (b.outcome === undefined || b.outcome === '' || lineOk(b.outcome, OUTCOME_MAX, true)) ? ['thread', 'resolve', b.id, ...(b.outcome?.trim() ? [`--outcome=${b.outcome.trim()}`] : [])] : null),
    'thread-reopen': (b) => ((typeof b.id === 'string' && THREAD_ID.test(b.id)) && (b.text === undefined || b.text === '' || turnOk(b.text)) ? ['thread', 'reopen', b.id, ...(b.text?.trim() ? ['--', b.text.trim()] : [])] : null),
    // bound to the proposal the card showed: a newer one is refused, so the owner reads it first
    'thread-accept': (b) => ((typeof b.id === 'string' && THREAD_ID.test(b.id)) && typeof b.at === 'string' && READY_AT.test(b.at) ? ['thread', 'resolve', b.id, '--accept', `--at=${b.at}`] : null),
    'thread-accept-addressed': (b) => ((typeof b.id === 'string' && THREAD_ID.test(b.id)) && typeof b.at === 'string' && READY_AT.test(b.at) ? ['thread', 'resolve', b.id, '--accept-addressed', `--at=${b.at}`] : null),
    'artifact-handoff': (b) => (typeof b.slug === 'string' && LINK_ID.test(b.slug) && typeof b.at === 'string' && ARTIFACT_AT.test(b.at) ? ['artifact', 'handoff', b.slug, `--at=${b.at}`, '--json'] : null),
  };
  // An action whose caller has a deadline of its own: the gateway gives the whole answer 15 s.
  const ACTION_MS = { 'artifact-publish': 12000 };
  // An action whose reply is what its command printed, a JSON object, and nothing else.
  const ACTION_JSON = new Set(['artifact-handoff']);
  return { ID, text, autonomyArgs, turnOk, lineOk, filesArgs, ACTIONS, ACTION_MS, ACTION_JSON };
}
// POST /upload; GET/HEAD /upload/…
export async function dashRoutesUpload(D, req, res, q) {
  const { send } = D;
  // a file dropped on the page: before every other route, and before a byte of its body is read
  if (req.method === 'POST' && (req.url === '/upload' || req.url.startsWith('/upload?'))) {
    clearTimeout(q.bodyTimer);
    try { return await receiveLaptopUpload(req, res, new URL(req.url, 'http://x').searchParams.get('name'), send); } catch (e) {
      process.stderr.write(`a dropped file could not be stored: ${e.message}\n`);
      if (!res.headersSent && !res.destroyed) return send(res, 500, 'application/json', JSON.stringify({ error: 'this machine could not store this file' }), { connection: 'close' });
      return void req.destroy();
    }
  }
  // a dropped file, back to this page: before the routes below, which parse the URL
  if ((req.method === 'GET' || req.method === 'HEAD') && req.url.startsWith('/upload/')) return await serveLaptopUpload(req, res, req.url.split('?')[0], send);
  return DASH_NEXT;
}
// /api/hello (with level, for a box's level header); / and /index.html; /api/data (with viewer: { level })
export async function dashRoutesPage(D, req, res, q) {
  // The level the box's gateway says this request is (kit-250): exactly one x-devteam-level line,
  // exactly full or view, or null. Only the gateway sets it (it drops the browser's copy); a laptop
  // has none. It changes what the page shows, never what this server lets anyone do.
  const viewerLevel = () => {
    const lines = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === 'x-devteam-level') lines.push(req.rawHeaders[i + 1]);
    return lines.length === 1 && (lines[0] === 'full' || lines[0] === 'view') ? lines[0] : null;
  };
  // the body with the level spliced in as its first key, for a box's level: /api/data's viewer: { level },
  // hello's level (its viewer: 1 is a kit capability the gateway reads). The string it was given never
  // changes (a kept one stays as it was), and only an object is spliced.
  const withViewer = (body, key = 'viewer') => {
    const level = viewerLevel();
    const open = body.search(/\S/);
    if (!level || open < 0 || body[open] !== '{') return body;
    const rest = body.slice(open + 1);
    return `{"${key}":${JSON.stringify(key === 'viewer' ? { level } : level)}${rest.trimStart().startsWith('}') ? '' : ','}${rest}`;
  };
  const { page, pageCsp, send, helloBody, stageFrames, dashboardData, logWatch } = D;
  // hello carries it too, as level: the artifact and preview viewer reads no /api/data, and polls this already
  if (req.method === 'GET' && req.url === '/api/hello') return send(res, 200, 'application/json', withViewer(helloBody(), 'level'));
  // frame-src 'self': a frame of this page (a review page, an HTML mock) may navigate itself, and
  // this keeps it on the dashboard; a sandbox alone would let it load any URL, query string and all.
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    // frame-ancestors: only this dashboard and the machine's hub may frame it, so another site
    // can't lay it under its own page and steer a click onto an owner action.
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': pageCsp(stageFrames()) });
    return res.end(fs.readFileSync(page));
  }
  if (req.method === 'GET' && req.url.startsWith('/api/data')) {
    // the log looked at now, so a change the watch hasn't delivered yet makes the kept build stale
    logWatch.look();
    // A run slower than DATA_WAIT_MS, with data to fall back on, answers with that, marked stale:
    // the run goes on and the next read has it, but no page waits minutes on a stuck child.
    let waited;
    const slow = new Promise((resolve) => { waited = setTimeout(() => resolve({ ok: false, stderr: '' }), DATA_WAIT_MS); });
    const r = await (D.lastData ? Promise.race([dashboardData(), slow]) : dashboardData());
    clearTimeout(waited);
    if (!r.ok && !D.lastData) return send(res, 500, 'application/json', JSON.stringify({ error: r.stderr.trim() }));
    // The page in use says which version of itself it is: an open tab keeps the code it loaded,
    // so after a kit update it compares this with the first one it saw and offers a reload.
    let version = '';
    try { version = sha256(fs.readFileSync(page)).slice(0, 16); } catch {}
    // a run that failed or timed out serves the last good data, marked stale
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-devteam-page': version, ...(r.ok ? {} : { 'x-devteam-stale': 'true' }) });
    // a fresh run's or the kept last good data, with the viewer for a box's level (D.lastData untouched)
    return res.end(withViewer(r.ok ? r.stdout : D.lastData));
  }
  return DASH_NEXT;
}
// /view/artifact/…, /view/preview/…, /api/artifact-fp, /api/view, /api/artifact-versions
export async function dashRoutesViewer(D, req, res, q) {
  const { u } = q;
  const { page, pageCsp, run, describing, versioning, send, previewStage, remote } = D;
  // The viewer (spec §7): this page in viewer mode, one artifact on its stage. Its frames are this
  // dashboard's own pages. It may be framed by itself and the machine's hub, by policy alone and
  // never X-Frame-Options: on a box the gateway adds the public name to frame-ancestors for its
  // owner wrapper, and leaves every other header as it is.
  const vw = req.method === 'GET' ? /^\/view\/artifact\/([^/]+)$/.exec(u.pathname) : null;
  if (vw) {
    if (!LINK_ID.test(vw[1]) || !ARTIFACT_AT.test(u.searchParams.get('at') || 'main')) return send(res, 404, 'text/plain; charset=utf-8', 'not found');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': pageCsp() });
    return res.end(fs.readFileSync(page));
  }
  // A preview's viewer: the same page, framing the preview's lens where it is served (previewStage):
  // frame-src names exactly that origin, the preview's own name on a box (the gateway rewrites no
  // dev port) or this laptop's relay (decision 5). Never opens a relay: any page can navigate here
  // (decision 3); the page's own /api/view does, and says so.
  const vp = req.method === 'GET' ? /^\/view\/preview\/([^/]+)$/.exec(u.pathname) : null;
  if (vp) {
    const rec = PREVIEW_NAME.test(vp[1]) ? readPreviews().find((r) => r.name === vp[1]) : null;
    if (!rec) return send(res, 404, 'text/plain; charset=utf-8', 'not found');
    const { origin } = await previewStage(rec);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': pageCsp(origin ? [origin] : []) });
    return res.end(fs.readFileSync(page));
  }
  // A draft's fingerprint, for the viewer's 2 s draft poll (responder contract, artifact-fp@1): the
  // same fp artifact describe gives, from stat calls and the oid cache (diskOid hashes only a file
  // whose size or mtime moved), in this process: no child, no git. Drafts only: main or a published
  // tree never changes under a viewer, so it is a 400. 404 when artifactSource finds nothing (an
  // unknown slug or worktree, a reviewer's or scratch one, a symlinked folder). Same-origin only, as /api/threads.
  if (req.method === 'GET' && u.pathname === '/api/artifact-fp') {
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin') return send(res, 403, 'application/json', JSON.stringify({ error: "not for another site's page" }));
    const slug = u.searchParams.get('slug') ?? '';
    const at = u.searchParams.get('at') ?? '';
    if (!LINK_ID.test(slug) || !ARTIFACT_AT.test(at) || at === 'main' || at.startsWith('tree:')) return send(res, 400, 'application/json', JSON.stringify({ error: 'a slug, and at a draft\'s worktree (drafts only)' }));
    // a draft from another machine (kit-750): its fetched tree, read async, its fp kept by tree id;
    // a branch or folder that isn't there is gone (404), a git that fails a 500
    if (at.startsWith('origin:')) {
      const r = await remote.resolve(at.slice(7), slug);
      if (r.failed) return send(res, 500, 'application/json', JSON.stringify({ error: "the draft's files: git failed" }));
      if (!r.tree) return send(res, 404, 'application/json', JSON.stringify({ error: `no draft of ${slug} at ${at}` }));
      return send(res, 200, 'application/json', JSON.stringify({ fp: r.fp, at }));
    }
    // a draft that vanishes mid-walk is nothing there (404); any other failure (EACCES, EMFILE) is a 500, as /api/view keeps them apart
    let src;
    try { src = artifactSource(at, slug); } catch (e) {
      if (e?.code !== 'ENOENT' && e?.code !== 'ENOTDIR') return send(res, 500, 'application/json', JSON.stringify({ error: `the draft's files: ${e?.code ?? 'error'}` }));
      src = null;
    }
    if (!src) return send(res, 404, 'application/json', JSON.stringify({ error: `no draft of ${slug} at ${at}` }));
    return send(res, 200, 'application/json', JSON.stringify({ fp: fingerprint(src.entries), at }));
  }
  // What the viewer's bar and its "changed since" read of what it shows (artifact describe), so a
  // viewer never waits on /api/data. Since kit-206 the viewer asks it every 10 s while it is seen:
  // a child process per ask, one shared by asks for the same one while it runs. The cheap,
  // stat-only route for the 2 s draft poll is /api/artifact-fp. A GET carries no Origin:
  // same-origin only, as /api/threads. 404 only when describe says nothing is there (the viewer
  // then shows main); a timeout or a crash is a 500, never mistaken for that.
  if (req.method === 'GET' && u.pathname === '/api/view') {
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin') return send(res, 403, 'application/json', JSON.stringify({ error: "not for another site's page" }));
    const slug = u.searchParams.get('slug') ?? '';
    const at = u.searchParams.get('at') || 'main';
    if (u.searchParams.get('kind') === 'preview') {
      const rec = readPreviews().find((r) => r.name === u.searchParams.get('name') && PREVIEW_NAME.test(r.name));
      if (!rec) return send(res, 404, 'application/json', JSON.stringify({ error: 'no such preview here' }));
      // the one place a relay opens: this same-origin ask, never a GET of /view/preview/ (decision 3)
      const { origin, opened } = await previewStage(rec, { open: true });
      return send(res, 200, 'application/json', JSON.stringify({ name: rec.name, label: rec.label, session: rec.session, project: rec.project, up: previewUp.get(rec.name) ?? null, origin, opened, lens: origin ? `${origin}/.devteam/lens` : null, served: previewServed() }));
    }
    if (u.searchParams.get('kind') !== 'artifact' || !LINK_ID.test(slug) || !ARTIFACT_AT.test(at)) return send(res, 400, 'application/json', JSON.stringify({ error: 'bad kind, slug or at' }));
    const key = `${slug}|${at}`;
    let job = describing.get(key);
    if (!job) { job = run(['artifact', 'describe', slug, `--at=${at}`, '--json'], { timeout: 12000 }).finally(() => describing.delete(key)); describing.set(key, job); }
    const r = await job;
    if (r.ok) return send(res, 200, 'application/json', r.stdout);
    return r.code === 3 ? send(res, 404, 'application/json', JSON.stringify({ error: `no artifact ${slug} at ${at}` })) : send(res, 500, 'application/json', JSON.stringify({ error: 'the artifact could not be read' }));
  }
  // The Library's fetch of origin (kit-750): when it last fetched, whether that failed (the Library
  // then says remote drafts may be stale), and rev, which moves when a fetch moved a ref. A GET only
  // reads (org-access A13: no GET starts a command that writes). The page's POST is the demand: a
  // Library or an artifact viewer open keeps origin fetched each interval. It is held to the owner
  // actions' same-origin rule (a browser's own page, a JSON body), as fleet-check, the other POST
  // that fetches; a refused one changes nothing.
  if (u.pathname === '/api/artifact-remote' && (req.method === 'GET' || req.method === 'POST')) {
    const site = req.headers['sec-fetch-site'];
    const origin = req.headers.origin;
    const own = `http://${req.headers.host}`;
    if (req.method === 'GET') {
      if (site !== undefined && site !== 'same-origin') return send(res, 403, 'application/json', JSON.stringify({ error: "not for another site's page" }));
      return send(res, 200, 'application/json', JSON.stringify(remote.status()));
    }
    const sameOrigin = (site === 'same-origin' || origin === own) && (site === undefined || site === 'same-origin') && (origin === undefined || origin === own);
    const no = () => send(res, 403, 'application/json', JSON.stringify({ error: "only from this dashboard's own page, in a browser, with an empty {} body" }));
    if (!q.okHost || !sameOrigin || !(req.headers['content-type'] ?? '').startsWith('application/json')) { req.resume(); return no(); }
    // the body is {} and nothing else: read up to 64 bytes, the rest drained
    const body = await new Promise((resolve) => {
      let b = '', over = false;
      req.setEncoding('utf8');
      req.on('data', (c) => { if (over || b.length + c.length > 64) over = true; else b += c; });
      req.on('end', () => resolve(over ? null : b));
      req.on('error', () => resolve(null));
    });
    if (body?.trim() !== '{}') return no();
    remote.want();
    return send(res, 200, 'application/json', JSON.stringify(remote.status()));
  }
  // An artifact's versions (kit-172): the CLI's list, run in a child process shared by asks for the
  // same slug. Same-origin only, as /api/view. 404 only when the subcommand says nothing is there.
  if (req.method === 'GET' && u.pathname === '/api/artifact-versions') {
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin') return send(res, 403, 'application/json', JSON.stringify({ error: "not for another site's page" }));
    const slug = u.searchParams.get('slug') ?? '';
    if (!LINK_ID.test(slug)) return send(res, 400, 'application/json', JSON.stringify({ error: 'bad slug' }));
    let job = versioning.get(slug);
    if (!job) { job = run(['artifact', 'versions', slug, '--json'], { timeout: 12000 }).finally(() => versioning.delete(slug)); versioning.set(slug, job); }
    const r = await job;
    if (r.ok) return send(res, 200, 'application/json', r.stdout);
    return r.code === 3 ? send(res, 404, 'application/json', JSON.stringify({ error: `no versions of ${slug}` })) : send(res, 500, 'application/json', JSON.stringify({ error: 'the versions could not be read' }));
  }
  return DASH_NEXT;
}
// What noteSource found for main, kept by its commit, and the last body it changed.
export const shotSources = { commit: null, held: new Map(), digest: null, key: null, body: null };
// threadsRead's threads with each note to check's source as it is now, and a digest of those sources.
// One git rev-parse a read while there is such a note, and one git ls-tree an artifact a commit.
export function dashFreshSources({ views, body, key }, cache) {
  const notes = views.filter(noteToCheck);
  if (!notes.length) return { body, digest: '' };
  const ref = mainRef();
  const commit = ref ? git(['rev-parse', ref], mainRoot) : null;
  if (cache.commit !== commit) { cache.commit = commit; cache.held = new Map(); }
  const holds = shotHolds((slug) => {
    if (cache.held.has(slug)) return cache.held.get(slug);
    const listed = commit ? git(['ls-tree', commit, '--', `${ARTIFACTS_REL}/${slug}/`], mainRoot) : null;
    // a git that failed has said nothing to keep
    if (listed !== null) cache.held.set(slug, !!listed);
    return !!listed;
  });
  const now = new Map(notes.map((v) => [v.id, noteSource(v, holds)]));
  const digest = JSON.stringify([...now]);
  if (cache.digest !== digest || cache.key !== key) Object.assign(cache, { digest, key, body: JSON.stringify(views.map((v) => (now.has(v.id) ? { ...v, source: now.get(v.id) } : v))) });
  return { body: cache.body, digest };
}
// /api/shot/<thread>/<stamp>-<light|dark>.png: a picture of a note's spot, read only from that thread's own
// folder. False when the path isn't one.
export function dashShotRoute(req, res, rawPath) {
  const m = req.method === 'GET' ? /^\/api\/shot\/(t-\d{8}-\d{9}-[a-z0-9]+(?:-[a-z0-9]+)*)\/(\d{8}-\d{9}-(?:light|dark)\.png)$/.exec(rawPath) : null;
  if (!m) return false;
  const site = req.headers['sec-fetch-site'];
  let bytes = null;
  const refused = site !== undefined && site !== 'same-origin';
  try { const dir = refused ? null : shotFolder(m[1]); if (dir && fs.lstatSync(path.join(dir, m[2])).isFile()) bytes = fs.readFileSync(path.join(dir, m[2])); } catch {}
  res.writeHead(refused ? 403 : bytes ? 200 : 404, bytes ? { 'content-type': 'image/png', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin' } : { 'content-type': 'text/plain' });
  res.end(bytes ?? (refused ? "not for another site's page" : 'not found'));
  return true;
}
// /api/threads
export async function dashRoutesThreads(D, req, res, q) {
  const { u } = q;
  const { send, threadsRead, supervisorPane, supervisorAsks, sessionPrompts, paneToken } = D;
  // Threads for the layer: a GET carries no Origin, so like /public-manifest/ it is refused when the
  // browser says another site's page asks.
  if (req.method === 'GET' && u.pathname === '/api/threads') {
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin') return send(res, 403, 'application/json', JSON.stringify({ error: "not for another site's page" }));
    let r;
    try { r = threadsRead(); } catch (e) { return send(res, 500, 'application/json', JSON.stringify({ error: e.message })); }
    // where each note to check shows now, which no log line says (kit-147): a worktree goes, main moves
    const fresh = dashFreshSources(r, shotSources);
    const pane = supervisorPane();
    const asks = supervisorAsks();
    const prompts = sessionPrompts();
    // the card's "not delivered": the turns no terminal took, and when the supervisor last checked
    // (two small run files, read here: no child, no tmux)
    const undelivered = Object.keys(undeliveredTurns(Date.now(), { entries: true }));
    const checked = supervisorCheckedAt();
    // which session holds each owner's turn and how far it got (kit-314): one small run file and a
    // kill(0) per entry, so a session that died mid-turn drops out here on the next read
    const working = threadWorking(Date.now());
    // Nothing changed since the page's last read (no log file, no pane state): a 304, and the browser
    // keeps its copy (no-cache: it asks every time). Behind the gateway, which says no-store, only
    // this process's work is saved.
    // the token for an answer goes only to this page's own read, said so by the browser
    if (asks?.kind === 'menu' && site === 'same-origin') asks.token = paneToken(asks.digest);
    const tag = `"${sha256(`${r.key}|${fresh.digest}|${pane}|${asks?.kind ?? ''}|${asks?.digest ?? ''}|${asks?.token ? 1 : 0}|${checked ?? ''}|${undelivered.join(',')}|${JSON.stringify(working)}|${JSON.stringify(prompts)}`).slice(0, 20)}"`;
    const head = { etag: tag, 'cache-control': 'private, no-cache', ...(r.cached ? { 'x-devteam-threads': 'cached' } : {}) };
    if (req.headers['if-none-match'] === tag) { res.writeHead(304, head); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/json', ...head });
    return res.end(`{"supervisor":${JSON.stringify({ pane, question: asks, ...(prompts.length ? { prompts } : {}), checked, undelivered })},"working":${JSON.stringify(working)},"threads":${fresh.body}}`);
  }
  return DASH_NEXT;
}
// /api/fleet, /api/record, /api/peek, /api/sensor, /api/schema, /api/timeline, /api/governance
export async function dashRoutesReads(D, req, res, q) {
  const { u } = q;
  const { run, send } = D;
  // Whether the fleet can move now: fleet status, never fetching, whatever the query says (no GET
  // changes anything, kit-251: Settings' Check now fetches first by POST /api/fleet-check).
  if (req.method === 'GET' && u.pathname === '/api/fleet') {
    const r = await run(['fleet', 'status', '--json', '--no-fetch']);
    return r.ok ? send(res, 200, 'application/json', r.stdout) : send(res, 500, 'application/json', JSON.stringify({ error: r.stderr.trim() }));
  }
  // One record's stored fields, and the schema's words for each field (the sidepeek's attributes).
  if (req.method === 'GET' && u.pathname === '/api/record') {
    const id = u.searchParams.get('id') ?? '';
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return send(res, 400, 'application/json', JSON.stringify({ error: 'bad id' }));
    const r = await run(['record', id, '--json']);
    return r.ok ? send(res, 200, 'application/json', r.stdout) : send(res, 404, 'application/json', JSON.stringify({ error: r.stderr.trim() }));
  }
  if (req.method === 'GET' && u.pathname === '/api/peek') {
    const kind = u.searchParams.get('kind') ?? '';
    const id = u.searchParams.get('id') ?? '';
    const ts = (u.searchParams.get('tickets') ?? '').split(',').filter(Boolean);
    const rec = u.searchParams.get('rec') ?? '';
    const ref = u.searchParams.get('ref') ?? '';
    if (ref && !/^(?!-)[A-Za-z0-9._\/-]+$/.test(ref)) return send(res, 400, 'application/json', JSON.stringify({ error: 'bad ref' }));
    const prepo = u.searchParams.get('repo') ?? '';
    if (prepo && !LINK_ID.test(prepo)) return send(res, 400, 'application/json', JSON.stringify({ error: 'bad repo' }));
    if (!/^[a-z]+$/.test(kind) || !id || id.length > 400 || /[\0\n]/.test(id) || id.startsWith('-') || ts.some((x) => !/^[a-z0-9][a-z0-9-]*$/.test(x)) || (rec && !/^[a-z0-9][a-z0-9-]*$/.test(rec))) return send(res, 400, 'application/json', JSON.stringify({ error: 'bad kind, id, rec or tickets' }));
    const r = await run(['peek', kind, id, ...(ts.length ? ['--tickets', JSON.stringify(ts)] : []), ...(rec ? ['--rec', rec] : []), ...(ref ? ['--ref', ref] : []), ...(prepo ? ['--repo', prepo] : []), '--json']);
    return r.ok ? send(res, 200, 'application/json', r.stdout) : send(res, 404, 'application/json', JSON.stringify({ error: r.stderr.trim() }));
  }
  if (req.method === 'GET' && u.pathname === '/api/sensor') {
    const name = u.searchParams.get('name') ?? '';
    const range = u.searchParams.get('range') === '7d' ? '7d' : '24h';
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) return send(res, 400, 'application/json', JSON.stringify({ error: 'bad sensor name' }));
    const r = await run(['sensor', 'series', name, '--range', range]);
    return r.ok ? send(res, 200, 'application/json', r.stdout) : send(res, 404, 'application/json', JSON.stringify({ error: r.stderr.trim() }));
  }
  if (req.method === 'GET' && u.pathname === '/api/schema') return send(res, 200, 'application/json', JSON.stringify(schemaDocs()));
  if (req.method === 'GET' && u.pathname === '/api/timeline') {
    const id = u.searchParams.get('id') ?? '';
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return send(res, 400, 'application/json', JSON.stringify({ error: 'bad ticket id' }));
    const r = await run(['timeline', id, '--json']);
    return r.ok ? send(res, 200, 'application/json', r.stdout) : send(res, 404, 'application/json', JSON.stringify({ error: r.stderr.trim() }));
  }
  if (req.method === 'GET' && u.pathname === '/api/governance') {
    const r = await run(['governance', '--json']);
    return r.ok ? send(res, 200, 'application/json', r.stdout) : send(res, 500, 'application/json', JSON.stringify({ error: r.stderr.trim() }));
  }
  return DASH_NEXT;
}
// /api/file, /api/review
export async function dashRoutesFiles(D, req, res, q) {
  const { u } = q;
  const { run, ID, send } = D;
  // An artifact a question or ticket links to, read from git (committed content only, never a
  // path outside the repo). HTML mocks are served sandboxed so they can't call the owner API.
  if (req.method === 'GET' && u.pathname === '/api/file') {
    const p = u.searchParams.get('path') ?? '';
    // repo=<link>: a file in another repo's checkout (a sibling ticket's records), read by name
    // only when this machine can read that repo
    const rid = u.searchParams.get('repo');
    if (rid && rid !== 'home' && !LINK_ID.test(rid)) return send(res, 400, 'text/plain', 'bad repo');
    const R = !rid || rid === 'home' ? repo('home') : repoReadable(rid) ? repo(rid) : null;
    if (!R) return send(res, 404, 'text/plain', `no checkout of ${rid} here`);
    const ref = u.searchParams.get('ref') || R.mainRef() || 'HEAD';
    if (!/^(?!\/)(?!.*\.\.)[^\s]+$/.test(p) || !/^(?!-)[A-Za-z0-9._\/-]+$/.test(ref)) return send(res, 400, 'text/plain', 'bad path or ref');
    const body = await new Promise((resolve) => execFile('git', ['show', `${ref}:${p}`], { cwd: R.root, encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout)));
    if (!body) return send(res, 404, 'text/plain', `not found: ${p} at ${ref}`);
    const ext = path.extname(p).toLowerCase();
    const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.html': 'text/html; charset=utf-8' }[ext] ?? 'text/plain; charset=utf-8';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'content-security-policy': 'sandbox', 'x-content-type-options': 'nosniff' });
    return res.end(body);
  }
  // A review: what the dashboard's review view loads (the question, its verified files, the
  // owner's draft and stored result), or the result as TSV for the owner's own use.
  if (req.method === 'GET' && u.pathname === '/api/review') {
    const id = u.searchParams.get('id') ?? '';
    if (!ID.test(id)) return send(res, 400, 'application/json', JSON.stringify({ error: 'bad question id' }));
    if (u.searchParams.get('format') === 'tsv') {
      const r = await run(['review', 'result', id, '--tsv']);
      return r.ok ? send(res, 200, 'text/tab-separated-values; charset=utf-8', r.stdout) : send(res, 404, 'application/json', JSON.stringify({ error: r.stderr.trim() }));
    }
    const r = await run(['review', 'show', id, '--json', '--contents']);
    return r.ok ? send(res, 200, 'application/json', r.stdout) : send(res, 404, 'application/json', JSON.stringify({ error: r.stderr.trim().replace(/^devteam: /, '') }));
  }
  return DASH_NEXT;
}
// /public-manifest/…, /artifact/…
export async function dashRoutesArtifacts(D, req, res, q) {
  const { u } = q;
  const { run, send, remote } = D;
  // An artifact's files: landed from main's tree, a published version from its tree by id (what the
  // gateway's owner wrapper frames, spec §8), a draft off its worktree's disk. Matched on the raw
  // path, before URL parsing folds ../ and %2e%2e into something that looks fine. Any
  // sec-fetch-site: under its sandbox the page is an opaque origin, so its own loads say cross-site.
  const rawPath = req.url.split('?')[0];
  // What publishing an artifact would put up, for the cloud gateway's confirm page. Its loopback
  // request sends no sec-fetch-site; a browser's must come from this page's own origin.
  if (req.method === 'GET' && rawPath.startsWith('/public-manifest/')) {
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin') return send(res, 403, 'application/json', JSON.stringify({ error: 'not for another site\'s page' }));
    const slug = rawPath.slice('/public-manifest/'.length);
    if (!LINK_ID.test(slug)) return send(res, 404, 'application/json', JSON.stringify({ error: 'not an artifact slug' }));
    const r = await run(['artifact', 'manifest', slug, '--json'], { timeout: 12000 });
    return r.ok ? send(res, 200, 'application/json', r.stdout) : send(res, r.code === 2 ? 409 : 404, 'application/json', JSON.stringify({ error: r.stderr.trim().replace(/^devteam: /, '') }));
  }
  if (dashShotRoute(req, res, rawPath)) return;
  if (req.method === 'GET' && rawPath.startsWith('/artifact/')) {
    // A draft from another machine (kit-750): a fetched branch's folder, by the tree id that passed
    // the artifact checks (artifactRemoteRefs' resolve), its files as blobs of that tree, so a fetch
    // that moves the branch meanwhile never mixes two trees. Never a checkout; every refusal a 404.
    const om = /^\/artifact\/origin\/([^/]+)\/([^/]+)(\/.*)?$/.exec(rawPath);
    let bytes = null, rel, tail;
    if (om) {
      let b = null;
      try { b = decodeURIComponent(om[1]); } catch {}
      if (b === null || !BRANCH_AT.test(b) || !LINK_ID.test(om[2])) return send(res, 404, 'text/plain', 'not found');
      if (om[3] === undefined) { res.writeHead(301, { location: `${rawPath}/`, 'cache-control': 'no-store' }); return res.end(); }
      tail = om[3];
      rel = om[3] === '/' ? 'index.html' : om[3].slice(1);
      if (!artifactPathOk(rel)) return send(res, 404, 'text/plain', 'not found');
      const r = await remote.resolve(b, om[2]);
      if (!r.tree || r.error) return send(res, 404, 'text/plain', 'not found');
      bytes = await new Promise((resolve) => execFile('git', ['cat-file', 'blob', `${r.tree}:${rel}`], { cwd: mainRoot, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }, (err, so) => resolve(err ? null : so)));
    } else {
      const am = /^\/artifact\/(?:main|wt\/([^/]+)|tree\/([0-9a-f]{40}(?:[0-9a-f]{24})?))\/([^/]+)(\/.*)?$/.exec(rawPath);
      const at = am ? (am[2] ? `tree:${am[2]}` : am[1] ?? 'main') : null;
      if (!am || (at !== 'main' && !am[2] && !draftWorktree(at)) || !LINK_ID.test(am[3])) return send(res, 404, 'text/plain', 'not found');
      if (am[4] === undefined) { res.writeHead(301, { location: `${rawPath}/`, 'cache-control': 'no-store' }); return res.end(); }
      tail = am[4];
      rel = am[4] === '/' ? 'index.html' : am[4].slice(1);
      if (!artifactPathOk(rel)) return send(res, 404, 'text/plain', 'not found');
      const blobAt = (spec) => new Promise((resolve) => execFile('git', ['cat-file', 'blob', spec], { cwd: mainRoot, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 }, (err, so) => resolve(err ? null : so)));
      if (at === 'main') {
        const ref = mainRef();
        if (ref) bytes = await blobAt(`${ref}:${ARTIFACTS_REL}/${am[3]}/${rel}`);
      } else if (am[2]) {
        // an artifact folder's tree by its id, and nothing else (decision 12): <id>:<path> resolves
        // against a commit or the root tree as well, which would serve any committed file. A tree
        // never changes: what was published is what is shown.
        if (await artifactTreeOk(am[2], am[3])) bytes = await blobAt(`${am[2]}:${rel}`);
      } else {
        // the real path stays inside the artifact's folder: a symlink out of it is not found
        try {
          const root = draftWorktree(at);
          const dir = path.join(root, ARTIFACTS_REL, am[3]);
          const real = draftDirOk(root, am[3]) ? fs.realpathSync(path.join(dir, rel)) : null;
          if (real && real.startsWith(dir + path.sep) && fs.statSync(real).isFile()) bytes = fs.readFileSync(real);
        } catch {}
      }
    }
    if (!bytes) return send(res, 404, 'text/plain', 'not found');
    const base = `http://${req.headers.host}`;
    // frame-ancestors by policy alone, never X-Frame-Options: on a box the gateway adds the public
    // name to this list for a published tree, and an X-Frame-Options would still refuse it
    // the lens (spec §6): a framed load of a page only, so a top-level load, curl and the gateway's
    // loopback fetch for a publish get the bytes as committed. Vary says so to anything that keeps
    // an answer, though no-store already keeps none.
    const framed = req.headers['sec-fetch-dest'] === 'iframe' && rel.toLowerCase().endsWith('.html');
    res.writeHead(200, { ...artifactHeaders(rel, base, `${base}${rawPath.slice(0, rawPath.length - tail.length)}/`), vary: 'sec-fetch-dest' });
    return res.end(framed ? withArtifactLens(bytes) : bytes);
  }
  return DASH_NEXT;
}
// /review/<seg>/<file>
export async function dashRoutesReviewPage(D, req, res, q) {
  const { u } = q;
  const { run, ID, send } = D;
  // A review page: the agent's bytes, verbatim, only into the dashboard's own sandboxed frame,
  // under a policy that allows no network (reviewPageCsp). Under a question's path the server
  // serves exactly two other files, the kit's helpers; nothing else.
  const rvm = req.method === 'GET' ? /^\/review\/([^/]+)\/([^/]*)$/.exec(u.pathname) : null;
  if (rvm) {
    const [, seg, file] = rvm;
    if (seg !== 'preview' && !ID.test(seg)) return send(res, 404, 'text/plain', 'not found');
    if (file === 'devteam-ui.css' || file === 'devteam-ui.js') {
      res.writeHead(200, { 'content-type': file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      return res.end(fs.readFileSync(path.join(kitDir, 'dashboard', file)));
    }
    if (file !== '') return send(res, 404, 'text/plain', 'not found');
    // Opened top-level it would be same-origin with the owner API; it is served only into a frame
    // of this page (and its policy makes its origin opaque even then).
    if (!q.okHost || !['iframe', 'frame'].includes(req.headers['sec-fetch-dest']) || req.headers['sec-fetch-site'] !== 'same-origin') return send(res, 403, 'text/plain; charset=utf-8', 'A review page opens only inside the dashboard: open the Inbox and choose "Open the review".');
    const blob = (spec) => new Promise((resolve) => execFile('git', ['cat-file', 'blob', spec], { cwd: mainRoot, encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout)));
    let bytes;
    if (seg === 'preview') {
      // the supervisor's (or an agent's) look at a committed page before anyone asks
      const p = u.searchParams.get('path') ?? '';
      const ref = u.searchParams.get('ref') || mainRef() || 'HEAD';
      if (!REPO_PATH.test(p) || !/\.html?$/i.test(p) || !/^(?!-)[A-Za-z0-9._\/-]+$/.test(ref)) return send(res, 400, 'text/plain', 'bad path or ref');
      bytes = await blob(`${ref}:${p}`);
      if (!bytes) return send(res, 404, 'text/plain', `not found: ${p} at ${ref}`);
    } else {
      const r = await run(['review', 'show', seg, '--json']);
      if (!r.ok) return send(res, 404, 'text/plain', `not a review question: ${seg}`);
      const shown = JSON.parse(r.stdout);
      const rv = shown.review;
      if (shown.files.some((f) => f.status === 'missing')) return send(res, 404, 'text/plain', `the page's commit ${String(rv.commit).slice(0, 12)} is gone and its files are not on main; nothing can be answered on it`);
      if (shown.files.some((f) => f.status === 'tampered')) return send(res, 403, 'text/plain', 'the page or its data no longer hash to the question; it is not the page the supervisor asked on');
      // read from where it verified: the pinned commit, or main once a squash merge landed it
      const at = shown.files.find((f) => f.role === 'page')?.at ?? rv.commit;
      if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(at)) return send(res, 404, 'text/plain', 'the page is gone');
      bytes = await blob(`${at}:${rv.page.path}`);
      if (!bytes) return send(res, 404, 'text/plain', 'the page is gone');
      if (sha256(bytes) !== rv.page.sha256) return send(res, 403, 'text/plain', 'the page no longer hashes to the question');
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': reviewPageCsp(`http://${req.headers.host}`), 'referrer-policy': 'no-referrer', 'x-dns-prefetch-control': 'off' });
    return res.end(bytes);
  }
  return DASH_NEXT;
}
// every POST /api/<name> (pane-answer, owner-setting, secret, review-draft and review-answer, fleet-check, the ACTIONS), and the 404 for everything else
export async function dashRoutesOwner(D, req, res, q) {
  const { u } = q;
  const { log, run, runAction, ID, autonomyArgs, ACTIONS, ACTION_MS, ACTION_JSON, send, refreshHello, paneTokenOk, paneNonces, ownerSettingNonces, paneAnswer } = D;
  const name = req.method === 'POST' && u.pathname.startsWith('/api/') ? u.pathname.slice(5) : null;
  const isSecret = name === 'secret';
  const isReview = name === 'review-draft' || name === 'review-answer';
  const isPane = name === 'pane-answer';
  const isOwnerSetting = name === 'owner-setting';
  const isCheck = name === 'fleet-check';
  const action = name && Object.hasOwn(ACTIONS, name) ? ACTIONS[name] : null;
  if (!action && !isSecret && !isReview && !isPane && !isOwnerSetting && !isCheck) return send(res, 404, 'text/plain', 'not found');
  // an owner action, answered however it ends: the kept /api/data build is stale from its answer's
  // head on, before a byte of it reaches the page, so the page's next read waits for a new build
  const head = res.writeHead;
  res.writeHead = function (...a) { D.dataEpoch += 1; return head.apply(this, a); };
  const site = req.headers['sec-fetch-site'];
  const origin = req.headers.origin;
  // A browser sends Origin on every fetch POST, and Sec-Fetch-Site to a loopback or https origin
  // (not to a --host LAN address over http); a secret or a review is accepted only with both
  // present. Every other owner action needs at least one of them saying this page, and neither
  // saying another (kit-324): a client that sends neither (curl, an agent's fetch) is not the
  // owner's browser. A sandboxed frame's request says Origin: null and is refused here too. Only a
  // browser is held to this: a process on this machine can send both headers, and still gets in.
  const own = `http://${req.headers.host}`;
  const strict = isSecret || isReview || isPane || isOwnerSetting;
  const sameOrigin = strict ? site === 'same-origin' && origin === own : (site === 'same-origin' || origin === own) && (site === undefined || site === 'same-origin') && (origin === undefined || origin === own);
  if (!q.okHost || !sameOrigin || !(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, 403, 'application/json', JSON.stringify({ error: "owner actions only from this dashboard's own page, in a browser (Sec-Fetch-Site same-origin or this page's Origin)" }));
  // A review's result or draft is up to 4 MB, plus its envelope.
  const cap = isSecret ? 4 * 1024 * 1024 : isReview ? REVIEW_MAX + 64 * 1024 : isOwnerSetting ? 512 : 20000;
  // Bytes first, decoded once: a multibyte character split across chunks stays whole.
  const chunks = [];
  let size = 0;
  let body = '';
  let over = false;
  req.on('data', (c) => {
    size += c.length;
    if (size <= cap) return void chunks.push(c);
    over = true;
    chunks.length = 0;
    // a review or setting body over the cap is drained and refused with a reason; one far over it is cut off
    if (!(isReview || isOwnerSetting) || size > 4 * cap) req.destroy();
  });
  req.on('end', () => { const buf = Buffer.concat(chunks); body = buf.toString('utf8'); buf.fill(0); chunks.length = 0; });
  // A body no check foresaw (a result nested thousands deep, which JSON.stringify can't walk) is
  // a bad request, never a crash: a throw from an end handler is an uncaught exception, and that
  // ends the dashboard.
  const guarded = (f) => { try { f(); } catch { body = ''; if (!res.headersSent) send(res, 400, 'application/json', JSON.stringify({ error: 'missing or invalid fields' })); } };
  // Who gave it (kit-252): read in each branch after its own checks and just before its child, so
  // a request refused before is refused the same way with any header. A malformed one answers 400
  // and nothing runs; false then means it was answered.
  const personOr400 = () => {
    const p = requestPerson(req);
    if (!p?.bad) return p;
    send(res, 400, 'application/json', JSON.stringify({ error: PERSON_MALFORMED }));
    return false;
  };
  // The owner's own process, with the body on its stdin (never in argv or the server's output).
  const ownerChild = (args, input, person) => runAction(args, { input, person }).then((r) => send(res, r.ok ? 200 : 400, 'application/json', JSON.stringify(r.ok ? { ok: true, out: r.stdout.trim() } : { error: r.stderr.split('\n').filter((l) => l && !l.startsWith('devteam: warning:')).join(' ').replace(/^devteam: /, '') || 'failed', out: r.stdout.trim() })));
  // Check now (kit-251): fleet status after a fetch from origin. A POST, as every other request that
  // changes refs is: the body is read to its end (the cap above holds) and nothing in it is used.
  if (isCheck) return req.on('end', async () => {
    if (over) return;
    // a deadline, as an action under the gateway's 15 s has (kit-339); home's origin unreachable is a
    // failed check (502), never a 200 that reads as checked
    const r = await run(['fleet', 'status', '--json'], { timeout: 12000 });
    if (res.headersSent) return;
    if (!r.ok) return send(res, 500, 'application/json', JSON.stringify({ error: r.stderr.trim().replace(/^devteam: /, '') }));
    let failed = null;
    try { failed = JSON.parse(r.stdout)?.fetch_error ?? null; } catch {}
    send(res, failed ? 502 : 200, 'application/json', failed ? JSON.stringify({ error: String(failed) }) : r.stdout);
  });
  if (isPane) {
    const gw = (k) => { const v = req.headers[`x-devteam-gateway-${k}`]; return typeof v === 'string' ? v : null; };
    return req.on('end', () => guarded(() => {
      if (over) return send(res, 400, 'application/json', JSON.stringify({ error: 'missing or invalid fields' }));
      let parsed;
      try { parsed = JSON.parse(body || '{}'); } catch { return send(res, 400, 'application/json', JSON.stringify({ error: 'bad json' })); }
      // exactly an option's press or an Esc's, as the page sends them (paneAnswerShape): nothing else reaches the terminal
      if (!paneAnswerShape(parsed)) return send(res, 400, 'application/json', JSON.stringify({ error: 'missing or invalid fields: { digest, option, token } or { digest, escape: true, token }' }));
      if (!paneTokenOk(parsed.digest, parsed.token)) return send(res, 403, 'application/json', JSON.stringify({ error: "nothing was answered: that is not this page's card for the question (reload the page)" }));
      let proof = null;
      if (threadsNeedGateway()) {
        const boxOnly = "nothing was answered: on a box the owner answers only through the box's gateway";
        if (!(gw('ts') && gw('nonce') && gw('sig'))) return send(res, 403, 'application/json', JSON.stringify({ error: boxOnly }));
        proof = { port: D.port, ts: gw('ts'), nonce: gw('nonce'), sig: gw('sig'), body: Buffer.from(body, 'utf8').toString('base64') };
        const why = paneProofProblem(proof) ?? (paneNonces.has(proof.nonce) ? 'its signature was used already' : null);
        if (why) { log(`refused /api/pane-answer: ${why}`); return send(res, 403, 'application/json', JSON.stringify({ error: `${boxOnly} (${why})` })); }
        const now = Date.now();
        for (const [n, at] of paneNonces) if (now - at > 2 * OPERATOR_PROOF_MS) paneNonces.delete(n);
        paneNonces.set(proof.nonce, now);
      }
      if (D.paneAnswering) return send(res, 409, 'application/json', JSON.stringify({ error: 'another answer is on its way to the terminal; wait for it' }));
      // after every check above and before any key is sent: a malformed person types nothing
      const person = personOr400();
      if (person === false) return;
      D.paneAnswering = true;
      paneAnswer({ digest: parsed.digest, option: parsed.option, escape: parsed.escape === true, proof, person }).then((a) => a, (e) => ({ status: 500, body: { error: `nothing more was done: ${e?.message ?? e}` } })).then((a) => { D.paneAnswering = false; if (!res.headersSent) send(res, a.status, 'application/json', JSON.stringify(a.body)); });
    }));
  }
  // The owner's Save on the Settings page: exactly { key, value }, an askable key, and on a box the
  // gateway's signature for it (each nonce once here, and in the log for the command it runs).
  if (isOwnerSetting) {
    const gw = (k) => { const v = req.headers[`x-devteam-gateway-${k}`]; return typeof v === 'string' ? v : null; };
    return req.on('end', () => guarded(() => {
      const bad = () => send(res, 400, 'application/json', JSON.stringify({ error: 'missing or invalid fields: { key, value }' }));
      if (over) return bad();
      let parsed;
      try { parsed = JSON.parse(body || '{}'); } catch { return send(res, 400, 'application/json', JSON.stringify({ error: 'bad json' })); }
      if (!isObj(parsed) || Object.keys(parsed).sort().join(',') !== 'key,value' || typeof parsed.key !== 'string' || !(parsed.value === null || Number.isInteger(parsed.value))) return bad();
      const why = askableProblem(parsed.key, parsed.value);
      if (why) return send(res, 400, 'application/json', JSON.stringify({ error: why }));
      let proof = null;
      if (threadsNeedGateway()) {
        const boxOnly = "not saved: on a box the owner saves settings only through the box's gateway";
        if (!(gw('ts') && gw('nonce') && gw('sig'))) return send(res, 403, 'application/json', JSON.stringify({ error: boxOnly }));
        proof = { port: D.port, ts: gw('ts'), nonce: gw('nonce'), sig: gw('sig'), body: Buffer.from(body, 'utf8').toString('base64') };
        const w = ownerSettingProofProblem(proof) ?? (ownerSettingNonces.has(proof.nonce) ? 'its signature was used already' : null);
        if (w) { log(`refused /api/owner-setting: ${w}`); return send(res, 403, 'application/json', JSON.stringify({ error: `${boxOnly} (${w})` })); }
        const now = Date.now();
        for (const [n, at] of ownerSettingNonces) if (now - at > 2 * OPERATOR_PROOF_MS) ownerSettingNonces.delete(n);
        ownerSettingNonces.set(proof.nonce, now);
      }
      const person = personOr400();
      if (person === false) return;
      ownerChild(['owner-setting', parsed.key, parsed.value === null ? 'none' : String(parsed.value)], proof ? JSON.stringify({ proof }) : null, person);
    }));
  }
  if (isSecret) {
    // The values go to a child on stdin; the child pipes each to its sink (secret post --json)
    // and logs only names.
    return req.on('end', () => guarded(() => {
      let parsed;
      try { parsed = JSON.parse(body || '{}'); } catch { return send(res, 400, 'application/json', JSON.stringify({ error: 'bad json' })); }
      body = '';
      if (!ID.test(parsed.id ?? '') || typeof parsed.values !== 'object' || !parsed.values) return send(res, 400, 'application/json', JSON.stringify({ error: 'missing or invalid fields' }));
      const person = personOr400();
      if (person === false) { parsed = null; return; }
      ownerChild(['secret', 'post', parsed.id, '--json'], JSON.stringify(parsed.values), person);
      parsed = null;
    }));
  }
  if (isReview) {
    return req.on('end', () => guarded(() => {
      if (over) return send(res, 400, 'application/json', JSON.stringify({ error: `the body is over ${cap} bytes; a review result or draft is at most ${REVIEW_MAX} (4 MB)` }));
      let parsed;
      try { parsed = JSON.parse(body || '{}'); } catch { return send(res, 400, 'application/json', JSON.stringify({ error: 'bad json' })); }
      body = '';
      if (!ID.test(parsed.id ?? '')) return send(res, 400, 'application/json', JSON.stringify({ error: 'missing or invalid fields' }));
      if (name === 'review-draft') {
        if (parsed.state === undefined) return send(res, 400, 'application/json', JSON.stringify({ error: 'a draft has a state' }));
        const savedAt = typeof parsed.saved_at === 'string' && !Number.isNaN(Date.parse(parsed.saved_at)) ? parsed.saved_at : nowIso();
        const person = personOr400();
        if (person === false) return;
        return ownerChild(['review', 'draft', parsed.id, '-'], JSON.stringify({ state: parsed.state, saved_at: savedAt }), person);
      }
      // The answer is the object the owner's preview rendered: its JSON text is hashed in the page
      // and here, and the owner's process reads exactly those bytes.
      if (!isObj(parsed.result) || !/^[0-9a-f]{64}$/.test(parsed.sha256 ?? '')) return send(res, 400, 'application/json', JSON.stringify({ error: 'missing or invalid fields: { id, result, sha256 }' }));
      const textOut = JSON.stringify(parsed.result);
      if (sha256(Buffer.from(textOut)) !== parsed.sha256) return send(res, 400, 'application/json', JSON.stringify({ error: 'the result is not the one the preview showed (its sha256 differs); nothing was answered' }));
      const person = personOr400();
      if (person === false) return;
      ownerChild(['answer', parsed.id, '--review-result', '-', ...autonomyArgs(parsed)], textOut, person);
    }));
  }
  req.on('end', async () => {
    let parsed;
    try { parsed = JSON.parse(body || '{}'); } catch { return send(res, 400, 'application/json', JSON.stringify({ error: 'bad json' })); }
    // a body no check foresaw (one nested thousands deep) is a bad request, never a crash: a throw
    // here is an unhandled rejection, and that ends the dashboard
    let args;
    try { args = action(parsed); } catch { return send(res, 400, 'application/json', JSON.stringify({ error: 'missing or invalid fields' })); }
    if (args && args.some((a) => typeof a !== 'string' || a.includes('\0'))) args = null;
    if (!args) return send(res, 400, 'application/json', JSON.stringify({ error: 'missing or invalid fields' }));
    const person = personOr400();
    if (person === false) return;
    const r = await runAction(args, { timeout: ACTION_MS[name] ?? 0, person });
    // what the hub lists (the Inbox count, the fleet's mode) follows an owner action at once
    if (r.ok) refreshHello();
    if (r.ok && ACTION_JSON.has(name)) {
      let said = null;
      try { said = JSON.parse(r.stdout); } catch {}
      return send(res, isObj(said) ? 200 : 500, 'application/json', JSON.stringify(isObj(said) ? said : { error: 'the action printed no JSON' }));
    }
    send(res, r.ok ? 200 : 400, 'application/json', JSON.stringify(r.ok ? { ok: true, out: r.stdout.trim() } : { error: r.stderr.split('\n').filter((l) => l && !l.startsWith('devteam: warning:')).join(' ').replace(/^devteam: /, '') }));
  });
  return;
}
export const DASHBOARD_ROUTES = [dashRoutesUpload, dashRoutesPage, dashRoutesViewer, dashRoutesThreads, dashRoutesReads, dashRoutesFiles, dashRoutesArtifacts, dashRoutesReviewPage, dashRoutesOwner];
/* dashboardRoutes end */
