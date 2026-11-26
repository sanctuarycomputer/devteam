// A rule that collides with 10-each: it writes notes/same.txt (10-each's files/ writes it) and changes
// whereAmI (10-each's rule changes it). With both areas, each pair is a conflict and neither applies.
export const rules = [{
  name: 'collide',
  apply(t) {
    t.write('notes/same.txt', 'written by 60-rules\n');
    t.replace('whereAmI', 'function whereAmI() { return \'60-rules\'; }');
    return { changed: [{ file: 'notes/same.txt' }, { decl: 'whereAmI' }], refused: [] };
  },
}];
