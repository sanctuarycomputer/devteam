// override dashboardHub sha256:b08fd8a3b29c645c827f817915538b20883e1f5a3df15892bc2b493723a33bed
// A dashboard's hub, unless the box image runs the machine's hub on this port (DEVTEAM_IMAGE_HUB):
// then it is left to the image. The image relies on this check (IMAGE_RUNS).
// From R (kit-package@1's hub; kit-967), the hub runs from ~/.devteam/hub/current when that names a
// runnable install: packageStatus reads it verified (its verified.json and pair), of layout 2, with its
// package's docs/devteam/scripts/cli.mjs a file. It runs as `node <that cli.mjs, by the folder's real
// path> hub`, a child in this dashboard's process group, in this dashboard's project (mainRoot), so its
// owner actions run where today's do (the installed script is in no repo, so the guard leaves it be).
// It logs to ~/.devteam/hub-<HUB_PORT>.log, as any `hub` does. packagePrune sees the folder held by
// that command-line word while the child runs. Anything else runs the hub in this process, as before
// R, said in the log. One hub per port: a child starts
// only once nothing answers on HUB_PORT, checked again every DEVTEAM_HUB_RETRY_MS (30 s). While a
// child runs, current is read every DEVTEAM_HUB_POINTER_MS (10 s): a runnable install of the same
// package, newer, replaces it (the old child stopped and waited for first, so the port is free, then
// that install started); anything else is said once per folder and reason, and the child stays. A
// child that exits on its own is started again after the retry wait, from what current then names; one
// that ends within a minute of starting three times running hands the hub to this process. close() (a
// dashboard handing over to a new kit) stops the child and every timer; so does the dashboard's exit.
function dashboardHub(log) {
  if (imageHub() === HUB_PORT) { log(`hub: left to the image (DEVTEAM_IMAGE_HUB=${HUB_PORT})`); return null; }
  const tree = path.join(os.homedir(), '.devteam', 'hub');
  const ms = (k, d) => { const v = Number(process.env[k]); return Number.isInteger(v) && v > 0 ? v : d; };
  const RETRY = ms('DEVTEAM_HUB_RETRY_MS', 30000), EVERY = ms('DEVTEAM_HUB_POINTER_MS', 10000), STOP = 10000, QUICK = 60000, QUICK_MAX = 3;
  const older = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };
  const said = new Set();
  const sayOnce = (k, m) => { if (!said.has(k)) { said.add(k); log(m); } };
  // the install current names, if the hub can run from it: { folder, dir, record, entry }, else { why }
  const pointed = () => {
    let t;
    try { t = packageStatus({ tree }); } catch (e) { return { why: `${tree} can't be read (${e?.code ?? e?.message ?? e})` }; }
    if (!t.current) return { why: `${tree}/current names no install` };
    const i = t.installs.find((x) => x.folder === t.current);
    if (!i?.verified) return { why: `${tree}/current names ${t.current}, which is not verified` };
    if (i.record.layout !== 2) return { why: `${tree}/current names ${t.current}, which is layout ${i.record.layout}, not 2` };
    let dir;
    try { dir = fs.realpathSync(path.join(tree, t.current)); } catch (e) { return { why: `${t.current} can't be read (${e?.code ?? e?.message ?? e})` }; }
    const entry = path.join(dir, 'node_modules', ...i.record.name.split('/'), 'docs', 'devteam', 'scripts', 'cli.mjs');
    if (!fs.statSync(entry, { throwIfNoEntry: false })?.isFile()) return { why: `${tree}/current names ${t.current}, which has no ${path.relative(dir, entry)}` };
    return { folder: t.current, dir, record: i.record, entry };
  };
  // nothing answers on the hub port (refused): a child may start; anything else waits
  const portFree = () => new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port: HUB_PORT });
    const done = (free) => { s.destroy(); resolve(free); };
    s.setTimeout(2000, () => done(false));
    s.once('connect', () => done(false));
    s.once('error', (e) => done(e?.code === 'ECONNREFUSED'));
  });
  const env = { ...process.env };
  for (const k of ['TMUX_PANE', 'DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_PERSON', 'DEVTEAM_OWN_KIT']) delete env[k];
  const hubLog = path.join(os.homedir(), '.devteam', `hub-${HUB_PORT}.log`);
  let closed = false, inproc = null, child = null, switching = false, timer = null, watch = null, quick = 0;
  const later = (f) => { clearTimeout(timer); timer = setTimeout(f, RETRY); };
  const here = (why) => {
    clearInterval(watch);
    watch = null;
    log(`hub: in this process (${why})`);
    inproc = startHub(log, { kit: ownKitVersion() });
  };
  // the child for install p, once the port is free
  const launch = (p) => portFree().then((free) => {
    if (closed || inproc || child) return;
    if (!free) { sayOnce(`busy\0${p.folder}`, `hub: something answers on ${HUB_PORT}; ${p.folder}'s hub starts once it is free (checked every ${RETRY} ms)`); return later(start); }
    run(p);
  });
  const run = (p) => {
    let proc;
    try { proc = spawn(process.execPath, [p.entry, 'hub'], { cwd: mainRoot, env, stdio: 'ignore' }); } catch (e) { log(`hub: can't start ${p.folder}'s hub (${e?.message ?? e}); trying again in ${RETRY} ms`); return later(start); }
    const me = { proc, ...p, at: Date.now() };
    child = me;
    watch ??= setInterval(follow, EVERY);
    log(`hub: running ${p.record.name}@${p.record.version} from ${p.dir} (pid ${proc.pid})`);
    let gone = false;
    const exited = (why) => {
      if (gone) return;
      gone = true;
      if (child !== me) return;
      child = null;
      if (closed || switching) return;
      quick = Date.now() - me.at < QUICK ? quick + 1 : 0;
      if (quick >= QUICK_MAX) return here(`${p.folder}'s hub ended ${quick} times within ${QUICK / 1000} s of starting, last ${why}; its log is ${hubLog}`);
      log(`hub: ${p.folder}'s hub ended (${why}; its log is ${hubLog}); starting it again in ${RETRY} ms`);
      later(start);
    };
    proc.once('error', (e) => exited(e?.code ?? e?.message ?? String(e)));
    proc.once('exit', (code, sig) => exited(sig ?? `exit ${code}`));
  };
  function start() {
    if (closed || inproc || child) return;
    const p = pointed();
    if (!p.folder) return here(p.why);
    launch(p);
  }
  // a running child follows current: only to a newer runnable install of its own package
  function follow() {
    if (closed || switching || !child) return;
    const p = pointed();
    if (!p.folder) return sayOnce(`why\0${p.why}`, `hub: ${p.why}; staying on ${child.folder}`);
    if (p.folder === child.folder) return;
    if (p.record.name !== child.record.name || !older(child.record.version, p.record.version)) return sayOnce(`old\0${p.folder}`, `hub: ${tree}/current names ${p.folder}, not a newer ${child.record.name} than ${child.folder}; staying on it`);
    switching = true;
    const old = child.proc;
    log(`hub: ${tree}/current moved from ${child.folder} to ${p.folder}; stopping ${child.folder}'s hub to run it`);
    const hard = setTimeout(() => { try { old.kill('SIGKILL'); } catch {} }, STOP);
    const moved = () => { clearTimeout(hard); switching = false; if (child?.proc === old) child = null; quick = 0; if (!closed) launch(p); };
    if (old.exitCode !== null || old.signalCode !== null) return moved();
    old.once('exit', moved);
    try { old.kill('SIGTERM'); } catch {}
  }
  const onExit = () => { try { child?.proc.kill('SIGTERM'); } catch {} };
  process.once('exit', onExit);
  start();
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      clearInterval(watch);
      process.off('exit', onExit);
      inproc?.close();
      inproc = null;
      try { child?.proc.kill('SIGTERM'); } catch {}
      child = null;
    },
  };
}
