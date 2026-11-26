/* imports start */
/* imports end */
// --- the gateway's own pages -------------------------------------------------------------------
export const STYLE = `<style>
:root{color-scheme:light dark;--bg:#fafafa;--fg:#171717;--fg2:#666;--line:#e5e5e5;--btn:#171717;--btnfg:#fff;--red:#cb2a2f}
@media (prefers-color-scheme:dark){:root{--bg:#000;--fg:#ededed;--fg2:#a1a1a1;--line:#2e2e2e;--btn:#ededed;--btnfg:#000;--red:#ff6166}}
html{touch-action:manipulation}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}
main{max-width:440px;margin:12vh auto;padding:0 16px}h1{font-size:20px;margin:0 0 8px}p{color:var(--fg2)}
button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid var(--btn);background:var(--btn);color:var(--btnfg);cursor:pointer}
button.quiet{background:none;color:var(--fg);border-color:var(--line)}input{font:inherit;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:none;color:var(--fg);width:100%;box-sizing:border-box;margin:8px 0}
#err{color:var(--red)}li{margin:6px 0;display:flex;gap:8px;align-items:center;justify-content:space-between}ul{padding:0;list-style:none}a{color:inherit}
li.pub{display:block;padding:8px 0;border-bottom:1px solid var(--line)}li.pub small,li.pub code,li.pub span{display:block;color:var(--fg2);overflow-wrap:anywhere}
.files{max-height:14em;overflow:auto;margin:4px 0;font:12px/1.5 ui-monospace,monospace;color:var(--fg2);overflow-wrap:anywhere}li.pub .files small{display:inline}
</style>`;
// The browser half of a ceremony: base64url in JSON both ways.
export const CLIENT = `<script>
for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
const b = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const s = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
const err = (m) => { document.getElementById('err').textContent = m || ''; };
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
async function create(optionsUrl, verifyUrl, extra) {
  const o = await post(optionsUrl, extra);
  o.challenge = b(o.challenge); o.user.id = b(o.user.id);
  o.excludeCredentials = o.excludeCredentials.map((c) => ({ ...c, id: b(c.id) }));
  const c = await navigator.credentials.create({ publicKey: o });
  return post(verifyUrl, { ...extra, rawId: s(c.rawId), clientDataJSON: s(c.response.clientDataJSON), attestationObject: s(c.response.attestationObject) });
}
async function signIn() {
  const o = await post('/auth/login/options');
  o.challenge = b(o.challenge);
  const c = await navigator.credentials.get({ publicKey: o });
  return post('/auth/login/verify', { rawId: s(c.rawId), clientDataJSON: s(c.response.clientDataJSON), authenticatorData: s(c.response.authenticatorData), signature: s(c.response.signature), userHandle: c.response.userHandle ? s(c.response.userHandle) : null });
}
const run = (f) => async () => { err(); try { await f(); } catch (e) { err(e.name === 'NotAllowedError' ? 'Cancelled, or the passkey was not allowed.' : e.message); } };
</script>`;
export const esc = (x) => String(x).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const jsonIn = (x) => JSON.stringify(x).replace(/</g, '\\u003c');
export const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
// JSON as a header value: a header carries only Latin-1, so everything past ~ is escaped.
export const asciiJson = (v) => JSON.stringify(v).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
// What a new version changes against the copy the box serves: each file added or changed, by name, and those removed.
export const fileChanges = (old, files) => {
  const before = old ?? {};
  const marks = new Map();
  for (const [rel, f] of Object.entries(files)) {
    if (!Object.hasOwn(before, rel)) marks.set(rel, 'new');
    else if (before[rel].sha256 !== f.sha256) marks.set(rel, 'changed');
  }
  return { marks, removed: Object.keys(before).filter((rel) => !Object.hasOwn(files, rel)).sort() };
};
export const treeShort = (t) => String(t).slice(0, 12);
// The files going up, by name: a title can say one thing while the folder holds another.
export const publishFiles = (r) => {
  const line = (rel, mark, size) => `<div>${mark ? `<b>${mark}</b> ` : ''}${esc(rel)}${size === null ? '' : ` <small>${esc(fmtSize(size))}</small>`}</div>`;
  return `<div class="files">${Object.entries(r.m.files).map(([rel, f]) => line(rel, r.changes?.marks.get(rel), f.size)).join('')}${(r.changes?.removed ?? []).map((rel) => line(rel, 'removed', null)).join('')}</div>`;
};
// Why an item is ticked or not, in words that claim only what the gateway knows. The log is the
// instance's to report and can be forged, so it is quoted, never relied on.
export const publishNote = (r) => {
  if (r.changes) {
    const marks = [...r.changes.marks.values()];
    return `This replaces the copy this box serves: ${marks.filter((x) => x === 'changed').length} changed, ${marks.filter((x) => x === 'new').length} new, ${r.changes.removed.length} removed.`;
  }
  if (r.held) return '';
  const said = r.m.recorded;
  const day = said && esc(said.at.slice(0, 10));
  const why = !said ? 'This instance\'s log records no publish of it.'
    : said.tree === r.m.tree ? `This instance's log says it was published on ${day} at this same version; a log can be forged, so check the files.`
      : `This instance's log says it was published on ${day} at tree ${esc(treeShort(said.tree))}. This is tree ${esc(treeShort(r.m.tree))}, what main holds now, so it is not that version, and the box can't show what changed.`;
  return `Not ticked, because ${r.movedFrom ? 'this box\'s copy of it came from another checkout' : 'this box holds no copy of it'}. ${why} Tick it to make this version public.`;
};
export const doc = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>${title}</title>${STYLE}</head><body><main>${body}</main>${CLIENT}`;
export const PREVIEW_REFRESH = '<meta http-equiv="refresh" content="5">';
// A name not listed yet may be a moment away (a `preview` command takes one to show up): retry for a few minutes, never forever.
export const RETRY_UNLISTED = "<script>try{const k='dt-preview-since',t=Date.now();let s=Number(sessionStorage.getItem(k)||0);if(!s||t-s>600000){s=t;sessionStorage.setItem(k,String(s))}if(t-s<180000)setTimeout(()=>location.reload(),5000)}catch{}</script>";
export const PAGES = {
  // Signed out on a project's host: the same bytes for every name. Only script can read the hash.
  signedOut: (box) => `${doc('Sign in', '<h1>devteam</h1><p>Sign in to open this page.</p>')}<script>const here = location.pathname === '/.devteam/lens' ? location.origin + '/' : location.href; location.replace(${jsonIn(`${box}/auth/login?next=`)} + encodeURIComponent(here));</script></body></html>`,
  sharedName: (name) => `${doc('No dashboard', `<h1>Two projects are named ${esc(name)}</h1><p>This box can't tell which one this address means, so it opens neither. Rename one (settings.md's project). Their published pages still answer.</p>`)}</body></html>`,
  unknownHost: (name, read, stored, names, previewNames, originOf) => `${doc('Not found', `${RETRY_UNLISTED}<h1>${!read || stored ? `${esc(name)} isn't running` : `Nothing is named ${esc(name)} on this box`}</h1><p>${!read ? 'The hub isn\'t running, so the box can\'t list its projects.' : `Live now: ${[...names, ...previewNames].map((n) => `<a href="${esc(originOf(n))}/">${esc(n)}</a>`).join(', ') || 'none'}.`}</p>`)}</body></html>`,
  // Every preview on the box, by instance. Each value came through the hub's list and is shown as text.
  previewList: (rows) => doc('Previews', `<h1>Previews on this box</h1><p>Only you can open these, signed in. Each is a running server a session offered.</p>${rows.length ? Object.entries(rows.reduce((g, r) => { (g[r.root] ??= []).push(r); return g; }, Object.create(null))).map(([root, rs]) => `<h2 style="font-size:15px;margin:16px 0 4px">${esc(rs[0].project)} <small>${esc(root)}</small></h2><ul>${rs.map((r) => `<li class="pub"><span><b>${esc(r.name)}</b> <small>${[r.session && esc(r.session), r.label && esc(r.label), `port ${esc(r.port)}`, esc(r.state)].filter(Boolean).join(' · ')}</small></span>${r.link ? `<a href="${esc(r.link)}">Open</a>` : ''}</li>`).join('')}</ul>`).join('') : '<p>Nothing is offered right now.</p>'}`),
  previewDown: (name, l) => `${doc('Preview', `${PREVIEW_REFRESH}<h1>Preview ${esc(l.label || name)} isn't answering</h1><p>Offered by ${esc(l.session)} of ${esc(l.project)}, instance ${esc(l.root)}: nothing answers on port ${esc(l.port)}. Its server may be starting, or stopped. This page retries every 5 s.</p>`)}`,
  previewAmbiguous: (name, cs) => `${doc('Preview', `${PREVIEW_REFRESH}<h1>Two instances offer a preview named ${esc(name)}</h1><p>${cs.map((c) => `${esc(c.project)} at ${esc(c.root)} (port ${esc(c.port)})`).join(' and ')}. The box serves neither until one stops; run <code>devteam.mjs preview stop ${esc(name)}</code> in the one that shouldn't. This page retries every 5 s.</p>`)}`,
  // A preview command can be a second behind the link: the page retries for a few minutes, not forever.
  previewUnknown: (name, names, originOf) => `${doc('Preview', `${RETRY_UNLISTED}<h1>No preview named ${esc(name)} on this box</h1><p>${names.length ? `Offered now: ${names.map((n) => `<a href="${esc(originOf(n))}/">${esc(n)}</a>`).join(', ')}.` : 'Nothing is offered right now.'} This page retries for a few minutes; a <code>preview</code> command takes a moment to show up.</p>`)}`,
  // An invite's page: whose it is (POST /auth/claim/invite), then the passkey row's flow, purpose
  // invite. Every name and level is set as text.
  invite: (box) => `${doc('Join this box', `<h1 id="h">Join this devteam box</h1><p id="who"></p><p id="how">Make a passkey to join. Your password manager (1Password, iCloud Keychain…) saves it.</p><input id="name" placeholder="Name this passkey (optional)" maxlength="60"><p><button id="go">Create passkey and join</button></p><p id="err"></p><p id="after" hidden><a href="${esc(box)}/">Open the hub</a></p><p id="signin" hidden><a href="/auth/login">Already have a sign-in method? Sign in</a></p>`)}
<script>
const token = decodeURIComponent(location.hash.slice(1));
history.replaceState(null, '', location.pathname);
const el = (id) => document.getElementById(id);
const host = ${jsonIn(new URL(box).host)};
const hide = (...ids) => { for (const id of ids) el(id).hidden = true; };
const dead = () => { el('h').textContent = 'This invite can\\'t be used'; el('who').textContent = 'It has expired or was already used. Each link works once, for 24 hours. Ask the person who sent it for a new one.'; hide('how', 'name', 'go'); el('signin').hidden = false; };
let again = false;
if (!token) location.replace('/auth/login');
else post('/auth/claim/invite', { token }).then((i) => {
  again = i.again === true;
  if (again) { el('h').textContent = 'Add a sign-in method to your account'; el('who').textContent = 'This link adds a sign-in method (a passkey) to ' + i.name + '\\'s account on ' + host + '. Your other sign-in methods keep working.'; el('how').textContent = ''; el('go').textContent = 'Create passkey'; }
  else el('who').textContent = 'You\\'re invited to ' + host + ', ' + i.name + ', as ' + (i.level === 'view' ? 'view only: you can see everything here (the hub, dashboards, artifacts, boards and goals) and change only your own sign-in methods. One exception: opening a running preview can set off what that app does when a page opens.' : 'Full: you can do everything on the box except manage people.');
}, (e) => (/expired or was used/.test(e.message) ? dead() : err(e.message + ' Reload to try again.')));
el('go').onclick = run(async () => {
  try { await create('/auth/method/passkey/start', '/auth/method/passkey/finish', { purpose: 'invite', token, name: el('name').value }); }
  catch (e) { if (/expired or was used/.test(e.message)) return dead(); throw e; }
  el('h').textContent = 'You\\'re in';
  el('who').textContent = again ? 'The passkey is added. Sign in with it from now on.' : 'Your password manager saved the passkey. Use it to sign in here from now on.';
  hide('how', 'name', 'go');
  el('after').hidden = false;
});
</script></body></html>`,
  claim: (box) => `${doc('Claim this box', `<h1>Claim this devteam box</h1><p>Make a passkey for this box. Your password manager (1Password, iCloud Keychain…) saves it; from then on only a passkey made here opens the box.</p><input id="name" placeholder="Name this passkey (optional)" maxlength="60"><p><button id="go">Create passkey and claim</button></p><p id="err"></p>`)}
<script>
const token = decodeURIComponent(location.hash.slice(1));
history.replaceState(null, '', location.pathname);
if (!token) err('This link has no claim token. Use the full link from the box\\'s logs (it ends in #…).');
document.getElementById('go').onclick = run(async () => { await create('/auth/claim/options', '/auth/claim/verify', { token, name: document.getElementById('name').value }); location.replace(${jsonIn(`${box}/`)}); });
</script></body></html>`,
  login: (next) => `${doc('Sign in', '<h1>devteam</h1><p>Sign in with this box\'s passkey.</p><p><button id="go" autofocus>Sign in with a passkey</button></p><p id="err"></p><div id="notes" hidden></div>')}
<script>const next = ${jsonIn(next)};
// a notice the sign-in hands back is shown, as text, before going on
const day = (at) => { const d = new Date(at); return Number.isNaN(d.getTime()) ? 'a recent day' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
document.getElementById('go').onclick = run(async () => {
  const j = await signIn();
  const ns = Array.isArray(j?.notices) ? j.notices.filter((n) => n && n.kind === 'method-added') : [];
  if (!ns.length) return location.replace(next);
  const box = document.getElementById('notes');
  for (const n of ns) {
    const p = document.createElement('p');
    p.textContent = 'A sign-in method (a ' + String(n.type) + ') was added to your account on ' + day(n.at) + ', from a new link the box\\'s owner sent. If you didn\\'t ask for one, tell them.' + (n.label ? ' It is named "' + String(n.label) + '".' : '');
    box.append(p);
  }
  const ok = document.createElement('button');
  ok.textContent = 'OK';
  ok.onclick = () => location.replace(next);
  box.append(ok);
  box.hidden = false;
  document.getElementById('go').hidden = true;
});</script></body></html>`,
  unclaimed: () => `${doc('Unclaimed', '<h1>This box is unclaimed</h1><p>Open the claim link from the box\'s logs (it ends in <code>/auth/claim#…</code>). Lost it? In a shell on the box, run <code>devteam-reclaim</code>.</p>')}</body></html>`,
  passkeys: (list, box) => `${doc('Passkeys', `<h1>Passkeys</h1><p>Any of these opens the box. Add one for another device or password manager; keep at least one. Removing one signs out every other session.</p><ul>${list.map((p) => `<li><span>${esc(p.name)} <small style="color:var(--fg2)">${esc(p.createdAt.slice(0, 10))}</small></span>${list.length > 1 ? `<button class="quiet" data-id="${esc(p.id)}">Remove</button>` : ''}</li>`).join('')}</ul><input id="name" placeholder="Name the new passkey" maxlength="60"><p><button id="add">Add a passkey</button> <button class="quiet" id="out">Sign out</button> <a href="${esc(`${box}/`)}">Back to the hub</a></p><p id="err"></p>`)}
<script>
document.getElementById('add').onclick = run(async () => { await create('/auth/passkeys/options', '/auth/passkeys/verify', { name: document.getElementById('name').value }); location.reload(); });
document.getElementById('out').onclick = run(async () => { await post('/auth/logout'); location.replace('/auth/login'); });
for (const x of document.querySelectorAll('button[data-id]')) x.onclick = run(async () => { if (confirm('Remove this passkey?')) { await post('/auth/passkeys/remove', { id: x.dataset.id }); location.reload(); } });
</script></body></html>`,
  // Each item from the manifest the gateway fetched itself, escaped; its state from the gateway's
  // own copy; ticked only when the box already holds a copy of what the owner approved, never
  // "move it". The POST binds each item to the manifest shown.
  publish: (port, rows) => `${doc('Publish', `<h1>Publish to anyone</h1><p>Anyone with a link below can read that page, with no sign-in. The box keeps its own copy of exactly what is listed here, which is what main holds now; a later change on main reaches the public only when you publish again. From instance ${esc(port)}: the project, checkout and log below are as that instance reports them. An item this box doesn't already serve starts unticked.</p><ul>${rows.map((r) => (r.error ? `<li class="pub"><b>${esc(r.slug)}</b><span>${esc(r.error)}</span></li>` : `<li class="pub"><label><input type="checkbox" data-slug="${esc(r.slug)}" data-manifest="${esc(r.hash)}"${r.held ? ' checked' : ''}> <b>${esc(r.m.title)}</b></label><small>${esc(r.m.project)} · ${esc(r.slug)} · ${esc(Object.keys(r.m.files).length)} files, ${esc(fmtSize(Object.values(r.m.files).reduce((n, f) => n + f.size, 0)))} · ${esc(r.state)}</small><small>from the checkout ${esc(r.m.root)}, as this instance reports it</small><code>${esc(r.url)}</code>${publishNote(r) ? `<span>${publishNote(r)}</span>` : ''}${publishFiles(r)}${r.movedFrom ? `<span>${esc(r.m.project)} is published from ${esc(r.movedFrom)}; this instance is ${esc(r.m.root)}. <label><input type="checkbox" data-move="${esc(r.slug)}" data-moved-from="${esc(r.movedFrom)}"> move it${r.others.length ? ` (its ${r.others.length} other page${r.others.length === 1 ? '' : 's'} from ${esc(r.movedFrom)} come${r.others.length === 1 ? 's' : ''} down: ${r.others.map(esc).join(', ')})` : ''}</label></span>` : ''}</li>`)).join('')}</ul>${rows.some((r) => !r.error) ? '<p><button id="go">Publish</button></p>' : ''}<p id="err"></p><ul id="out"></ul>`)}
<script>
const PORT = ${jsonIn(port)};
const go = document.getElementById('go');
if (go) go.onclick = run(async () => {
  const moves = [...document.querySelectorAll('input[data-move]')];
  const items = [...document.querySelectorAll('input[data-manifest]')].filter((x) => x.checked).map((x) => { const m = moves.find((y) => y.dataset.move === x.dataset.slug && y.checked); return { slug: x.dataset.slug, manifest: x.dataset.manifest, move: !!m, ...(m ? { movedFrom: m.dataset.movedFrom } : {}) }; });
  if (!items.length) return err('Nothing is ticked.');
  go.disabled = true;
  try {
    const r = await post('/public/publish', { port: PORT, items });
    document.getElementById('out').replaceChildren(...r.results.map((x) => {
      const li = document.createElement('li');
      if (!x.ok) { li.textContent = x.slug + ': refused: ' + x.error; return li; }
      const a = document.createElement('a');
      a.href = x.url; a.textContent = x.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      li.append(x.slug + (x.update ? ': updated at ' : ': public at '), a);
      return li;
    }));
  } finally { go.disabled = false; }
});
</script></body></html>`,
  unpublish: (x) => `${doc('Unpublish', `<h1>Take this page down</h1><p><b>${esc(x.title)}</b> (${esc(x.project)} · ${esc(x.slug)}) comes down within a minute, for everyone:</p>${x.url ? `<p><code>${esc(x.url)}</code></p>` : ''}${x.shared ? `<p id="shared">Two listed projects share the name ${esc(x.project)}, so this page may be the other project's. Only this page comes down, and no instance's record is written; the Library's Forget clears it.</p>` : ''}<p><button id="go">Unpublish</button></p><p id="err"></p><p id="out"></p>`)}
<script>
const ITEM = ${jsonIn({ project: x.project, slug: x.slug, ...(x.port ? { port: x.port } : {}) })};
const go = document.getElementById('go');
go.onclick = run(async () => {
  const r = await post('/public/unpublish', ITEM);
  go.disabled = true;
  document.getElementById('out').textContent = 'Taken down.' + (r.recorded ? ' The Library shows it.' : ' ' + (r.note || ''));
});
</script></body></html>`,
  // address(project, slug): a page's address, or null for a project whose name can't be a host
  publicList: (pub, address) => {
    const rows = Object.entries(pub).flatMap(([n, x]) => Object.entries(x.artifacts ?? {}).map(([s, a]) => ({ n, s, a, root: x.root, link: address(n, s) })));
    return `${doc('Public', `<h1>Public on this box</h1><p>Anyone can read these, with no sign-in. Each is the box's own copy of what you published.</p>${rows.length ? `<ul>${rows.map((r) => `<li class="pub"><b>${esc(r.a.title)}</b><small>${esc(r.n)} · ${esc(r.s)} · published ${esc(String(r.a.at).slice(0, 10))} from ${esc(r.root)}</small>${r.link ? `<code><a href="${esc(r.link)}" target="_blank" rel="noopener noreferrer">${esc(r.link)}</a></code>` : '<small>this name can\'t be a host, so the page has no address</small>'}<a href="${esc(`/public/unpublish?project=${r.n}&slug=${r.s}`)}">Unpublish</a></li>`).join('')}</ul>` : '<p>Nothing is public.</p>'}`)}</body></html>`;
  },
  // The owner's view of a public page: the instance's viewer, framed full size under one line, and
  // no script of its own. The frame may not navigate this tab, nor open a window outside its
  // sandbox (an artifact viewer needs none); its sandbox keeps its origin.
  ownerWrapper: ({ project, slug, title, plain, frame }) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>${esc(title)}</title><style>
html{touch-action:manipulation}:root{color-scheme:light dark;--bg:#fafafa;--fg:#171717;--fg2:#666;--line:#e5e5e5}@media (prefers-color-scheme:dark){:root{--bg:#000;--fg:#ededed;--fg2:#a1a1a1;--line:#2e2e2e}}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:13px/1.4 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}body{display:flex;flex-direction:column}
header{padding:6px 12px;border-bottom:1px solid var(--line);color:var(--fg2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}a{color:var(--fg)}iframe{flex:1;border:0;width:100%}
</style></head><body><header>Public · ${esc(project)}/${esc(slug)} · <a href="${esc(plain)}">Open it as the public sees it</a></header><iframe src="${esc(frame)}" title="${esc(title)}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads" autofocus></iframe></body></html>`,
};

