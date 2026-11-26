/* imports start */
import { COMMANDS } from './help.mjs';
import { GIT_READ_ONLY } from './help.mjs';
import { HELP } from './help.mjs';
import { OPERATOR_READS } from './help.mjs';
import { OPERATOR_SUBCOMMANDED } from './help.mjs';
import { citeTargets } from './questions.mjs';
import { command } from './base.mjs';
import { decisionFor } from './questions.mjs';
import { deliverNudges } from './sessions.mjs';
import { die } from './base.mjs';
import { flagStr } from './base.mjs';
import { flags } from './base.mjs';
import { gitReadCache } from './base.mjs';
import { out } from './base.mjs';
import { positional } from './base.mjs';
import { replyNow } from './base.mjs';
import { reviewMemo } from './reviews.mjs';
import { supervisorOnly } from './log.mjs';
/* imports end */
/* dispatch start */
if (!command || command === 'help' || command === '--help') out(HELP);
else if (!COMMANDS[command]) die(`unknown command "${command}"\n${HELP}`);
// A cloud box's operator (process/operator.md) looks after the machine and reads every repo. Any other
// role the kit doesn't know reads as the supervisor, so this one may only look.
else if (process.env.DEVTEAM_ROLE === 'operator' && !['recover', 'machine', 'operator-thread'].includes(command) && !OPERATOR_READS.has(OPERATOR_SUBCOMMANDED.has(command) && positional[0] ? `${command} ${positional[0]}` : command)) die(`${command}: the operator only reads; this is for the repo's supervisor or its owner`);
else {
  // --decision names the decision a command's act carries out; check it before the command does anything.
  if (flags.decision !== undefined) {
    if (!flagStr('decision')) die('--decision needs a decision id (d-…)');
    if (command !== 'act') {
      const targets = citeTargets();
      if (!targets) die(`${[command, positional[0]].filter(Boolean).join(' ')} logs no act; --decision is for act, merge, ticket add|set, withdraw, goal hold, worker, planner, fleet, link and remediate`);
      supervisorOnly('--decision');
      const d = decisionFor(flagStr('decision'));
      if (!(d.refs ?? []).some((r) => targets.includes(r))) die(`${d.id} is about ${(d.refs ?? []).join(', ') || 'nothing in particular (it named no --refs)'}; this ${command} is about ${targets.slice(0, 4).join(', ')}${targets.length > 4 ? ', …' : ''}. Decide with --refs naming it, or act without --decision`);
    }
  }
  if (GIT_READ_ONLY.has(command)) { gitReadCache = new Map(); reviewMemo = new Map(); }
  const r = COMMANDS[command]();
  if (GIT_READ_ONLY.has(command)) reviewMemo = null;
  // done: the dashboard has its answer, then the supervisor is told
  // a command that set a failing exit code (preview start when the app died) answers from its exit
  Promise.resolve(r).then(() => { if (!process.exitCode) replyNow(); deliverNudges(); }, (e) => die(e?.message ?? String(e)));
}
/* dispatch end */
