// override kitWatched sha256:eaa93286d932013eb2e2eb23a39845c7e9b76ebb4f28c3f3d9b48318975a0596
// apps@1 Serving (kit-984, R1): the kit a dashboard runs is the script Node loaded and each built page's
// route index.html that exists (a rebuild changes it: its chunk names are hashed into it), in place of
// the old dashboard/ files. kitPrint skips a file that is gone.
const kitWatched = (self) => [self, ...['apps/dashboard/index.html', 'apps/dashboard/browser/index.html', 'apps/hub/index.html'].map((f) => path.join(kitDir, ...f.split('/'))).filter((f) => fs.existsSync(f))];
