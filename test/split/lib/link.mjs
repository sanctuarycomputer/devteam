// Link a generated entry and every module it reaches, without running any: each import must name an
// export of the module it names. Then print the order the modules would run in (ES module evaluation:
// depth first over each module's imports in source order, a module after its imports, cycles cut
// where they close), one file per line after "order:". Run with node --experimental-vm-modules.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';

const ctx = vm.createContext({});
const cache = new Map();
const load = (f) => { if (!cache.has(f)) cache.set(f, new vm.SourceTextModule(fs.readFileSync(f, 'utf8'), { identifier: f, context: ctx })); return cache.get(f); };
const builtins = new Map();
async function linker(spec, ref) {
  if (!spec.startsWith('.')) {
    if (!builtins.has(spec)) {
      const ns = await import(spec);
      const names = Object.keys(ns);
      builtins.set(spec, new vm.SyntheticModule(names, function () { for (const n of names) this.setExport(n, ns[n]); }, { context: ctx }));
    }
    return builtins.get(spec);
  }
  return load(path.resolve(path.dirname(ref.identifier), spec));
}
await load(path.resolve(process.argv[2])).link(linker);
console.log(`linked ${cache.size} modules`);
const order = [], seen = new Set();
const visit = (m) => {
  seen.add(m);
  for (const r of m.dependencySpecifiers) if (r.startsWith('.')) { const d = load(path.resolve(path.dirname(m.identifier), r)); if (!seen.has(d)) visit(d); }
  order.push(m.identifier);
};
visit(load(path.resolve(process.argv[2])));
console.log('order:');
for (const f of order) console.log(path.relative(path.dirname(path.resolve(process.argv[2])), f));
