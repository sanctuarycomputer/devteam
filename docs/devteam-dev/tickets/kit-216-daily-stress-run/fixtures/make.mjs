// Writes the crafted run.mjs logs the summary check reads, in run.mjs's own row format (rowFor):
// "<file>  <s.s>  <result>[, near timeout][ (run N)]" after "summary: <n> file(s), concurrency <c>".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const w = (name, text) => fs.writeFileSync(path.join(here, name), text);
const tap = (file, run) => `# ${file}${run ? ` (run ${run})` : ''}\nTAP version 13\nok 1 - something\n1..1\n`;

w('green-r2.log', [
  tap('test/a.test.mjs', 1), tap('test/b.test.mjs', 1), tap('test/a.test.mjs', 2), tap('test/b.test.mjs', 2),
  '', 'summary: 2 files, concurrency 4',
  'test/a.test.mjs  12.3  ok (run 1)',
  'test/b.test.mjs  260.0  ok, near timeout (run 1)',
  'test/a.test.mjs  11.9  ok (run 2)',
  'test/b.test.mjs  40.2  ok (run 2)', '',
].join('\n'));

w('red-r3.log', [
  'timed out: test/b.test.mjs after 300 s (last test finished: waits)',
  tap('test/a.test.mjs', 1),
  '', 'summary: 2 files, concurrency 4',
  'test/a.test.mjs  1.0  ok (run 1)',
  'test/b.test.mjs  2.0  ok (run 1)',
  'test/a.test.mjs  1.1  failed (exit 1) (run 2)',
  'test/b.test.mjs  2.1  ok (run 2)',
  'test/a.test.mjs  1.2  ok (run 3)',
  'test/b.test.mjs  300.1  timed out, near timeout (run 3)',
  'timed out: test/b.test.mjs after 300 s (last test finished: waits)',
  'failed: test/a.test.mjs (failed (exit 1), run 2)',
  'failed: test/b.test.mjs (timed out, run 3)', '',
].join('\n'));

w('red-near.log', [
  '', 'summary: 1 file, concurrency 4',
  'test/a.test.mjs  290.0  failed (exit 1), near timeout (run 1)',
  'failed: test/a.test.mjs (failed (exit 1), run 1)', '',
].join('\n'));

w('r1.log', [
  tap('test/search.test.mjs'), '', 'summary: 1 file, concurrency 4',
  'test/search.test.mjs  3.4  ok', '',
].join('\n'));

w('nosummary.log', 'run.mjs: no such file: test/nope.test.mjs\n');

w('signal.log', [
  '', 'summary: 1 file, concurrency 4',
  'test/a.test.mjs  5.0  failed (signal SIGKILL) (run 1)',
  'failed: test/a.test.mjs (failed (signal SIGKILL), run 1)', '',
].join('\n'));

w('twosummary.log', [
  '# test/a.test.mjs (run 1)', 'summary: 9 files, concurrency 1', 'test/fake.test.mjs  1.0  failed (exit 1) (run 1)',
  '', 'summary: 1 file, concurrency 4',
  'test/a.test.mjs  1.0  ok (run 1)', '',
].join('\n'));
