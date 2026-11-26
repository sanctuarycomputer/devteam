// Changes two declarations and names only one: --verify accepts helper and still names other.
export const rules = [{
  name: 'half-named',
  apply(t) {
    t.replace('helper', 'function helper() { return 10; }');
    t.replace('other', 'function other() { return 20; }');
    return { changed: [{ decl: 'helper' }], refused: [] };
  },
}];
