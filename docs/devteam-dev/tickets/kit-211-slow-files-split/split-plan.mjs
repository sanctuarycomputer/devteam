// kit-211: which part each test goes to (by the start of its name), and which code between tests
// goes to a part rather than the fixture (by a name it declares).
export const PLANS = {
  machine: {
    fixtureComment: `// What machine.*.test.mjs share: the machine's commands (machine status|tell|alert|pane-state) and
// recover --machine as a box runs it (cloud/Dockerfile's box-recover), every project on the machine,
// real tmux on this file's own server, stand-in agents, and repos on kits from before recover, taken
// from the release tags. Each part imports it, so each part (its own process) gets its own copy.`,
    code: { LEAKED: 'run-folder', realHome: 'hub-records', boxCode: 'box', devteamDev: 'box', FIXED: 'box-pins', LATEST: 'box-pins', argOf: 'box-pins', imageKit: 'box-pins' },
    parts: {
      'run-folder': { comment: '// A test never writes into a session\'s run folder, and a kit refuses one outside its home.', tests: ['importing the test helper', 'a worker\'s run folder gets nothing', 'a kit refuses a run folder', 'a kit takes a run folder', 'a worker on a repo link', 'a kit copied into a home'] },
      status: { comment: '// machine status: the check-in digest, the machine\'s caps, and what the operator may run (reads only).', tests: ['status says at a glance', 'status says the machine\'s own CPU', 'each read the operator may run', 'the kit lets a box operator look', 'alert reaches the hub'] },
      tell: { comment: '// What a pane is at, machine tell into a supervisor, and status finding projects and the hub.', tests: ['what a pane is at', 'tell types into a supervisor', 'tell and status find a project', 'status names the hub\'s kit'] },
      'hub-records': { comment: '// The records a project leaves for the machine\'s hub: never from a scratch kit or a session.', tests: ['a scratch or session-run kit', 'a session\'s dashboard doesn\'t record', 'stray hub records'] },
      box: { comment: '// recover --machine as the box runs it, the box\'s boot and its hub window, and box-deploy.', tests: ['a repo on a kit from before recover comes back', 'a repo on a kit from before recover: status', 'the box\'s list:', '--force skips a sibling', 'the box\'s boot keeps', 'the box\'s boot forgets', 'the box\'s boot starts', 'the boot waits for the hub', 'the minute loop', 'the boot\'s hub lines', 'hub_window makes', 'box-deploy refuses', 'after the first deploy', 'a pane noted moments ago'] },
      'box-pins': { comment: '// box-pins: verify, check, bump and installed, against the kit\'s Dockerfile and stand-in upstreams.', tests: ['box-pins verify: ok', 'box-pins verify names', 'verify does not count', 'verify takes a hold', 'verify names what it found', 'box-pins check:', 'check ignores', 'check reports', 'check: stale wins', 'check sends GH_TOKEN', 'check on a broken file', 'box-pins bump', 'bump --dry-run', 'bump writes nothing when', 'bump sends no token', 'bump keeps the file', 'bump and check refuse', 'bump refuses', 'bump writes nothing that', 'bump downloads nothing', 'box-pins installed', 'installed exits 1', 'installed runs from', 'installed without', 'help names box-pins'] },
    },
  },
  'next-step': {
    fixtureComment: `// What next-step.*.test.mjs share. Next best step: the supervisor rates (each goal's impact against
// the strategy, each question's stake and urgency, what an answer would settle), the kit counts and
// orders. The order is computed on every read; nothing here stores it.`,
    code: { REL_STRATEGY: 'strategy' },
    parts: {
      rank: { comment: '// Next best step: how a question ranks (the formula, what an answer settles, ratings that stand).', tests: ['the formula:', 'a question that settles others', 'the owner gives the settling answer', 'a new rating never reopens', 'settles-if names a choice'] },
      order: { comment: '// Next best step: the order as things change, owner actions, goal impact, defaults, and the floor.', tests: ['the order is computed', 'owner-actions:', 'goal impact:', 'a default about to fire', 'the floor:'] },
      strategy: { comment: '// Next best step: findings, the strategy as the owner\'s, what the ratings say, and the Inbox (next, Chrome).', tests: ['findings: no strategy', 'the strategy answer is bound', 'ratings are said to be', 'the strategy is the owner\'s', 'next prints the top', 'the Inbox shows the order'] },
    },
  },
  recovery: {
    fixtureComment: `// What recovery.*.test.mjs share. Coming back after a dead machine, and a supervisor at a usage
// limit: relaunching a session whose window is gone, --if-gone, restarting the supervisor on its exact
// conversation, and the command the owner gets when it can't be. Stand-in agents throughout, never
// the real claude or cswap.`,
    code: { asOwner: 'recover' },
    parts: {
      relaunch: { comment: '// A dead machine\'s workers and planners come back, one a tick: the guards, the race, the caps.', tests: ['a machine that died', 'no tmux server at all', 'the key guard', 'held, parked, done', '--if-gone: refuses', 'the race:', 'the caps:', 'what a crash leaves behind'] },
      restart: { comment: '// A supervisor stopped at a usage limit is restarted on its exact conversation, and when it is not.', tests: ['not onto a full account', 'a supervisor stopped at a limit', 'the supervisor is not restarted', 'the supervisor\'s restarts share', 'an ad-hoc agent at the banner', 'a process that can\'t be read', 'the restart keeps the permissions', 'a parked or drained fleet\'s supervisor', 'a person at the pane', 'a tmux server the tick starts', '--if-gone, its window made'] },
      recover: { comment: '// recover: a supervisor brought back after a dead machine, and the command when it can\'t be.', tests: ['a supervisor that can\'t be restarted', 'recover', 'the tick after an upgrade', 'the supervisor\'s own command in a tmux pane', 'on Linux a boot is named'] },
    },
  },
  'pane-question': {
    fixtureComment: `// What pane-question.*.test.mjs share. A question in an agent's terminal (a tool that wants a
// person's yes): read from the pane, never answered by a message typed into it, answered by the owner
// from the dashboard's card and nowhere else.`,
    code: { dash: 'answer' },
    parts: {
      parse: { comment: '// A question in an agent\'s terminal, as the parser reads it from the pane\'s text.', tests: ['a Claude Code permission menu', 'another account\'s artifact', 'the card never shows less', 'what is no question holds nothing', 'a dialog the card cannot answer'] },
      held: { comment: '// While a pane asks, messages for it are held, then typed in order, once; what the card cannot answer.', tests: ['a message for a pane that is asking', 'held lines are typed once', 'a claim nobody is working', 'held lines wait for the input box', 'what the card cannot answer'] },
      answer: { comment: '// The owner answers a pane\'s question from the dashboard\'s card: the route, the key, the box, the page.', tests: ['the dashboard: an answer', 'a menu whose digit', 'one click is one answer', 'a question that goes as the key', 'on a box an answer needs', 'the dashboard page:'] },
    },
  },
  'operator-threads': {
    fixtureComment: `// What operator-threads.*.test.mjs share. The owner's threads with the machine's operator, from the
// hub's Overview: the store beside the operator (operator-thread), who may write what in it, the line
// an owner turn becomes in the operator's pane, a laptop's operator started once, the hub's routes,
// and the Overview's dock and pin in a real Chrome. Real tmux on each part's own server, with
// stand-in agents.`,
    code: { ask: 'hub' },
    parts: {
      store: { comment: '// The operator\'s threads: the store, who may write what, what is kept, and the box\'s signed verbs.', tests: ['DEVTEAM_BOX=off turns', 'the store:', 'a box keeps them', 'who may write what', 'what is kept is checked', 'on a box the owner\'s verbs', 'on a box an owner verb run with an idle stdin'] },
      pane: { comment: '// An owner turn in the operator\'s pane, and the operator started once, on a laptop and on a box.', tests: ['an owner turn becomes one line', 'on a box the operator is window 0', 'a laptop\'s operator is started once', 'start-once holds', 'settings that can\'t be read', 'inside tmux, list, show and reply', 'turns sent at the same moment', 'a start\'s note from a kit'] },
      hub: { comment: '// The hub\'s routes for the owner\'s turns, on a laptop and a box, and the Overview\'s Threads dock in Chrome.', tests: ['the hub takes the owner\'s turns', 'on a box the hub takes a press', 'the Overview in Chrome', 'on a box the standalone hub'] },
    },
  },
};
