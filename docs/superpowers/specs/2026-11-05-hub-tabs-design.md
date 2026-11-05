# Hub tabs: every instance's dashboard in one page

Date: 2026-11-05. Builds on `2026-11-04-devteam-hub-design.md` (v0.19.0).

## Goal

`http://127.0.0.1:4320` becomes one page for every devteam instance on the machine. A tab bar across the top has one tab per instance: the project name, with a badge when its Inbox has something. Selecting a tab shows that instance's own dashboard below the bar. The owner can switch between projects and see, in one view, which ones are waiting on them.

## Non-goals

- No proxy and no shared origin. Each dashboard is still served by its own repo's kit, on its own port and origin, inside a frame.
- No owner powers on the hub page. Every action happens in the instance's own dashboard.
- No hosted deployment (still the later spec).

## Design

### The tab bar

- **Tabs.** One tab per instance in `/instances.json`, ordered by root path, as the hub lists them now. The label is `name`, plus a badge with the Inbox count when it's above 0. On hover, a tab shows its repo root, kit version and fleet state (the details the v0.19.0 cards showed). An instance whose `inbox` is still `null` shows "starting" in its tooltip and no badge.
- **Refresh.** The bar follows `/instances.json`, re-read every 10 s as now.
  - An instance that appears gets a tab.
  - An instance that disappears keeps its tab for 30 s, dimmed (a dashboard restarting isn't gone), and then the tab and its frame are removed.
  - Instances are told apart by root path, not by name or port: two projects can share a name, and a restarted dashboard can come back on another port. A tab whose instance comes back on a new port reloads its frame at the new address.
- **Empty.** No instances: the message "No devteam dashboards are running on this machine."

### Showing a dashboard

- **The frame.** Selecting a tab shows that instance's dashboard in a frame filling the rest of the page: `src = http://127.0.0.1:<port>/`.
- **Loading.** A frame loads the first time its tab is selected, then stays loaded and hidden while other tabs are shown. Its scroll position and unsent notes survive, and its data keeps refreshing. Frames never opened cost nothing.
- **The URL** keeps the selection: `#<name>`, or `#<name>-<6 hex of the root>` when two instances share a name. A reload or bookmark lands on the same instance.
- **First open.** With no selection in the URL, the hub selects the first instance with something in its Inbox, else the first instance.

### Framing is allowed only for the hub

- Today the dashboard page sends no `frame-ancestors`, so any web page can frame the owner's dashboard and trick a click onto an owner action (clickjacking).
- The dashboard's `GET /` now sends `frame-ancestors 'self' http://127.0.0.1:<HUB_PORT> http://localhost:<HUB_PORT>`, so only the dashboard itself and the machine's hub can frame it. The existing `frame-src 'self'` stays.
- The hub page's own policy adds `frame-src http://127.0.0.1:<range>`, the 25 instance ports (as explicit `http://127.0.0.1:p` sources), so the hub can frame only instances in the block. `connect-src 'self'` and `frame-ancestors 'none'` stay.
- Owner actions inside a frame work unchanged: they are same-origin requests from the dashboard's own document, with the dashboard's own Host and Origin.

### Notifications live on the hub

- Browsers don't let a page inside a cross-origin frame ask for notification permission, so a dashboard's "Notify me" can't work inside a tab.
- The hub page gets one "Notify me of new Inbox items" control. When any instance's Inbox count goes up between two reads, the hub shows a browser notification, "`<name>`: N new in the Inbox", and clicking it selects that tab.
- The first read after the page loads only sets a baseline and never notifies.
- Inside a frame, the dashboard hides its own control, since it can't work there and the hub covers it. It detects the frame with `window.top !== window`.

## Testing

- **Kit test (hub):** the dashboard's `GET /` sends a `frame-ancestors` naming the hub's port. The hub page's policy has `frame-src` covering the block. The hub page contains the tab bar's script hooks.
- **Browser check (headless Chrome, fixture instances on test ports):**
  - two instances render two tabs, and the one with an open question shows a badge;
  - selecting a tab shows its dashboard in the frame;
  - the URL hash selects a tab on load.
- **Framing refused:** a page on another origin that frames a dashboard gets nothing. Checked by the header in the kit test; the browser enforces it.

## Migration

None. Restart the dashboard after the sync. The hub page is served by whichever dashboard holds 4320, so the tabs appear once any instance runs this version.
