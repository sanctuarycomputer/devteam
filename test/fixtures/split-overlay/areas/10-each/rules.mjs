// An overlay area using every kind (rules and a check here; overrides/, files/ and patches/ beside).
// The rule moves whereAmI off import.meta.url, and writes order/10-each.txt, which 20-later's rule
// reads, so a test can read the order rules ran in; the check refuses any module still reading
// import.meta.url.
export const rules = [{
  name: 'entry',
  apply(t) {
    const d = t.decl('whereAmI');
    if (!d || !d.text.includes('fileURLToPath(import.meta.url)')) return { changed: [], refused: [{ site: 'whereAmI', why: 'no fileURLToPath(import.meta.url) to rewrite' }] };
    t.replace('whereAmI', d.text.replace('fileURLToPath(import.meta.url)', 'process.argv[1]'));
    t.write('order/10-each.txt', '10-each\n');
    return { changed: [{ decl: 'whereAmI', site: 'fileURLToPath(import.meta.url)' }, { file: 'order/10-each.txt' }], refused: [] };
  },
}];
export const checks = [{
  name: 'no-meta',
  run(t) {
    const refused = t.modules().filter((m) => t.read(m.file).includes('import.meta.url')).map((m) => ({ site: m.file, why: 'still reads import.meta.url' }));
    return { changed: [], refused };
  },
}];
