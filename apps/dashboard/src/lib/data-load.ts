// kit-989: how long data's /api/data read waits before it gives up (index.html:12341). No imports and no DOM at
// import: compiled to lib-dist/lib/data-load.js.
// A refresh gives up after READ_GIVE_UP_MS, so one read the server never answers can't hold the
// one-at-a-time guard: the next poll tries again. The first read waits as long as the server does.
export const READ_GIVE_UP_MS = 30000;
