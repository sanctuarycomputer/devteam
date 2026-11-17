# Task review: T3 (gateway routes), pass 1

- Reviewer: task-reviewer-t3 (fresh subagent, claude-opus)
- Reviewed: a17f6959d214f6afce2362ad24f2ee2c3742cff6 (5908bbf0..a17f6959)

Spec compliance: ✅ §4 and §5 are met as written. Both routes are in the `if (port)` branch, before the artifact redirect. `serveUpload` follows the §5 rule step by step, and the tests for A1-A3, A9 (gateway half), C1/C2/C4 (box half) are real and pass.

What I checked (named risks):
- **Order.** In `cloud/gateway.mjs` ~1997-2071, the routes come after the host dispatch (421), the top-level non-GET Origin rule (`origin !== own`, where own is `instanceOrigin(port)`), the service-worker refusal, `/c/` caps, `crossSiteOk` and the session check (401/302). `term.`, `public.` and the box's own name have no new code. `public.` returns before the Origin rule, as before, and A3 shows it takes no upload.
- **serveUpload.** It matches `rawPath` (`req.url.split('?')[0]`, never decoded) against `^/upload/([^/]+)/([^/]+)$`. Then: `UPLOAD_FOLDER` (anchored, no `g` flag), not `.part`, `name === safeUploadName(name)`, realpath containment with `root + path.sep`, `O_NOFOLLOW` open plus `fstat().isFile()`, and 404 on anything else. Every 200 and HEAD carries nosniff, `sandbox`, no-store and no-referrer. `uploadType` puts only `.png .jpg .gif .webp` inline (`Object.hasOwn`, case-sensitive; `.PNG` can't be a stored name anyway). Everything else is octet-stream plus attachment. The Content-Disposition filename can only hold `[A-Za-z0-9._-]` (it is equal to `safeUploadName`), so no quote, CR or LF can get into the header. An error after the headers destroys the response; `pipeline` closes the file when the reader leaves.
- **Catch guard.** `res.destroyed || req.socket?.destroyed`: the stall timer's `req.destroy()` destroys the socket of an incomplete request at once, and so does a client abort, so neither tries to answer. A failure after the whole body has arrived is answered 500. A box version of the T2-1 case covers it, and the implementer's mutation (old guard) shows it fails without the change. `term.` uses the same function; the report says gateway.test.mjs passed 74/74 unchanged (I did not rerun it, per the brief).
- **Symlink to another stored file (implementer's note).** §5 asks only that the realpath "lie inside realpath(root)" and be a regular file. A link inside the root is allowed by the spec's own words, and only gw (the root's only writer, 0750) could plant one. Not a defect; see T3-1.
- **Tests.** They drive a real `createGateway` on a real socket, claimed with a software passkey. `cbor`, `authenticator` and `freePort` are copied, not imported. No lib file was added. `t.after` closes connections and the server and removes the base; `<root>-evil` is under the base, so it goes too. I ran `test/attachments.test.mjs` at a17f6959: 19 tests, 18 pass, 0 fail, 1 skipped (the existing ON_A_BOX skip).

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T3-1 | Suggestion | | cloud/gateway.mjs:1970 (`serveUpload` containment) | Containment allows any regular file under the root (for example a link to `<root>/not-ours/x` or to another folder's `.part`). §6's `attachedFiles` requires the realpath to be exactly `realpath(root)/<folder>/<n>`. Holding the GET to that same equality (`real === path.join(root, m[1], m[2])`) would make the two rules one, and would close the gw-planted-link case at no cost. It is optional: §5 as written is met. | |

Verdict: APPROVE a17f6959d214f6afce2362ad24f2ee2c3742cff6
