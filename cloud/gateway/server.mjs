/* imports start */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { BLOCK } from './base.mjs';
import { BODY_MS } from './assets.mjs';
import { BRANCH_AT } from './base.mjs';
import { BROWSER_VIEW } from './base.mjs';
import { CAPABILITY_MS } from './base.mjs';
import { CHALLENGE_MS } from './base.mjs';
import { CLAIM_MS } from './base.mjs';
import { FRAME_ANCESTORS } from './assets.mjs';
import { HOST_LABEL } from './base.mjs';
import { HUB_PORT } from './base.mjs';
import { INSTALL } from './assets.mjs';
import { LINK_ID } from './assets.mjs';
import { PAGES } from './pages.mjs';
import { PREVIEW_LENS } from './assets.mjs';
import { PREVIEW_NAME } from './base.mjs';
import { PROJECT } from './assets.mjs';
import { PUBLIC_TYPES } from './assets.mjs';
import { PURPOSES } from './base.mjs';
import { PUSH_DEVICES } from './base.mjs';
import { PUSH_REST_MS } from './base.mjs';
import { PUSH_SENDS } from './base.mjs';
import { PUSH_TEST } from './base.mjs';
import { REQUEST_MS } from './assets.mjs';
import { RESERVED_LABELS } from './base.mjs';
import { RESERVED_SEGMENTS } from './base.mjs';
import { SESSION_MS } from './base.mjs';
import { TREE } from './assets.mjs';
import { UPLOAD_FOLDER } from './assets.mjs';
import { UPLOAD_FREE } from './assets.mjs';
import { UPLOAD_KEEP_MS } from './assets.mjs';
import { UPLOAD_MAX } from './assets.mjs';
import { UPLOAD_PART } from './assets.mjs';
import { UPLOAD_STALL_MS } from './assets.mjs';
import { UPLOAD_TOTAL } from './assets.mjs';
import { alertNews } from './assets.mjs';
import { asciiJson } from './pages.mjs';
import { b64u } from './base.mjs';
import { boxImage } from './base.mjs';
import { canonicalJson } from './assets.mjs';
import { cborDecode } from './base.mjs';
import { claimLive } from './base.mjs';
import { claimUrl } from './base.mjs';
import { coseToJwk } from './base.mjs';
import { dropNote } from './assets.mjs';
import { dropPaste } from './assets.mjs';
import { dropSpace } from './assets.mjs';
import { encryptPush } from './base.mjs';
import { env } from './base.mjs';
import { fileChanges } from './pages.mjs';
import { gatewayDir } from './base.mjs';
import { gitBlobId } from './assets.mjs';
import { gitTreeId } from './assets.mjs';
import { here } from './base.mjs';
import { hex256 } from './assets.mjs';
import { hubSignature } from './base.mjs';
import { inboxNews } from './assets.mjs';
import { isDropImage } from './assets.mjs';
import { listedByPort } from './base.mjs';
import { manifestProblem } from './assets.mjs';
import { mapPool } from './assets.mjs';
import { methodRows } from './base.mjs';
import { newClaim } from './base.mjs';
import { newId } from './base.mjs';
import { ownerRow } from './base.mjs';
import { ownerSettingSignature } from './base.mjs';
import { paneSignature } from './base.mjs';
import { parseAuthData } from './base.mjs';
import { peopleStamp } from './base.mjs';
import { pipeline } from 'node:stream';
import { previewLensCsp } from './assets.mjs';
import { previewLinks } from './base.mjs';
import { publicCsp } from './assets.mjs';
import { publicPathOk } from './assets.mjs';
import { publicStore } from './assets.mjs';
import { publicUrl } from './base.mjs';
import { pushSubscription } from './base.mjs';
import { redactClaimLinks } from './base.mjs';
import { replaceFrameAncestors } from './assets.mjs';
import { resetPeople } from './base.mjs';
import { safeUploadName } from './assets.mjs';
import { sameBytes } from './base.mjs';
import { sha256 } from './base.mjs';
import { shellQuote } from './assets.mjs';
import { stamped } from './base.mjs';
import { stateStore } from './base.mjs';
import { termSignature } from './base.mjs';
import { threadKey } from './base.mjs';
import { unb64u } from './base.mjs';
import { uploadType } from './assets.mjs';
import { vapidToken } from './base.mjs';
import { verifySignature } from './base.mjs';
import { withOwner } from './base.mjs';
/* imports end */
// --- the server ---------------------------------------------------------------------------------
export function createGateway(opts = {}) {
  const PUB = publicUrl(opts.publicUrl);
  const BOX_IMAGE = boxImage(opts.env ?? env);
  const pubUrl = new URL(PUB);
  const NAME = pubUrl.hostname;
  const SECURE = pubUrl.protocol === 'https:';
  const SUFFIX = pubUrl.port ? `:${pubUrl.port}` : '';
  const projectOrigin = (name) => `${pubUrl.protocol}//${name}.${NAME}${SUFFIX}`;
  // Exactly <label>.<box>: a look-alike suffix or a second label is no name of this box.
  const labelOf = (host) => {
    const h = String(host ?? '');
    const tail = `.${NAME}${SUFFIX}`;
    if (!h.endsWith(tail)) return null;
    const l = h.slice(0, -tail.length);
    return HOST_LABEL.test(l) && !RESERVED_LABELS.includes(l) ? l : null;
  };
  // A preview's name, one label directly under the box's, on the wildcard DNS and certificate it has.
  const previewOf = (host) => {
    const m = /^([a-z0-9-]+)\.(.+)$/.exec(String(host ?? ''));
    return m && m[2] === `${NAME}${SUFFIX}` && PREVIEW_NAME.test(m[1]) ? m[1] : null;
  };
  const previewOrigin = (name) => `${pubUrl.protocol}//${name}.${NAME}${SUFFIX}`;
  // Who may hold a preview's lens: frame-ancestors is checked against every ancestor, so the hub
  // (which frames a dashboard) as well as the project host of the instance that lists the preview
  // (whose viewer frames the lens), as the list last said. The bytes are the same on every preview's
  // name, as the kit's relay serves them. A name two instances list, or none, gets the hub alone.
  const lensCsp = (name) => {
    const l = previews.get(name);
    return previewLensCsp([PUB, l && !l.ambiguous ? portHost.get(l.instance) : null].filter(Boolean).join(' '));
  };
  // Passkeys belong to the box's name. A page on an instance's subdomain may ask for one, but its
  // answer names that page's origin, and only an answer from the box's own origin is accepted.
  const RP_ID = NAME;
  const TERM = `${pubUrl.protocol}//term.${pubUrl.host}`;
  const termHost = new URL(TERM).host;
  // What the owner published, to anyone: under its project's own host. A project whose name isn't a
  // host label has no such host, so a page of it has no address.
  const publicAddress = (project, slug) => `${projectOrigin(project)}/${slug}/`;
  const hostable = (name) => HOST_LABEL.test(name) && !RESERVED_LABELS.includes(name);
  // Parsed once, before anything else starts: a cap that isn't a number would compare false
  // against every total and publish without limit, so a bad one stops the gateway instead.
  const maxSet = opts.publicMax ?? env.DEVTEAM_PUBLIC_MAX;
  const PUBLIC_MAX = maxSet === undefined ? 500 * 1024 * 1024 : Number(maxSet);
  if (!Number.isFinite(PUBLIC_MAX) || PUBLIC_MAX <= 0) throw new Error('DEVTEAM_PUBLIC_MAX must be a positive number of bytes');
  const EXTRA_METHODS = methodRows(opts.methodTypes);
  // How long a pending flow lives (records and sign-in states); only a test shortens it.
  const CHALLENGE = opts.challengeMs ?? CHALLENGE_MS;
  const COOKIE = 'devteam_session';
  const dir = opts.dir ?? gatewayDir();
  const ttydPort = Number(opts.ttydPort ?? env.DEVTEAM_TTYD_PORT ?? 7681);
  const stored = stateStore(dir);
  // every write is followed by a look at the open presence and canvas sockets (endPresence), in the same turn
  let afterSave = () => {};
  const store = { load: stored.load, save: (s) => { stored.save(s); afterSave(); } };
  const firstFile = (...c) => c.find((f) => f && fs.existsSync(f));
  const hubPage = fs.readFileSync(firstFile(opts.hubPage, env.DEVTEAM_HUB_PAGE, path.join(here, 'hub.html'), path.join(here, '..', 'docs', 'devteam', 'dashboard', 'hub.html')));
  const ttydPage = () => fs.readFileSync(opts.ttydPage ?? env.DEVTEAM_TTYD_PAGE ?? path.join(here, 'ttyd.html'));
  const log = opts.log ?? ((m) => process.stdout.write(`gateway: ${m}\n`));
  const uploadsRoot = opts.uploadsDir ?? env.DEVTEAM_UPLOADS_DIR ?? '/data/uploads';
  const uploadMax = opts.uploadMax ?? UPLOAD_MAX;
  const uploadTotal = opts.uploadTotal ?? UPLOAD_TOTAL;
  const uploadFree = opts.uploadFree ?? UPLOAD_FREE;
  const uploadKeepMs = opts.uploadKeepMs ?? UPLOAD_KEEP_MS;
  const uploadStallMs = opts.uploadStallMs ?? UPLOAD_STALL_MS;
  const bodyMs = opts.bodyMs ?? BODY_MS;

  // Unclaimed: the token named in the environment, else one made now and printed once (whoever
  // reads the platform's logs can already open a shell on the box, the root of trust anyway).
  try {
    let s = store.load();
    // A box claimed before people: its passkeys, sessions and devices become the owner's where they
    // are, so the write only adds the row and the stamp after the old keys. Once there, nothing.
    if (s.passkeys.length && !s.people) store.save(s = stamped(withOwner(s)));
    // Only an older gateway changes `passkeys` without the stamp, and none runs beside this one, so
    // the check is here alone. A sign-in under it changes counters, never ids, and trips nothing.
    else if (s.people && s.peopleStamp !== peopleStamp(s.passkeys)) {
      store.save(s = resetPeople(s).next);
      log('the owner\'s passkeys changed under an older gateway: every other person\'s session and every invite ended; they sign in again');
    }
    // made before sign-in moved under /auth (or for another name): the browser won't offer them here
    if (s.passkeys.some((x) => x.rp !== RP_ID)) log(`passkeys made before sign-in moved to ${PUB}/auth (or for another name) can't sign in here: run devteam-reclaim in a shell on the box for a claim link, and claim it again`);
    if (!s.passkeys.length) {
      const given = env.DEVTEAM_CLAIM_TOKEN;
      // a link `reclaim` printed outlives a restart, for its day; the environment's token is only the first
      if (claimLive(s)) log(`unclaimed: open the claim link printed earlier (${PUB}/auth/claim#…), or run devteam-reclaim for a new one`);
      else if (given && given.length >= 32) { store.save({ ...s, claimHash: b64u(sha256(given)), claimExpires: Date.now() + CLAIM_MS }); log(`unclaimed: open ${PUB}/auth/claim#<DEVTEAM_CLAIM_TOKEN> within a day to claim this box with a passkey`); }
      else { if (given) log('DEVTEAM_CLAIM_TOKEN is shorter than 32 characters; ignored'); log(`unclaimed: open ${claimUrl(PUB, newClaim(store))} within a day to claim this box with a passkey`); }
    }
  } catch (e) {
    // never taken for a new box, never overwritten: every request answers 503 until it is mended
    if (!e.unreadable) throw e;
    log(e.message);
  }

  const secret = crypto.randomBytes(32);
  const mac = (...parts) => crypto.createHmac('sha256', secret).update(parts.join('|')).digest().subarray(0, 16);

  const isOwner = (person) => person?.role === 'owner';
  // 'owner', 'admin' or 'member': any other role in a row reads as a member's, the least it can be
  const roleOf = (person) => (isOwner(person) ? 'owner' : person?.role === 'admin' ? 'admin' : 'member');
  // 'full' or 'view' (kit-250): only a row that says view is View; the stand-in and any other value are Full
  const levelOf = (person) => (person?.level === 'view' ? 'view' : 'full');
  // A claimed file with no owner row (one restored from before people, read while running): its
  // top-level sessions are still the owner's, until the next start's upgrade writes the row.
  const STAND_IN = { id: null, role: 'owner', level: 'full', name: 'Owner' };
  // The one rule for who a session is, for pages, sockets and artifact links alike: a live top-level
  // session is the owner's; a live peopleSessions entry is its person's, only while that row exists
  // (so nobody outlives their removal, and an entry naming no one is never taken for the owner).
  const liveSession = (s, test) => {
    const now = Date.now();
    const top = s.sessions.find((x) => x.expires > now && test(x));
    if (top) return { session: top, person: ownerRow(s) ?? STAND_IN };
    for (const x of s.peopleSessions ?? []) {
      if (!(x.expires > now) || !test(x)) continue;
      const person = (s.people ?? []).find((p) => p.id === x.person);
      if (person) return { session: x, person };
    }
    return null;
  };
  // Every devteam_session the browser sends: one set by something else can't shadow the real one.
  const sessionOf = (req) => {
    const s = store.load();
    for (const part of String(req.headers.cookie ?? '').split(';')) {
      const k = part.indexOf('=');
      if (k < 0 || part.slice(0, k).trim() !== COOKIE) continue;
      const tok = unb64u(part.slice(k + 1).trim());
      if (!tok || tok.length !== 32) continue;
      const h = b64u(sha256(tok));
      const found = liveSession(s, (x) => x.hash === h);
      if (found) return found;
    }
    return null;
  };
  // A write that waited on a body (up to five minutes) asks again, of the state as it is now: a
  // reclaim or a removal meanwhile must win, so a stolen session's request in flight lands nothing.
  const stillHeld = (s, session) => (s.passkeys.length ? liveSession(s, (x) => x.hash === session.hash) : null);
  // Adding a passkey takes a sign-in in the last five minutes, not only a session.
  const fresh = (session) => Date.now() - (session.at ?? 0) < CHALLENGE_MS;
  // One cookie for the box and every instance's subdomain. SameSite=None: a review page or an
  // artifact runs in a sandboxed frame with an opaque origin, and a browser treats its requests
  // (the kit's helpers, committed images) as cross-site, so a Lax cookie would not go with them.
  // Cross-site requests are refused below by their Origin, and by the kit's own checks.
  const cookie = (value, maxAge) => `${COOKIE}=${value}; Domain=${NAME}; Path=/; HttpOnly; Max-Age=${maxAge}${SECURE ? '; Secure; SameSite=None' : '; SameSite=Lax'}`;
  // `method`: the one it was opened with, so removing that method can end it. The owner's go in
  // top-level `sessions`, where an older gateway reads them; anyone else's in `peopleSessions`. The
  // state with it, and its cookie, so a flow's finish writes it with the rest in one save.
  const sessionFor = (s, person, methodId) => {
    const tok = crypto.randomBytes(32);
    const hash = b64u(sha256(tok));
    const at = Date.now();
    const next = isOwner(person)
      ? { ...s, sessions: [...s.sessions, { hash, method: methodId, at, expires: at + SESSION_MS }] }
      : { ...s, peopleSessions: [...(s.peopleSessions ?? []), { hash, person: person.id, method: methodId, at, expires: at + SESSION_MS }] };
    return { next, set: cookie(b64u(tok), SESSION_MS / 1000) };
  };
  // The hash of every devteam_session the request carries, live or not.
  const sessionHashes = (req) => String(req.headers.cookie ?? '').split(';').flatMap((part) => {
    const k = part.indexOf('=');
    const tok = k < 0 || part.slice(0, k).trim() !== COOKIE ? null : unb64u(part.slice(k + 1).trim());
    return tok?.length === 32 ? [b64u(sha256(tok))] : [];
  });

  const hsts = SECURE ? { 'strict-transport-security': 'max-age=31536000' } : {};
  const send = (res, code, type, body, extra = {}) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...hsts, ...extra }); res.end(body); };
  const json = (res, code, obj, extra) => send(res, code, 'application/json', JSON.stringify(obj), extra);
  const redirect = (res, to) => { res.writeHead(302, { location: to, 'cache-control': 'no-store', ...hsts }); res.end(); };
  const PAGE_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
  const page = (res, html) => send(res, 200, 'text/html; charset=utf-8', html, { 'content-security-policy': PAGE_CSP, 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' });
  const readJson = (req, cap = 64 * 1024) => new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > cap) { req.destroy(); resolve(null); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
  // Where to go after signing in: the box or one of its instances, never anywhere else.
  const safeNext = (n) => {
    try {
      const u = new URL(String(n ?? '/'), PUB);
      if (u.origin === PUB || u.origin === TERM || (u.protocol === pubUrl.protocol && labelOf(u.host) && u.origin === projectOrigin(labelOf(u.host)))) return u.href;
    } catch {}
    return `${PUB}/`;
  };

  // A person's own sign-in methods, without key material: the owner's are the top-level passkeys and
  // then their row's methods; anyone else's, their row's.
  const ownMethods = (s, person) => {
    const row = person.id === null ? null : (s.people ?? []).find((p) => p.id === person.id);
    const methods = (row?.methods ?? []).map((m) => ({ id: m.id, type: m.type, label: m.label, added_at: m.added_at, last_used: m.last_used ?? null }));
    return isOwner(person) ? [...s.passkeys.map((p) => ({ id: p.id, type: 'passkey', label: p.name, added_at: p.createdAt, last_used: p.usedAt ?? null })), ...methods] : methods;
  };
  // Every passkey on the box, everyone's: one credential belongs to one person.
  const allCredentialIds = (s) => [...s.passkeys.map((p) => p.id), ...(s.people ?? []).flatMap((p) => (p.methods ?? []).filter((m) => m.type === 'passkey').map((m) => m.key))];
  // A person's push devices: the owner's in top-level `pushSubs`, where an older gateway reads them;
  // anyone else's in their row. Devices aren't what `rev` counts, so neither bumps it.
  const subsOf = (s, person) => (isOwner(person) ? s.pushSubs ?? [] : (s.people ?? []).find((p) => p.id === person.id)?.pushSubs ?? []);
  const withSubs = (s, person, subs) => (isOwner(person) ? { ...s, pushSubs: subs } : { ...s, people: (s.people ?? []).map((p) => (p.id === person.id ? { ...p, pushSubs: subs } : p)) });
  // Whom news goes to: the owner's devices and every Full person's. A View person gets none (kit-801),
  // even if their row holds a device (a hand-edited state); removing a dead one still reads every list.
  const everySub = (s) => [...(s.pushSubs ?? []), ...(s.people ?? []).flatMap((p) => (levelOf(p) === 'view' ? [] : p.pushSubs ?? []))];
  // Every list, everyone's, keeping only what `keep` passes.
  const keepSubs = (s, keep) => ({ ...s, pushSubs: (s.pushSubs ?? []).filter(keep), ...(s.people ? { people: s.people.map((p) => ({ ...p, pushSubs: (p.pushSubs ?? []).filter(keep) })) } : {}) });
  // "Yours" before "last", so nobody learns anything of anyone else's. On success: whoever held it
  // may hold a session too, so every other session of yours ends, and the requester's as well when it
  // was opened with this method; your devices' notifications go (each subscribes again when its hub
  // next opens). Nobody else's sessions or devices change.
  const removeMethod = (s, person, id, session) => {
    const own = ownMethods(s, person);
    if (!own.some((m) => m.id === id)) return { status: 404, error: 'no such sign-in method of yours' };
    const owner = isOwner(person);
    const top = owner && s.passkeys.some((p) => p.id === id);
    // the owner's last top-level passkey is what keeps the box claimed, whatever else they hold
    if (owner ? top && s.passkeys.length < 2 : own.length < 2) return { status: 400, error: owner ? 'the last passkey can\'t be removed; add another first' : 'your last sign-in method can\'t be removed; add another first' };
    const keep = (x) => x.hash === session.hash && x.method !== id;
    const people = s.people?.map((p) => (p.id === person.id && p.methods.some((m) => m.id === id) ? { ...p, methods: p.methods.filter((m) => m.id !== id), rev: p.rev + 1 } : p));
    const next = owner
      ? { ...s, ...(top ? { passkeys: s.passkeys.filter((p) => p.id !== id) } : {}), sessions: s.sessions.filter(keep), ...(people ? { people } : {}) }
      : { ...s, people, peopleSessions: (s.peopleSessions ?? []).filter((x) => x.person !== person.id || keep(x)) };
    const cleared = withSubs(next, person, []);
    return { status: 200, next: top ? stamped(cleared) : cleared };
  };
  // The passkey's user names its person, so a password manager doesn't file anyone's as the owner's.
  const createOptions = (challenge, userId, person) => ({
    challenge, rp: { id: RP_ID, name: 'devteam' },
    user: isOwner(person) ? { id: userId, name: `owner@${RP_ID}`, displayName: `devteam owner (${RP_ID})` } : { id: userId, name: `${person.name}@${RP_ID}`, displayName: `${person.name} (${RP_ID})` },
    pubKeyCredParams: [-7, -8, -257].map((alg) => ({ type: 'public-key', alg })),
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    attestation: 'none', timeout: CHALLENGE_MS, excludeCredentials: allCredentialIds(store.load()).map((id) => ({ type: 'public-key', id })),
  });
  const checkAuthData = (ad) => {
    if (!sameBytes(Buffer.from(ad.rpIdHash), sha256(RP_ID))) throw new Error('wrong relying party');
    if (!ad.up || !ad.uv) throw new Error('the passkey did not verify you (user presence and verification are required)');
  };
  // --- sign-in methods: the table, pending flows, the flow cookie (spec kit-254) ----------------
  // The owner's passkeys stay top-level in today's shape; this is the one mapping between that and
  // a method's { key, data, label, added_at, last_used }, both ways.
  const topToMethod = (p) => ({ key: p.id, data: { userId: p.userId, jwk: p.jwk, alg: p.alg, signCount: p.signCount, rp: p.rp }, label: p.name, added_at: p.createdAt, last_used: p.usedAt ?? null });
  const methodToTop = (m) => ({ id: m.key, userId: m.data.userId, jwk: m.data.jwk, alg: m.data.alg, signCount: m.data.signCount, name: m.label, rp: m.data.rp, createdAt: m.added_at });
  // Hand the box from `from` (the owner's row) to `to` (joined, no link out, a passkey): the next
  // state, which the caller saves in one write (kit-253 spec §2). The top-level fields, all an older
  // gateway reads, become `to`'s alone; `from`'s passkeys, sessions and devices move into their row,
  // each moved session naming the new id of the passkey it named, the id of another method still in
  // their row, or none. The stamp follows.
  const transferTo = (s, from, to) => {
    const pk = (to.methods ?? []).filter((m) => m.type === 'passkey');
    const keyOf = new Map(pk.map((m) => [m.id, m.key]));
    const idOf = new Map(s.passkeys.map((p) => [p.id, newId('m-')]));
    const moved = s.passkeys.map((p) => ({ id: idOf.get(p.id), type: 'passkey', ...topToMethod(p) }));
    const theirs = (s.peopleSessions ?? []).filter((x) => x.person === to.id);
    return stamped({
      ...s,
      passkeys: pk.map((m) => ({ ...methodToTop(m), ...(m.last_used ? { usedAt: m.last_used } : {}) })),
      sessions: theirs.map(({ person, ...x }) => ({ ...x, method: keyOf.get(x.method) ?? x.method ?? null })),
      pushSubs: to.pushSubs ?? [],
      people: s.people.map((p) => {
        if (p.id === to.id) return { ...p, role: 'owner', level: 'full', methods: (p.methods ?? []).filter((m) => m.type !== 'passkey'), pushSubs: [], rev: p.rev + 1 };
        if (p.id === from.id) return { ...p, role: 'admin', level: 'full', methods: [...(p.methods ?? []), ...moved], pushSubs: (s.pushSubs ?? []).slice(-PUSH_DEVICES), rev: p.rev + 1 };
        return p;
      }),
      peopleSessions: [...(s.peopleSessions ?? []).filter((x) => x.person !== to.id), ...s.sessions.map((x) => ({ ...x, person: from.id, method: idOf.get(x.method) ?? ((from.methods ?? []).some((m) => m.id === x.method) ? x.method : null) }))],
      invites: (s.invites ?? []).filter((x) => x.person !== from.id && x.person !== to.id),
    });
  };
  // Who holds (type, key) on the box: the owner's top-level passkeys, else anyone's row.
  const holderOf = (s, type, key) => {
    const pk = type === 'passkey' ? s.passkeys.find((p) => p.id === key) : null;
    if (pk) return { person: ownerRow(s) ?? STAND_IN, method: topToMethod(pk), top: true };
    for (const person of s.people ?? []) {
      const method = (person.methods ?? []).find((m) => m.type === type && m.key === key);
      if (method) return { person, method, top: false };
    }
    return null;
  };

  // The passkey row: today's ceremonies behind the table's interface. Its state is the challenge.
  const clientDataOf = (b64) => {
    const raw = unb64u(b64);
    if (!raw) throw new Error('no clientDataJSON');
    return { raw, c: JSON.parse(raw.toString('utf8')) };
  };
  const ceremony = (b64, type, state) => {
    const { raw, c } = clientDataOf(b64);
    if (c?.type !== type) throw new Error('wrong ceremony');
    if (c.origin !== PUB || c.crossOrigin === true) throw new Error('wrong origin');
    // stateOf read the state from this same clientDataJSON; checked again so the row holds on its own
    if (c.challenge !== state) throw new Error('unknown or expired challenge');
    return raw;
  };
  // A new passkey from navigator.credentials.create(): the attestation itself is not checked
  // (attestation 'none'); what makes it trusted is who may start the flow (a claim token, a fresh
  // session, an invite). Its user id was made at start (`kept`).
  const attested = (body, state, kept) => {
    ceremony(body?.clientDataJSON, 'webauthn.create', state);
    const attBytes = unb64u(body?.attestationObject) ?? Buffer.alloc(0);
    const { value: att, end } = cborDecode(attBytes);
    if (end !== attBytes.length) throw new Error('bad attestationObject');
    if (!(att instanceof Map) || !Buffer.isBuffer(att.get('authData'))) throw new Error('bad attestationObject');
    const ad = parseAuthData(att.get('authData'));
    checkAuthData(ad);
    if (!ad.at) throw new Error('no credential in the response');
    const rawId = unb64u(body?.rawId);
    if (!rawId || !sameBytes(rawId, Buffer.from(ad.credentialId))) throw new Error('credential id mismatch');
    const { jwk, alg } = coseToJwk(ad.cose);
    return { key: b64u(rawId), data: { userId: kept?.userId, jwk, alg, signCount: ad.signCount, rp: RP_ID } };
  };
  const asserted = (body, state, lookup) => {
    const key = body?.rawId;
    const pk = typeof key === 'string' ? lookup(key) : null;
    if (!pk) throw new Error('unknown passkey');
    const raw = ceremony(body?.clientDataJSON, 'webauthn.get', state);
    const adBytes = unb64u(body?.authenticatorData);
    const sig = unb64u(body?.signature);
    if (!adBytes || !sig) throw new Error('bad assertion');
    if (body?.userHandle && pk.userId && body.userHandle !== pk.userId) throw new Error('the passkey is for another account');
    const ad = parseAuthData(adBytes);
    checkAuthData(ad);
    if (!verifySignature(pk, Buffer.concat([adBytes, sha256(raw)]), sig)) throw new Error('bad signature');
    // A counter that stopped going up means a cloned authenticator; synced passkeys keep it at 0.
    if ((ad.signCount || pk.signCount) && ad.signCount <= pk.signCount) throw new Error('the passkey\'s counter went backwards');
    return { key, data: { ...pk, signCount: ad.signCount } };
  };
  const PASSKEY = {
    start: ({ purpose, state, person }) => {
      if (purpose === 'sign-in') return { send: { challenge: state, rpId: RP_ID, userVerification: 'required', timeout: CHALLENGE_MS, allowCredentials: [] } };
      const userId = b64u(crypto.randomBytes(16));
      return { send: createOptions(state, userId, person), keep: { userId } };
    },
    stateOf: (body) => clientDataOf(body?.clientDataJSON).c?.challenge,
    finish: ({ purpose, state, body, lookup, kept }) => (purpose === 'sign-in' ? asserted(body, state, lookup) : attested(body, state, kept)),
    describe: ({ body, count }) => (typeof body?.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 60) : `passkey ${count + 1}`),
  };
  const METHODS = new Map([['passkey', PASSKEY], ...EXTRA_METHODS]);

  // A claim, add or invite keeps a record under its state, in memory, one use (today's rule: at most
  // 100, the oldest dropped). Only someone already let in (or the claimer) can start one.
  const records = new Map();
  const putRecord = (state, rec) => {
    records.set(state, rec);
    while (records.size > 100) records.delete(records.keys().next().value);
  };
  // A sign-in keeps nothing, so no flood of anonymous starts evicts anyone's: its state carries its
  // own expiry and a MAC over the type and the browser's nonce; only a sign-in that succeeded is
  // spent, and the spent-set holds each for its lifetime.
  const signInMac = (type, head, nonceHash) => mac('sign-in', type, head.toString('hex'), b64u(nonceHash));
  const signInState = (type, nonceHash) => {
    const head = Buffer.alloc(24);
    crypto.randomFillSync(head, 0, 16);
    head.writeBigUInt64BE(BigInt(Date.now() + CHALLENGE), 16);
    return b64u(Buffer.concat([head, signInMac(type, head, nonceHash)]));
  };
  // a sign-in state is 40 bytes, a record's 32: the length says which
  const isSignIn = (state) => unb64u(state)?.length === 40;
  const signInOk = (state, type, nonceHash) => { const b = unb64u(state); return sameBytes(b.subarray(24), signInMac(type, b.subarray(0, 24), nonceHash)); };
  const signInLive = (state) => Number(unb64u(state).readBigUInt64BE(16)) > Date.now();
  const usedSignIns = new Map();
  const spendSignIn = (state) => {
    for (const [k, t] of usedSignIns) if (t < Date.now()) usedSignIns.delete(k);
    usedSignIns.set(state, Date.now() + CHALLENGE);
  };

  // The flow cookie binds a flow to the browser that started it: pairs <state>.<nonce>, the newest 4.
  // Host-only on the box's name; on HTTPS only the __Host- name is read, which no instance's page can set.
  const FLOW = SECURE ? '__Host-devteam_flow' : 'devteam_flow';
  const PAIR = /^[\w-]{16,128}\.[\w-]{43}$/;
  const flowPairs = (req) => String(req.headers.cookie ?? '').split(';').flatMap((part) => {
    const k = part.indexOf('=');
    return k < 0 || part.slice(0, k).trim() !== FLOW ? [] : part.slice(k + 1).trim().split('~').filter((x) => PAIR.test(x));
  });
  const flowCookie = (pairs) => `${FLOW}=${pairs.join('~')}; Path=/; HttpOnly;${SECURE ? ' Secure;' : ''} SameSite=Lax; Max-Age=${pairs.length ? CHALLENGE_MS / 1000 : 0}`;
  const pairState = (x) => x.slice(0, x.lastIndexOf('.'));

  const OTHER_BROWSER = 'unknown or expired challenge: this was started in another browser, or too long ago; start again';
  const START_AGAIN = 'unknown or expired challenge: start again';
  const INVITE_GONE = 'This invite has expired or was used; ask for a new one.';
  const NOT_FRESH = 'sign in again to change your sign-in methods (reload this page)';
  const CLAIM_EXPIRED = 'this claim link has expired: restart the box, or run devteam-reclaim in a shell on it, for a new one';
  const isObject = (x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
  const no = (status, error, cookies = []) => ({ status, body: { error }, cookies });
  const said = (e) => String(e?.message ?? e);
  // A live invite for someone who isn't the owner; by its hash.
  const inviteOf = (s, hash) => {
    // compared as bytes, as the claim token's hash is
    const want = unb64u(hash);
    const inv = want ? (s.invites ?? []).find((x) => { const got = unb64u(x.hash); return got && sameBytes(got, want) && x.expires > Date.now(); }) : undefined;
    const person = inv ? (s.people ?? []).find((p) => p.id === inv.person) : null;
    return person && !isOwner(person) ? { inv, person } : null;
  };

  // A method a new link added to someone who already had one: a notice in their row, shown once at
  // their next sign-in with another method (never the added one's own, so whoever holds a leaked
  // link can't spend the warning), and always in their own method list. The newest 20 are kept.
  const NOTICES_KEPT = 20;
  const withNotice = (row, n) => {
    const all = [...(row.notices ?? []), n];
    const added = all.filter((x) => x?.kind === 'method-added');
    const drop = new Set(added.slice(0, Math.max(0, added.length - NOTICES_KEPT)));
    return all.filter((x) => !drop.has(x));
  };
  const noticeOut = ({ kind, at, type, label }) => ({ kind, at, type, label });
  const noticesOf = (s, person) => (person.id === null ? [] : ((s.people ?? []).find((p) => p.id === person.id)?.notices ?? []).filter((x) => x?.kind === 'method-added').map(noticeOut));

  // --- the owner's People routes (kit-249's route contract): a refusal is { error, code } --------
  const refuse = (res, status, code, error) => json(res, status, { error, code });
  const INVITE_MS = 24 * 3600 * 1000;
  const MAX_INVITES = 50;
  const MAX_PEOPLE = 200;
  const STALE = 'This changed since you opened it; reload';
  // C0 and C1 controls, line and paragraph separators, bidi controls (as the kit's UNSAFE_TEXT)
  const NAME_BAD = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
  const liveInvites = (s) => (s.invites ?? []).filter((x) => x.expires > Date.now());
  // The link is shown once; only the hash of its token is kept, as startFlow reads it.
  const newInvite = (personId) => {
    const token = b64u(crypto.randomBytes(32));
    return { link: `${PUB}/auth/claim#${token}`, invite: { hash: b64u(sha256(token)), person: personId, expires: Date.now() + INVITE_MS } };
  };
  // The one name rule, for an invite's name and a rename: one line of 1 to 60 characters, kept
  // trimmed and in NFC, and no other row's in NFC ignoring case. `except`: the row being renamed,
  // whose own name never clashes. A name, or the refusal's { code, error }.
  const nameIssue = (s, raw, except = null) => {
    const name = typeof raw === 'string' ? raw.normalize('NFC').trim() : null;
    if (!name || [...name].length > 60 || NAME_BAD.test(name)) return { code: 'bad-name', error: 'A name is one line of 1 to 60 characters.' };
    const key = name.toLowerCase();
    if ((s.people ?? []).some((p) => p.id !== except && String(p.name).normalize('NFC').toLowerCase() === key)) return { code: 'name-taken', error: 'Someone on this box already has that name.' };
    return { name };
  };
  // Who may: the owner, signed in in the last five minutes. Asked before the body is read and again,
  // of the state as it is, after (stillHeld): a reclaim or a removal meanwhile wins.
  const ownerGuard = (res, who) => {
    if (!isOwner(who.person)) return refuse(res, 403, 'not-allowed', 'Only the box\'s owner can do this.'), false;
    if (!fresh(who.session)) return refuse(res, 403, 'fresh-sign-in', 'Sign in again to change who is on this box (reload this page).'), false;
    return true;
  };
  const peopleBody = async (req, res, session) => {
    const body = await readJson(req, 4096);
    const s = store.load();
    const held = stillHeld(s, session);
    if (!held) return json(res, 401, { error: 'your session ended; sign in again' }), null;
    if (!ownerGuard(res, held)) return null;
    if (!isObject(body)) return refuse(res, 400, 'bad-request', 'bad request'), null;
    return { s, body };
  };
  const inviteRoute = async (req, res, who) => {
    if (!ownerGuard(res, who)) return;
    const got = await peopleBody(req, res, who.session);
    if (!got) return;
    const { s, body } = got;
    if (body.level !== undefined && body.level !== 'full' && body.level !== 'view') return refuse(res, 400, 'bad-request', 'a level is full or view');
    // a file from before people gets its owner row here, stamped as start stamps it: a people list
    // with no stamp reads, at the next start, as an older gateway's change and is reset
    const base = s.people ? s : stamped(withOwner(s));
    const named = nameIssue(base, body.name);
    if (named.code) return refuse(res, 400, named.code, named.error);
    const { name } = named;
    const open = liveInvites(base);
    if (open.length >= MAX_INVITES || base.people.length >= MAX_PEOPLE) return refuse(res, 409, 'too-many', `A box holds ${MAX_PEOPLE} people and ${MAX_INVITES} open invites; remove one first.`);
    const iso = new Date().toISOString();
    const row = { id: newId('p-'), name, role: 'member', level: body.level === 'view' ? 'view' : 'full', methods: [], pushSubs: [], added_at: iso, last_seen: null, notices: [], rev: 1 };
    const { link, invite } = newInvite(row.id);
    store.save({ ...base, people: [...base.people, row], invites: [...open, invite] });
    log(`invited "${name}"`);
    return json(res, 200, { person: { id: row.id, rev: row.rev }, link, expires: invite.expires });
  };
  // A new link for someone already here: their earlier one dies (one live link per person); their
  // row, level and rev are as they were.
  const relinkRoute = async (req, res, who) => {
    if (!ownerGuard(res, who)) return;
    const got = await peopleBody(req, res, who.session);
    if (!got) return;
    const { s, body } = got;
    const row = typeof body.id === 'string' ? (s.people ?? []).find((p) => p.id === body.id) : null;
    if (!row) return refuse(res, 409, 'stale', STALE);
    if (isOwner(row)) return refuse(res, 403, 'not-allowed', 'The owner gets back in with devteam-reclaim, in a shell on the box.');
    if (body.rev !== row.rev) return refuse(res, 409, 'stale', STALE);
    const others = liveInvites(s).filter((x) => x.person !== row.id);
    if (others.length >= MAX_INVITES) return refuse(res, 409, 'too-many', `A box holds ${MAX_INVITES} open invites; remove one first.`);
    const { link, invite } = newInvite(row.id);
    store.save({ ...s, invites: [...others, invite] });
    log(`a new link for "${row.name}"`);
    return json(res, 200, { link, expires: invite.expires });
  };

  // --- People: the list, and the changes kit-249 owns (rename, revoke, remove) ---------------------
  // Who sees People: the owner (the stand-in included) and admins. Admins rename, remove and raise
  // joined members and admins, and leave (kit-253, a-20261123-051441425-supervisor).
  const seesPeople = (person) => roleOf(person) !== 'member';
  const FRESH_AGAIN = "Confirm it's you: sign in again, then make the change again";
  const joined = (s, row) => ownMethods(s, row).length > 0;
  // Any invite naming the row, expired or not, is a link out until it is revoked (kit-253 R3).
  const linkOut = (s, id) => (s.invites ?? []).some((x) => x.person === id);
  const hasPasskey = (s, row) => ownMethods(s, row).some((m) => m.type === 'passkey');
  const isAdmin = (person) => roleOf(person) === 'admin';
  // A move to Full is offered only to a View member (an admin is always Full); kit-250 adds View.
  const movable = (row) => roleOf(row) === 'member';
  // The newest invite naming the row: a first invite for someone who never joined, else a new link.
  const linkOf = (s, row) => {
    const mine = (s.invites ?? []).filter((x) => x.person === row.id);
    if (!mine.length) return null;
    const newest = mine.reduce((a, b) => (b.expires > a.expires ? b : a));
    return { kind: joined(s, row) ? 'new-link' : 'invite', expires: newest.expires, expired: newest.expires <= Date.now() };
  };
  // What this viewer may post for this row, in menu order; the routes refuse the rest. One link per
  // person: with one out (expired too, until it is revoked: kit-253 R3), Revoke comes first and no
  // second link is offered (relink still takes one, replacing it). Someone who never joined and whose link is gone (swept as expired by an
  // invite or relink's save) can only be removed.
  // Make admin and Make owner only where they land: joined, no link out, and for Make owner a passkey,
  // never from the stand-in (it restarts first). The list never offers what mayPeople refuses.
  const peopleActions = (s, viewer, row) => {
    const offered = (() => {
      if (isOwner(viewer)) {
        if (isOwner(row)) return ['rename'];
        const link = linkOf(s, row);
        if (!joined(s, row)) return link ? ['revoke'] : ['remove'];
        const lv = movable(row) ? ['level'] : [];
        if (link) return ['revoke', 'rename', ...lv, 'remove'];
        return ['rename', ...lv, 'role', ...(hasPasskey(s, row) && viewer.id !== null ? ['transfer'] : []), 'relink', 'remove'];
      }
      if (!isAdmin(viewer) || isOwner(row) || !joined(s, row)) return [];
      return ['rename', ...(movable(row) ? ['level'] : []), 'remove'];
    })();
    return offered.filter((a) => !mayPeople(viewer, row, a, s));
  };
  const peopleList = (s, viewer) => {
    const rows = s.people ?? [];
    const order = [...rows.filter((r) => isOwner(r)), ...rows.filter((r) => !isOwner(r))];
    return {
      viewer: { id: viewer.id, role: roleOf(viewer), invite: isOwner(viewer) },
      people: order.map((r) => ({
        id: r.id, name: r.name, role: roleOf(r), level: r.level, you: viewer.id !== null && r.id === viewer.id,
        methods: ownMethods(s, r).length, added_at: r.added_at, last_seen: r.last_seen ?? null, rev: r.rev,
        link: linkOf(s, r), actions: peopleActions(s, viewer, r),
      })),
    };
  };
  // Step 9: why this viewer may not do this to this row (403 not-allowed, its sentence), or null. The
  // rules peopleActions draws from (kit-253 spec §1). `self`: the row is the viewer's own.
  const mayPeople = (viewer, row, action, s) => {
    const no = (error) => ({ status: 403, code: 'not-allowed', error });
    const self = viewer.id !== null && row.id === viewer.id;
    if (isOwner(viewer)) {
      if (action === 'remove' && isOwner(row)) return no('Nobody can remove the box\'s owner.');
      if (action === 'revoke' && isOwner(row)) return no('The box\'s owner has no link to revoke.');
      if (action === 'level' && roleOf(row) !== 'member') return no(isAdmin(row) ? 'An admin is always Full; take Admin away first' : 'The box\'s owner is always Full');
      if (action === 'level' && !joined(s, row)) return no('They haven\'t joined yet: their level is their invite\'s');
      if (action === 'role' && (self || isOwner(row))) return no('The owner stops being the owner only by handing the box over');
      if (action === 'transfer' && (self || isOwner(row))) return no('You already own this box');
      return null;
    }
    if (!isAdmin(viewer)) return no('Only the owner and admins can change People.');
    if (isOwner(row)) return no('Nobody but the owner changes the owner\'s row');
    if (action === 'role') return no('Only the owner makes admins');
    if (action === 'transfer') return no('Only the owner hands the box over');
    if (action !== 'rename' && action !== 'remove' && action !== 'level') return no('Only the owner sends or revokes links');
    if (action === 'level' && isAdmin(row)) return no(self ? 'An admin is always Full' : 'An admin is always Full; take Admin away first');
    // R1: an invite not used yet is the owner's to change
    if (!self && !joined(s, row)) return no('They haven\'t joined yet: only the owner changes an invite');
    return null;
  };
  // The guards, in the spec's order: role and fresh (before the body), the body, still held and still
  // fresh (on the state as it is: no I/O between this load and the route's save, only the one
  // microtask the route's await of this guard takes; the store is synchronous), the row, its rev, then may.
  const peopleGuard = async (req, res, who, action) => {
    if (!seesPeople(who.person)) return refuse(res, 403, 'not-allowed', 'Only the owner and admins can change People.'), null;
    if (!fresh(who.session)) return refuse(res, 403, 'fresh-sign-in', FRESH_AGAIN), null;
    const body = await readJson(req, 4096);
    if (!isObject(body)) return refuse(res, 400, 'bad-request', 'bad request'), null;
    const s = store.load();
    const held = stillHeld(s, who.session);
    if (!held || !seesPeople(held.person)) return json(res, 401, { error: 'your session ended; sign in again' }), null;
    if (!fresh(held.session)) return refuse(res, 403, 'fresh-sign-in', FRESH_AGAIN), null;
    const row = typeof body.id === 'string' ? (s.people ?? []).find((x) => x.id === body.id) : null;
    if (!row || body.rev !== row.rev) return refuse(res, 409, 'stale', STALE), null;
    const no = mayPeople(held.person, row, action, s);
    if (no) return refuse(res, no.status, no.code, no.error), null;
    return { s, person: held.person, row, body };
  };
  const renameRoute = async (req, res, who) => {
    const g = await peopleGuard(req, res, who, 'rename');
    if (!g) return;
    const { s, row, body } = g;
    const named = nameIssue(s, body.name, row.id);
    if (named.code) return refuse(res, 400, named.code, named.error);
    const rev = row.rev + 1;
    store.save({ ...s, people: s.people.map((x) => (x.id === row.id ? { ...x, name: named.name, rev } : x)) });
    log('a person on this box was renamed');
    return json(res, 200, { ok: true, rev });
  };
  // Every link naming the person goes; someone who never joined goes with theirs.
  const revokeRoute = async (req, res, who) => {
    const g = await peopleGuard(req, res, who, 'revoke');
    if (!g) return;
    const { s, row } = g;
    if (!(s.invites ?? []).some((x) => x.person === row.id)) return refuse(res, 409, 'stale', STALE);
    const stays = joined(s, row);
    store.save({ ...s, invites: s.invites.filter((x) => x.person !== row.id), ...(stays ? {} : { people: s.people.filter((x) => x.id !== row.id) }) });
    log(stays ? 'a new link was revoked' : 'an invite was revoked, with its person who never joined');
    return json(res, 200, { ok: true });
  };
  // One write ends everything the row held (its methods and devices go with it), every session and
  // invite naming them; then the terminal and preview sockets they hold close. The owner's row is
  // never removed (mayPeople). Removing your own row is Leave: the answer clears your cookie too.
  const removeRoute = async (req, res, who) => {
    const g = await peopleGuard(req, res, who, 'remove');
    if (!g) return;
    const { s, person, row } = g;
    store.save({ ...s, people: s.people.filter((x) => x.id !== row.id), peopleSessions: (s.peopleSessions ?? []).filter((x) => x.person !== row.id), invites: (s.invites ?? []).filter((x) => x.person !== row.id) });
    dropPerson(row.id);
    const left = person.id !== null && person.id === row.id;
    log(left ? 'a person left the box: their sessions, invites and open sockets ended' : 'a person was removed: their sessions, invites and open sockets ended');
    return json(res, 200, { ok: true }, left ? { 'set-cookie': cookie('', 0) } : undefined);
  };
  // A move between Full and View (kit-250). Already there: its rev, nothing written (R4). A move to
  // View drops their push subscriptions in the same write, then closes their terminal and preview
  // sockets; their sessions go on, at View from their next request.
  const levelRoute = async (req, res, who) => {
    const g = await peopleGuard(req, res, who, 'level');
    if (!g) return;
    const { s, row, body } = g;
    if (body.level !== 'full' && body.level !== 'view') return refuse(res, 400, 'bad-request', 'a level is full or view');
    if (levelOf(row) === body.level) return json(res, 200, { ok: true, rev: row.rev });
    const rev = row.rev + 1;
    const next = body.level === 'view' ? { level: 'view', pushSubs: [], rev } : { level: 'full', rev };
    store.save({ ...s, people: s.people.map((x) => (x.id === row.id ? { ...x, ...next } : x)) });
    if (body.level === 'view') dropPerson(row.id);
    log(body.level === 'view' ? 'a person was made view only: their terminal and preview sockets closed' : 'a person was made full');
    return json(res, 200, { ok: true, rev });
  };
  // Make admin (joined, no link out; a View member becomes Full too) or Take Admin away (they stay
  // Full). Their sessions go on; their next People request is judged by the new role.
  const roleRoute = async (req, res, who) => {
    const g = await peopleGuard(req, res, who, 'role');
    if (!g) return;
    const { s, row, body } = g;
    if (body.role !== 'admin' && body.role !== 'member') return refuse(res, 400, 'bad-request', 'a role is admin or member');
    if (body.role === 'admin') {
      if (!joined(s, row)) return refuse(res, 409, 'not-joined', 'They haven\'t joined yet');
      if (linkOut(s, row.id)) return refuse(res, 409, 'link-outstanding', 'Revoke their link first');
    }
    if (roleOf(row) === body.role) return json(res, 200, { ok: true, rev: row.rev });
    const rev = row.rev + 1;
    const next = body.role === 'admin' ? { role: 'admin', level: 'full', rev } : { role: 'member', rev };
    store.save({ ...s, people: s.people.map((x) => (x.id === row.id ? { ...x, ...next } : x)) });
    log(body.role === 'admin' ? 'a person was made admin' : 'a person is no longer an admin');
    return json(res, 200, { ok: true, rev });
  };
  // Make owner: the owner (never the stand-in: its row is written at the next start) hands the box to
  // a joined person with no link out who holds a passkey, and stays on as a Full admin. One write.
  const transferRoute = async (req, res, who) => {
    const g = await peopleGuard(req, res, who, 'transfer');
    if (!g) return;
    const { s, person, row } = g;
    if (person.id === null) return refuse(res, 409, 'restart-first', 'Restart the box first, then try again');
    if (!joined(s, row)) return refuse(res, 409, 'not-joined', 'They haven\'t joined yet');
    if (linkOut(s, row.id)) return refuse(res, 409, 'link-outstanding', 'Revoke their link first');
    if (!hasPasskey(s, row)) return refuse(res, 409, 'no-passkey', 'They need a passkey first: the box\'s owner always has one');
    store.save(transferTo(s, person, row));
    log('the box was handed to another person; the old owner is an admin');
    return json(res, 200, { ok: true });
  };
  const PEOPLE_POSTS = { rename: renameRoute, revoke: revokeRoute, remove: removeRoute, level: levelRoute, role: roleRoute, transfer: transferRoute };

  // Start, guards in the spec's order. `who`: the request's session (sessionOf), for an add.
  const startFlow = async (req, type, purpose, body, who) => {
    const row = METHODS.get(type);
    if (!isObject(body)) return no(400, 'bad request');
    if (!PURPOSES.includes(purpose)) return no(400, 'unknown purpose');
    const s = store.load();
    let person = null;
    let restsOn = {};
    if (purpose === 'claim') {
      if (type !== 'passkey') return no(400, 'a box is claimed with a passkey');
      if (s.passkeys.length) return no(409, 'this box is already claimed');
      if (s.claimHash && !claimLive(s)) return no(403, CLAIM_EXPIRED);
      const want = unb64u(s.claimHash ?? '');
      if (!want || !sameBytes(sha256(typeof body.token === 'string' ? body.token : ''), want)) return no(403, 'that is not this box\'s claim token');
      person = ownerRow(s) ?? STAND_IN;
      restsOn = { claimHash: s.claimHash };
    } else if (purpose === 'sign-in') {
      if (!s.passkeys.length) return no(409, 'this box is not claimed yet');
    } else if (purpose === 'add') {
      if (!who) return no(401, 'sign in first');
      if (!fresh(who.session)) return no(403, NOT_FRESH);
      person = who.person;
      restsOn = { session: who.session.hash, person: person.id, role: person.role };
    } else {
      if (!s.passkeys.length) return no(409, 'this box is not claimed yet');
      const found = typeof body.token === 'string' ? inviteOf(s, b64u(sha256(body.token))) : null;
      if (!found) return no(403, INVITE_GONE);
      person = found.person;
      restsOn = { invite: found.inv.hash };
    }
    const nonce = crypto.randomBytes(32);
    const nonceHash = sha256(nonce);
    const state = purpose === 'sign-in' ? signInState(type, nonceHash) : b64u(crypto.randomBytes(32));
    let out;
    try { out = await row.start({ purpose, state, person, body }); } catch (e) { return no(400, said(e)); }
    // sign-in stores nothing, so a row that would keep something can't start one
    if (purpose === 'sign-in' && out?.keep !== undefined) return no(500, 'this sign-in method can\'t start a sign-in');
    if (purpose !== 'sign-in') putRecord(state, { type, purpose, expires: Date.now() + CHALLENGE, nonceHash, keep: out?.keep, ...restsOn });
    return { status: 200, body: { ...(isObject(out?.send) ? out.send : {}), state }, cookies: [flowCookie([...flowPairs(req), `${state}.${b64u(nonce)}`].slice(-4))] };
  };

  // Finish, guards in the spec's order. `purpose`: the body's (POST), or null (GET: the flow's own).
  // Everything before the type's finish is in memory; after it, one load, the re-checks and the
  // write, with no await between, so a reclaim, revoke or removal meanwhile wins.
  const finishFlow = async (req, type, purpose, input, method) => {
    const row = METHODS.get(type);
    if (!isObject(input)) return no(400, 'bad request');
    if (method === 'POST' && !PURPOSES.includes(purpose)) return no(400, 'unknown purpose');
    let state;
    try { state = row.stateOf ? row.stateOf(input) : input.state; } catch (e) { return no(400, said(e)); }
    if (typeof state !== 'string' || !/^[\w-]{16,128}$/.test(state)) return no(400, 'no sign-in state');
    // 3. this browser: before anything is spent, so a state someone learns burns nobody's flow
    const pairs = flowPairs(req);
    const nonces = pairs.filter((x) => pairState(x) === state).map((x) => sha256(unb64u(x.slice(x.lastIndexOf('.') + 1))));
    const signIn = isSignIn(state);
    const rec = signIn ? null : records.get(state) ?? null;
    const mine = signIn ? nonces.some((h) => signInOk(state, type, h)) : nonces.length > 0 && (!rec || nonces.some((h) => sameBytes(h, rec.nonceHash)));
    if (!mine) return no(403, OTHER_BROWSER);
    // 4. the flow: a record is spent here, once, whatever follows; a sign-in only when it succeeds
    const dropped = [flowCookie(pairs.filter((x) => pairState(x) !== state).slice(-4))];
    const after = rec ? dropped : [];
    if (rec) records.delete(state);
    const p = signIn ? 'sign-in' : rec?.purpose;
    if (signIn ? usedSignIns.has(state) || !signInLive(state) : !rec || !(rec.expires > Date.now()) || rec.type !== type) return no(403, START_AGAIN, after);
    if (method === 'POST' && purpose !== p) return no(403, START_AGAIN, after);
    // 5. an add finishes in the session that started it (by hash, before asking if it's live)
    if (p === 'add' && !sessionHashes(req).includes(rec.session)) return no(403, 'this challenge was issued to another session: finish it where you started it', after);
    // 6. the type's own finish
    const lookup = (key) => holderOf(store.load(), type, key)?.method.data ?? null;
    let out;
    try { out = await row.finish({ purpose: p, state, body: input, lookup, kept: rec?.keep }); } catch (e) { return no(400, said(e), after); }
    const key = out?.key;
    if (typeof key !== 'string' || !key || key.length > 512) return no(400, 'bad sign-in method', after);
    let data;
    try { data = JSON.parse(JSON.stringify(out.data ?? null)); } catch { return no(400, 'bad sign-in method', after); }
    // 7. what start rested on, against the state as it is now
    const s = store.load();
    const now = Date.now();
    const iso = new Date(now).toISOString();
    let person = null;
    if (p === 'claim') {
      if (s.passkeys.length) return no(409, 'this box is already claimed', after);
      if (!claimLive(s) || s.claimHash !== rec.claimHash) return no(403, CLAIM_EXPIRED, after);
    } else if (p === 'sign-in') {
      if (!s.passkeys.length) return no(409, 'this box is not claimed yet');
    } else if (p === 'add') {
      const held = stillHeld(s, { hash: rec.session });
      if (!held) return no(401, 'your session ended; sign in again', after);
      if (!fresh(held.session)) return no(403, NOT_FRESH, after);
      // a top-level session is whoever owns the box now, so the person is checked by id as well; an
      // add the stand-in owner started (no row yet) stays the owner's once the row is written
      if ((rec.person != null && held.person.id !== rec.person) || held.person.role !== rec.role) return no(409, 'your account changed since; start again', after);
      person = held.person;
    } else {
      const found = inviteOf(s, rec.invite);
      if (!found) return no(403, INVITE_GONE, after);
      person = found.person;
    }
    // 8. one write
    const holder = holderOf(s, type, key);
    if (p === 'sign-in') {
      // another finish of this state may have landed while this one's finish was awaited
      if (usedSignIns.has(state)) return no(403, START_AGAIN);
      if (!holder) return no(403, 'no one on this box signs in with that');
      const usedId = holder.top ? key : holder.method.id;
      const shown = ((s.people ?? []).find((x) => x.id === holder.person.id)?.notices ?? []).filter((n) => n?.kind === 'method-added' && !n.shown_at && n.method !== usedId);
      const people = s.people?.map((x) => (x.id !== holder.person.id ? x : { ...x, last_seen: iso, methods: holder.top ? x.methods : x.methods.map((m) => (m.id === holder.method.id ? { ...m, data, last_used: iso } : m)), ...(shown.length ? { notices: x.notices.map((n) => (shown.includes(n) ? { ...n, shown_at: iso } : n)) } : {}) }));
      // a top-level passkey takes back only its counter and last use, as today
      const used = { ...s, ...(holder.top ? { passkeys: s.passkeys.map((x) => (x.id === key ? { ...x, signCount: data?.signCount, usedAt: iso } : x)) } : {}), ...(people ? { people } : {}) };
      const { next, set } = sessionFor(used, holder.person, usedId);
      store.save(next);
      spendSignIn(state);
      return { status: 200, body: { ok: true, ...(shown.length ? { notices: shown.map(noticeOut) } : {}) }, cookies: [set, ...dropped] };
    }
    if (holder) return no(400, type === 'passkey' ? 'that passkey is already registered' : 'that sign-in method is already registered', after);
    const owner = p === 'claim' || isOwner(person);
    const base = owner ? withOwner(s, now) : s;
    const ownRow = owner ? ownerRow(base) : null;
    const count = ownMethods(base, owner ? ownRow ?? STAND_IN : person).filter((m) => m.type === type).length;
    // one line: a label is logged, and an invitee chooses it
    const label = String(row.describe({ key, data, body: input, count }) ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 60);
    const m = { id: newId('m-'), type, key, label, added_at: iso, last_used: p === 'invite' ? iso : null, data };
    // only the owner's passkey lands top-level, in today's shape
    const top = owner && type === 'passkey' ? methodToTop(m) : null;
    const rowId = owner ? ownRow?.id : person.id;
    const addTo = (st) => (top ? st : { ...st, people: st.people.map((x) => (x.id !== rowId ? x : { ...x, methods: [...x.methods, m], rev: x.rev + 1, ...(p === 'invite' ? { last_seen: iso } : {}) })) });
    if (p === 'claim') {
      const claimed = stamped(withOwner({ ...s, passkeys: [top], claimHash: null, claimExpires: null, sessions: [], peopleSessions: [] }, now));
      const { next, set } = sessionFor(claimed, ownerRow(claimed) ?? STAND_IN, top.id);
      store.save(next);
      log(`claimed with passkey "${top.name}"`);
      return { status: 200, body: { ok: true }, cookies: [set, ...dropped] };
    }
    if (p === 'add') {
      store.save(top ? stamped({ ...s, passkeys: [...s.passkeys, top] }) : addTo(base));
      log(type === 'passkey' ? `passkey "${label}" added` : `a ${type} sign-in method "${label}" added`);
      return { status: 200, body: { ok: true }, cookies: dropped };
    }
    // an invite: the method to its person, the invite gone in the same write, and a session
    const had = (person.methods ?? []).length > 0;
    const added = addTo(s);
    const noted = had ? { ...added, people: added.people.map((x) => (x.id !== person.id ? x : { ...x, notices: withNotice(x, { kind: 'method-added', at: iso, type, label, method: m.id, shown_at: null }) })) } : added;
    const { next, set } = sessionFor({ ...noted, invites: (s.invites ?? []).filter((x) => x.hash !== rec.invite) }, person, m.id);
    store.save(next);
    log(`an invite added a ${type} sign-in method "${label}"`);
    return { status: 200, body: { ok: true }, cookies: [set, ...dropped] };
  };
  // A flow's answer: JSON, the session cookie (if any) first and the flow cookie second.
  const flowAnswer = (res, out) => json(res, out.status, out.body, out.cookies.length ? { 'set-cookie': out.cookies } : undefined);
  // Today's routes never refused a body that wasn't an object; they read it as empty.
  const asBody = (b) => (isObject(b) ? b : {});

  // --- requests that look local to the kit, and its headers mapped back to the public names ---
  const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'referer', 'forwarded', 'x-real-ip', 'true-client-ip', 'cf-connecting-ip']);
  // Who a request is and what it may see are the gateway's to say (kit-252): the browser's copies of
  // x-devteam-person and x-devteam-level never pass, on any route.
  const upstreamHeaders = (req, port, publicOrigin, { loopbackHost = '127.0.0.1' } = {}) => {
    const h = {};
    // a name with a space before its colon is no header of ours, and older Nodes let one in
    for (const [k, v] of Object.entries(req.headers)) if (k === k.trim() && !HOP.has(k) && !k.startsWith('x-forwarded-') && !k.startsWith('fly-') && !k.startsWith('rndr-') && !k.startsWith('render-') && k !== 'x-devteam-person' && k !== 'x-devteam-level') h[k] = v;
    h.host = `${loopbackHost}:${port}`;
    if (req.headers.origin === publicOrigin) h.origin = `http://${loopbackHost}:${port}`;
    const rest = String(req.headers.cookie ?? '').split(';').map((p) => p.trim()).filter((p) => p && p.split('=')[0] !== COOKIE).join('; ');
    if (rest) h.cookie = rest; else delete h.cookie;
    return h;
  };
  // The person a session is, as x-devteam-person (presence@1 §4) for a dashboard or the hub to put on
  // the owner's lines it writes for them (kit-252): null for the owner's stand-in (a state from before
  // people: no person, the owner as ever), false for a row whose id or name the header can't carry
  // (only a hand-edited state makes one), never a throw. A lone surrogate is U+FFFD (encodeURIComponent
  // throws on one), and the name is cut, by whole characters, to 80 bytes of JSON without its quotes.
  // Attribution, not authority: it is not signed, and the kit gives it no say in who may do what.
  const PERSON_ID = /^[A-Za-z0-9._:@/-]{1,64}$/;
  const personHeader = (person) => {
    if (!person || person.id === null) return null;
    if (typeof person.id !== 'string' || !PERSON_ID.test(person.id) || typeof person.name !== 'string') return false;
    const whole = person.name.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
    let name = '';
    let n = 0;
    for (const ch of whole) { const b = Buffer.byteLength(JSON.stringify(ch)) - 2; if (n + b > 80) break; name += ch; n += b; }
    return name ? `${person.id};name=${encodeURIComponent(name)}` : false;
  };
  const LOOP = /http:\/\/(?:127\.0\.0\.1|localhost):(\d+)/g;
  // A block port to its project's host, as the list last said; a port no one name holds stays as sent.
  const mapLoop = (s) => s.replace(LOOP, (all, p) => (Number(p) === HUB_PORT ? PUB : BLOCK.includes(Number(p)) ? portHost.get(Number(p)) ?? all : all));
  // A preview's own headers: only this link's port, http and ws forms, to its own origin.
  const PREVIEW_LOOP = /\b(http|ws):\/\/(?:127\.0\.0\.1|localhost):(\d+)/g;
  const mapPreview = (s, port, own) => s.replace(PREVIEW_LOOP, (all, scheme, p) => (Number(p) !== port ? all : scheme === 'ws' ? own.replace(/^http/, 'ws') : own));
  // lensOf: for a preview's page framed from its own origin, which is how its lens holds it (spec §7),
  // the instance that lists the preview. For that load alone the app's own framing headers give way,
  // to the lens, the hub and that one instance's dashboard: no other instance's page may hold the app.
  const downstreamHeaders = (h, cap, own, previewPort = null, lensOf = null) => {
    const out = {};
    for (const [k, v] of Object.entries(h)) {
      // x-devteam-public is the gateway's to say (what the box serves); an upstream's copy never passes
      if (['connection', 'keep-alive', 'transfer-encoding', 'strict-transport-security', 'clear-site-data', 'x-devteam-public', 'x-devteam-previews'].includes(k)) continue;
      // nothing behind the gateway sets a cookie for the box's names (the kit sets none at all)
      if (k === 'set-cookie') { const keep = [].concat(v).filter((c) => !/;\s*domain\s*=/i.test(c) && !new RegExp(`^\\s*${COOKIE}\\s*=`).test(c)); if (keep.length) out[k] = keep; continue; }
      out[k] = k !== 'content-security-policy' && k !== 'location' ? v : previewPort ? mapPreview(String(v), previewPort, own) : mapLoop(String(v));
    }
    // an artifact under its capability: its policy stays under it too
    if (cap && out['content-security-policy']) out['content-security-policy'] = out['content-security-policy'].split(`${own}/artifact/`).join(`${own}${cap}/artifact/`);
    // a port off the block is no instance's: then nothing gives way
    if (previewPort && BLOCK.includes(lensOf)) {
      const ancestors = ["'self'", PUB, portHost.get(lensOf)].filter(Boolean).join(' ');
      delete out['x-frame-options'];
      const csp = out['content-security-policy'] ? String(out['content-security-policy']) : '';
      if (csp.search(FRAME_ANCESTORS) >= 0) out['content-security-policy'] = replaceFrameAncestors(csp, ancestors);
      // The app said nothing of frames by policy: by X-Frame-Options alone, or not at all (a dev
      // server's default). Either way a policy of its own keeps every other instance's page out.
      else out['content-security-policy'] = `${csp ? `${csp}, ` : ''}frame-ancestors ${ancestors}`;
    }
    return { ...out, ...hsts };
  };
  // viewer: null, or for the viewer's page whether the wrapper's grant holds (viewerAncestors)
  // person: the session's x-devteam-person (personHeader), on a dashboard's request alone
  // level: the session's, sent beside the person (kit-250), never the browser's
  const proxy = (req, res, { port, path: p, publicOrigin, cap, extra = null, viewer = null, person = null, level = 'full' }) => {
    const up = http.request({ host: '127.0.0.1', port, method: req.method, path: p, headers: { ...upstreamHeaders(req, port, publicOrigin), ...(person ? { 'x-devteam-person': person, 'x-devteam-level': level } : {}) } }, (ur) => {
      // Never kept: a page an agent served once on this name must not come back from the browser's
      // cache after a real dashboard has taken its port.
      const head = downstreamHeaders(ur.headers, cap, publicOrigin);
      if (viewer !== null && head['content-security-policy']) head['content-security-policy'] = viewerAncestors(String(head['content-security-policy']), viewer.granted);
      res.writeHead(ur.statusCode, { ...head, 'cache-control': 'no-store', ...(extra ?? {}) });
      // an upstream cut off mid-body cuts the browser's response too, rather than leaving it open
      pipeline(ur, res, () => {});
    });
    // and a browser that goes away stops the kit's work for it
    res.on('close', () => { if (!res.writableFinished) up.destroy(); });
    up.on('error', () => {
      if (res.headersSent) return res.destroy();
      send(res, 502, 'text/plain; charset=utf-8', `Nothing answers on instance ${port}.`);
    });
    pipeline(req, up, () => {});
  };
  // The owner's answer to what an instance's supervisor's terminal asks (paneSignature), and the
  // owner's Save on its Settings page (ownerSettingSignature): the two dashboard requests the gateway
  // signs, after the session check, since on a box every agent can send that dashboard any header.
  // The body is read whole (it is small) so its hash is what is signed; whatever signature headers
  // the browser sent are replaced.
  const SIGNED_POSTS = { '/api/pane-answer': paneSignature, '/api/owner-setting': ownerSettingSignature };
  const signedPost = (req, res, port, publicOrigin, route, signer, person = null, level = 'full', { cap = 20000, cut = Infinity, leave = false, over = (extra) => send(res, 400, 'application/json', JSON.stringify({ error: 'missing or invalid fields' }), extra) } = {}) => {
    const chunks = [];
    let size = 0;
    let answered = false;
    req.on('data', (c) => {
      if (answered) return;
      size += c.length;
      if (size <= cap) chunks.push(c); else chunks.length = 0;
      if (size > cut) { answered = true; over({ connection: 'close' }); }
    });
    req.on('error', () => res.destroy());
    req.on('end', () => {
      if (answered) return;
      if (size > cap) return over();
      const data = Buffer.concat(chunks);
      const up = http.request({ host: '127.0.0.1', port, method: 'POST', path: route, headers: { ...upstreamHeaders(req, port, publicOrigin), ...(person ? { 'x-devteam-person': person, 'x-devteam-level': level } : {}), 'content-length': data.length, ...signer(threadKey(store).privateKey, port, data) } }, (ur) => {
        res.writeHead(ur.statusCode, { ...downstreamHeaders(ur.headers, undefined, publicOrigin), 'cache-control': 'no-store' });
        pipeline(ur, res, () => {});
      });
      // a terminal post: a browser that goes away stops the kit's work for it, as proxy does
      if (leave) res.on('close', () => { if (!res.writableFinished) up.destroy(); });
      up.on('error', () => { if (res.headersSent) return res.destroy(); send(res, 502, 'text/plain; charset=utf-8', `Nothing answers on instance ${port}.`); });
      up.end(data);
    });
  };
  // The terminal's two posts (terminal@1 §3): keys, for the supervisor or the shell, and the shell's
  // open, each signed under its own domain with the path's own which. Matched on the path as the
  // dashboard routes it (url.pathname: dot segments resolved, %2e among them, nothing else decoded), so what is signed is
  // what it routes; any other POST under /api/term/ goes on unsigned and the dashboard refuses it,
  // and its reads (token, screen, history) go on unsigned as any GET does.
  // Their bodies are capped at 100 KB, as the dashboard caps them: over it is a 413, with nothing
  // forwarded, and a body more than four times over is cut off once the 413 is sent. A View session
  // never gets here: viewRefusal's rule 0 answers it first.
  const TERM_CAP = 102400;
  const termPost = (p) => {
    const m = /^\/api\/term\/(supervisor|shell)\/keys$/.exec(p);
    if (m) return (key, port, body) => termSignature(key, 'devteam-term-keys-v1', port, m[1], body);
    return p === '/api/term/shell/open' ? (key, port, body) => termSignature(key, 'devteam-term-open-v1', port, 'shell', body) : null;
  };
  const termCap = (res) => ({ cap: TERM_CAP, cut: 4 * TERM_CAP, leave: true, over: (extra) => send(res, 413, 'application/json', JSON.stringify({ error: 'that is too large to send' }), extra) });
  // Where a preview's server is listening: a dev server bound to localhost may sit on either family.
  const previewHost = (port) => new Promise((resolve) => {
    const next = (hosts) => {
      if (!hosts.length) return resolve(null);
      const c = net.connect({ port, host: hosts[0], timeout: 300 });
      c.once('connect', () => { c.destroy(); resolve(hosts[0]); });
      c.once('timeout', () => { c.destroy(); next(hosts.slice(1)); });
      c.once('error', () => next(hosts.slice(1)));
    };
    next(['127.0.0.1', '::1']);
  });
  // Never HTML to a fetch or an asset: a dev client must see a failure, not a page it takes for its own.
  const previewUnavailable = (req, res, html) => (navigating(req)
    ? send(res, 503, 'text/html; charset=utf-8', html(), { 'content-security-policy': PAGE_CSP, 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' })
    : send(res, 503, 'text/plain; charset=utf-8', 'this preview is not available right now', { 'retry-after': '5' }));
  // The server is tried on 127.0.0.1, then ::1 when that's refused. The body starts only once a
  // connection is up, so a refused attempt has taken none of it and the retry sends all of it.
  // Only a link the map holds unambiguously gets here (servePreview), with the one instance listing it.
  const proxyPreview = (req, res, name, link, own) => {
    let current = null;
    res.on('close', () => { if (!res.writableFinished) current?.destroy(); });
    const attempt = (hosts) => {
      let connected = false;
      // agent: false, a fresh connection each time: a kept-alive one to a server since stopped would read as a 502, not as down
      const up = http.request({ host: hosts[0], agent: false, port: link.port, method: req.method, path: req.url, headers: upstreamHeaders(req, link.port, own, { loopbackHost: 'localhost' }) }, (ur) => {
        res.writeHead(ur.statusCode, { ...downstreamHeaders(ur.headers, null, own, link.port, req.headers['sec-fetch-dest'] === 'iframe' && req.headers['sec-fetch-site'] === 'same-origin' ? link.instance : null), 'cache-control': 'no-store' });
        pipeline(ur, res, () => {});
      });
      current = up;
      const relay = () => { connected = true; pipeline(req, up, () => {}); };
      up.on('socket', (s) => { if (s.connecting) s.once('connect', relay); else relay(); });
      up.on('error', (e) => {
        if (!connected && e.code === 'ECONNREFUSED' && hosts.length > 1) return attempt(hosts.slice(1));
        if (res.headersSent) return res.destroy();
        if (res.destroyed) return undefined;
        if (!connected) return previewUnavailable(req, res, () => PAGES.previewDown(name, link));
        return send(res, 502, 'text/plain; charset=utf-8', 'that preview\'s server stopped answering');
      });
    };
    attempt(['127.0.0.1', '::1']);
  };
  // After the session check, and no sooner: a name not in the map asks the hub once more, once.
  const servePreview = async (req, res, name, own) => {
    let link = previews.get(name);
    if (!link) { await refreshPreviews(); link = previews.get(name); }
    if (!link) return previewUnavailable(req, res, () => PAGES.previewUnknown(name, [...previews.keys()].sort(), previewOrigin));
    if (link.ambiguous) return previewUnavailable(req, res, () => PAGES.previewAmbiguous(name, link.ambiguous));
    return proxyPreview(req, res, name, link, own);
  };
  // The hub's list is the one thing the box's name takes from behind it, and only as data: whatever
  // holds the port, the page reads JSON and shows it as text. No hub yet is an empty list.
  // Each read is a connection of its own (agent: false): since Node 19 the global agent keeps
  // sockets alive, and one the hub closed (a restart, its idle timeout) failed the next read, which
  // emptied the list until the poll after it.
  const hubList = () => new Promise((settle) => {
    let deadline = null;
    const resolve = (v) => { clearTimeout(deadline); settle(v); };
    const none = () => resolve(null);
    const up = http.get({ host: '127.0.0.1', port: HUB_PORT, agent: false, path: '/instances.json', timeout: 10000, headers: { host: `127.0.0.1:${HUB_PORT}`, 'sec-fetch-site': 'same-origin' } }, (ur) => {
      if (ur.statusCode !== 200) { ur.resume(); return none(); }
      const chunks = [];
      let size = 0;
      ur.on('data', (c) => { size += c.length; if (size > 1024 * 1024) { none(); up.destroy(); } else chunks.push(c); });
      ur.on('end', () => resolve(Buffer.concat(chunks)));
      ur.on('error', none);
      ur.on('close', none);
    });
    up.on('timeout', () => up.destroy());
    up.on('error', none);
    // the whole answer, not only each pause in it: one sent a byte at a time would hold the poller
    deadline = setTimeout(() => { up.destroy(); none(); }, opts.hubDeadlineMs ?? 15000);
  });
  // No hub answering (nothing on the port, or an answer no list could be) is the empty list with
  // down: true, which only this fallback ever sets: the page says the hub isn't answering.
  const instances = async (req, res) => send(res, 200, 'application/json', (await hubList()) ?? JSON.stringify({ hub: 1, instances: [], down: true }));
  // The machine's memory readings (machine-memory@1, the hub's /memory.json), for the Overview's
  // memory line, after the session check. Only since and after go to the hub, each once and checked
  // here first, in the path the gateway builds itself: never thin, which the hub takes only from
  // loopback (as the gateway is) and which would unthin 24 hours. The hub thins long windows; a
  // body past MEMORY_CAP anyway (8 days on a busy box) is refused whole, never cut.
  const MEMORY_CAP = 2 * 1024 * 1024;
  const MEMORY_DOWN = { error: 'the hub isn\'t answering' };
  const memoryParams = (search) => {
    const keys = [...search.keys()];
    const other = keys.find((k) => k !== 'since' && k !== 'after');
    if (other !== undefined) return { error: 'only since and after are parameters of /memory.json' };
    if (new Set(keys).size !== keys.length) return { error: 'give since and after once each' };
    const since = search.get('since'), after = search.get('after');
    const q = [];
    if (since !== null) {
      const m = /^(\d{1,3})([hd])$/.exec(since);
      const hours = m ? Number(m[1]) * (m[2] === 'd' ? 24 : 1) : 0;
      if (!m || hours < 1 || hours > 8 * 24) return { error: 'since should be hours or days, 1 to 3 digits then h or d, up to 8 days (24h, 8d)' };
      q.push(`since=${since}`);
    }
    if (after !== null) {
      const t = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(after) ? Date.parse(after) : NaN;
      if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 19) !== after.slice(0, 19)) return { error: 'after should be a reading\'s at, YYYY-MM-DDTHH:MM:SSZ in UTC (milliseconds may follow the seconds)' };
      q.push(`after=${encodeURIComponent(after)}`);
    }
    return { path: `/memory.json${q.length ? `?${q.join('&')}` : ''}` };
  };
  // { status, body } as the hub answered, { over: true } past the cap, or null (nothing answering,
  // a broken answer, or none within the deadline).
  const memoryAsk = (p) => new Promise((settle) => {
    let deadline = null;
    let settled = false;
    const resolve = (v) => { if (settled) return; settled = true; clearTimeout(deadline); settle(v); };
    const up = http.get({ host: '127.0.0.1', port: HUB_PORT, path: p, timeout: 10000, headers: { host: `127.0.0.1:${HUB_PORT}`, 'sec-fetch-site': 'same-origin' } }, (ur) => {
      const chunks = [];
      let size = 0;
      ur.on('data', (c) => { size += c.length; if (size > MEMORY_CAP) { resolve({ over: true }); up.destroy(); } else chunks.push(c); });
      ur.on('end', () => resolve({ status: ur.statusCode, body: Buffer.concat(chunks) }));
      ur.on('error', () => resolve(null));
      ur.on('close', () => resolve(null));
    });
    up.on('timeout', () => up.destroy());
    up.on('error', () => resolve(null));
    deadline = setTimeout(() => { up.destroy(); resolve(null); }, opts.hubDeadlineMs ?? 15000);
  });
  // The hub's 200 goes back byte for byte when it is a JSON object; its 400 (an after over 6 hours
  // old, which the Overview reads as "ask for the day again") and 500 go back as their one line of
  // error. Anything else is the route's own 502, never another route's body.
  const memory = async (req, res, search) => {
    const q = memoryParams(search);
    if (q.error) return json(res, 400, { error: q.error });
    const r = await memoryAsk(q.path);
    if (r?.over) {
      log(`/memory.json: the hub's answer to ${q.path} was over 2 MB; refused`);
      return json(res, 502, { error: 'the hub\'s readings for that window are over 2 MB: ask for a shorter one' });
    }
    let body = null;
    try { body = r ? JSON.parse(r.body.toString('utf8')) : null; } catch {}
    const object = body !== null && typeof body === 'object' && !Array.isArray(body);
    if (object && r.status === 200) return send(res, 200, 'application/json', r.body);
    if (object && [400, 500].includes(r.status) && typeof body.error === 'string') return json(res, r.status, { error: body.error.slice(0, 600) });
    return json(res, 502, MEMORY_DOWN);
  };
  // The owner's threads with the box's operator (the Overview's dock): the hub keeps them and types
  // each owner turn into the operator's pane, so the box's name passes these few requests to it, after
  // the session check, as the hub's own page would send them on the machine. What comes back is JSON
  // the page shows as text, whatever holds the port; whatever holds it also reads what the owner
  // wrote there, as anything running as the box's user can read the threads' file.
  // Each press is signed (hubSignature), with a key kept with the passkeys: every agent runs as the
  // hub's own Unix user and can send the hub any header, so on a box the hub takes a press only
  // with this signature, checked against the public half the boot gave root (gateway.mjs thread-key).
  const HUB_POSTS = ['thread-new', 'thread-say', 'thread-close', 'thread-reopen', 'start'];
  const hubAsk = (method, p, body = null, person = null) => new Promise((settle) => {
    let deadline = null;
    const resolve = (v) => { clearTimeout(deadline); settle(v); };
    const none = () => resolve(null);
    const data = body === null ? null : Buffer.from(JSON.stringify(body));
    const up = http.request({ host: '127.0.0.1', port: HUB_PORT, path: p, method, timeout: 150000, headers: { host: `127.0.0.1:${HUB_PORT}`, 'sec-fetch-site': 'same-origin', ...(person ? { 'x-devteam-person': person } : {}), ...(data ? { origin: `http://127.0.0.1:${HUB_PORT}`, 'content-type': 'application/json', 'content-length': data.length, ...hubSignature(threadKey(store).privateKey, p, data) } : {}) } }, (ur) => {
      const chunks = [];
      let size = 0;
      ur.on('data', (c) => { size += c.length; if (size > 4 * 1024 * 1024) { none(); up.destroy(); } else chunks.push(c); });
      ur.on('end', () => { try { resolve({ status: ur.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch { resolve({ status: ur.statusCode, json: null }); } });
      ur.on('error', none);
      ur.on('close', none);
    });
    up.on('timeout', () => up.destroy());
    up.on('error', none);
    // a read waits no longer than the list does; a press waits out the owner's command behind it
    deadline = setTimeout(() => { up.destroy(); none(); }, data ? 160000 : opts.hubDeadlineMs ?? 15000);
    up.end(data ?? undefined);
  });
  // An answer the hub gave as JSON goes back as it is: 200, or a refusal with its reason (400 for
  // what the press asked, 403 for a press the hub wouldn't take: its signature, its key, a
  // replay). Only the status and the one line of error go back from a refusal. Anything else (no
  // hub, a hub on a kit from before these threads, something else on the port) is a 502.
  const operatorThreads = async (req, res, action, person = null) => {
    let body = null;
    if (action) { body = await readJson(req, 20000); if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'missing or invalid fields' }); body = redactClaimLinks(body); }
    const r = await hubAsk(action ? 'POST' : 'GET', action ? `/operator/${action}` : '/operator/threads', body, person);
    const answered = r && r.json && typeof r.json === 'object' && !Array.isArray(r.json);
    if (answered && r.status === 200) return json(res, 200, r.json);
    if (answered && [400, 403].includes(r.status) && typeof r.json.error === 'string') return json(res, r.status, { error: r.json.error.slice(0, 600) });
    return json(res, 502, { error: r ? 'the hub on this box is served by a kit from before threads with the operator' : 'the hub on this box is not answering' });
  };

  // --- previews: the name-to-port map, from the same list ---------------------------------------
  // Nothing is stored: the map is whatever the list said last, and a hub that doesn't answer lists
  // nothing, so a stale name can't keep pointing at a port. A miss after the session check asks the
  // hub once more, with every waiter sharing one read, so no anonymous request can make it poll.
  const ownPort = opts.port ?? null;
  let previews = new Map();
  let browserPorts = new Set();
  // Each name the list gives to the ports that hold it (with each one's root and whether its kit has
  // viewers, as the hub's list last said, every poll, PUSH_POLL_MS: the owner wrapper's choice is a
  // lookup in it, so no visit asks anything, spec §8); a port's origin only for a name one port holds;
  // whether the last read gave a list; and the hub page's copy of the hosts, which a failed read leaves.
  let projects = new Map();
  let portHost = new Map();
  let hubFrames = [];
  let listRead = false;
  let listed = new Map();
  const takePreviews = (body) => {
    let list = null;
    try { list = JSON.parse(body).instances; } catch {}
    const ok = Array.isArray(list) ? list : [];
    const byPort = listedByPort(ok, BLOCK);
    const names = new Map();
    for (const [port, x] of byPort) if (typeof x.name === 'string' && HOST_LABEL.test(x.name) && !RESERVED_LABELS.includes(x.name)) names.set(x.name, [...(names.get(x.name) ?? []), { port, root: x.root, viewer: x.viewer === 1 }]);
    // every name the list gives, host or not: an older page may be stored under one that can't be
    listed = new Map();
    for (const x of byPort.values()) if (typeof x.name === 'string') listed.set(x.name, (listed.get(x.name) ?? 0) + 1);
    projects = names;
    portHost = new Map([...names].filter(([, c]) => c.length === 1).map(([n, c]) => [c[0].port, projectOrigin(n)]));
    previews = previewLinks(ok, BLOCK, ownPort, ttydPort);
    browserPorts = new Set(ok.flatMap((x) => (Array.isArray(x?.previews) ? x.previews : [])).filter((p) => p?.label === BROWSER_VIEW && Number.isInteger(p.port)).map((p) => p.port));
    // a preview whose generated name is a project's is not served under it
    for (const n of names.keys()) previews.delete(n);
    listRead = Array.isArray(list);
    if (listRead) hubFrames = [...portHost.values()];
  };
  // At most ms of waiting on the shared read; the read itself goes on and still updates the maps.
  const refreshWithin = (ms) => new Promise((done) => { const t = setTimeout(done, ms); refreshPreviews().catch(() => {}).finally(() => { clearTimeout(t); done(); }); });
  // One listed project, else a name two share (no dashboard), else a listed preview.
  const resolveLabel = (l) => {
    const c = projects.get(l);
    if (c?.length === 1) return { port: c[0].port };
    if (c) return { shared: true };
    return previews.has(l) ? { preview: l } : null;
  };
  // A page is a published one when the gateway's store holds it under this name, by its first path
  // segment as sent (raw, before any decoding). Never a reserved segment: those are the dashboard's
  // (and the gateway's own /upload), whatever an older store holds under them. The store alone, so
  // it answers alike signed in or out, with the hub down. Throws only if the store can't be read.
  const publishedBy = (label, seg) => {
    if (!seg || RESERVED_SEGMENTS.includes(seg) || !LINK_ID.test(seg)) return false;
    const pub = store.load().public ?? {};
    return Object.hasOwn(pub, label) && Object.hasOwn(pub[label].artifacts ?? {}, seg);
  };
  // Whether a raw path is /<slug>/… for a slug some other project published: on this host that is
  // a page's address under the wrong name, so the gateway answers 404 rather than the dashboard.
  // /<slug> with no slash and every reserved segment stay the dashboard's (or the gateway's).
  const anotherProjects = (label, raw) => {
    const m = /^\/([^/]+)\//.exec(raw);
    if (!m || RESERVED_SEGMENTS.includes(m[1]) || !LINK_ID.test(m[1])) return false;
    return Object.entries(store.load().public ?? {}).some(([n, x]) => n !== label && Object.hasOwn(x?.artifacts ?? {}, m[1]));
  };
  // Every read that feeds the maps is numbered when it begins, so a slow older answer never undoes
  // a newer one: an answer is applied only if no read begun after it has been applied already.
  let readSeq = 0;
  let appliedSeq = 0;
  const readList = () => {
    const seq = ++readSeq;
    return hubList().then((body) => { if (seq > appliedSeq) { appliedSeq = seq; takePreviews(body); } return body; });
  };
  let previewRefresh = null;
  const refreshPreviews = () => (previewRefresh ??= readList().finally(() => { previewRefresh = null; }));
  // The projects of a list read that began after this call and returned within ms, or null (no list
  // in time, or none the hub could give). A read already under way may hold an older answer, so it
  // is waited out, not counted. What Publish takes as proof that a name is one project's.
  const freshList = (ms) => new Promise((done) => {
    const t = setTimeout(() => done(null), ms);
    Promise.resolve(previewRefresh).catch(() => {}).then(() => refreshPreviews()).then(() => (listRead ? projects : null), () => null).then((v) => { clearTimeout(t); done(v); });
  });
  const sharedWhy = (name, from = projects) => (from.get(name)?.length > 1 ? `two listed projects share the name ${name}, so the box can't tell which one you mean: rename one (settings.md's project)` : null);
  // Whether two listed instances give this name, whether or not it can be a host: what Unpublish asks
  // (a-20261122-032256363), as of the newest list applied, which is at least as new as any proof.
  const listedShared = (name) => (listed.get(name) ?? 0) > 1;
  // Why a page of this project can't be published now: no fresh list to prove the name is one
  // project's, or a name two share, by that list or the live one.
  const publishBlocked = (name, proved) => (!proved ? `the hub's list can't be read, so the box can't check that only one project is named ${name}: start the hub and try again` : sharedWhy(name, proved) || sharedWhy(name));
  // The port a project's name stands for, as the list says after at most a second's re-read.
  const projectPort = async (name) => {
    await refreshWithin(1000);
    const c = projects.get(name) ?? [];
    return c.length > 1 ? { refused: sharedWhy(name) } : { port: c[0]?.port ?? null };
  };

  // --- notifications: the gateway reads the hub's list itself, so they need no page open ----------
  // The signing key sits with the passkeys, where no agent can read it. Made the first time it's asked for.
  const vapid = () => {
    const now = store.load();
    if (now.vapid) return now.vapid;
    const jwk = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
    const made = { jwk, publicKey: b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)])) };
    store.save({ ...now, vapid: made });
    return made;
  };
  const pushFetch = opts.pushFetch ?? fetch;
  const sendPush = async (sub, message) => {
    const { jwk, publicKey } = vapid();
    const r = await pushFetch(sub.endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { authorization: `vapid t=${vapidToken(jwk, new URL(sub.endpoint).origin, PUB)}, k=${publicKey}`, 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '86400', urgency: 'high' },
      body: encryptPush(sub, Buffer.from(JSON.stringify(message))),
    });
    return r.status;
  };
  // Counts are kept on the disk, so a restart, when every dashboard comes back with its Inbox as it
  // was, is not news. Only a read that worked counts: a hub that's down changes nothing.
  let polling = false;
  const lastSent = new Map();
  const pollPush = async () => {
    if (polling) return;
    polling = true;
    try {
      const body = await readList();
      let list = null;
      try { list = JSON.parse(body).instances; } catch {}
      if (!Array.isArray(list)) return;
      const before = store.load();
      const now = Date.now();
      for (const [r, t] of lastSent) if (now - t >= PUSH_REST_MS) lastSent.delete(r);
      const { seen, messages: inboxMessages, roots } = inboxNews(before.pushSeen ?? {}, list, BLOCK, new Set(lastSent.keys()));
      const alerts = alertNews(before.pushAlerts ?? {}, list, BLOCK, new Set(lastSent.keys()));
      const messages = [...inboxMessages, ...alerts.messages];
      const subs = everySub(before);
      // a root rests after news to anyone's devices, not only the owner's
      if (subs.length) for (const r of [...roots, ...alerts.keys]) lastSent.set(r, now);
      if (JSON.stringify(seen) !== JSON.stringify(before.pushSeen ?? {}) || JSON.stringify(alerts.seen) !== JSON.stringify(before.pushAlerts ?? {})) store.save({ ...before, pushSeen: seen, pushAlerts: alerts.seen });
      const dead = new Set();
      const jobs = subs.flatMap((sub) => messages.map((message) => ({ sub, message })));
      const worker = async () => {
        for (let job = jobs.shift(); job; job = jobs.shift()) {
          try {
            const status = await sendPush(job.sub, job.message);
            // the browser dropped it (uninstalled, or notifications turned off)
            if (status === 404 || status === 410) dead.add(job.sub.endpoint);
            else if (status >= 300) log(`a push to ${new URL(job.sub.endpoint).host} was refused (${status})`);
          } catch (e) { log(`a push to ${new URL(job.sub.endpoint).host} failed: ${e.message}`); }
        }
      };
      await Promise.all(Array.from({ length: PUSH_SENDS }, worker));
      // whoever's list each is in, all in one write
      if (dead.size) store.save(keepSubs(store.load(), (x) => !dead.has(x.endpoint)));
    } finally { polling = false; }
  };

  const navigating = (req) => req.method === 'GET' && (req.headers['sec-fetch-mode'] === 'navigate' || (!req.headers['sec-fetch-mode'] && String(req.headers.accept ?? '').includes('text/html')));
  // View only (kit-250): a View session reads and changes nothing. One check, run once the name is
  // resolved and before any route or body; the sockets refuse View on their own (upgrade). null, or
  // the 403's type and body. project: the name is a dashboard's (not a preview's); p: the pathname.
  const VIEW_ANY = 'View only: you can look at everything here, but not change anything.';
  const VIEW_TERM = 'View only: there is no terminal for view-only people.';
  // Is this a dashboard's terminal route, as terminal@1 §3 reads a path (parsed as a URL,
  // percent-decoded, dot segments resolved, repeated slashes folded)? Readings differ on where a
  // decoded / or . counts, so every plausible one is taken and any that lands under /api/term/ is
  // refused: refusing a View session too much costs nothing, too little reaches the terminal.
  const dots = (d) => {
    const out = [];
    const segs = d.replace(/\/+/g, '/').split('/').slice(1);
    segs.forEach((seg, i) => {
      if (seg === '..') out.pop();
      else if (seg !== '.') out.push(seg);
      if ((seg === '.' || seg === '..') && i === segs.length - 1) out.push('');
    });
    return `/${out.join('/')}`;
  };
  const decoded = (x) => { try { return decodeURIComponent(x); } catch { return x; } };
  const isTermRoute = (raw) => {
    let parsed = raw;
    try { parsed = new URL(raw.replace(/^\/+/, '/'), 'http://x').pathname; } catch {}
    // the raw path resolved first (as the dashboard parses it), then decoded; decoded first; neither
    return [dots(decoded(parsed)), dots(decoded(raw)), dots(raw), dots(parsed)].some((p) => p.startsWith('/api/term/'));
  };
  const VIEW_EXEMPT = (p, method) => (method === 'POST' && p === '/auth/logout') || p.startsWith('/auth/method/') || p === '/auth/passkeys' || p.startsWith('/auth/passkeys/');
  const viewRefusal = (req, person, { isBox, isTerm, project, p }) => {
    if (person?.level !== 'view') return null;
    // 0: a dashboard's terminal routes answer as the dashboard's own View deny does (terminal@1 §4)
    if (project && isTermRoute(req.url.split('?')[0])) return { type: 'json', body: '{"why":"view"}' };
    const no = (sentence) => (navigating(req) ? { type: 'text', body: sentence } : { type: 'json', body: JSON.stringify({ error: sentence, code: 'view-only' }) });
    if (isTerm) return no(VIEW_TERM);
    if (isBox && (p === '/public' || p.startsWith('/public/'))) return no(VIEW_ANY);
    if (req.method === 'GET' || req.method === 'HEAD') return null;
    if (isBox && VIEW_EXEMPT(p, req.method)) return null;
    return no(VIEW_ANY);
  };
  // The cookie is SameSite=None, so a page elsewhere (another site, or another name of the box)
  // could make the browser send it with an <img> or <script>, or navigate a frame to the API. Such
  // a request is refused, but for a link to a page and for what a sandboxed review page loads (its
  // opaque origin makes those cross-site too): the kit's two helpers and a committed image. An
  // artifact's files don't need this: they load under a capability in the path (below).
  const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|ico)$/i;
  const PREVIEW_FRAMED = ['iframe', 'frame', 'object', 'embed', 'fencedframe'];
  const CAP_LINK = /^\/c\/(\d+)\.([\w-]+)\.([\w-]+)(\/artifact\/.*)$/;
  // An artifact navigating its own frame (a link, location.href, a reload, a meta refresh) arrives as
  // a cross-site iframe request, since its sandbox has no allow-same-origin, with its capability as the
  // only credential. (A nested frame never gets here: the kit's CSP blocks it.) So an exact capability
  // path answers to its own check instead of the frame refusal. Judged on the
  // raw path: anything a server could decode or normalise into another path keeps the refusal.
  // Any escape at all, a backslash, or a doubled slash.
  const CAP_NOT_EXACT = /%|\\|\/\//;
  // The one exception: the kit's link to a draft on a fetched branch encodes the branch into one
  // segment (/artifact/origin/ticket%2Fkit-1/<slug>/...). That segment may hold %2F and no other
  // escape: with %2F decoded it must be a branch the kit accepts, whose characters hold no %. The
  // path is forwarded unchanged, so the kit decodes this segment to this branch.
  const capLinkExact = (raw) => {
    const m = CAP_LINK.exec(raw);
    if (!m) return false;
    const [, branch, rest] = /^\/artifact\/origin\/([^/]+)(\/.*)$/.exec(m[4]) ?? [];
    if (branch !== undefined && !BRANCH_AT.test(branch.replace(/%2f/gi, '/'))) return false;
    const judged = branch !== undefined ? rest : raw;
    return !CAP_NOT_EXACT.test(judged) && !judged.split('/').some((x) => x === '.' || x === '..');
  };
  const crossSiteOk = (req, p, url) => {
    const site = req.headers['sec-fetch-site'];
    if (!site || site === 'same-origin' || site === 'none') return true;
    if (req.headers['sec-fetch-mode'] === 'navigate') return !p.startsWith('/api/');
    const dest = req.headers['sec-fetch-dest'];
    if (/^\/review\/[^/]+\/devteam-ui\.(js|css)$/.test(p)) return ['script', 'style'].includes(dest);
    return p === '/api/file' && dest === 'image' && IMAGE.test(url.searchParams.get('path') ?? '');
  };
  // A sandboxed artifact can't be told from another site's page by its headers, and its bytes use
  // relative URLs. So the frame's first load (same-origin, with the session) is redirected under
  // /c/<expiry>.<session>.<mac>/, good for that one artifact folder, and its files need no cookie.
  // The folder is main's, a worktree's, a draft's fetched from another machine (origin/<branch>, the
  // branch encoded into one segment: kit-750), or a published tree's (the owner's wrapper shows
  // exactly the version the public sees: spec §8).
  const ARTIFACT = /^\/artifact\/(?:main|wt\/[^/]+|origin\/[^/]+|tree\/[0-9a-f]{40}(?:[0-9a-f]{24})?)\/[^/]+\//;
  // The grant the owner's wrapper puts in its frame's URL (spec §8): this project, this page, this
  // published tree, for a few minutes, MACed with this process's secret. The wrapper is on the box's
  // own name (<box>/w/<project>/<slug>/), off the dashboard's origin, whose page stops itself when a
  // page of its own origin frames it. The kit's viewer names the hub as a frame ancestor, which is the
  // box: so the gateway takes the box out of the viewer's ancestors, and puts it back only under a
  // valid grant. It only widens who may frame the viewer; it never stands in for the session.
  const WRAP_GRANT_MS = 5 * 60 * 1000;
  const wrapMac = (project, slug, at, exp) => b64u(mac('wrap', project, `/view/artifact/${slug}`, at, exp));
  const wrapGrant = (project, slug, at, exp = Date.now() + WRAP_GRANT_MS) => `${exp}.${wrapMac(project, slug, at, exp)}`;
  // The viewer's own path, as the kit reads it (dot segments resolved), and the exact raw path a grant is good for.
  const VIEWER = /^\/view\/artifact\/([^/]+)$/;
  const wrapGranted = (label, rawPath, url) => {
    const m = VIEWER.exec(rawPath);
    if (!m || !LINK_ID.test(m[1]) || url.searchParams.getAll('at').length !== 1 || url.searchParams.getAll('w').length !== 1) return false;
    const at = url.searchParams.get('at');
    if (!/^tree:/.test(at) || !TREE.test(at.slice(5))) return false;
    const w = /^(\d{1,15})\.([\w-]{22})$/.exec(url.searchParams.get('w'));
    const exp = w ? Number(w[1]) : 0;
    if (!w || exp < Date.now() || exp > Date.now() + WRAP_GRANT_MS) return false;
    return sameBytes(Buffer.from(w[2]), Buffer.from(wrapMac(label, m[1], at, exp)));
  };
  // The viewer's frame-ancestors: the box out of every list, and back in, alone, under the grant. A
  // list left empty is 'none'; a policy that names no ancestors is left as it is.
  const viewerAncestors = (csp, granted) => csp.replace(FRAME_ANCESTORS, (all, sep, sp, list) => {
    if (!list.trim() || /^\s*'none'\s*$/i.test(list)) return all;
    const kept = list.trim().split(/\s+/).filter((s) => s !== PUB);
    const out = granted ? [...kept, PUB] : kept;
    return `${sep}${sp}frame-ancestors ${out.length ? out.join(' ') : "'none'"}${/\s$/.test(list) ? ' ' : ''}`;
  });
  const capMac = (port, prefix, exp, sid) => b64u(mac('artifact', port, prefix, exp, sid));
  const capFor = (port, prefix, session) => {
    const exp = Date.now() + CAPABILITY_MS;
    const sid = session.hash.slice(0, 16);
    return `/c/${exp}.${sid}.${capMac(port, prefix, exp, sid)}`;
  };
  const capOk = (port, inner, exp, sid, given) => {
    const prefix = ARTIFACT.exec(inner)?.[0];
    if (!prefix || /\.\.|%2e|%5c|\\/i.test(inner) || Number(exp) < Date.now()) return false;
    const want = Buffer.from(capMac(port, prefix, exp, sid));
    const got = Buffer.from(given);
    const s = store.load();
    return sameBytes(got, want) && s.passkeys.length > 0 && liveSession(s, (x) => x.hash.startsWith(sid)) !== null;
  };
  // The hub page frames the terminal and each listed project's host: hubFrames, as the last list read
  // said (a failed read keeps the last copy). Never a wildcard, which would admit any preview's name.
  const hubCsp = () => `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; img-src 'self'; frame-src ${[TERM, ...hubFrames].join(' ')}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
  // ttyd's page has no OSC 52, how tmux and a program in it (Claude Code's fullscreen) put text on
  // the clipboard. This adds it, to write only (a request to read is ignored), and only just after
  // the owner clicked or typed here, so what an agent prints can't quietly replace the clipboard.
  const TERM_CLIPBOARD = Buffer.from(`<script>(() => {
  let at = 0;
  for (const e of ['mouseup', 'keydown']) addEventListener(e, () => { at = Date.now(); }, true);
  const hook = setInterval(() => {
    const t = window.term;
    if (!t || !t.parser) return;
    clearInterval(hook);
    t.parser.registerOscHandler(52, (d) => {
      const b64 = d.slice(d.indexOf(';') + 1);
      if (b64 && b64 !== '?' && Date.now() - at < 3000) {
        try { navigator.clipboard.writeText(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))).catch(() => {}); } catch {}
      }
      return true;
    });
  }, 100);
})();</script>`);
  // A phone's swipe doesn't scroll tmux: xterm.js sends tmux a mouse wheel, but nothing for a touch, and
  // tmux's history isn't in xterm's own scrollback. This turns a one-finger vertical swipe into wheel
  // steps on the terminal, which tmux (mouse on) reads as scrolling its history. Taps are left alone.
  const TERM_TOUCH = Buffer.from(`<script>(() => {
  // y follows the finger; y0 is where it touched down, and every wheel step of the gesture goes there,
  // kept off the last rows: tmux's status bar is the bottom row, and a wheel on it switches windows
  let y = null, y0 = null, acc = 0;
  const STEP = 18;
  addEventListener('touchstart', (e) => { y = y0 = e.touches.length === 1 ? e.touches[0].clientY : null; acc = 0; }, { passive: true, capture: true });
  addEventListener('touchmove', (e) => {
    if (y === null || e.touches.length !== 1) return;
    const t = document.querySelector('.xterm-screen');
    if (!t) return;
    const ny = e.touches[0].clientY;
    acc += y - ny;
    y = ny;
    const r = t.getBoundingClientRect();
    const row = document.querySelector('.xterm-rows > div')?.getBoundingClientRect().height || 20;
    const at = Math.min(Math.max(y0, r.top + row / 2), r.bottom - 2 * row);
    while (Math.abs(acc) >= STEP) {
      const d = acc > 0 ? STEP : -STEP;
      acc -= d;
      t.dispatchEvent(new WheelEvent('wheel', { deltaY: d, deltaMode: 0, clientX: r.left + r.width / 2, clientY: at, bubbles: true, cancelable: true }));
    }
    e.preventDefault();
  }, { passive: false, capture: true });
  addEventListener('touchend', () => { y = null; }, { capture: true });
})();</script>`);
  // ttyd's page drops what's typed or pasted while its socket is down, and gives no sign. So this
  // goes in ahead of its bundle, to note the socket it opens; a paste then waits for a live one.
  // ttyd reconnects without loading the page again, so a tab left open through a deploy keeps the
  // old page, and whatever a new one adds never reaches it. So when its socket closes or comes back
  // this asks which page is current and, if it has changed, loads it: tmux redraws the screen, as it
  // does on a reconnect. It keeps asking while the box is away: ttyd tries once, then waits for Enter.
  // Not while a dropped file is on its way or waiting to paste, once per page (one that still comes
  // back old can't loop), and past ttyd's "leave site?" prompt, which is for the owner's own leaving.
  const TERM_SOCKET = `<script>(() => {
  const BUILD = '@@BUILD@@';
  let opens = 0;
  let reloading = false;
  addEventListener('beforeunload', (e) => { if (reloading) e.stopImmediatePropagation(); }, true);
  const reload = () => {
    if (window.devteamDropBusy && window.devteamDropBusy()) return void setTimeout(reload, 1000);
    reloading = true;
    location.reload();
  };
  const checkBuild = async () => {
    const r = await fetch('/build', { cache: 'no-store' });
    if (r.status >= 500) throw new Error('the box is away');
    const build = r.ok ? (await r.json()).build : null;
    if (!build || build === BUILD) return;
    try {
      if (sessionStorage.getItem('devteam-term-reloaded') === build) return;
      sessionStorage.setItem('devteam-term-reloaded', build);
    } catch { return; }
    reload();
  };
  let asking = false;
  const watchBuild = async () => {
    if (asking) return;
    asking = true;
    for (let i = 0; i < 200; i++) {
      try { await checkBuild(); break; } catch {}
      await new Promise((r) => setTimeout(r, 3000));
    }
    asking = false;
  };
  window.WebSocket = new Proxy(window.WebSocket, { construct(T, args, nt) {
    const socket = Reflect.construct(T, args, nt);
    const live = { socket, at: 0 };
    window.devteamTermSocket = live;
    socket.addEventListener('open', () => {
      live.at = Date.now();
      if (++opens > 1) watchBuild();
    });
    socket.addEventListener('close', () => { watchBuild(); });
    return socket;
  } });
})();</script>`;
  const withSocketWatch = (html, watch) => {
    const at = html.indexOf('<head>');
    return at < 0 ? html : Buffer.concat([html.subarray(0, at + 6), watch, html.subarray(at + 6)]);
  };
  // A native terminal pastes the path of a file dropped on it, and Claude Code picks it up from
  // there. So does this: each file goes to the box first, and then its path goes in by term.paste,
  // bracketed like any paste when the program in the pane has asked for that, to the focused pane.
  // No Enter, so the owner can add to the message. The drop is the owner's own act, on their page.
  // ⌘⌥← and ⌘⌥→ (on a Mac; Ctrl+Alt+←/→ elsewhere) move to the previous or next tmux window, as they
  // move between tabs elsewhere. The terminal types them as Ctrl+Alt+Shift+←/→ (xterm's \e[1;8D and
  // \e[1;8C), which the box's .tmux.conf binds to previous-window and next-window: no shell or agent
  // uses that chord, and tmux needs no prefix for it. On a Mac nothing is lost: terminal programs don't
  // use ⌘⌥←/→. Off a Mac, Ctrl+Alt+←/→ is taken from the pane: emacs -nw's C-M-left/right (sexp
  // movement) and any readline or vim binding of \e[1;7D/\e[1;7C no longer reach it, and on Windows
  // AltGr+←/→ (which reports Ctrl+Alt) is caught too; Ctrl+Alt+Shift+←/→ itself still reaches tmux.
  // A browser or desktop that keeps the chord for its own tabs or workspaces takes it before the page,
  // and is left to; nothing else is caught.
  const TERM_KEYS = Buffer.from(`<script>(() => {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (!e.altKey || e.shiftKey || !(mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey)) return;
    if (!window.term || typeof window.term.input !== 'function') return;
    e.preventDefault();
    e.stopPropagation();
    window.term.input(e.key === 'ArrowLeft' ? '\\x1b[1;8D' : '\\x1b[1;8C');
  }, { capture: true });
})();</script>`);
  const TERM_DROP = Buffer.from(`<script>(() => {
  const MAX = ${uploadMax};
  const shellQuote = ${shellQuote};
  const dropPaste = ${dropPaste};
  const isDropImage = ${isDropImage};
  const dropSpace = ${dropSpace};
  const dropNote = ${dropNote};
  // ttyd is attached and tmux has redrawn (bracketed paste back on) a moment after a socket opens
  const SETTLE_MS = 1500;
  const box = (css) => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;z-index:10000;font:14px system-ui,sans-serif;display:none;' + css; document.documentElement.appendChild(d); return d; };
  const veil = box('inset:0;align-items:center;justify-content:center;background:rgba(0,0,0,.6);color:#fff;border:2px dashed #fff;box-sizing:border-box;pointer-events:none');
  veil.id = 'devteam-drop-veil';
  veil.textContent = 'Drop to send to the box';
  const note = box('right:12px;bottom:12px;max-width:70%;padding:8px 12px;border-radius:6px;background:#222;color:#eee;white-space:pre-wrap;cursor:pointer');
  note.id = 'devteam-drop-note';
  note.onclick = () => { note.style.display = 'none'; };
  const say = (text, bad) => {
    note.textContent = text;
    note.style.background = bad ? '#b3261e' : '#222';
    note.style.display = 'block';
  };
  const send = (file, label) => new Promise((done, fail) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/upload?name=' + encodeURIComponent(file.name));
    x.setRequestHeader('content-type', 'application/octet-stream');
    x.upload.onprogress = (e) => { if (e.lengthComputable) say(label + ' ' + Math.round(100 * e.loaded / (e.total || 1)) + '%'); };
    x.onload = () => {
      let j = {};
      try { j = JSON.parse(x.responseText); } catch {}
      if (x.status === 200 && j.path) done(j.path); else fail(new Error(j.error || x.responseText || 'the box answered ' + x.status));
    };
    x.onerror = () => fail(new Error('the upload was refused or cut off'));
    x.send(file);
  });
  // Safari reads HEIC, so an iPhone photo can go as a JPEG, which Claude Code attaches. Elsewhere
  // (Chrome can't decode it) the original goes, and arrives as a path.
  const toJpeg = async (file) => {
    if (!/\\.hei[cf]$/i.test(file.name) && !/^image\\/hei[cf]/i.test(file.type)) return file;
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      bitmap.close();
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
      return blob ? new File([blob], file.name.replace(/\\.[^.]*$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
    } catch { return file; }
  };
  // A paste's image: the kinds Claude Code attaches go as they are, any other is redrawn as a PNG here.
  const ASIS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
  const toPng = async (file) => {
    if (Object.hasOwn(ASIS, file.type)) return file;
    let blob = null;
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      bitmap.close();
      blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    } catch {}
    if (!blob) throw Object.assign(new Error("That image can't be read here. Save it and drop the file."), { whole: true });
    return new File([blob], file.name.replace(/\\.[^.]*$/, '') + '.png', { type: 'image/png' });
  };
  // Stored but not yet pasted. Tried again until the terminal is back, and on screen until then.
  let waiting = [];
  let verb = 'Sent';
  let trouble = [];
  let active = 0;
  window.devteamDropBusy = () => active > 0 || waiting.length > 0;
  const ready = () => {
    const live = window.devteamTermSocket;
    return Boolean(window.term && window.term.paste && live && live.socket.readyState === 1 && live.at && Date.now() - live.at >= SETTLE_MS);
  };
  const flush = () => {
    if (!waiting.length || !ready()) return false;
    const paths = waiting;
    waiting = [];
    window.term.paste(dropPaste(paths));
    if (dropSpace(paths)) window.term.input(' ');
    window.term.focus();
    say(trouble.concat(dropNote(paths, verb)).join('\\n'), trouble.length > 0);
    trouble = [];
    return true;
  };
  setInterval(flush, 500);
  const take = async (picks, skipped) => {
    const paths = [];
    const failed = skipped ? [skipped] : [];
    for (const [i, p] of picks.entries()) {
      const name = p.file ? p.file.name : 'that item';
      try {
        if (!p.file || p.dir) throw new Error('is a folder: zip it and drop that');
        if (p.file.size > MAX) throw new Error('is over the ' + Math.floor(MAX / 1048576) + ' MB limit');
        const label = (picks.length > 1 ? (i + 1) + '/' + picks.length + ' ' : '') + name;
        say(label + ' 0%');
        paths.push(await send(await (p.pasted ? toPng : toJpeg)(p.file), label));
      } catch (e) { failed.push(e.whole ? e.message : name + ': ' + e.message); }
    }
    trouble = failed;
    // a drop and a paste waiting together are told as a drop
    if (paths.length) verb = picks[0].pasted && (!waiting.length || verb === 'Pasted') ? 'Pasted' : 'Sent';
    waiting.push(...paths);
    if (flush()) return;
    if (waiting.length) say(trouble.concat('terminal not connected: stored at ' + dropPaste(waiting) + '\\nIt pastes when the terminal reconnects.').join('\\n'), true);
    else if (trouble.length) { say(trouble.join('\\n'), true); trouble = []; }
  };
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
  let hide = 0;
  let queue = Promise.resolve();
  const enqueue = (picks, skipped) => {
    active++;
    queue = queue.then(() => take(picks, skipped)).catch((err) => say(String(err && err.message || err), true)).finally(() => { active--; });
  };
  addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    veil.style.display = 'flex';
    clearTimeout(hide);
    hide = setTimeout(() => { veil.style.display = 'none'; }, 500);
  }, true);
  addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    clearTimeout(hide);
    veil.style.display = 'none';
    // only while the event lasts: the list is empty afterwards
    const picks = Array.from(e.dataTransfer.items).filter((i) => i.kind === 'file').map((i) => { const entry = i.webkitGetAsEntry && i.webkitGetAsEntry(); return { file: i.getAsFile(), dir: Boolean(entry && entry.isDirectory) }; });
    enqueue(picks);
  }, true);
  // --- a pasted image: only in the owner's own paste, and never in place of text ---
  const IMAGES_ONLY = 'Only images paste here. Drop other files instead.';
  // The text of a paste that only names its files: a copied image's address, or a copied file's name.
  // Browsers wrap a copied image's HTML differently, so it is judged by what is left in its body.
  const onlyNames = (text, html, files) => {
    const line = text.replace(/[\\r\\n]+$/, '');
    if (!line) return true;
    // every line break there is, not only the ones a browser writes
    if (/[\\r\\n\\v\\f\\x85\\u2028\\u2029]/.test(line)) return false;
    if (html) {
      const body = new DOMParser().parseFromString(html, 'text/html').body;
      const els = Array.from(body.querySelectorAll('*')).filter((e) => e.tagName !== 'META');
      if (els.length !== 1 || els[0].tagName !== 'IMG' || body.textContent.trim()) return false;
    }
    return /^(https?|file|data):\\S+$/i.test(line) || /\\.(png|jpe?g|gif|webp|heic|tiff?|bmp)$/i.test(line) || files.some((f) => f.name && line.endsWith(f.name));
  };
  const pastedName = (file, at) => {
    if (file.name && !/^image\\.[a-z0-9]+$/i.test(file.name)) return file;
    const two = (n) => String(n).padStart(2, '0');
    const stamp = at.getFullYear() + two(at.getMonth() + 1) + two(at.getDate()) + '-' + two(at.getHours()) + two(at.getMinutes()) + two(at.getSeconds());
    return new File([file], 'pasted-' + stamp + '.' + (Object.hasOwn(ASIS, file.type) ? ASIS[file.type] : 'png'), { type: file.type });
  };
  addEventListener('paste', (e) => {
    const data = e.clipboardData;
    const files = data ? Array.from(data.files) : [];
    if (!files.length || !onlyNames(data.getData('text/plain'), data.getData('text/html'), files)) return;
    // before xterm.js, which would type the clipboard's text
    e.preventDefault();
    e.stopImmediatePropagation();
    const images = files.filter((f) => /^image\\//i.test(f.type));
    if (!images.length) return void enqueue([], IMAGES_ONLY);
    const at = new Date();
    enqueue(images.map((f) => ({ file: pastedName(f, at), dir: false, pasted: true })), images.length < files.length ? IMAGES_ONLY : '');
  }, true);
  // Off a Mac, xterm.js types Ctrl+V as ^V and prevents the browser's paste. These keys never reach it,
  // and the browser pastes. keyCode follows the keyboard's layout, as the browser's own shortcut does.
  // On a Mac, Cmd+V pastes and Ctrl+V stays ^V.
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  addEventListener('keydown', (e) => {
    if (mac || e.altKey || e.metaKey) return;
    if (e.ctrlKey ? e.keyCode === 86 : e.shiftKey && e.keyCode === 45) e.stopPropagation();
  }, true);
})();</script>`);
  const TERM_CSP = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'self' ${TERM.replace(/^http/, 'ws')}; frame-ancestors ${PUB}; base-uri 'none'; form-action 'none'`;
  // The page the terminal is served, and a name for it that changes only when its bytes do.
  const termPage = () => {
    const html = ttydPage();
    const build = b64u(sha256(Buffer.concat([html, Buffer.from(TERM_SOCKET), TERM_CLIPBOARD, TERM_DROP, TERM_TOUCH, TERM_KEYS]))).slice(0, 22);
    return { build, body: Buffer.concat([withSocketWatch(html, Buffer.from(TERM_SOCKET.replace('@@BUILD@@', build))), TERM_CLIPBOARD, TERM_DROP, TERM_TOUCH, TERM_KEYS]) };
  };
  const loginAt = (next) => `${PUB}/auth/login${next ? `?next=${encodeURIComponent(next)}` : ''}`;

  // A published artifact, from the gateway's own copy alone: reads only, the raw path matched
  // before any decoding, the gateway's own headers. Nothing here reads the cookie, sets one, or
  // talks to an instance, so taking a port, rewriting main or forging log lines changes nothing.
  // (The owner's wrapper, tried before this, reads the cookie to choose itself, and only that.)
  // The bytes are the public's, whoever asks. A page's index also varies on the cookie and
  // sec-fetch-dest, which can make it the wrapper, and has the wrapper's opener policy: without it
  // on both, a site that opens the page in a popup could tell from the window (its frame count, or
  // whether it can still see it) whether the visitor is the signed-in owner. The page's sandbox
  // has no allow-popups, so it opens no window that the policy could cut off.
  // On <label>.<box>, the page is /<slug>/… of the project of that name.
  const servePublic = (req, res, label) => {
    if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, 'text/plain; charset=utf-8', 'GET or HEAD only', { allow: 'GET, HEAD' });
    if (req.headers['service-worker'] || req.headers['sec-fetch-dest'] === 'serviceworker') return send(res, 403, 'text/plain; charset=utf-8', 'no service workers on this box');
    const notFound = () => send(res, 404, 'text/plain; charset=utf-8', 'not found');
    const raw = /^\/([^/]+)(\/.*)?$/.exec(req.url.split('?')[0]);
    const m = raw ? [raw[0], label, raw[1], raw[2]] : null;
    if (!m || !LINK_ID.test(m[2])) return notFound();
    const pub = store.load().public ?? {};
    const proj = Object.hasOwn(pub, m[1]) ? pub[m[1]] : null;
    const art = proj && Object.hasOwn(proj.artifacts ?? {}, m[2]) ? proj.artifacts[m[2]] : null;
    if (!art) return notFound();
    if (m[3] === undefined) { res.writeHead(302, { location: `/${m[2]}/`, 'cache-control': 'no-store', ...hsts }); return res.end(); }
    const rel = m[3] === '/' ? 'index.html' : m[3].slice(1);
    const f = publicPathOk(rel) && Object.hasOwn(art.files ?? {}, rel) ? art.files[rel] : null;
    if (!f || !/^[0-9a-f]{64}$/.test(f.sha256 ?? '')) return notFound();
    const tag = `"${f.sha256}"`;
    const head = { etag: tag, 'cache-control': 'public, max-age=60', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': publicCsp(publicAddress(m[1], m[2])), ...(rel === 'index.html' ? { vary: 'cookie, sec-fetch-dest', 'cross-origin-opener-policy': 'same-origin' } : {}), ...hsts };
    const asked = String(req.headers['if-none-match'] ?? '').split(',').map((t) => t.trim());
    if (asked.includes('*') || asked.includes(tag)) { res.writeHead(304, head); return res.end(); }
    // no range requests, as in the kit: the whole file or its headers
    const all = { ...head, 'content-type': PUBLIC_TYPES[rel.split('.').pop().toLowerCase()] ?? 'application/octet-stream', 'content-length': f.size };
    // a stat, never a read, so a HEAD says what a plain GET would (a HEAD is never the wrapper)
    const file = path.join(dir, 'public', 'blobs', f.sha256);
    const st = fs.statSync(file, { throwIfNoEntry: false });
    if (!st || st.size !== f.size) return send(res, 500, 'text/plain; charset=utf-8', 'the box has lost its copy of this page: publish it again');
    res.writeHead(200, all);
    if (req.method === 'HEAD') return res.end();
    pipeline(fs.createReadStream(file), res, () => {});
  };

  // --- publishing: only from the gateway's own page on the box's name, of bytes it checked itself ---
  const pstore = publicStore(dir);
  const LOOP_MS = opts.publicDeadlineMs ?? 15000;
  // One publish item's whole time on its instance (manifest, files, record): an instance that
  // answers slowly but within each request's deadline still runs out.
  const ITEM_MS = opts.publicItemMs ?? 120000;
  // A request to an instance as a loopback client: its own Host, no sec-fetch-* or cookie, and no
  // Origin on a GET. A POST (the publish record) says the instance's own Origin, which the
  // dashboard's owner actions need (kit-324), as any local process can say it. It never carries
  // the owner's session or the box's signature. One deadline for the whole answer, and a cap on its
  // size: whatever holds the port wrote it.
  const loopback = (port, method, p, { body = null, cap = 2 * 1024 * 1024, ms = LOOP_MS } = {}) => new Promise((resolve, reject) => {
    let deadline = null;
    let settled = false;
    const finish = (err, v) => { if (settled) return; settled = true; clearTimeout(deadline); if (err) reject(err); else resolve(v); };
    // a POST says the instance's own Origin, as its page does: the dashboard takes an owner action
    // only with that (or Sec-Fetch-Site same-origin), never from a bare client (kit-324)
    const headers = { host: `127.0.0.1:${port}`, ...(body === null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), origin: `http://127.0.0.1:${port}` }) };
    const up = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (ur) => {
      const chunks = [];
      let size = 0;
      ur.on('data', (c) => { size += c.length; if (size > cap) { up.destroy(); finish(new Error(`instance ${port} sent more than ${cap} bytes for ${p}`)); } else chunks.push(c); });
      ur.on('end', () => finish(null, { status: ur.statusCode, body: Buffer.concat(chunks) }));
      ur.on('error', () => finish(new Error(`instance ${port} broke off its answer to ${p}`)));
      ur.on('close', () => finish(new Error(`instance ${port} broke off its answer to ${p}`)));
    });
    up.on('error', () => finish(new Error(`nothing answers on instance ${port}`)));
    deadline = setTimeout(() => { up.destroy(); finish(Object.assign(new Error(`instance ${port} took over ${ms / 1000} s to answer ${p}`), { deadline: true })); }, ms);
    up.end(body ?? undefined);
  });
  const errorOf = (r) => { try { return String(JSON.parse(r.body.toString('utf8')).error ?? `HTTP ${r.status}`).slice(0, 300); } catch { return `HTTP ${r.status}`; } };
  const fetchManifest = async (port, slug, ms = LOOP_MS) => {
    const r = await loopback(port, 'GET', `/public-manifest/${slug}`, { ms });
    if (r.status !== 200) throw new Error(`instance ${port}: ${errorOf(r)}`);
    let m;
    try { m = JSON.parse(r.body.toString('utf8')); } catch { throw new Error(`instance ${port} sent a manifest that isn't JSON`); }
    const why = manifestProblem(m, slug);
    if (why) throw new Error(`instance ${port}'s manifest for ${slug}: ${why}`);
    return m;
  };
  const manifestHash = (m) => hex256(canonicalJson(m));
  // A page needs an address: <project>.<box>/<slug>/, where the slug is none of the dashboard's paths.
  const addressProblem = (m) => {
    if (RESERVED_SEGMENTS.includes(m.slug)) return `${m.slug} is a path of the dashboard, so a page can't be published under it: rename the artifact`;
    if (!hostable(m.project)) return `${m.project} can't be a host name, so a page of it would have no address: rename the project (settings.md's project)`;
    return null;
  };
  // Whether this item may go on the box as it stands: bound to the root the owner saw, and under
  // the cap with this item's files in place of its old version. Checked before the slow work, and
  // again in the queue against the state it will change.
  const publishProblem = (pubNow, m, item) => {
    const where = addressProblem(m);
    if (where) return where;
    const bound = Object.hasOwn(pubNow, m.project) ? pubNow[m.project] : null;
    if (bound && bound.root !== m.root) {
      if (item.move !== true) return `${m.project} is published from ${bound.root}; this instance is ${m.root}: tick "move it" to publish it from here`;
      // "move it" is consent to take down what the page showed, so only from that root
      if (bound.root !== item.movedFrom) return 'this project moved since you looked; reload the page';
    }
    const after = { ...pubNow, [m.project]: { ...(bound ?? {}), artifacts: { ...(bound && bound.root === m.root ? bound.artifacts ?? {} : {}) } } };
    delete after[m.project].artifacts[m.slug];
    const sizes = pstore.referenced(after);
    for (const f of Object.values(m.files)) sizes.set(f.sha256, f.size);
    const total = [...sizes.values()].reduce((n, s) => n + s, 0);
    if (total > PUBLIC_MAX) return `publishing it would hold ${total} bytes, over the box's public cap of ${PUBLIC_MAX} bytes (DEVTEAM_PUBLIC_MAX)`;
    return null;
  };
  // One confirmed item. Bound to the manifest the owner saw (its sha256), every file to the
  // manifest, the tree id to the bytes; anything off refuses this item. Everything that waits on
  // the instance runs before the queue, within one budget, so a slow instance holds up no one
  // else's change (an unpublish least of all); the queue holds only the writes, the record and
  // the save, and the sweep after them drops whatever a refused item wrote.
  const publishItem = async (port, item) => {
    const t0 = Date.now();
    const late = () => new Error(`instance ${port} took over ${ITEM_MS / 1000} s for this item; nothing was published`);
    const left = () => { const n = ITEM_MS - (Date.now() - t0); if (n <= 0) throw late(); return Math.min(LOOP_MS, n); };
    // decided by cause, not by the clock: a timer may fire a millisecond early, and a deadline
    // shorter than LOOP_MS can only be the item's budget running out
    const ask = async (f) => { const ms = left(); try { return await f(ms); } catch (e) { throw e.deadline && ms < LOOP_MS ? late() : e; } };
    const m = await ask((ms) => fetchManifest(port, item.slug, ms));
    if (manifestHash(m) !== item.manifest) throw new Error('this changed since you looked; reload the page');
    let why = publishProblem(store.load().public ?? {}, m, item);
    if (why) throw new Error(why);
    const algo = m.tree.length === 40 ? 'sha1' : 'sha256';
    const bytes = new Map();
    const ids = Object.create(null);   // a file may be named __proto__
    for (const [rel, f] of Object.entries(m.files)) {
      const r = await ask((ms) => loopback(port, 'GET', `/artifact/main/${m.slug}/${rel}`, { cap: f.size, ms }));
      if (r.status !== 200 || r.body.length !== f.size || hex256(r.body) !== f.sha256) throw new Error(`${rel} is not the file the manifest names (its bytes differ); nothing was published`);
      bytes.set(f.sha256, r.body);
      ids[rel] = { oid: gitBlobId(r.body, algo), mode: f.mode };
    }
    if (gitTreeId(ids, algo) !== m.tree) throw new Error(`the files don't make the tree ${m.tree.slice(0, 12)} the manifest names; nothing was published`);
    // this item's own proof that its name is one project's, from a list read begun now, taken
    // outside the store's queue so a stalled hub never holds anyone else's change
    const proof = await freshList(1000);
    const blocked = publishBlocked(m.project, proof);
    if (blocked) throw Object.assign(new Error(blocked), { noProof: !proof });
    return pstore.serial(async () => {
      try {
        // the budget may have run out while this item queued: refuse before any blob is written
        left();
        // the state may have changed while this item waited: a move, another publish, the cap, a
        // second project of this name listed since
        why = publishProblem(store.load().public ?? {}, m, item) || publishBlocked(m.project, proof);
        if (why) throw new Error(why);
        for (const [sha, buf] of bytes) pstore.write(sha, buf);
        // the record gets the full deadline, whatever is left of the budget: cutting it short would leave a recorded-but-unsaved publish
        const k = await loopback(port, 'POST', '/api/artifact-publish', { body: JSON.stringify({ op: 'publish', slug: m.slug, tree: m.tree }), ms: LOOP_MS });
        if (k.status !== 200) throw new Error(`the kit didn't record it, so it wasn't published: ${errorOf(k)}`);
        // load, change and save with nothing awaited in between
        const now = store.load();
        const pub = { ...(now.public ?? {}) };
        const prev = Object.hasOwn(pub, m.project) ? pub[m.project] : null;
        const kept = prev && prev.root === m.root ? prev.artifacts ?? {} : {};
        // a move is a new binding, so never an update
        const update = Object.hasOwn(kept, m.slug);
        pub[m.project] = { root: m.root, port, artifacts: { ...kept, [m.slug]: { tree: m.tree, title: m.title, at: new Date().toISOString(), files: Object.fromEntries(Object.entries(m.files).map(([rel, f]) => [rel, { sha256: f.sha256, size: f.size }])) } } };
        store.save({ ...now, public: pub });
        return { url: publicAddress(m.project, m.slug), update };
      } finally { try { pstore.sweep(store.load().public); } catch {} }
    });
  };

  // An unpublish is recorded on the instance only when it is that project, at that checkout: its
  // manifest says so, or its hello for a slug no longer on main. Otherwise the Library's Forget does it.
  const recordUnpublish = async (port, project, root, slug) => {
    const r = await loopback(port, 'GET', `/public-manifest/${slug}`);
    let says = null;
    if (r.status === 200) { try { says = JSON.parse(r.body.toString('utf8')); } catch {} }
    else { const h = await loopback(port, 'GET', '/api/hello'); try { const x = JSON.parse(h.body.toString('utf8')); says = { project: x.name, root: x.root }; } catch {} }
    if (says?.project !== project || says?.root !== root) throw new Error(`instance ${port} is not ${project} at ${root}, so the record wasn't written there`);
    const k = await loopback(port, 'POST', '/api/artifact-publish', { body: JSON.stringify({ op: 'unpublish', slug }) });
    if (k.status !== 200) throw new Error(`instance ${port} didn't record it (${errorOf(k)})`);
  };

  // What the box serves, for the Library: each project's checkout, last port and slug -> tree. At
  // most 32 KB; past that, only the projects last seen on the asking instance.
  const publicMap = (port) => {
    const pub = store.load().public ?? {};
    const all = Object.fromEntries(Object.entries(pub).map(([n, x]) => [n, { port: x.port, root: x.root, artifacts: Object.fromEntries(Object.entries(x.artifacts ?? {}).map(([s, a]) => [s, a.tree])) }]));
    const text = asciiJson(all);
    return text.length <= 32 * 1024 ? text : asciiJson(Object.fromEntries(Object.entries(all).filter(([, x]) => x.port === port)));
  };

  // The owner's page at a published page's address (spec §8): the project's viewer at the published version,
  // with threads. Only for a top-level visit (sec-fetch-dest: document; navigate also matches frames)
  // to a published page's index, by the signed-in owner, whose bound instance the hub's list (as last
  // polled) shows as that checkout with a kit that has viewers. Anything in doubt is null: a session
  // that isn't one, a store that can't be read, no binding, an instance not listed so, another
  // checkout or an older kit. Then the public's bytes are served, as before. It reads the cookie, and
  // nothing else of the owner's, and it is synchronous: nothing is asked on the request path, not even
  // on a miss, so its timing says nothing of who is visiting. The list can be up to a poll stale.
  // The root check is for consistency, against another real checkout on that port, not for
  // authenticity: that rests on the port binding, as it does for the dashboard on that name.
  // On <label>.<box> the binding is found by name and root, not by the port stored at publish: the
  // listed project of that name, one port only, at the stored root, with viewers. A project whose
  // port moved keeps its wrapper; a name two projects share gets the plain bytes.
  // The viewer it frames is on the project's host, and the wrapper is on the box's own name
  // (<box>/w/<project>/<slug>/): the dashboard's page stops itself when a page of its own origin
  // frames it, so the wrapper can't share that origin. The owner's visit to the page's index is sent
  // there; the wrapper page is signed in only and holds no byte of the artifact.
  // The wrapper's own policy: styles and one frame, the project's host; no script, nothing to fetch.
  const WRAP_CSP = (origin) => `default-src 'none'; style-src 'unsafe-inline'; frame-src ${origin}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
  const WRAP_HEAD = { 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store, private', vary: 'cookie, sec-fetch-dest', 'cross-origin-opener-policy': 'same-origin' };
  // The binding, by name and root, of a page this project published, or null in any doubt.
  const wrapBinding = (label, slug) => {
    if (!LINK_ID.test(slug) || RESERVED_SEGMENTS.includes(slug)) return null;
    const s = store.load();
    const bound = Object.hasOwn(s.public ?? {}, label) ? s.public[label] : null;
    const art = bound && Object.hasOwn(bound.artifacts ?? {}, slug) ? bound.artifacts[slug] : null;
    if (!art || typeof bound.root !== 'string' || typeof art.tree !== 'string' || !TREE.test(art.tree)) return null;
    const c = projects.get(label) ?? [];
    if (c.length !== 1 || !c[0].viewer || c[0].root !== bound.root) return null;
    return { art, at: `tree:${art.tree}` };
  };
  // On <project>.<box>: the slug of the signed-in owner's own document visit to a bound page's index, or null.
  const ownerVisit = (req, url, label) => {
    try {
      if (req.method !== 'GET' || req.headers['sec-fetch-dest'] !== 'document' || url.searchParams.has('plain')) return null;
      const m = /^\/([^/]+)\/(?:index\.html)?$/.exec(req.url.split('?')[0]);
      if (!m || !store.load().passkeys.length || !sessionOf(req)) return null;
      return wrapBinding(label, m[1]) ? m[1] : null;
    } catch { return null; }
  };
  // On the box, after the session: /w/<project>/<slug>/, or null for anything it can't bind.
  const ownerWrapper = (rawPath) => {
    try {
      const m = /^\/w\/([^/]+)\/([^/]+)\/$/.exec(rawPath);
      if (!m || !HOST_LABEL.test(m[1]) || RESERVED_LABELS.includes(m[1])) return null;
      const b = wrapBinding(m[1], m[2]);
      if (!b) return null;
      const origin = projectOrigin(m[1]);
      const title = typeof b.art.title === 'string' && b.art.title ? b.art.title : m[2];
      return { origin, html: PAGES.ownerWrapper({ project: m[1], slug: m[2], title, plain: `${origin}/${m[2]}/?plain`, frame: `${origin}/view/artifact/${m[2]}?at=${b.at}&w=${wrapGrant(m[1], m[2], b.at)}` }) };
    } catch { return null; }
  };

  // --- a file dropped on the terminal: streamed to a folder of its own, never read back or run ---
  // The root is made at boot, by root, for gw to write and dev to read. It is checked here, not
  // assumed, so the gateway never writes through something an agent could have put in its place.
  const uploadsRootOk = async () => {
    try {
      const st = await fs.promises.lstat(uploadsRoot);
      return st.isDirectory() && st.uid === process.getuid() && !(st.mode & 0o022);
    } catch { return false; }
  };
  // What's there, from the disk once, and kept up to date here: only this process writes the root.
  const kept = new Map(); // folder -> { bytes, at }
  const receiving = new Map(); // folder -> the most it may yet take
  const sum = (ns) => { let t = 0; for (const n of ns) t += n; return t; };
  let scan = null;
  const scanUploads = () => {
    scan ??= (async () => {
      for (const e of await fs.promises.readdir(uploadsRoot, { withFileTypes: true })) {
        if (!e.isDirectory() || !UPLOAD_FOLDER.test(e.name)) continue;
        const folder = path.join(uploadsRoot, e.name);
        // one that can't be read or removed costs only itself; one not made by this user isn't ours
        try {
          const st = await fs.promises.lstat(folder);
          if (st.uid !== process.getuid()) continue;
          const names = await fs.promises.readdir(folder);
          // a restart cut this one off: nothing is receiving yet, the scan comes first
          if (!names.length || names.includes(UPLOAD_PART)) { await fs.promises.rm(folder, { recursive: true, force: true }); continue; }
          let bytes = 0;
          for (const n of names) bytes += (await fs.promises.lstat(path.join(folder, n))).size;
          kept.set(e.name, { bytes, at: st.mtimeMs });
        } catch (err) { log(`dropped files: skipping ${e.name}: ${err.message}`); }
      }
    })().catch((e) => { scan = null; throw e; });
    return scan;
  };
  // Removes only what the scan or an upload recorded: a folder named as ours, made by this process's user.
  const sweepUploads = async (now = Date.now()) => {
    if (!(await uploadsRootOk())) return;
    await scanUploads();
    for (const [name, u] of kept) {
      if (now - u.at <= uploadKeepMs) continue;
      try {
        await fs.promises.rm(path.join(uploadsRoot, name), { recursive: true, force: true });
        kept.delete(name);
      } catch (err) { log(`dropped files: could not remove ${name}: ${err.message}`); }
    }
  };
  const receiveUpload = async (req, res, rawName) => {
    const refuse = (code, error, extra) => json(res, code, { error }, extra);
    // closes, so what's still being sent is dropped with the connection, not read
    const tooBig = () => refuse(413, `over the ${Math.floor(uploadMax / 1048576)} MB limit for a file`, { connection: 'close' });
    if (!(await uploadsRootOk())) return refuse(503, 'this box has no folder for dropped files');
    const declared = req.headers['content-length'] === undefined ? null : Number(req.headers['content-length']);
    if (declared !== null && declared > uploadMax) return tooBig();
    const want = declared ?? uploadMax;
    // housekeeping: whatever goes wrong with it, the owner's file still goes in
    await sweepUploads().catch((e) => log(`dropped files: ${e.message}`));
    const pending = sum(receiving.values());
    if (sum([...kept.values()].map((u) => u.bytes)) + pending + want > uploadTotal) return refuse(507, `the box already holds as many dropped files as it keeps (${Math.floor(uploadTotal / 1048576)} MB); they go after ${Math.round(uploadKeepMs / 86400000)} days`);
    const id = `${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(12).toString('hex')}`;
    const folder = path.join(uploadsRoot, id);
    const part = path.join(folder, UPLOAD_PART);
    const stored = path.join(folder, safeUploadName(rawName));
    receiving.set(id, want);
    let fh = null;
    let size = 0;
    const stall = setTimeout(() => req.destroy(new Error('stalled')), uploadStallMs);
    try {
      const { bavail, bsize } = await fs.promises.statfs(uploadsRoot);
      if (bavail * bsize - pending - want < uploadFree) throw Object.assign(new Error('full'), { code: 'ENOSPC' });
      // a new folder of a random name, then a new file in it: neither can be anything already there
      await fs.promises.mkdir(folder, { mode: 0o750 });
      fh = await fs.promises.open(part, 'wx', 0o600);
      // one chunk at a time, each written before the next is read: a big body waits, in the socket
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > uploadMax) throw Object.assign(new Error('too big'), { tooBig: true });
        await fh.writeFile(chunk);
        stall.refresh();
      }
      await fh.chmod(0o640);
      await fh.close();
      await fs.promises.rename(part, stored);
      kept.set(id, { bytes: size, at: Date.now() });
      return json(res, 200, { path: stored, size });
    } catch (e) {
      await fh?.close().catch(() => {});
      await fs.promises.rm(folder, { recursive: true, force: true }).catch(() => {});
      if (e.tooBig) return tooBig();
      // req.destroyed is true once a body is read whole, so it can't say the client has gone: the socket can
      if (res.destroyed || req.socket?.destroyed) return;
      if (e.code === 'ENOSPC') return refuse(507, 'the box\'s disk is too full for this file', { connection: 'close' });
      log(`a dropped file could not be stored: ${e.message}`);
      return refuse(500, 'the box could not store this file', { connection: 'close' });
    } finally {
      clearTimeout(stall);
      receiving.delete(id);
    }
  };

  // GET /upload/<folder>/<name>: a file dropped on an instance's page, back to that page (spec §5).
  // Matched on the raw path, so nothing URL parsing folds (.., %2e, %2F) can name another file:
  // only a name exactly as one is stored, in a folder named as ours, really inside the root.
  const serveUpload = async (req, res, rawPath) => {
    const none = () => send(res, 404, 'text/plain', 'not found');
    const m = /^\/upload\/([^/]+)\/([^/]+)$/.exec(rawPath);
    if (!m || !UPLOAD_FOLDER.test(m[1]) || m[2] === UPLOAD_PART || m[2] !== safeUploadName(m[2])) return none();
    let fh = null;
    try {
      const root = await fs.promises.realpath(uploadsRoot);
      const real = await fs.promises.realpath(path.join(uploadsRoot, m[1], m[2]));
      // exactly the file named, not merely inside the root: a link in a folder to another stored file,
      // or out to <root>-evil/…, names a file never dropped there (task review T3-1)
      if (real !== path.join(root, m[1], m[2])) return none();
      fh = await fs.promises.open(real, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const st = await fh.stat();
      if (!st.isFile()) { await fh.close(); return none(); }
      const { type, attachment } = uploadType(m[2]);
      res.writeHead(200, { 'content-type': type, ...(attachment ? { 'content-disposition': `attachment; filename="${m[2]}"` } : {}), 'content-length': st.size, 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', ...hsts });
      if (req.method === 'HEAD') { await fh.close(); return res.end(); }
      // pipeline: a reader who goes mid-file closes the file too
      pipeline(fh.createReadStream(), res, () => {});
    } catch {
      await fh?.close().catch(() => {});
      return res.headersSent ? res.destroy() : none();
    }
  };

  // Room for a jar a page has stuffed; past it, see clientError below.
  const server = http.createServer({ maxHeaderSize: 64 * 1024 }, async (req, res) => {
    // Node's five minutes for a body, for all but an upload that has passed its checks (REQUEST_MS)
    const bodyTimer = setTimeout(() => { if (!req.complete) req.destroy(); }, bodyMs);
    bodyTimer.unref();
    req.once('close', () => clearTimeout(bodyTimer));
    // origin-form only: a request line with a full URL, or *, is refused
    if (!req.url.startsWith('/') || req.url.startsWith('//')) return send(res, 400, 'text/plain', 'bad request');
    let url;
    try { url = new URL(req.url, PUB); } catch { return send(res, 400, 'text/plain', 'bad request'); }
    // an app's own /healthz is reachable through its link; the platform's probe is on the service's name
    // The gateway's own ok on every name, but for a live preview's own /healthz to its signed-in owner:
    // signed out, a real name and a made-up one answer alike.
    if (url.pathname === '/healthz') {
      const l = labelOf(req.headers.host);
      let app = false;
      // the session work first, for every label, so its cost says nothing of which names are live
      try {
        const signedIn = !!l && store.load().passkeys.length > 0 && !!sessionOf(req);
        app = signedIn && previews.has(l);
      } catch {}
      if (!app) return send(res, 200, 'text/plain', 'ok');
    }
    // Our own names only; and anything but a read must come from a page on the same name.
    const isBox = req.headers.host === pubUrl.host;
    const isTerm = req.headers.host === termHost;
    const label = isBox || isTerm ? null : labelOf(req.headers.host);
    if (!isBox && !isTerm && !label) return send(res, 421, 'text/plain; charset=utf-8', `this box answers only on its own names: open ${PUB}/`);
    const own = isBox ? PUB : isTerm ? TERM : projectOrigin(label);
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== own) return send(res, 403, 'text/plain; charset=utf-8', 'only from this box\'s own pages');
    // The kit has no service workers. One an agent's page registers on a project's name would
    // outlive its server, and run as that name's real dashboard once one takes the port.
    if (label && (req.headers['service-worker'] || req.headers['sec-fetch-dest'] === 'serviceworker')) return send(res, 403, 'text/plain; charset=utf-8', 'no service workers on this box');
    // Before any lookup, for every label: no other site lays one of these under its own page with
    // the owner's session in it. An exact capability path, which an artifact navigating its own frame
    // sends as a cross-site iframe request, has its own check instead, and reads no session.
    const rawPath = req.url.split('?')[0];
    if (label && !capLinkExact(rawPath) && PREVIEW_FRAMED.includes(req.headers['sec-fetch-dest']) && !['same-origin', 'same-site'].includes(req.headers['sec-fetch-site'])) return send(res, 403, 'text/plain; charset=utf-8', 'not in another site\'s frame');
    const p = url.pathname;
    // A page this name published: anyone's, from the gateway's own store, before every check about
    // the owner. The one exception reads the cookie to choose a page, never to refuse one: the
    // owner's own visit is sent to the wrapper on the box (/w/), and whatever that can't settle gets
    // the public's bytes. Nothing after this runs for a published page.
    if (label) {
      let published = false;
      try { published = publishedBy(label, rawPath.split('/')[1]); } catch (e) { return send(res, e?.unreadable ? 503 : 500, 'text/plain; charset=utf-8', 'this page can\'t be served just now'); }
      if (published) {
        const slug = ownerVisit(req, url, label);
        if (slug) {
          res.writeHead(302, { location: `${PUB}/w/${label}/${slug}/`, ...WRAP_HEAD, ...hsts });
          return res.end();
        }
        try { return servePublic(req, res, label); } catch (e) { return send(res, e?.unreadable ? 503 : 500, 'text/plain; charset=utf-8', 'this page can\'t be served just now'); }
      }
    }
    const isAuth = isBox && (p === '/auth' || p.startsWith('/auth/'));
    try {
      const cm = label ? CAP_LINK.exec(rawPath) : null;
      if (cm) {
        // The same MAC and state read for every name: an unlisted one is checked against port 0,
        // which no link is minted for, so a failure costs the same and says nothing of the list.
        const only = projects.get(label);
        const capPort = only?.length === 1 ? only[0].port : null;
        const capGood = capOk(capPort ?? 0, cm[4], cm[1], cm[2], cm[3]);
        if (!['GET', 'HEAD'].includes(req.method) || capPort === null || !capGood) return send(res, 403, 'text/plain; charset=utf-8', 'that artifact link has expired: open it again from the dashboard');
        // the capability is this request's only credential: no cookie of any name goes on to the port
        delete req.headers.cookie;
        return proxy(req, res, { port: capPort, path: cm[4] + url.search, publicOrigin: own, cap: `/c/${cm[1]}.${cm[2]}.${cm[3]}` });
      }
      if (!crossSiteOk(req, p, url)) return send(res, 403, 'text/plain; charset=utf-8', 'not for another site\'s page');
      const s = store.load();
      const claimed = s.passkeys.length > 0;
      if (isAuth) {
        if (p === '/auth' && req.method === 'GET') return redirect(res, '/auth/login');
        // Every type's start and finish, for a claim, a sign-in, an invite, an add (which looks up its
        // own session): before the session gate, since only an add has one.
        const mt = /^\/auth\/method\/([^/]+)\/(start|finish)$/.exec(p);
        if (mt) {
          const [, type, step] = mt;
          const row = METHODS.get(type);
          if (!row) return json(res, 404, { error: 'no such sign-in method type' });
          // a redirect type's provider sends the browser back by GET, state and the rest in the query
          if (step === 'finish' && req.method === 'GET' && row.finishByGet) {
            const q = Object.fromEntries(url.searchParams);
            const out = await finishFlow(req, type, null, q, 'GET');
            const head = out.cookies.length ? { 'set-cookie': out.cookies } : {};
            if (out.status !== 200) return send(res, out.status, 'text/plain; charset=utf-8', out.body.error, head);
            res.writeHead(302, { location: safeNext(q.next), 'cache-control': 'no-store', ...hsts, ...head });
            return res.end();
          }
          if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
          const body = await readJson(req);
          if (step === 'start') return flowAnswer(res, await startFlow(req, type, body?.purpose, body, claimed ? sessionOf(req) : null));
          return flowAnswer(res, await finishFlow(req, type, body?.purpose, body, 'POST'));
        }
        // on a claimed box a claim link is an invite's: its page reads the token from the fragment
        if (p === '/auth/claim' && req.method === 'GET') return page(res, claimed ? PAGES.invite(PUB) : PAGES.claim(PUB));
        // What the invite page shows before the passkey: whose invite, at what level, and whether it
        // adds a method to someone already here. Reads only; every dead token gets the same answer.
        if (p === '/auth/claim/invite' && req.method === 'POST') {
          const body = await readJson(req, 4096);
          const s2 = store.load();
          const found = s2.passkeys.length && typeof body?.token === 'string' ? inviteOf(s2, b64u(sha256(body.token))) : null;
          if (!found) return json(res, 403, { error: INVITE_GONE });
          return json(res, 200, { name: found.person.name, level: found.person.level, again: (found.person.methods ?? []).length > 0, expires: found.inv.expires });
        }
        // Today's passkey routes are aliases of the passkey row, each naming its purpose (today's
        // pages send none). The claim's keep today's 405 and 409 before reading the body.
        if (p === '/auth/claim/options' || p === '/auth/claim/verify') {
          if (req.method !== 'POST') return send(res, 405, 'text/plain', 'POST only');
          if (claimed) return json(res, 409, { error: 'this box is already claimed' });
          const body = asBody(await readJson(req));
          return flowAnswer(res, p === '/auth/claim/options' ? await startFlow(req, 'passkey', 'claim', body, null) : await finishFlow(req, 'passkey', 'claim', body, 'POST'));
        }
        if (p === '/auth/login' && req.method === 'GET') return page(res, claimed ? PAGES.login(safeNext(url.searchParams.get('next'))) : PAGES.unclaimed());
        // as today, options reads no body
        if (p === '/auth/login/options' && req.method === 'POST') return flowAnswer(res, await startFlow(req, 'passkey', 'sign-in', {}, null));
        if (p === '/auth/login/verify' && req.method === 'POST') {
          const body = asBody(await readJson(req));
          // as today, first: a challenge fetched before a reclaim must not open a session after it
          if (!store.load().passkeys.length) return json(res, 409, { error: 'this box is not claimed yet' });
          return flowAnswer(res, await finishFlow(req, 'passkey', 'sign-in', body, 'POST'));
        }
      }
      // What installing the hub fetches. Public: a browser asks for the manifest without the cookie, and
      // refreshes the worker after a session has ended. Nothing here says anything about the box.
      const installed = isBox && req.method === 'GET' ? INSTALL[p] : null;
      if (installed) return send(res, 200, installed.type, installed.body());
      const who = claimed ? sessionOf(req) : null;
      if (!who) {
        // On a project's name, the same bytes for every name; only its script can read the hash.
        if (label && claimed && navigating(req)) return send(res, 401, 'text/html; charset=utf-8', PAGES.signedOut(PUB), { 'content-security-policy': PAGE_CSP, 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' });
        if (navigating(req)) return redirect(res, claimed ? loginAt(`${own}${req.url}`) : loginAt());
        return send(res, claimed ? 401 : 403, 'text/plain; charset=utf-8', claimed ? 'sign in with your passkey' : 'this box is unclaimed');
      }
      const { session, person } = who;
      // who this session is, for the kit (kit-252): read here, once, before anything is forwarded
      const personH = personHeader(person);
      if (personH === false) return send(res, 500, 'text/plain; charset=utf-8', "this person's record can't be read");
      // Only now, with the session, does the name mean anything: a miss asks the hub once, shared.
      let port = null;
      let pv = null;
      if (label) {
        let found = resolveLabel(label);
        if (!found) { await refreshWithin(1000); found = resolveLabel(label); }
        if (found?.shared) return previewUnavailable(req, res, () => PAGES.sharedName(label));
        if (!found) {
          let stored = false;
          try { stored = Object.hasOwn(store.load().public ?? {}, label); } catch {}
          return previewUnavailable(req, res, () => PAGES.unknownHost(label, listRead, stored, [...projects].filter(([, c]) => c.length === 1).map(([n]) => n).sort(), [...previews.keys()].sort(), projectOrigin));
        }
        port = found.port ?? null;
        pv = found.preview ?? null;
      }
      const viewNo = viewRefusal(req, person, { isBox, isTerm, project: Boolean(port && !pv), p });
      if (viewNo) return send(res, 403, viewNo.type === 'text' ? 'text/plain; charset=utf-8' : 'application/json', viewNo.body);
      if (pv && !isOwner(person) && ownerOnlyPreview(pv)) return send(res, 403, 'text/plain; charset=utf-8', 'Only the box\'s owner can open the supervisor\'s browser.');
      // A preview's lens: the gateway's own page, after the session check, never the app's (spec §7).
      // Static, so it asks the hub nothing; any other method or path there is the app's, as before.
      if (pv && req.method === 'GET' && p === '/.devteam/lens') return send(res, 200, 'text/html; charset=utf-8', PREVIEW_LENS, { 'content-security-policy': lensCsp(pv), 'referrer-policy': 'no-referrer' });
      if (pv) return servePreview(req, res, pv, own);
      // An instance's dashboard, on its own subdomain: the request exactly as the browser sent it.
      if (port) {
        // another project's page under this name is no page: 404, never the dashboard (reserved
        // segments, /upload among them, are never another project's)
        if (anotherProjects(label, rawPath)) return send(res, 404, 'text/plain; charset=utf-8', 'not found');
        // dropped files, as on term. (receiveUpload, after the session and the Origin rule above), and served back
        if (rawPath === '/upload' && req.method === 'POST') { clearTimeout(bodyTimer); return await receiveUpload(req, res, url.searchParams.get('name')); }
        if (['GET', 'HEAD'].includes(req.method) && rawPath.startsWith('/upload/')) return await serveUpload(req, res, rawPath);
        const prefix = req.method === 'GET' && ['iframe', 'document'].includes(req.headers['sec-fetch-dest']) && ['same-origin', 'none'].includes(req.headers['sec-fetch-site']) ? ARTIFACT.exec(rawPath)?.[0] : null;
        if (prefix) return redirect(res, `${capFor(port, prefix, session)}${req.url}`);
        if (req.method === 'POST' && Object.hasOwn(SIGNED_POSTS, rawPath)) return signedPost(req, res, port, own, rawPath, SIGNED_POSTS[rawPath], personH, levelOf(person));
        const termSigner = req.method === 'POST' ? termPost(p) : null;
        if (termSigner) return signedPost(req, res, port, own, p, termSigner, personH, levelOf(person), termCap(res));
        // the viewer, by its path as the kit resolves it: the box may frame it only under the wrapper's grant
        const viewer = VIEWER.test(p) || VIEWER.test(rawPath) ? { granted: wrapGranted(label, rawPath, url) } : null;
        return proxy(req, res, { port, path: req.url, publicOrigin: own, viewer, person: personH, level: levelOf(person), extra: req.method === 'GET' && p === '/api/data' ? { 'x-devteam-public': publicMap(port), 'x-devteam-previews': '1' } : null });
      }
      // The terminal: the gateway's copy of ttyd's page. Only its socket reaches ttyd (see upgrade).
      if (isTerm) {
        if (req.method === 'GET' && p === '/') {
          let body;
          try { body = termPage().body; } catch { return send(res, 502, 'text/plain; charset=utf-8', 'This image has no terminal page.'); }
          return send(res, 200, 'text/html; charset=utf-8', body, { 'content-security-policy': TERM_CSP, 'referrer-policy': 'no-referrer' });
        }
        if (req.method === 'GET' && p === '/token') return json(res, 200, { token: '' });
        if (req.method === 'GET' && p === '/build') { try { return json(res, 200, { build: termPage().build }); } catch { return send(res, 502, 'text/plain; charset=utf-8', 'This image has no terminal page.'); } }
        // a session, and (like every POST, above) this page's own Origin: an agent's page has neither
        if (req.method === 'POST' && p === '/upload') { clearTimeout(bodyTimer); return await receiveUpload(req, res, url.searchParams.get('name')); }
        return send(res, 404, 'text/plain', 'not found');
      }
      if (isAuth) {
        if (p === '/auth/logout' && req.method === 'POST') {
          const now = store.load();
          store.save({ ...now, sessions: now.sessions.filter((x) => x.hash !== session.hash), ...(now.peopleSessions ? { peopleSessions: now.peopleSessions.filter((x) => x.hash !== session.hash) } : {}) });
          return json(res, 200, { ok: true }, { 'set-cookie': cookie('', 0) });
        }
        if (p === '/auth/people/invite' && req.method === 'POST') return await inviteRoute(req, res, who);
        if (p === '/auth/people/relink' && req.method === 'POST') return await relinkRoute(req, res, who);
        if (p === '/auth/people/list') {
          if (req.method !== 'GET') return refuse(res, 405, 'bad-request', 'the People list is read with GET');
          if (!seesPeople(person)) return refuse(res, 403, 'not-allowed', 'only the owner and admins see People');
          return json(res, 200, peopleList(store.load(), person));
        }
        if (p.startsWith('/auth/people/')) {
          const route = req.method === 'POST' && Object.hasOwn(PEOPLE_POSTS, p.slice(13)) ? PEOPLE_POSTS[p.slice(13)] : null;
          if (!route) return refuse(res, 404, 'not-found', 'no such People action');
          return await route(req, res, who);
        }
        // Each of these acts on the signed-in person's own methods only (ownMethods, removeMethod).
        // fresh_ms: how long this sign-in still counts as fresh, so the hub asks to confirm it's you
        // before trying a change that would be refused
        if (p === '/auth/method/list' && req.method === 'GET') { const now = store.load(); return json(res, 200, { methods: ownMethods(now, person), notices: noticesOf(now, person), fresh_ms: Math.max(0, (session.at ?? 0) + CHALLENGE_MS - Date.now()) }); }
        if (p === '/auth/passkeys' && req.method === 'GET') return fresh(session) ? page(res, PAGES.passkeys(ownMethods(store.load(), person).filter((m) => m.type === 'passkey').map((m) => ({ id: m.id, name: m.label, createdAt: m.added_at })), PUB)) : redirect(res, loginAt(`${PUB}/auth/passkeys`));
        if ((p.startsWith('/auth/passkeys/') || p === '/auth/method/remove') && !fresh(session)) return json(res, 403, { error: 'sign in again to change passkeys (reload this page)' });
        // the passkey row's add, after the gate and the fresh rule above (today's place and answers);
        // its finish re-checks the session, the person's role and freshness against the state as it is
        if (p === '/auth/passkeys/options' && req.method === 'POST') return flowAnswer(res, await startFlow(req, 'passkey', 'add', {}, who));
        if (p === '/auth/passkeys/verify' && req.method === 'POST') return flowAnswer(res, await finishFlow(req, 'passkey', 'add', asBody(await readJson(req)), 'POST'));
        if ((p === '/auth/method/remove' || p === '/auth/passkeys/remove') && req.method === 'POST') {
          const body = await readJson(req);
          const now = store.load();
          const held = stillHeld(now, session);
          if (!held) return json(res, 401, { error: 'your session ended; sign in again' });
          const out = removeMethod(now, held.person, body?.id, held.session);
          if (!out.next) return json(res, out.status, { error: out.error });
          store.save(out.next);
          log('a sign-in method was removed; its person\'s other sessions ended');
          return json(res, 200, { ok: true });
        }
        return send(res, 404, 'text/plain', 'not found');
      }
      // The box's own name: the gateway's copy of the hub page, what it needs to know, and the list.
      if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
        // a project listed a moment ago is framed at once: one shared read first, a second at most
        await refreshWithin(1000);
        return send(res, 200, 'text/html; charset=utf-8', hubPage, { 'content-security-policy': hubCsp(), 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' });
      }
      // The owner's wrapper of a published page, on the box's own name (ownerWrapper). Anything it
      // can't bind answers as any other unknown path here does.
      if (req.method === 'GET' && isBox && rawPath.startsWith('/w/')) {
        const wrap = ownerWrapper(rawPath);
        if (wrap) return send(res, 200, 'text/html; charset=utf-8', wrap.html, { 'content-security-policy': WRAP_CSP(wrap.origin), ...WRAP_HEAD });
        return send(res, 404, 'text/plain', 'not found');
      }
      // /box.json, box: 2: { box, terminal, project, passkeys, previews, push, image }. project is where a
      // project is (project-hosts@1), {project} its name. image is what the
      // box's image says it is (boxImage, from the image's ENV: its release and its tools' pins):
      // { release: 'vX.Y.Z' | null, tools: { name: version } } in the ENV's order, or null with neither
      // set (a laptop, an older image). Versions only. An additive change keeps box: 2.
      // role is the signed-in person's ('owner', 'admin' or 'member'); people, where the People list
      // is, for the owner and admins only, so the hub draws People for them alone.
      if (['GET', 'HEAD'].includes(req.method) && p === '/box.json') return json(res, 200, { box: 2, terminal: `${TERM}/`, project: `${pubUrl.protocol}//{project}.${NAME}${SUFFIX}/`, passkeys: `${PUB}/auth/passkeys`, previews: `${PUB}/dev/`, push: vapid().publicKey, image: BOX_IMAGE, role: roleOf(person), level: levelOf(person), ...(roleOf(person) === 'member' ? {} : { people: `${PUB}/auth/people/list` }) });
      if (req.method === 'GET' && p === '/instances.json') return instances(req, res);
      if (req.method === 'GET' && p === '/memory.json') return memory(req, res, url.searchParams);
      if (req.method === 'GET' && p === '/operator/threads') return operatorThreads(req, res, null, personH);
      if (req.method === 'POST' && p.startsWith('/operator/') && HUB_POSTS.includes(p.slice(10))) return operatorThreads(req, res, p.slice(10), personH);
      // a file for a thread with the operator: dropped as on an instance's name (the session and the Origin
      // rule above), and served back to the hub's own page alone, which its browser says it is
      if (req.method === 'POST' && rawPath === '/upload') { clearTimeout(bodyTimer); return await receiveUpload(req, res, url.searchParams.get('name')); }
      if (['GET', 'HEAD'].includes(req.method) && rawPath.startsWith('/upload/')) {
        if (req.headers['sec-fetch-site'] !== 'same-origin') return send(res, 403, 'text/plain; charset=utf-8', 'dropped files only to the hub\'s own page');
        return await serveUpload(req, res, rawPath);
      }
      if (req.method === 'POST' && p === '/push/subscribe') {
        const sub = pushSubscription(await readJson(req));
        if (!sub) return json(res, 400, { error: 'that is not a push subscription this box can send to' });
        // One device, one person: out of every list, then into the subscriber's, capped per person so
        // nobody can push the owner's devices off.
        const now = store.load();
        const held = stillHeld(now, session);
        if (!held) return json(res, 401, { error: 'your session ended; sign in again' });
        // moved to View while its body was read (the View rule ran at Full): no device, as the guard answers
        if (levelOf(held.person) === 'view') return json(res, 403, { error: VIEW_ANY, code: 'view-only' });
        const freed = keepSubs(now, (x) => x.endpoint !== sub.endpoint);
        store.save(withSubs(freed, held.person, [...subsOf(freed, held.person), sub].slice(-PUSH_DEVICES)));
        return json(res, 200, { ok: true });
      }
      // The hub's "is this working?": one push, to the device that asked, if it is the asker's own.
      if (req.method === 'POST' && p === '/push/test') {
        const body = await readJson(req);
        const now = store.load();
        const held = stillHeld(now, session);
        if (!held) return json(res, 401, { error: 'your session ended; sign in again' });
        const sub = subsOf(now, held.person).find((x) => x.endpoint === body?.endpoint);
        if (!sub) return json(res, 404, { error: 'this device is not subscribed: reload the hub' });
        let status;
        try { status = await sendPush(sub, PUSH_TEST); } catch (e) { return json(res, 502, { error: e.message }); }
        return status < 300 ? json(res, 200, { ok: true }) : json(res, 502, { error: `the push service answered ${status}` });
      }
      // Publishing: the gateway's own page, from the manifest it fetched itself, then a POST of what
      // that page showed (only from this page: the Origin rule above refuses any other).
      // Its pages open as a page only: another site's frame navigated here carries the cookie, and
      // would have the gateway ask an instance for up to 50 manifests each time.
      // Every preview on the box, the phone's way in: one tap from the hub, this one document only.
      if (req.method === 'GET' && (p === '/dev' || p === '/dev/')) {
        if (req.headers['sec-fetch-dest'] !== undefined && req.headers['sec-fetch-dest'] !== 'document') return send(res, 403, 'text/plain; charset=utf-8', 'open this page on its own, not in a frame');
        await refreshPreviews();
        const rows = (await Promise.all([...previews].map(async ([name, l]) => {
          if (l.ambiguous) return l.ambiguous.map((c) => ({ name, project: c.project, root: c.root, port: c.port, session: '', label: '', state: 'ambiguous (two instances)' }));
          return [{ name, project: l.project, root: l.root, port: l.port, session: l.session, label: l.label, state: (await previewHost(l.port)) ? 'answers' : 'not answering', link: `${previewOrigin(name)}/` }];
        }))).flat().sort((a, b) => a.root.localeCompare(b.root) || a.name.localeCompare(b.name));
        return page(res, PAGES.previewList(rows));
      }
      if (req.method === 'GET' && (p === '/public' || p.startsWith('/public/')) && req.headers['sec-fetch-dest'] !== undefined && req.headers['sec-fetch-dest'] !== 'document') return send(res, 403, 'text/plain; charset=utf-8', 'open this page on its own, not in a frame');
      if (req.method === 'GET' && p === '/public/publish') {
        // One proof for what the page shows; each item of the POST takes its own.
        const proved = await freshList(1000);
        const byName = url.searchParams.has('project') && !url.searchParams.has('port');
        if (byName && !proved) return send(res, 503, 'text/plain; charset=utf-8', publishBlocked(url.searchParams.get('project'), null));
        // by the project's name, or by an instance's port as an older dashboard sends it
        const named = url.searchParams.has('port') ? { port: Number(url.searchParams.get('port')) } : byName ? await projectPort(url.searchParams.get('project')) : { port: NaN };
        if (named.refused) return send(res, 409, 'text/plain; charset=utf-8', named.refused);
        const port = named.port;
        const slugs = [...new Set(url.searchParams.getAll('slug'))];
        if (!BLOCK.includes(port) || !slugs.length || slugs.length > 50 || !slugs.every((x) => LINK_ID.test(x))) return send(res, 400, 'text/plain; charset=utf-8', 'publish?project=<project>&slug=<slug>[&slug=…] (or ?port=<an instance of this box>), at most 50');
        const pub = store.load().public ?? {};
        // at most four manifests at a time: each is a node child on the instance, and Restore all asks for up to 50
        const rows = await mapPool(slugs, 4, async (slug) => {
          try {
            const m = await fetchManifest(port, slug);
            // however the instance was named, the manifest's project is judged against the proof
            const why = addressProblem(m) || publishBlocked(m.project, proved);
            if (why) throw new Error(why);
            const bound = Object.hasOwn(pub, m.project) ? pub[m.project] : null;
            const now = bound && Object.hasOwn(bound.artifacts ?? {}, slug) ? bound.artifacts[slug] : null;
            const moving = bound && bound.root !== m.root;
            // what the owner approved earlier, if this box still holds it: the only copy to compare with
            const held = now && !moving ? now : null;
            // a move takes down every other page of the old checkout: the page names them
            return { slug, m, hash: manifestHash(m), url: publicAddress(m.project, slug), held: !!held, changes: held && held.tree !== m.tree ? fileChanges(held.files, m.files) : null, state: !held ? 'not on this box' : held.tree === m.tree ? 'already public at this version' : 'an update', movedFrom: moving ? bound.root : null, others: moving ? Object.keys(bound.artifacts ?? {}).filter((x) => x !== slug).sort() : [] };
          } catch (e) { return { slug, error: e.message }; }
        });
        return page(res, PAGES.publish(port, rows));
      }
      if (req.method === 'POST' && p === '/public/publish') {
        const body = await readJson(req);
        const port = Number(body?.port);
        const items = Array.isArray(body?.items) ? body.items : [];
        if (!BLOCK.includes(port) || !items.length || items.length > 50 || !items.every((x) => x && typeof x.slug === 'string' && LINK_ID.test(x.slug) && typeof x.manifest === 'string' && /^[0-9a-f]{64}$/.test(x.manifest))) return json(res, 400, { error: 'publish takes { port, items: [{ slug, manifest, move, movedFrom }] }, 1 to 50 items' });
        const results = [];
        // a proof that failed stops the request: the rest get the same refusal and are not asked for
        let stopped = null;
        for (const it of items) {
          if (stopped) { results.push({ slug: it.slug, ok: false, error: stopped }); continue; }
          try { results.push({ slug: it.slug, ok: true, ...(await publishItem(port, it)) }); }
          catch (e) { results.push({ slug: it.slug, ok: false, error: e.message }); if (e.noProof) stopped = e.message; }
        }
        log(`public: ${results.map((x) => `${x.slug} ${x.ok ? 'published' : 'refused'}`).join(', ')} from instance ${port}`);
        return json(res, 200, { results });
      }
      // Taking a page down never waits on an instance: the gateway's copy goes first, then the record.
      if (req.method === 'GET' && p === '/public/unpublish') {
        const pub = store.load().public ?? {};
        const slug = url.searchParams.get('slug') ?? '';
        let port = url.searchParams.has('port') ? Number(url.searchParams.get('port')) : null;
        let project = url.searchParams.get('project');
        if (project === null && port !== null) {
          const named = Object.keys(pub).filter((n) => pub[n].port === port && Object.hasOwn(pub[n].artifacts ?? {}, slug));
          project = named.length === 1 ? named[0] : null;
        }
        if (!LINK_ID.test(slug) || (port !== null && !BLOCK.includes(port)) || !PROJECT.test(project ?? '')) return send(res, 400, 'text/plain; charset=utf-8', 'unpublish?project=<project>&slug=<slug>[&port=<instance>]');
        const a = Object.hasOwn(pub, project) && Object.hasOwn(pub[project].artifacts ?? {}, slug) ? pub[project].artifacts[slug] : null;
        if (!a) return send(res, 404, 'text/plain; charset=utf-8', `${project}/${slug} is not public on this box`);
        // by the project's name, the instance to tell is the one the list names (a shared name, none)
        if (url.searchParams.has('project') && port === null) port = (await projectPort(project)).port ?? null;
        // Never refused: a page nobody could take down is worse. Without a fresh list proving the name
        // one project's, the box can't know which instance holds the record, so it tells none.
        const proved = await freshList(1000);
        const shared = listedShared(project);
        return page(res, PAGES.unpublish({ project, slug, port: shared || !proved ? null : port, title: a.title, url: hostable(project) ? publicAddress(project, slug) : null, shared }));
      }
      if (req.method === 'POST' && p === '/public/unpublish') {
        const body = await readJson(req);
        const project = String(body?.project ?? '');
        const slug = String(body?.slug ?? '');
        const asked = body?.port === undefined || body?.port === null ? null : Number(body.port);
        if (!PROJECT.test(project) || !LINK_ID.test(slug) || (asked !== null && !BLOCK.includes(asked))) return json(res, 400, { error: 'unpublish takes { project, slug, port? }' });
        // A shared name, or no fresh list to say it isn't: only the gateway's copy comes down, and no
        // instance is told, even one sent, since the box can't know which one holds the record.
        const proved = await freshList(1000);
        const shared = listedShared(project);
        const port = shared || !proved ? null : asked;
        const root = await pstore.serial(() => {
          const now = store.load();
          const pub = { ...(now.public ?? {}) };
          const x = Object.hasOwn(pub, project) ? pub[project] : null;
          if (!x || !Object.hasOwn(x.artifacts ?? {}, slug)) return null;
          const artifacts = { ...x.artifacts };
          delete artifacts[slug];
          // the binding stays: another checkout of this name still needs "move it"
          pub[project] = { ...x, artifacts };
          store.save({ ...now, public: pub });
          // the page is down once saved; a blob the sweep can't drop is the next sweep's
          try { pstore.sweep(pub); } catch {}
          return x.root;
        });
        if (root === null) return json(res, 404, { error: `${project}/${slug} is not public on this box` });
        log(`public: ${project}/${slug} unpublished`);
        if (shared) return json(res, 200, { ok: true, recorded: false, shared: true, note: `${project}/${slug} is down. Two listed projects share that name, so it may have been the other project's page. No instance's record was written; the Library's Forget clears it.` });
        if (port === null) return json(res, 200, { ok: true, recorded: false, note: asked !== null ? 'the hub\'s list can\'t be read, so no instance\'s record was written; the Library\'s Forget clears it' : 'no instance was named, so the record wasn\'t written; the Library\'s Forget clears it' });
        try { await recordUnpublish(port, project, root, slug); return json(res, 200, { ok: true, recorded: true, note: null }); }
        catch (e) { return json(res, 200, { ok: true, recorded: false, note: `${e.message}; the Library's Forget clears it` }); }
      }
      if (req.method === 'GET' && (p === '/public' || p === '/public/')) return page(res, PAGES.publicList(store.load().public ?? {}, (n, s) => (hostable(n) ? publicAddress(n, s) : null)));
      return send(res, 404, 'text/plain', 'not found');
    } catch (e) {
      if (res.headersSent) return res.destroy();
      return json(res, e?.unreadable ? 503 : 400, { error: String(e?.message ?? e) });
    }
  });

  // A stuffed cookie jar (any page on an instance's name can write cookies for the whole box) would
  // otherwise answer 431 on every name, sign-in included, for good. Clearing the jar costs a sign-in.
  server.on('clientError', (e, socket) => {
    if (e.code !== 'HPE_HEADER_OVERFLOW') return socket.destroy();
    const body = 'Too many cookies; cleared. Reload to sign in.';
    socket.end(`HTTP/1.1 431 Request Header Fields Too Large\r\nclear-site-data: "cookies"\r\ncontent-type: text/plain\r\nconnection: close\r\ncontent-length: ${body.length}\r\n\r\n${body}`);
  });

  // The head of an upstream's answer to an upgrade, its headers under the same rules as any response.
  // A lone CR is refused: a browser may read it as a line break where this parse didn't.
  const previewHandshake = (head, own, port) => {
    if (/\r(?!\n)/.test(head)) return null;
    const [status, ...rows] = head.split(/\r?\n/);
    if (!/^HTTP\/1\.[01] \d{3}/.test(status)) return null;
    const parsed = {};
    let last = null;
    for (const row of rows) {
      // a folded continuation belongs to the header it follows, dropped with it if that is
      if (/^[ \t]/.test(row)) { if (last) parsed[last] = [].concat(parsed[last]).map((v, i, all) => (i === all.length - 1 ? `${v} ${row.trim()}` : v)); continue; }
      const i = row.indexOf(':');
      if (i < 1) { last = null; continue; }
      const k = row.slice(0, i).trim().toLowerCase();
      const v = row.slice(i + 1).trim();
      last = k;
      if (k === 'set-cookie') (parsed[k] ??= []).push(v);
      else parsed[k] = parsed[k] === undefined ? v : `${parsed[k]}, ${v}`;
    }
    const out = downstreamHeaders(parsed, null, own, port);
    const is101 = / 101\b/.test(status);
    const lines = [status, `connection: ${is101 ? 'Upgrade' : 'close'}`];
    for (const [k, v] of Object.entries(out)) for (const one of [].concat(v)) lines.push(`${k}: ${one}`);
    return lines.join('\r\n');
  };
  // A preview's sockets (HMR, mostly): the checks an instance's request gets, a cap per name so a
  // client's reconnect loop can't exhaust the gateway, and the terminal's raw relay. No hub refresh on
  // a miss: the page that opened the socket already made one.
  const PREVIEW_SOCKETS = 32;
  const previewSockets = new Map();
  // Every relayed socket (the terminal's and each preview's) by the person whose session opened it:
  // their row's id, or null for the stand-in owner. Added the moment the handshake's session check
  // passes, before anything is awaited, so a removal at any point after closes it.
  const heldSockets = new Map();
  const holdSocket = (socket, person) => {
    heldSockets.set(socket, { person: person?.id ?? null });
    socket.once('close', () => heldSockets.delete(socket));
  };
  const dropPerson = (id) => { for (const [sock, holder] of heldSockets) if (holder.person === id) sock.destroy(); };
  // A /presence or /canvas socket (presence@1 §2, canvas@1 §3) lives no longer than its session, at the level it opened with.
  // Looked at after every write (sign-out, removal, a level or role change), at the session's own end,
  // and each second while any is open, for a write by another process (devteam-reclaim). A state that
  // can't be read ends them all: the page tries again.
  const PRESENCE_POLL_MS = 1000;
  let presencePoll = null;
  const presenceOpen = () => [...heldSockets].filter(([, h]) => h.session);
  const endPresence = () => {
    const open = presenceOpen();
    if (!open.length) { clearInterval(presencePoll); presencePoll = null; return; }
    let s = null;
    try { s = store.load(); } catch {}
    for (const [sock, h] of open) {
      let now = null;
      try { now = s ? stillHeld(s, h.session) : null; } catch {}
      if (!now || (now.person.id ?? null) !== h.person || levelOf(now.person) !== h.level) sock.destroy();
    }
  };
  afterSave = endPresence;
  const holdPresence = (socket, { session, person }) => {
    holdSocket(socket, person);
    heldSockets.set(socket, { person: person?.id ?? null, session, level: levelOf(person) });
    // The session's end, by the wall clock its liveness is read by (liveSession). A timer runs on the
    // monotonic clock and can fire a little before the wall clock gets there, while the session still
    // reads live: it is then set again for what is left, so an early timer never leaves the close to
    // the next poll (kit-927).
    let end = null;
    const atEnd = () => {
      const left = session.expires - Date.now();
      if (left > 0) { end = setTimeout(atEnd, Math.min(left + 1, 2 ** 31 - 1)); end.unref(); return; }
      endPresence();
    };
    end = setTimeout(atEnd, Math.min(Math.max(session.expires - Date.now(), 0) + 1, 2 ** 31 - 1));
    end.unref();
    socket.once('close', () => clearTimeout(end));
    if (!presencePoll) { presencePoll = setInterval(endPresence, PRESENCE_POLL_MS); presencePoll.unref(); }
  };
  // The supervisor's browser view (the preview the hub labels so): whoever opens it drives the
  // owner's signed-in browser, so it is the owner's alone, under any name its port is listed by.
  const ownerOnlyPreview = (name) => {
    const link = previews.get(name);
    if (!link || link.ambiguous) return false;
    return browserPorts.has(link.port);
  };
  // A refusal, and the socket gone a second later even if the browser keeps its half open or sends on.
  const endUpgrade = (socket, code, msg) => {
    socket.on('error', () => {});
    socket.end(`HTTP/1.1 ${code} ${msg}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`);
    socket.resume();
    const t = setTimeout(() => socket.destroy(), 1000);
    t.unref();
    socket.once('close', () => clearTimeout(t));
  };
  // An upgrade, forwarded on a raw socket. extra: headers the gateway sets over the browser's.
  // answerMs: how long the upstream has to answer (0: no limit). only101: any other answer is told by
  // its status alone and both sides end, and nothing of the browser's goes on before a 101: a server
  // with no such socket (an older kit) would read what came next as requests the gateway never saw.
  const relayUpgrade = (req, socket, head, { port, host, own, loopbackHost, extra = null, answerMs = 0, only101 = false }) => {
    // each side's pipe listens to both: more than Node's 10 without any leak
    socket.setMaxListeners(20);
    const up = net.connect(port, host);
    const late = answerMs ? setTimeout(() => socket.destroy(), answerMs) : null;
    late?.unref();
    socket.once('close', () => clearTimeout(late));
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
    socket.on('close', () => up.destroy());
    up.once('close', () => socket.destroy());
    up.on('connect', () => {
      if (socket.destroyed) return up.destroy();
      const h = { ...upstreamHeaders(req, port, own, { loopbackHost }), ...extra };
      h.connection = 'Upgrade';
      h.upgrade = req.headers.upgrade;
      const lines = [`GET ${req.url} HTTP/1.1`, ...Object.entries(h).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)];
      up.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head?.length && !only101) up.write(head);
      // The handshake's answer gets the rules any response does (cookies above all): held until its
      // headers are whole, then relayed, so a Set-Cookie on a 101 can't shadow anything either.
      let held = Buffer.alloc(0);
      const onHead = (chunk) => {
        held = Buffer.concat([held, chunk]);
        const text = held.toString('latin1');
        const end = /\r?\n\r?\n/.exec(text);
        if (!end) { if (held.length > 64 * 1024) { up.destroy(); socket.destroy(); } return; }
        up.off('data', onHead);
        clearTimeout(late);
        const status = /^HTTP\/1\.[01] (\d{3})(?: |\r|\n|$)/.exec(text)?.[1];
        if (only101 && status !== '101') {
          up.removeAllListeners('close');
          up.destroy();
          return endUpgrade(socket, status && status >= '400' ? status : '502', 'Refused');
        }
        const filtered = previewHandshake(text.slice(0, end.index), own, port);
        if (!filtered) { up.destroy(); socket.destroy(); return; }
        socket.write(Buffer.from(`${filtered}\r\n\r\n`, 'latin1'));
        if (only101 && head?.length) up.write(head);
        const rest = held.subarray(end.index + end[0].length);
        if (rest.length) socket.write(rest);
        pipeline(up, socket, () => {});
        pipeline(socket, up, () => {});
      };
      up.on('data', onHead);
      return undefined;
    });
    return undefined;
  };
  const previewUpgrade = async (req, socket, head, name, refuse) => {
    const own = previewOrigin(name);
    if (req.headers.origin !== own) return refuse(403, 'Forbidden');
    let who = null;
    try { who = store.load().passkeys.length ? sessionOf(req) : null; } catch { return refuse(503, 'Service Unavailable'); }
    if (!who) return refuse(401, 'Unauthorized');
    if (who.person?.level === 'view') return refuse(403, 'Forbidden');
    if (!isOwner(who.person) && ownerOnlyPreview(name)) return refuse(403, 'Forbidden');
    holdSocket(socket, who.person);
    const link = previews.get(name);
    // a project's name that has the form of a preview's: no socket of its but /presence and /canvas
    if (!link && projects.has(name)) return refuse(421, 'Misdirected Request');
    if (!req.url.startsWith('/') || req.url.startsWith('//')) return refuse(400, 'Bad Request');
    if (!link || link.ambiguous) return refuse(503, 'Service Unavailable');
    const open = previewSockets.get(name) ?? new Set();
    if (open.size >= PREVIEW_SOCKETS) return refuse(429, 'Too Many Requests');
    const host = await previewHost(link.port);
    if (socket.destroyed) return undefined;
    if (!host) return refuse(503, 'Service Unavailable');
    if (open.size >= PREVIEW_SOCKETS) return refuse(429, 'Too Many Requests');
    previewSockets.set(name, open);
    open.add(socket);
    const drop = () => { open.delete(socket); if (!open.size && previewSockets.get(name) === open) previewSockets.delete(name); };
    socket.once('close', drop);
    return relayUpgrade(req, socket, head, { port: link.port, host, own, loopbackHost: 'localhost' });
  };
  // A page's presence socket (presence@1 §2), on a project's name or the box's own, or its canvas
  // socket (canvas@1 §3, the same handshake), on a project's name alone: that name's Origin
  // (an artifact frame's is null), a session, at any level, and the person and level the gateway says.
  // Project and preview names share a form, so the list decides, once there is a session.
  const PRESENCE_ANSWER_MS = opts.presenceAnswerMs ?? 10000; // only a test shortens it
  const presenceUpgrade = async (req, socket, head, label, refuse) => {
    const own = label ? projectOrigin(label) : PUB;
    if (req.headers.origin !== own) return refuse(403, 'Forbidden');
    let who = null;
    try { who = store.load().passkeys.length ? sessionOf(req) : null; } catch { return refuse(503, 'Service Unavailable'); }
    if (!who) return refuse(401, 'Unauthorized');
    const person = personHeader(who.person);
    if (person === false) return refuse(500, 'Internal Server Error');
    holdPresence(socket, who);
    socket.on('error', () => socket.destroy());
    let port = HUB_PORT;
    if (label) {
      let found = resolveLabel(label);
      if (!found) { await refreshWithin(1000); found = resolveLabel(label); }
      if (socket.destroyed) return undefined;
      if (!found?.port) return previewOf(req.headers.host) && !found?.shared ? previewUpgrade(req, socket, head, label, refuse) : refuse(421, 'Misdirected Request');
      port = found.port;
    }
    return relayUpgrade(req, socket, head, { port, host: '127.0.0.1', own, loopbackHost: '127.0.0.1', extra: person ? { 'x-devteam-person': person, 'x-devteam-level': levelOf(who.person) } : null, answerMs: PRESENCE_ANSWER_MS, only101: true });
  };
  // The terminal's WebSocket, on the terminal's name, its Origin, a session; any preview's; presence; and a canvas.
  server.on('upgrade', (req, socket, head) => {
    const refuse = (code, msg) => endUpgrade(socket, code, msg);
    const label = labelOf(req.headers.host);
    // the path exactly as sent, less a query, as the relay reads it: only /presence is /presence, and
    // only /canvas is /canvas (canvas@1 §3), which a project's dashboard serves and the hub doesn't
    const route = req.method === 'GET' ? req.url.split('?')[0] : null;
    if ((route === '/presence' && (label || req.headers.host === pubUrl.host)) || (route === '/canvas' && label)) return presenceUpgrade(req, socket, head, label, refuse).catch(() => socket.destroy());
    const pv = previewOf(req.headers.host);
    if (pv) return previewUpgrade(req, socket, head, pv, refuse).catch(() => socket.destroy());
    if (req.headers.host !== termHost) return refuse(421, 'Misdirected Request');
    if (req.headers.origin !== TERM) return refuse(403, 'Forbidden');
    let who = null;
    try { who = store.load().passkeys.length ? sessionOf(req) : null; } catch { return refuse(503, 'Service Unavailable'); }
    if (!who) return refuse(401, 'Unauthorized');
    if (who.person?.level === 'view') return refuse(403, 'Forbidden');
    holdSocket(socket, who.person);
    let p;
    try { p = new URL(req.url, PUB); } catch { return refuse(400, 'Bad Request'); }
    if (!req.url.startsWith('/') || p.pathname !== '/ws') return refuse(404, 'Not Found');
    const up = net.connect(ttydPort, '127.0.0.1');
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
    socket.on('close', () => up.destroy());
    up.on('connect', () => {
      if (socket.destroyed) return up.destroy();
      const h = upstreamHeaders(req, ttydPort, null);
      delete h.origin;
      h.connection = 'Upgrade';
      h.upgrade = req.headers.upgrade;
      const lines = [`GET ${p.pathname}${p.search} HTTP/1.1`, ...Object.entries(h).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)];
      up.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head?.length) up.write(head);
      pipeline(up, socket, () => {});
      pipeline(socket, up, () => {});
    });
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.requestTimeout = REQUEST_MS;
  return { server, publicUrl: PUB, pollPush, sweepUploads, previewOf, safeNext, wrapGrant, threadPublicKey: () => threadKey(store).publicKey };
}

