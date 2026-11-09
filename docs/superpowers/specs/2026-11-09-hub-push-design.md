# Hub notifications by Web Push, and an installable hub

## Goal
The hub on a cloud box can be added to an iPhone's Home Screen and sends push notifications, which reach the Lock Screen, as new items arrive in any Inbox. Notifications match the desktop hub's and live only on the hub.

## Decisions
- **Content matches the hub's existing notification:** "`<name>`: N new in the Inbox", the repo root as the body, one tag per root, and a tap opens that instance's tab. Count only, no question text.
- **On a box, every browser uses push**, desktop included, so there is one code path and no duplicates. The laptop hub (`127.0.0.1:4320`) keeps in-page notifications because push can't reach it.
- **Dashboards no longer notify.** The Inbox count in the tab title stays.
- **The gateway does the watching.** It reads the hub's list every 10 seconds, so nothing depends on an open page. Counts are saved in the gateway's state, so a restart isn't news. A new instance counts from zero.
- **Node only, no dependencies:** RFC 8291 encryption and RFC 8292 signing with `node:crypto`. The signing key sits with the passkeys, unreadable by agents.
- **Sign-in moves to `box.example.com/auth`.** An installed app has its own cookies, and a link outside its scope opens a separate sheet, so sign-in must stay in scope. The relying party becomes the box's name, so existing passkeys need `devteam-reclaim` once.
- **Dashboards and the terminal stay on their own subdomains.** A path-based single origin would put agent-served pages on the same origin as the hub and sign-in.

## Security
- Hub and sign-in share an origin and are both gateway-only bytes.
- A dashboard's page may request a passkey under the parent name, but the gateway accepts only answers whose origin is the box's own.
- Subscribing and the test push need a session and the box's Origin. Endpoints must be on a known push service, over https, on the default port.
- The hub's list is untrusted: ports must be in the block, and text and the record of counts are capped.
- Removing a passkey or running `devteam-reclaim` clears all subscriptions.
- The manifest, icons and worker are public because browsers fetch them without the cookie. They reveal nothing about the box. The worker has no fetch handler.

## Test push
Tapping "Notifying you of new Inbox items" sends one test notification to the device that tapped, and reports a refusal from the push service.

## Testing
Unit: the RFC 8291 vector, token claims and signature, count rules, subscription validation. Integration: subscribing, delivery, decryption with a separate receiver, restart, dropped subscriptions, revocation. Manual: real delivery on an iPhone.
