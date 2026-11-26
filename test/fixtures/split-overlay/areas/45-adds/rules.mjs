// Adds a declaration the source doesn't have (a setter after other) and names it: --verify accepts it
// where the overlay put it, once.
export const rules = [{
  name: 'setter',
  apply(t) {
    t.replace('other', `${t.decl('other').text}\nfunction setOther() { return 3; }`);
    return { changed: [{ decl: 'setOther' }], refused: [] };
  },
}];
