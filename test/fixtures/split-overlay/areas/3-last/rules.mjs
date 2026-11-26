// Reads order/20-later.txt and writes order/3-last.txt. By name, 3-last sorts after 20-later, so it
// runs last.
export const rules = [{ name: 'order', apply(t) { t.write('order/3-last.txt', `${t.read('order/20-later.txt') ?? ''}3-last\n`); return { changed: [{ file: 'order/3-last.txt' }], refused: [] }; } }];
