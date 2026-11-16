// kit-212: which part each accounts test goes to (by the start of its name). Code between tests that
// only one part uses moves to that part (split.mjs finds it); the rest goes to the fixture.
export const PLANS = {
  accounts: {
    fixtureComment: `// What accounts.*.test.mjs share. Account rotation with cswap (claude-swap): detection, the claim
// that picks who drives it, resuming panes stopped at a limit, and the findings. A stand-in cswap
// throughout: never the machine's real one. Each part imports it, so each part (its own process)
// gets its own copy: its own home, claim files and tmux session.`,
    code: {},
    parts: {
      rotation: { comment: '// Account rotation: the tick, cswap auto, the claim between ticks, the dashboard\'s share, and what the accounts say.', tests: ['accounts-tick: off', 'rotation: runs cswap auto', 'the claim: of several ticks', 'the claim: a stale', 'the dashboard: rotation needs no hub', 'what the accounts say'] },
      leaving: { comment: '// Leaving a full account for the one with the most room, and the warning when a session starts on one.', tests: ['leaving a full account: on an expired token', 'leaving a full account: the enabled account', 'leaving a full account: never onto a slot', 'leaving a full account: cswap\'s state', 'leaving a full account: not on unknown usage', 'leaving a full account: not once another', 'starting a session:'] },
      restart: { comment: '// Restarting a session stopped at a limit: the menu, a banner alone, and text that only reads like a limit.', tests: ['restarting: a session at the limit menu', 'restarting: a banner alone', 'restarting: never on text'] },
      'restart-guards': { comment: '// Restarting: what is left running, which sessions qualify, the SIGTERM, and the cap on attempts.', tests: ['restarting: a refusal', 'restarting: only a session', 'restarting: a process that ignores', 'restarting: 3 times in 6 hours'] },
      untrusted: { comment: '// Restarting: the record and the files any agent could write are untrusted and can stop nothing.', tests: ['the restart record is untrusted', 'files any agent could write'] },
      supervisor: { comment: '// The supervisor: stopped, its own conversation, and its own pane\'s lost Enter.', tests: ['a stopped supervisor:', 'supervisor-session:', 'the supervisor\'s own pane:'] },
    },
  },
};
