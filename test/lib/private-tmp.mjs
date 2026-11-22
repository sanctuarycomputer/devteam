// A test file run on its own (node --test <file>, as a worker often does) gets what test/run.mjs
// gives each file it runs: a scratch TMPDIR of its own, and DEVTEAM_TEST_SHARED_TMP naming the shared
// temp dir for the port locks and kit.mjs's tmux shim (which must outlive the file). The scratch
// folder is a dtr- folder in the shared temp dir, where a file killed outright leaves it for that
// dir's sweep; in /tmp only where the shared dir's path is too long for tmux's socket paths
// (macOS), as the runner does. Without it, each file's dt-tmux-, dt-cli-, fixture
// and browser folders were left in the machine's temp folder whenever it ended unclean: thousands a
// day on a busy machine. lib/kit.mjs imports this first and removes the folder as the process exits,
// after its tmux server. Under the runner (DEVTEAM_TEST_SHARED_TMP set) it does nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export let privateTmp = null;
if (!process.env.DEVTEAM_TEST_SHARED_TMP) {
  const shared = os.tmpdir();
  let tmp = false;
  try { tmp = fs.statSync('/tmp').isDirectory(); fs.accessSync('/tmp', fs.constants.W_OK); } catch { tmp = false; }
  // <dir>/dtr-XXXXXX/dt-tmux-XXXXXX/tmux-<uid>/default must stay under the ~104-byte socket limit
  privateTmp = fs.mkdtempSync(shared.length <= 48 || !tmp ? path.join(shared, 'dtr-') : '/tmp/dtr-');
  process.env.DEVTEAM_TEST_SHARED_TMP = shared;
  process.env.TMPDIR = privateTmp;
}
