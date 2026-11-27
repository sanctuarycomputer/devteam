// kit-989: peeks's cross-view state (APPS.md, Cross-view state). index.html's top-level names that another view's
// lines read or assign, as one object: an import can't be assigned, so every view, peeks's own port too, reads and
// writes peeksState.<name>. Each value is index.html's, as it has it; this file imports no view.
// `Loose` is `any`: a null or empty value index.html later fills with data has no fixed shape there.
type Loose = any;

export const peeksState = {
  // index.html:5118
  TYPE_META: {
    ticket: ['ticket', 'Ticket'], goal: ['target', 'Goal'], feature: ['layers', 'Feature'], story: ['book-open', 'Story'], release: ['tag', 'Release'],
    wave: ['waves', 'Wave'], milestone: ['milestone', 'Milestone'], act: ['zap', 'Act'], decision: ['scale', 'Decision'], retro: ['history', 'Retro'],
    lesson: ['lightbulb', 'Knowledge'], problem: ['triangle-alert', 'Problem'], thread: ['messages-square', 'Message'], planner: ['map', 'Planner'],
    q: ['circle-help', 'Question'], file: ['file-text', 'File'], sensor: ['activity', 'Sensor'],
    observation: ['eye', 'Observation'], signal: ['repeat', 'Recurring signal'], learning: ['trending-up', 'Learning'], lib: ['library', 'Library item'],
    class: ['shield-check', 'Kind of decision'], recurring: ['calendar-clock', 'Job'], builtin: ['box', 'Built in'],
  },
  // index.html:5135
  KEY_TIPS: {
    ID: 'The record\'s id in the log.', 'How it changes': 'How you change it from here: where its correction is, or how to start a thread about it.', Record: 'Its record in the log.',
    Created: 'When the record was created, and by whom.', 'Last changed': 'The latest change to any of its fields, and who made it.',
    Title: 'Its name, one line.', Outcome: 'What is true for you when it is met.', Status: 'Where it stands now.', Priority: 'Your order of work; the lowest number goes first.', Horizon: 'The date it should be met by.',
    Measure: 'What says it is met.', Milestones: 'The usable slices it is planned in.', Preconditions: 'What must hold for it to be met, numbered.', 'Not in scope': 'What it deliberately leaves out.', 'Plan after': 'Goals that must be planned before this one.',
    Approved: 'The question you approved it in.', Hold: 'Run, Drain or Park: whether new work starts for it.', 'On hold': 'Why it is held, while it is.', Decision: 'The decision it carried out, or your verdict on it.',
    State: 'Where it stands, computed from its records.', 'Why it matters': 'Its impact, 1 to 4, with who set it and why.', Design: 'The design file it is built from.', Forecast: 'Each milestone\'s date at the measured rate.',
    Features: 'The features that carry it.', Planners: 'Planners working on it now.', 'Your verdicts': 'What you said when it was checked.', Questions: 'Questions about it, open ones marked.',
    Goals: 'The goals it serves.', Stories: 'The stories it holds, with their releases.', Notes: 'Anything else the planner wrote.', Component: 'The part of the system it changes.', Kind: 'What sort of record this is.',
    Size: 'S is up to about 400 changed lines, M about 1,000.', Risk: 'High risk gets two final reviewers.', Serves: 'The stories it delivers.', 'Waits on': 'Tickets that must merge first.', Contracts: 'Interfaces it provides or consumes.',
    Touches: 'The files it changes.', Links: 'The repos and links it uses.', 'Done when': 'The checks it must pass, in plain words.', 'Replaced by': 'The ticket that replaced it.', Documents: 'Its spec, plan and verification.',
    Reviews: 'Every review of it and its verdict.', Blocks: 'Tickets that wait on it.', Wave: 'The tickets that can be built alongside it.', 'Ships in': 'The release it ships in.', Spent: 'What its worker and reviewers have spent.',
    Branch: 'Its git branch.', Merged: 'The merge commit, once merged.', Feature: 'The feature it belongs to.', Release: 'The release it ships in.', Text: 'The story in one sentence.', Releases: 'Releases its stories and tickets target.',
    Waves: 'Waves its unfinished tickets are in.', Planner: 'A planner working on it now.', 'Plan reviews': 'Reviews of its plan.', Tagged: 'Whether the release has been tagged.', 'Waiting on': 'What must finish first.',
    Goal: 'The goal it serves.', By: 'The date it is due.', Target: 'What it checks, and what counts as good.', Tickets: 'How many tickets it holds.', 'One-way doors': 'Choices it makes that can\'t be undone.', Source: 'Where it came from.',
    Question: 'What was asked, in full.', Class: 'The kind of decision it settles.', Scope: 'How far it reaches.', Ticket: 'The ticket it is about.', Recommendation: 'What the supervisor recommends.', Options: 'The options it weighed.',
    Default: 'What happens at the deadline if you don\'t answer.', Deadline: 'When the default applies.', Answer: 'The answer it was given.', 'Why asked': 'Why it came to you, and its rung.', Autonomy: 'The trust it moved, if any.',
    Stake: 'How much rides on the answer.', Urgency: 'How soon it matters.', Settled: 'When it was answered, defaulted or withdrawn.', Took: 'How long it waited for you.', Matched: 'Whether your answer matched the recommendation.',
    What: 'What was done or decided, in a sentence.', 'Approved by': 'Your answer, or the standing rule, that approved it.', Rung: 'How it was allowed: asked you, deadline, or its own call.', Ceiling: 'The furthest this kind may go without asking.',
    About: 'The records it is about.', Given: 'Knowledge it was given at the time.', 'Rests on': 'Knowledge it rests on.', Reversible: 'Whether it can be undone.', Under: 'The authority it was done under.', Authority: 'Whose call it was.',
    Rationale: 'Why it chose this.', Confidence: 'How sure the supervisor is.', 'Its class now': 'How this kind is decided today, against then.', Corrected: 'Your correction of it, if any.', Repaired: 'How a corrected call was repaired.',
    'In plain words': 'The lesson as you read it.', Statement: 'The lesson as agents are given it.', Valence: 'Good (+) or bad (−), −2 to 2.', Evidence: 'What it rests on.', 'Goes to': 'The sessions that are given it.',
    Severity: 'How bad it is, 0 to 4.', Realized: 'Whether it happened (an issue) or may happen (a risk).', Threatens: 'The goals it puts at risk.', 'Assigned to': 'Who is handling it.', Detail: 'What happened, in a sentence.',
    Fingerprints: 'Distinct errors grouped under it.', Sensor: 'The sensor that saw it.', Stage: 'Where it is now.', Fix: 'The ticket that fixes it.', Verify: 'How the fix is shown to hold.', Regressed: 'Whether it came back after the fix.',
    Subject: 'What it is about.', 'Noticed by': 'Who noticed it.', From: 'Who sent it, or where it came from.', Detector: 'What raised it.', 'Source key': 'The key it recurs on.', 'Where it sits': 'Its signal and records in the loop.',
    Seen: 'How often it was seen.', Recurring: 'Whether it keeps coming back.', 'First seen': 'When it was first seen.', Latest: 'When it was last seen.', 'Unexplained for': 'How long it has gone without an explanation.', 'Explained already': 'Whether the supervisor has explained it.',
    Week: 'The week it covers.', Figures: 'The week\'s counts.', 'What it decided': 'Lessons, acts and decisions that came from it.', 'Write-up': 'The retro\'s file.',
    To: 'Who it was sent to.', Re: 'The message it answers.', Sha: 'The commit it refers to.', 'For goal': 'The goal it plans for.', 'Tickets so far': 'Tickets in its draft so far.', 'Waiting on you': 'Questions it is waiting on you for.', 'Asked the supervisor': 'Messages it sent the supervisor with no reply yet.',
    Version: 'The ref the file is shown at.', Commits: 'How many commits changed it.', Reads: 'What it reads.', Triage: 'When a new error is sorted.', 'Last run': 'When it last ran, and how it went.', Today: 'What it read today.', 'Invalid lines': 'Lines it could not read.',
    'Measured by': 'What says it is met.', Opened: 'When it was created, and by whom.', 'Held because': 'Why it is held, while it is.', 'What it covers': 'The work it holds.', 'Chores in flight': 'Its chores not merged yet.',
    Checks: 'What it requests and what counts as up.', Uptime: 'The share of checks that passed.', 'Response time': 'p50 and p95 latency.', 'Last check': 'When it last checked.', Certificate: 'The TLS certificate, if any.',
    Now: 'How this kind of decision is made today.', 'At most': 'The furthest this kind may go without asking, whatever you answer.', Since: 'When its level last moved.',
    'Agreed with you': 'How often your answers went with its recommendation, over the questions it counts.', Levels: 'The three ways a kind of decision is made, the one it is on marked.',
    Jobs: 'The checks and chores registered under Upkeep: how many, how many failing now, and how many due.', 'Proposed jobs': 'Jobs the supervisor asked you about, and your Yeses not landed yet.',
    Every: 'How often it comes due.', Runs: 'The command a check runs, or the steps a chore follows.', 'Runs as': 'What a run may do.', 'Failing means': 'What counts as a failure.',
    'Registered by': 'The yes that let it in.', Next: 'When it next comes due; a chore waits while Upkeep is drained or parked.', 'Fails in a row': 'Results that were not a pass since the last pass.',
    'What it does': 'What it is for.', 'Set by': 'The setting that sets how often it runs.', Last: 'When it last ran.',
  },
  // index.html:5221
  ATTR: null as { [kind: string]: Loose } | null,
  // index.html:5366
  PEEKS: new Map(),
  // index.html:5411
  DRAWER: { kind: null as Loose, id: null as Loose },
  // index.html:5413
  LAST_HTML: '',
  // index.html:5414
  AFTER: [] as Loose[],
  // index.html:5537
  STAGE_WORDS: { planned: 'waiting on other tickets', ready: 'ready to start', "spec'd": 'spec approved', 'planned-in-detail': 'plan approved', building: 'being built', 'in-review': 'in review', merged: 'merged', released: 'released', superseded: 'replaced by another ticket' },
  // index.html:5538
  MSG_WORDS: { 'review-request': 'asked for a review or a go-ahead', 'merge-request': 'asked to merge', blocked: 'is blocked', 'design-change': 'proposed a design change', ruling: 'ruled', answer: 'relayed your answer', info: 'said' },
  // index.html:5605
  DONE_STAGES: ['merged', 'released'],
};
