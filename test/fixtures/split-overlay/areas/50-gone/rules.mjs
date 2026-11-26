// Rules that leave the tree stale: a site the tool can't place, a site the rule refuses, and a rule
// that throws (its write is discarded).
export const rules = [
  { name: 'gone', apply() { return { changed: [{ decl: 'nowhere' }], refused: [] }; } },
  { name: 'refuser', apply() { return { changed: [], refused: [{ site: 'serve', why: 'the pattern is not there' }] }; } },
  { name: 'thrower', apply(t) { t.write('THROWN.txt', 'never written\n'); throw new Error('boom'); } },
];
