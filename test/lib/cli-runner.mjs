// One warm node process for cli.mjs: started ahead of time, it waits for one request in its slot
// directory, then becomes that command (its cwd, its environment, its argv) and imports the
// script, exactly as `node <script> <args>` would run it, and exits. Its stdout and stderr are the
// slot's files; its exit code is written to the slot's exit file.
import fs from 'node:fs';
import module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const slot = process.argv[2];
const parent = Number(process.argv[3]);
const req = path.join(slot, 'req.json');
fs.writeFileSync(path.join(slot, 'ready'), '');
const got = await new Promise((resolve) => {
  const check = () => { if (fs.existsSync(req)) { clearInterval(t); w.close(); resolve(true); } };
  // the test process that made this slot is gone: nothing will ever ask
  const t = setInterval(() => { try { process.kill(parent, 0); } catch { clearInterval(t); w.close(); resolve(false); } check(); }, 50);
  const w = fs.watch(slot, check);
  check();
});
if (!got) process.exit(0);
const r = JSON.parse(fs.readFileSync(req, 'utf8'));
process.chdir(r.cwd);
for (const k of Object.keys(process.env)) delete process.env[k];
Object.assign(process.env, r.env);
process.argv = [process.execPath, r.script, ...r.args];
// written whole, then renamed: the test process reads the code the moment the file appears
process.on('exit', (code) => { fs.writeFileSync(path.join(slot, 'exit.tmp'), String(code)); fs.renameSync(path.join(slot, 'exit.tmp'), path.join(slot, 'exit')); });
// V8's code cache for the script (Node 22.1+): the same code, compiled once rather than on every call
module.enableCompileCache?.(path.join(os.tmpdir(), 'devteam-kit-compile-cache'));
await import(pathToFileURL(r.script).href);
