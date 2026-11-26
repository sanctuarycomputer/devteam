// Reads order/10-each.txt (absent unless 10-each's rule ran first) and writes order/20-later.txt.
export const rules = [{ name: 'order', apply(t) { t.write('order/20-later.txt', `${t.read('order/10-each.txt') ?? ''}20-later\n`); return { changed: [{ file: 'order/20-later.txt' }], refused: [] }; } }];
