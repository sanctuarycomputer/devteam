#!/usr/bin/env node
// devteam's gateway: the one public listener on a cloud box. It lets in only the owner, by a
// passkey registered when the box was claimed, and passes the owner through to the machine's hub
// (box.example.com), a web terminal on the box's tmux server (term.box.example.com), and each
// project's dashboard at a host of its own, its name (alpha.box.example.com: project-hosts@1, below).
// Signed out, a navigation on a project's host gets the gateway's signed-out page, the same for a
// listed name and a made-up one, which sends the whole address, hash included, to sign-in. Signing
// in and passkeys are under /auth on the box's name, so an installed hub signs in without leaving
// its own scope. Every agent runs as the box's user and can change files and take ports, so the box
// and term names serve only bytes the gateway holds: its own copy of the hub page and of ttyd's
// page, and its own pages. Only the hub's JSON (its list, and the owner's threads with the operator)
// and the terminal's socket come from behind it. An agent's page can exist only on a project's or a
// preview's host. The gateway also sends the hub's notifications, by Web Push.
// Behind it the kit runs unchanged: every proxied request looks to the kit like a local browser's,
// and the kit's loopback origins in its response headers are mapped to the public ones.
// A file the owner drops on the terminal is the one thing it stores for the agents' side: under a
// folder only it writes, and handed over as a path pasted into the terminal.
// A session's running dev server gets a name of its own too (cool-tiger.box.example.com), behind the
// owner's session like a project, from the hub's list; the gateway holds nothing about them, never
// picks between two claimants of one name, and box.example.com/dev/ lists them.
// A project's public pages are at <project>.<box>/<slug>/, for anyone, from the gateway's own copy of
// what the owner published.
// The kit's viewers (for threads) lean on it twice. A preview's name answers /.devteam/lens, the
// gateway's own page that frames the app, and the app's own framing headers give way for that one
// frame. The signed-in owner's own visit to a published page is sent to the owner's wrapper on the
// box's own name, <box>/w/<project>/<slug>/, a page of the gateway's framing that project's viewer at
// the published version, under a grant bound to project, slug and tree; everyone else, and any
// doubt, gets the published bytes. A project's host reads the cookie on a published page for that
// choice alone.
// Node only, no dependencies. Usage: node gateway.mjs [serve | reclaim]
// project-hosts@1: where a project is on a box
// This section is the definition the gateway moves to: the address of a project on a box. Until the
// gateway follows it, the lines above describe today's names. A new reserved segment, or any change
// to these rules, bumps the version.
// A project is https://<project>.<box>/, its dashboard, behind the owner's sign-in. <project> is the
// project's name (the name /api/hello gives: settings.md's `project`, else the folder's name) when
// it passes the label rule.
// A public page is https://<project>.<box>/<artifact>/..., for anyone, from the gateway's store (no
// sign-in).
// The label rule: a DNS label of a-z, 0-9 and -, no leading or trailing -, 1 to 63 characters, not
// all digits, and not `term`, `public` or `www`:
//   label: /^(?!\d+$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
// A name two projects share gets no dashboard on its host; its stored pages still answer (the store
// ties each page to the one project folder that published it). A preview whose generated name is a
// project's is not served under it: the name is the project's. A host is known from the hub's list
// (projects first, then previews) or the gateway's store (published pages).
// Reserved first segments, the paths the dashboard and the gateway answer on a project's host: `api`,
// `artifact`, `c`, `healthz`, `index.html`, `presence`, `public-manifest`, `review`, `upload`, `view`. They are
// checked before the store, so a page stored under one never answers on a project's host, and
// Publish refuses those names. The path decides first, in this order. A reserved segment is never a
// published page: it is checked as on today's names (`healthz` is the gateway's own answer, a `c`
// link keeps its own check, every other one needs the session) and, but for `healthz`, goes to the
// project's port. Then a first segment that is not reserved and is a page that name published is
// served to anyone. Anything else needs the session and goes to the project's port, for a name only
// one listed project has.
// Gone, and not redirected: <port>.<box> (all-digit labels) and public.<box>, both 421.
// The box's own name keeps the hub, sign-in (/auth), passkeys, pushes and /dev/. Publish's pages name
// the project: /public/publish?project=<project>&...; ?port= is still accepted from older dashboards.
// /box.json becomes box: 2: `project`, https://{project}.<box>/, in place of `instance`
// (https://{port}.<box>/); its other keys stay.
// The cases are in test/fixtures/project-hosts.json, which the gateway's, the hub's and the
// dashboard's tests read.
// end project-hosts@1
// people@1: who is on a box, in the gateway's state.json beside today's fields
// Today's fields keep their meaning, the owner's: `passkeys` (the owner's passkeys), `sessions` (the
// owner's sessions; each new one also names the passkey it was opened with as `method`), `pushSubs`
// (the owner's devices), `claimHash`/`claimExpires`. "Claimed" stays `passkeys` not empty. So a gateway
// older than this one, which reads only these, lets in the owner alone; it keeps the fields below
// (it writes { ...load(), … }), unread, until a newer gateway returns.
// people: [{ id, name, role, level, methods, pushSubs, added_at, last_seen, notices, rev }]
//   id `p-` + 12 of [a-z2-7]; role 'owner' | 'admin' | 'member', exactly one owner; level 'full' |
//   'view', an admin always full. The owner's row is named "Owner" when made (on the claim, or on
//   the first start over a claimed box); its `methods` hold only the owner's non-passkey methods and
//   its `pushSubs` stay [], since theirs are the top-level fields. `rev` starts at 1 and goes up on
//   every change to the row's name, role, level or methods (not last_seen, nor a method's last_used).
//   notices: [{ kind, at, … }]; kind 'people-reset' carries sessions_ended, invites_deleted and
//   methods_deleted (below).
// A method: { id, type, key, label, added_at, last_used, data }. id `m-` + 12 of [a-z2-7]. A passkey
//   is type 'passkey', key its credential id (base64url), data { userId, jwk, alg, signCount, rp }.
//   (type, key) is unique on the box, the owner's top-level passkeys counted as ('passkey', id).
// peopleSessions: [{ hash, person, method, at, expires }], everyone's but the owner's, each live only
//   while its person's row exists; dropped when expired, as `sessions` are.
// invites: [{ hash, person, expires }].
// peopleStamp: b64u(sha256("devteam-people-stamp-v1\n" + the owner's passkey ids, sorted, joined by
//   "\n")), written with every change this gateway makes to `passkeys`. On start, a stamp that isn't
//   that of `passkeys` means an older gateway reset the owner (a reclaim, a passkey removed or added):
//   every peopleSessions entry and invite goes, and every method in the owner's row with the owner's
//   sessions opened with one, in one write that adds a 'people-reset' notice to the owner's row.
// A new method type adds values of `type` and its `data`; any other change bumps the version.
// end people@1
// In the generated tree (test/split/overlay/gateway, kit-894) this file is the gateway's entry: it
// loads every module under cloud/gateway/ in the manifest's order, re-exports the names the single
// file exported, and runs its command line, whose main-module check is this file's.
import fs from 'node:fs';
import { PUSH_POLL_MS } from './gateway/base.mjs';
import { UPLOAD_SWEEP_MS } from './gateway/assets.mjs';
import { boxImage } from './gateway/base.mjs';
import { claimUrl } from './gateway/base.mjs';
import { createGateway } from './gateway/server.mjs';
import { env } from './gateway/base.mjs';
import { fileURLToPath } from 'node:url';
import { gatewayDir } from './gateway/base.mjs';
import { newClaim } from './gateway/base.mjs';
import { publicUrl } from './gateway/base.mjs';
import { stamped } from './gateway/base.mjs';
import { stateStore } from './gateway/base.mjs';
import { threadKey } from './gateway/base.mjs';
import './gateway/base.mjs';
import './gateway/assets.mjs';
import './gateway/server.mjs';
import './gateway/pages.mjs';
export { HOST_LABEL, PREVIEW_NAME, RESERVED_LABELS, RESERVED_SEGMENTS, boxImage, cborDecode, coseToJwk, encryptPush, hubSignature, ownerSettingSignature, paneSignature, parseAuthData, previewLinks, pushSubscription, redactClaimLinks, termSignature, threadKey, vapidToken, verifySignature } from './gateway/base.mjs';
export { ARTIFACT_MAX, FILE_MAX, LINK_ID, PREVIEW_LENS, PROJECT, PUBLIC_CDNS, PUBLIC_TYPES, TREE, UPLOAD_RULES, alertNews, canonicalJson, dropNote, dropPaste, dropSpace, gitBlobId, gitTreeId, iconPng, inboxNews, isDropImage, manifestProblem, previewLensCsp, publicCsp, publicPathOk, publicStore, replaceFrameAncestors, safeUploadName, shellQuote } from './gateway/assets.mjs';
export { createGateway } from './gateway/server.mjs';

// --- command line ------------------------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const cmd = process.argv[2] ?? 'serve';
  try {
    if (cmd === 'serve') {
      const { server, publicUrl: pub, pollPush, sweepUploads } = createGateway({ port: Number(env.PORT ?? 8080) });
      setInterval(() => pollPush().catch((e) => process.stdout.write(`gateway: notifications: ${e.message}\n`)), PUSH_POLL_MS);
      const sweep = () => sweepUploads().catch((e) => process.stdout.write(`gateway: dropped files: ${e.message}\n`));
      sweep();
      setInterval(sweep, UPLOAD_SWEEP_MS);
      const port = Number(env.PORT ?? 8080);
      process.stdout.write(`image: ${boxImage(env)?.release ?? 'none'}\n`);
      // every address, IPv6 too: a port left open on either family is one an agent could take
      const up = () => process.stdout.write(`gateway: ${pub} on :${port}\n`);
      const fallback = (e) => { if (e.code !== 'EAFNOSUPPORT' && e.code !== 'EADDRNOTAVAIL') throw e; server.listen(port, '0.0.0.0', up); };
      server.once('error', fallback);
      server.listen(port, '::', () => { server.off('error', fallback); up(); });
      for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
    } else if (cmd === 'reclaim') {
      // Lost every passkey: forget them and every session, and print a new claim link. Run it in a
      // shell on the box (Render's Shell tab, fly ssh console): that access is the root of trust.
      const pub = publicUrl();
      const store = stateStore(gatewayDir());
      // Everyone's sessions and every invite go too, and the owner's other methods, since whoever
      // claims next is the owner; other people keep theirs, to be checked in People after the claim.
      const s = store.load();
      const people = s.people?.map((p) => (p.role === 'owner' ? { ...p, methods: [], rev: p.rev + 1 } : p));
      store.save(stamped({ ...s, passkeys: [], sessions: [], pushSubs: [], peopleSessions: [], invites: [], ...(people ? { people } : {}) }));
      process.stdout.write(`every passkey and session is forgotten. Claim the box again: ${claimUrl(pub, newClaim(store))}\n`);
      const n = (people ?? []).filter((p) => p.role !== 'owner' && p.methods.length).length;
      if (n > 0) process.stdout.write(`${n} other ${n === 1 ? 'person' : 'people'} can still sign in: check who they are in the hub's Settings › People after claiming\n`);
    } else if (cmd === 'thread-key') {
      // The public half of the key that signs the owner's thread presses, for the boot to put where
      // only root can write and every user can read (cloud/Dockerfile, /etc/devteam/thread-key.pub).
      process.stdout.write(threadKey(stateStore(gatewayDir())).publicKey);
    } else {
      process.stderr.write('usage: node gateway.mjs [serve | reclaim | thread-key]\n');
      process.exit(2);
    }
  } catch (e) {
    process.stderr.write(`gateway: ${e.message}\n`);
    process.exit(1);
  }
}
