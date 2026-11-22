// A test file run on its own (node --test <file>, as a worker often does) gets what test/run.mjs
// gives each file it runs: a scratch TMPDIR of its own, short (under /tmp/dtr- where /tmp is
// writable) so tmux's socket paths stay under their length limit, and DEVTEAM_TEST_SHARED_TMP
// naming the shared temp dir for the port locks. Without it, each file's dt-tmux-, dt-cli-, fixture
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
  privateTmp = fs.mkdtempSync(tmp ? '/tmp/dtr-' : path.join(shared, 'dtr-'));
  process.env.DEVTEAM_TEST_SHARED_TMP = shared;
  process.env.TMPDIR = privateTmp;
}
