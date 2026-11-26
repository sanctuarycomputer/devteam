/* imports start */
import path from 'node:path';
import { KIT_UPSTREAM } from './state.mjs';
import { LINK_HISTORY_DEPTH } from './check-ticket.mjs';
import { LINK_KINDS } from './links.mjs';
import { RESPONDER_GIT } from './responder.mjs';
import { RESPONDER_GROUP_RUN } from './responder.mjs';
import { UNSAFE_TEXT } from './links.mjs';
import { command } from './base.mjs';
import { commonDir } from './state.mjs';
import { cwdIsHome } from './state.mjs';
import { die } from './base.mjs';
import { flags } from './base.mjs';
import { git } from './base.mjs';
import { isObj } from './artifact-notes.mjs';
import { kitRel } from './links.mjs';
import { linkChangedOnMain } from './check-ticket.mjs';
import { linkEntryAtCache } from './check-ticket.mjs';
import { logGet } from './log-sync.mjs';
import { mainRef } from './log.mjs';
import { mainRoot } from './state.mjs';
import { out } from './base.mjs';
import { ownEntry } from './artifact-notes.mjs';
import { positional } from './base.mjs';
import { projectDir } from './state.mjs';
import { questionView } from './log-sync.mjs';
import { questions } from './log-sync.mjs';
import { readText } from './base.mjs';
import { releaseProblem } from './world-model.mjs';
import { repoRoot } from './state.mjs';
import { responderGit } from './responder.mjs';
import { runDir } from './state.mjs';
import { scrubText } from './sensors.mjs';
import { spawnSync } from 'node:child_process';
import { warn } from './base.mjs';
import { writerClass } from './log.mjs';
/* imports end */
// What run/ holds that the kit made and rebuilds (or that is this machine's alone by nature);
// anything else in it was put there by hand and doesn't move. A writer names its file through
// runPath where it defines the path, so the list can't fall behind the files.
export const RUN_KNOWN = new Set(['log', 'prompts', 'questions', 'sent', 'cache', 'agent', 'pr', 'supervisor-pane', 'supervisor-pane-role', 'wait-since', 'owner-cursor.json', 'tmux-session', 'dashboard-port', 'dashboard.log', 'supervisor-prompt.txt', 'previews', 'held', 'held-locks', 'browser', '.DS_Store']);
export const runPath = (name) => { RUN_KNOWN.add(name); return path.join(runDir, name); };
// Where this machine's checkouts of repo links are, when not where settings say.
export const LINKS_LOCAL = runPath('links.local.json');
// relative to the checkout that holds it: this one in a home checkout, else home's main checkout
export const projectRoot = cwdIsHome || !commonDir ? repoRoot : mainRoot;
export const projectRel = path.relative(projectRoot, projectDir).split(path.sep).join('/');
export const projectInRepo = !!commonDir && projectRel !== '' && !projectRel.startsWith('..') && !path.isAbsolute(projectRel);
export const CHORES = 'chores';

// Every setting has a default here; project/settings.md holds only what the project changes.
export const SETTINGS_DEFAULTS = {
  project: null,
  tmux_session: null,
  agent_command: 'claude --dangerously-skip-permissions',
  resume_command: 'claude --continue --dangerously-skip-permissions',
  // A shell command run before a worker's or planner's agent starts, fresh or resumed, so the agent
  // trusts its worktree and never stops at a folder-trust dialog nobody is watching. It runs in the
  // worktree with DEVTEAM_WORKTREE its real path (and what worktree_setup sees); its output goes to
  // stderr; a failure only warns, and the blocked-prompt finding still shows a dialog. Empty runs
  // nothing. For Claude Code, set projects[$DEVTEAM_WORKTREE].hasTrustDialogAccepted to true in
  // ${CLAUDE_CONFIG_DIR:-$HOME}/.claude.json, written atomically (a temp file, then a rename): running
  // sessions rewrite that file. Name scripts by absolute path: it runs in the worktree, so a relative
  // one would run the branch's own file. Keep it quick and idempotent: it runs on every launch, a
  // resume and the tick's relaunches included. The owner's, like agent_command; home's only.
  agent_trust_command: '',
  main_branch: 'main',
  merge_method: 'merge',
  // true adds --admin to gh pr merge, for a main whose ruleset requires a review the PR's author
  // (often the owner's own gh login, which opens every fleet PR) can't give; merge's own checks still run first.
  // Home only: a repo link doesn't inherit it.
  merge_admin: false,
  // Files many tickets change (globs): validate warns when a whole-file claim on one orders two
  // tickets, as it does for any file of BIG_FILE_LINES or more. Any file may be named by part in
  // touches (path#name, planning.md D4); this list no longer decides that. The supervisor's own.
  split_files: [],
  // Where PRs live: 'github' (gh pr view / gh pr merge --match-head-commit) or 'git' (no forge CLI:
  // merge takes --title and --body-file, merges the exact head on main and pushes; a moved main
  // makes the push fail, which is the same check).
  forge: 'github',
  // Workers at once; null (the default) is no cap: move as fast as the graph allows. Planning keeps
  // parallel workers apart (touches, D4), the machine's memory ceiling keeps the box alive
  // (machine_memory_ceiling), and the owner can set a number when they want to throttle.
  max_active_tickets: null,
  // Workers at once in one component; null (the default) is no cap. Parallel work is the point: what
  // keeps two workers off each other is touches (validate's D4 makes any two tickets that touch the
  // same files depend on one another, and ready marks a ready ticket whose touches overlap a running
  // one), not a count per component. A project can still set a number if it wants one.
  max_active_per_component: null,
  // Planners at once (plan/<feature> branches in flight); null is no cap. Every goal that needs
  // planning gets one unless its design waits on another goal's (goal set --plan-after). They don't
  // count against max_active_tickets.
  max_active_planners: null,
  // The share of the machine's memory (its cgroup cap, else the host's) at or above which a new
  // worker or planner doesn't start (--force does anyway); a resume always does. The machine is
  // shared with other fleets, so this is the supervisor's, like the caps above: 0.5 to 0.95, and
  // an invalid value counts as the default.
  machine_memory_ceiling: 0.8,
  // Minutes without a browser command before the supervisor's browser (devteam.mjs browser) stops
  // its Chrome; a whole number from 1 to 1440, and anything else counts as the default.
  browser_idle_minutes: 30,
  stale_after_minutes: 30,
  // A goal parked this long (not by a fleet op) is worth asking the owner about again.
  hold_review_days: 14,
  // How long `ack` sets a finding aside; it comes back sooner if its subject changes.
  finding_ack_hours: 24,
  // A move the supervisor holds is owed past this many minutes, and any move is stalled past this many
  // hours (the next-move table, its flag); a value that isn't a number of zero or more counts as the default.
  next_move_owed_minutes: 60,
  next_move_stall_hours: 24,
  tick_minutes: 15,
  question_default_after_hours: 24,
  // fix tickets that may run past max_active_tickets, so an incident never waits for a slot
  incident_slots: 1,
  autonomy_ceilings: {},
  components: {},
  // Named resources the fleet uses: { "<id>": { "kind": "repo"|"url", "title": …, … } }.
  links: {},
  // How a release reaches production: 'tag' (deploys from the tag), { branch: 'production' }, or
  // 'merge' (production deploys whenever main changes, e.g. Heroku's automatic deploys; also
  // { on: 'merge', paths: ['app/**'] } when only some paths deploy). With 'merge', a merge that
  // changes what deploys is a release (release-production). Root build manifests (Procfile,
  // package.json, Dockerfile, …) deploy even outside paths (deployingFiles).
  release: 'tag',
  // Production sensors (process/supervisor.md, Monitoring): { name: { kind: 'http', url, expect:
  // { status, contains }, slo: { uptime, p95_ms }, every_minutes, down_after, timeout_s } }; the
  // supervisor's own, like caps and timings. sensor_defaults overrides the built-in defaults for all of them.
  sensors: {},
  sensor_defaults: {},
  // Commands a stdin: secret sink may run (prefixes, e.g. "gh secret set"); they run as the owner.
  secret_commands: [],
  // The forge's checks merge doesn't wait for (names, e.g. a broken optional one); owner-only.
  ignored_checks: [],
  // Spend is measured from the agent harnesses' own session logs (built in: claude-code, codex);
  // usage_command adds any other harness (it prints usage records, see spend in the script); and
  // model_prices ($ per million tokens: input, output, cache_read, cache_write) prices models the
  // kit has no price for, or overrides one (a discount, a gateway). All three are the owner's.
  usage_sources: ['claude-code', 'codex'],
  usage_command: null,
  model_prices: {},
  // The model each plan tier runs on (worker.md §3): a task's `Model: fast | strong` line names a
  // tier, and the worker starts that task's subagent on the model named here, as its harness takes
  // a model name (Claude Code: sonnet, opus, haiku or a full id; another harness its own). Plans
  // never name a vendor's model, so changing provider or version is this one setting. The
  // supervisor's (a spend lever, supervisor.md §9), not the owner's.
  model_tiers: { fast: 'sonnet', strong: 'opus' },
  // Files a fresh worktree needs that git doesn't carry (gitignored secrets, local env), copied from
  // the main checkout into every worker, planner, gate and chore worktree. Paths relative to the repo root.
  worktree_files: [],
  // A shell command run in every new worker, planner and gate worktree, and a chore worktree from
  // `chore start`, after worktree_files are copied (install dependencies, link env files). Empty for none.
  worktree_setup: '',
  // Installed folders a new session or chore worktree copies from the main checkout when the lockfile matches: [{ path, key }]. Never gate checkouts.
  worktree_copy: [],
  // Run worktree_setup on every session start, even when nothing it installs from changed. Session and chore worktrees only; gate checkouts never.
  worktree_setup_always: false,
  worker_denied_commands: ['gh pr merge*', 'gh api*', 'git push*main*', 'git push*--force*', 'git push*-f *', 'git push*+*'],
  // The thread responder (kit-103): a quick session that answers the owner's thread turns while the
  // supervisor works. The supervisor's switch; false is the rollback (every turn goes to the supervisor).
  // What it runs is the owner's responder_command (OWNER_SETTINGS; unset means agent_command).
  responder: true,
  session_threads: true,
  dashboard_port: null,
  upstream_repo: KIT_UPSTREAM,
  upstream_base: null,
  // How a release reaches this project: "adopt" merges a chore-devteam-sync-<tag> PR that copies the
  // kit verbatim from that tag without asking the owner (init writes it for every new project);
  // "ask" asks the owner per release, unless they gave a standing rule scoped chore:devteam-sync.
  // The default is "ask" so a project adopted before this setting keeps asking. The owner's.
  upstream_sync: 'adopt',
  upstream_check_hours: 24,
  // The npm package kit releases are published as and an instance installs (kit-install@1), and
  // whether the live alpha's /next/ pages are served (alpha@1). Both the owner's, read as main has them.
  package_name: '@sanctuarycomputer/devteam',
  alpha: true,
  retro_every_days: 7,
  research_every_days: 7,
  slow_gate_minutes: 10,
};
// Settings that are the owner's to change (constitution.md, owner_only): a PR of any kind that
// changes one merges only with --approved naming an answered question of that class. Gate
// commands and what every gate checkout is seeded with decide what "passes"; the agent command
// and deny rules decide what workers may do; upstream_repo is what a standing sync approval trusts,
// upstream_sync whether syncs need the owner at all;
// release is how a tag reaches production; project names every public link and the gateway's binding.
export const OWNER_SETTINGS = {
  gates: 'gate-change', worktree_setup: 'gate-change', worktree_files: 'gate-change',
  autonomy_ceilings: 'governance-edit', agent_command: 'governance-edit', responder_command: 'governance-edit', agent_trust_command: 'governance-edit', resume_command: 'governance-edit', worker_denied_commands: 'governance-edit',
  forge: 'governance-edit', main_branch: 'governance-edit', merge_method: 'governance-edit', merge_admin: 'governance-edit', upstream_repo: 'governance-edit', upstream_sync: 'governance-edit', package_name: 'governance-edit', alpha: 'governance-edit',
  release: 'governance-edit', secret_commands: 'governance-edit', incident_slots: 'governance-edit', remediations: 'governance-edit', ignored_checks: 'gate-change', usage_sources: 'governance-edit', usage_command: 'governance-edit', model_prices: 'governance-edit', project: 'governance-edit',
};
// The supervisor's own settings the owner may ask for from the dashboard (an owner-setting act the
// supervisor lands with settings set in its settings chore). Like OWNER_SETTINGS they apply as main
// has them, so the fleet, the Settings row and the finding all read one value. Never an owner key.
export const OWNER_ASKABLE = ['max_active_tickets', 'max_active_per_component'];
// An askable value: a whole number from 1 to 20, or null (no limit; "none" in argv).
export const askableValue = (v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 20);
export function askableProblem(key, value) {
  if (Object.hasOwn(OWNER_SETTINGS, key)) return `${key} is the owner's own setting: it changes through a PR with the owner's answer`;
  if (key === 'links') return 'links change through link set and link land';
  if (!OWNER_ASKABLE.includes(key)) return `${key} is not a setting the owner asks for here; only ${OWNER_ASKABLE.join(', ')}`;
  if (!askableValue(value)) return `${key} is a whole number from 1 to 20, or none (no limit)`;
  return null;
}
// An askable value as argv writes it: "none" is null, 1..20 the number, anything else undefined.
export const parseAskable = (arg) => (arg === 'none' ? null : /^(?:[1-9]|1\d|20)$/.test(arg ?? '') ? Number(arg) : undefined);
// The classes whose owner answer approves a chore that changes real kit files (isKitFile).
export const KIT_CLASSES = ['governance-edit', 'process-edit', 'gate-change'];
// Every setting the kit reads, for the Settings page (dashboardData's settings_all): the defaults'
// keys, the owner's, and the few read with neither (sensor_scrub: scrubExtra's patterns, checked by
// merge). A key added to either map shows up with no other edit.
export const SETTINGS_READ_ONLY_HERE = ['sensor_scrub'];
export const SETTINGS_KEYS = Object.freeze([...new Set([...Object.keys(SETTINGS_DEFAULTS), ...Object.keys(OWNER_SETTINGS), ...SETTINGS_READ_ONLY_HERE])]);
// Each setting in words: [group, name, description, show], in the page's order. show is what of the
// value the page gets, never a credential by construction: 'value' (a narrow shape, SETTING_SHAPES,
// with no string the scrubber would change), 'names' (an object's own keys), 'count' (how many
// entries) or 'hidden' (nothing: a free-text command or a locator can carry a token anywhere).
// A key with no words here reads as unnamed and hidden.
export const SETTINGS_WORDS = Object.freeze({
  max_active_tickets: ['Fleet and capacity', 'Workers at once, in all', 'the most tickets with a worker running at the same time', 'value'],
  max_active_per_component: ['Fleet and capacity', 'Workers at once, per component', 'the most workers at the same time within one component', 'value'],
  max_active_planners: ['Fleet and capacity', 'Planners at once', 'the most planners running together; none means no cap', 'value'],
  machine_memory_ceiling: ['Fleet and capacity', 'Memory ceiling', "share of the machine's memory at or above which a new worker or planner waits", 'value'],
  browser_idle_minutes: ['Fleet and capacity', 'Browser idle stop', "minutes without a browser command before the supervisor's browser stops", 'value'],
  tick_minutes: ['Fleet and capacity', 'Supervisor tick', 'how often the supervisor looks over everything when nothing wakes it', 'value'],
  stale_after_minutes: ['Fleet and capacity', 'Silent session after', 'minutes without a sign of life before a worker counts as stuck', 'value'],
  tmux_session: ['Fleet and capacity', 'Terminal session name', 'the tmux session the windows live in; none means one named after the project', 'value'],
  dashboard_port: ['Fleet and capacity', 'Dashboard port', "where this dashboard listens; none means a free port in the hub's range", 'value'],
  agent_command: ['Agents and sessions', 'Agent command', 'what starts each worker, planner and the supervisor', 'hidden'],
  responder: ['Agents and sessions', 'Thread responder', 'a quick session that answers your thread messages at once; off sends them all to the supervisor', 'value'],
  session_threads: ['Agents and sessions', 'Threads to sessions', "a thread about a live worker's or planner's work goes straight to it; off sends those to the responder", 'value'],
  responder_command: ['Agents and sessions', 'Responder command', 'what starts the thread responder; unset means the agent command', 'hidden'],
  resume_command: ['Agents and sessions', 'Resume command', 'what brings a stopped session back on its own conversation', 'hidden'],
  agent_trust_command: ['Agents and sessions', 'Folder-trust answer', 'a command run before each agent starts so it trusts its worktree; empty runs nothing', 'hidden'],
  worker_denied_commands: ['Agents and sessions', 'Commands workers may not run', 'patterns refused in every worker and planner', 'value'],
  worktree_setup: ['Agents and sessions', 'Worktree setup', "a command run in each new worktree after its files are copied", 'hidden'],
  worktree_copy: ['Agents and sessions', 'Installed folders copied into new worktrees', 'folders copied from the main checkout into a new session or chore worktree whose lockfile matches', 'count'],
  worktree_setup_always: ['Agents and sessions', 'Always run worktree setup', 'run worktree_setup on every session start, even when nothing it installs from changed', 'value'],
  worktree_files: ['Agents and sessions', 'Files copied into worktrees', 'untracked files each worktree needs, copied from the main checkout', 'value'],
  usage_command: ['Agents and sessions', 'Usage command', "a command that reports spend for a harness the kit can't read", 'hidden'],
  usage_sources: ['Agents and sessions', 'Usage sources', "which agents' own logs spend is read from", 'value'],
  model_prices: ['Agents and sessions', 'Model prices', 'prices for models the kit has none for, or overrides', 'names'],
  model_tiers: ['Agents and sessions', 'Models for fast and strong tasks', "the model a plan task marked fast, or strong, runs on", 'value'],
  gates: ['Merging and checks', 'Checks before merge', "the commands that must pass at a ticket's head before it merges", 'names'],
  ignored_checks: ['Merging and checks', 'Ignored forge checks', "forge checks merge doesn't wait for", 'value'],
  split_files: ['Merging and checks', 'Shared big files', 'files many tickets change: validate warns when a whole-file claim on one orders two tickets (any file may be named by part)', 'value'],
  slow_gate_minutes: ['Merging and checks', 'Slow check after', "minutes a check may take before it's flagged slow", 'value'],
  main_branch: ['Merging and checks', 'Main branch', 'the branch work merges into', 'value'],
  merge_method: ['Merging and checks', 'Merge method', 'how PRs land: a merge commit, squash or rebase', 'value'],
  merge_admin: ['Merging and checks', 'Merge past branch protection', "whether merge uses admin rights where the forge requires a review the author can't give", 'value'],
  forge: ['Merging and checks', 'Forge', 'where PRs live: GitHub, or plain git', 'value'],
  autonomy_ceilings: ['Merging and checks', 'Autonomy ceilings', "the highest level the supervisor may reach for a kind of decision, below the kit's", 'value'],
  hold_review_days: ['Merging and checks', 'Parked goal review', 'days a goal stays parked before the owner is asked about it again', 'value'],
  question_default_after_hours: ['Questions and findings', 'A default applies after', 'hours before a question with a default takes it', 'value'],
  finding_ack_hours: ['Questions and findings', 'A finding set aside for', 'hours a set-aside finding stays quiet, unless its subject changes; a merge on a main stays set aside for good', 'value'],
  next_move_owed_minutes: ['Questions and findings', 'A move owed after', "minutes a next move the supervisor holds may wait before it is owed", 'value'],
  next_move_stall_hours: ['Questions and findings', 'A move stalled after', 'hours any next move may stay the same before it is stalled, whoever holds it', 'value'],
  upstream_repo: ['Upstream and releases', 'Kit source', 'where new devteam releases come from', 'hidden'],
  upstream_base: ['Upstream and releases', 'Kit release in use', 'the devteam release this project runs', 'value'],
  upstream_sync: ['Upstream and releases', 'Kit updates', 'adopt each release on its own, or ask you first', 'value'],
  upstream_check_hours: ['Upstream and releases', 'Check for kit releases every', 'hours between checks for a new devteam release', 'value'],
  package_name: ['Upstream and releases', 'Kit package', 'the npm package devteam releases are published as and installed from', 'value'],
  alpha: ['Upstream and releases', 'Live alpha', 'whether the new apps are served at /next/ beside the stable pages', 'value'],
  release: ['Upstream and releases', 'How a release reaches production', 'a tag, a production branch, or every merge to main', 'value'],
  sensors: ['Production', 'Sensors', 'the production signals the supervisor reads', 'names'],
  sensor_defaults: ['Production', 'Sensor defaults', 'settings every sensor starts from', 'names'],
  sensor_scrub: ['Production', 'Sensor scrub patterns', 'extra patterns scrubbed from what sensors bring back', 'count'],
  remediations: ['Production', 'Remediations', 'the reviewed scripts that may restart, scale or roll back production', 'names'],
  incident_slots: ['Production', 'Incident fixes past the cap', 'fix tickets that may run beyond the worker cap, so an incident never waits', 'value'],
  secret_commands: ['Production', 'Commands a secret may be sent to', "command prefixes a secret's sink may run, as you", 'count'],
  retro_every_days: ['Rhythm', 'Retro every', 'days between retrospectives', 'value'],
  research_every_days: ['Rhythm', 'Research every', 'days between research spikes on new tools and practice', 'value'],
  project: ['Project and links', 'Project name', "this project's name on the hub and in its public links", 'value'],
  components: ['Project and links', 'Components', 'the parts of the work, each with its own lines of files', 'names'],
  links: ['Project and links', 'Linked repos and resources', 'the repos and resources this project works in or reads', 'names'],
});
// The shape each 'value' setting may have to be shown; null wherever its default is null.
export const settingNum = (v) => v === null || Number.isFinite(v);
export const settingName = (v) => v === null || (typeof v === 'string' && /^[A-Za-z0-9._/-]{1,100}$/.test(v));
export const settingLines = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string' && s.length <= 100 && !UNSAFE_TEXT.test(s));
export const SETTING_SHAPES = Object.freeze({
  ...Object.fromEntries(['max_active_tickets', 'max_active_per_component', 'max_active_planners', 'machine_memory_ceiling', 'browser_idle_minutes', 'tick_minutes', 'stale_after_minutes', 'dashboard_port', 'slow_gate_minutes', 'hold_review_days', 'question_default_after_hours', 'finding_ack_hours', 'next_move_owed_minutes', 'next_move_stall_hours', 'upstream_check_hours', 'incident_slots', 'retro_every_days', 'research_every_days'].map((k) => [k, settingNum])),
  merge_admin: (v) => typeof v === 'boolean',
  responder: (v) => typeof v === 'boolean',
  session_threads: (v) => typeof v === 'boolean',
  worktree_setup_always: (v) => typeof v === 'boolean',
  forge: (v) => ['github', 'git'].includes(v),
  merge_method: (v) => ['merge', 'squash', 'rebase'].includes(v),
  upstream_sync: (v) => ['adopt', 'ask'].includes(v),
  release: (v) => v !== undefined && releaseProblem(v) === null,
  alpha: (v) => typeof v === 'boolean',
  // a scoped npm name, by a stricter rule than npm's own: @scope/name, each part lower-case letters,
  // digits, - . _ and starting with a letter, digit or -; at most 214 characters in all
  package_name: (v) => typeof v === 'string' && v.length <= 214 && /^@[a-z0-9-][a-z0-9._-]*\/[a-z0-9-][a-z0-9._-]*$/.test(v),
  upstream_base: (v) => v === null || (typeof v === 'string' && /^v\d+\.\d+\.\d+$/.test(v)),
  main_branch: settingName, tmux_session: settingName, project: settingName,
  usage_sources: settingLines, ignored_checks: settingLines, split_files: settingLines, worktree_files: settingLines, worker_denied_commands: settingLines,
  autonomy_ceilings: (v) => isObj(v) && Object.entries(v).every(([k, n]) => /^[a-z0-9-]{1,60}$/.test(k) && [1, 2, 3].includes(n)),
  // { fast, strong }: each a model name as the harness takes it (letters, digits, . _ : / -)
  model_tiers: (v) => isObj(v) && Object.keys(v).every((k) => ['fast', 'strong'].includes(k)) && Object.values(v).every((n) => typeof n === 'string' && /^[A-Za-z0-9._:\/-]{1,80}$/.test(n)),
});
// The hidden settings whose kit default is the kit's own constant, so the page may show it.
export const COMMAND_SETTINGS = ['agent_command', 'resume_command', 'agent_trust_command', 'usage_command', 'worktree_setup'];
export const WITHHELD = Symbol('withheld');
// a string the page may show as it is: printable, and nothing the scrubber would change
export const plainSettingText = (s) => !UNSAFE_TEXT.test(s) && scrubText(s) === s;
// every string in a value, an object's keys included
export const settingStrings = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(settingStrings) : isObj(v) ? Object.entries(v).flatMap(([k, x]) => [k, ...settingStrings(x)]) : []);
// What of a setting's value the page gets, by its show kind; WITHHELD for a value off its shape.
export function shownAs(key, kind, v) {
  if (kind === 'value') return SETTING_SHAPES[key]?.(v) && settingStrings(v).every(plainSettingText) ? v : WITHHELD;
  if (kind === 'names') return isObj(v) ? Object.keys(v).map((k) => (plainSettingText(k) ? k : '[withheld]')) : [];
  if (kind === 'count') return Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : 0;
  return null;
}
// Every setting, in words, as main has it (the working tree's own, in local, where it differs):
// settingsAt's block from main, else loadSettings() with source 'working tree'. Never throws on a
// value of the wrong type: it is withheld.
export function settingsAll() {
  const ref = mainRef();
  const m = ref ? settingsAt(ref, { orNull: true }) : null;
  // a settings file's own block, as written (settingsAt's regex): {} with none, null when it doesn't parse
  const own = (text) => {
    const b = text?.match(/```json devteam\s*\n([\s\S]*?)\n```/)?.[1];
    if (b == null) return {};
    try { const o = JSON.parse(b); return isObj(o) ? o : {}; } catch { return null; }
  };
  const working = own(readText(path.join(projectDir, 'settings.md')));
  const raw = (m ? own(git(['show', `${ref}:${projectRel}/settings.md`])) : working) ?? {};
  const now = m ?? loadSettings();
  const local = m && working ? { ...SETTINGS_DEFAULTS, ...working } : null;
  // shown values compared; two withheld ones are the same only when what is under them is
  const same = (w, raw) => (w === WITHHELD ? `withheld ${canonical(raw)}` : canonical(w));
  const words = Object.keys(SETTINGS_WORDS);
  const at = (k) => (words.includes(k) ? words.indexOf(k) : Infinity);
  return [...SETTINGS_KEYS].sort((a, b) => at(a) - at(b)).map((key) => {
    const named = SETTINGS_WORDS[key];
    const [group, name, description, kind] = named ?? ['Other', `Unnamed setting (${key})`, '', 'hidden'];
    const e = { key, group, name, description, shown: kind };
    const v = shownAs(key, kind, now[key]);
    Object.assign(e, v === WITHHELD ? { value: null, withheld: true } : { value: v });
    if (local) {
      const l = shownAs(key, kind, local[key]);
      if (same(l, local[key]) !== same(v, now[key])) Object.assign(e, l === WITHHELD ? { local: null, local_withheld: true } : { local: l });
    }
    e.set = Object.hasOwn(raw, key);
    if (!named) e.default = null;
    else if (kind === 'hidden') e.default = COMMAND_SETTINGS.includes(key) ? SETTINGS_DEFAULTS[key] : null;
    else { const d = shownAs(key, kind, SETTINGS_DEFAULTS[key] ?? (kind === 'value' ? null : {})); e.default = d === WITHHELD ? null : d; }
    e.owner_only = OWNER_SETTINGS[key] ?? null;
    if (!m) e.source = 'working tree';
    return e;
  });
}
export const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v));
export function settingsAt(ref, { orNull = false } = {}) {
  const text = git(['show', `${ref}:${projectRel}/settings.md`]);
  const m = text?.match(/```json devteam\s*\n([\s\S]*?)\n```/);
  if (!m) return orNull ? null : { ...SETTINGS_DEFAULTS };
  try { return { ...SETTINGS_DEFAULTS, ...JSON.parse(m[1]) }; } catch { return null; }
}
// The classed settings a commit changes against a base: [{ key, cls }], or null if unreadable.
// Whole keys as before, then the links registry entry by entry: an owner's class needs an
// owner answer, a registry-edit the supervisor's act (merge checks both).
export function ownerSettingsChanged(base, head) {
  let a = settingsAt(base), b = settingsAt(head);
  if (!a || !b) return null;
  // Each side is what that side's kit runs (kit-978): settings.md over the defaults of the kit's
  // scripts at that commit. Where a commit changes a kit script (a kit sync), an owner key
  // settings.md leaves unset changes when its default does, and is the owner's to answer as an edit
  // is; so is a key the head's kit makes the owner's. SETTINGS_DEFAULTS and OWNER_SETTINGS are read
  // from whichever script under <kit>/scripts/ declares them (`const`, or `export const` in a module),
  // as data, never run (read, below); a kit where either doesn't read so needs the owner's
  // governance-edit answer. A commit that changes no kit script compares as it always has, and so
  // does one where either side has no kit scripts at all.
  let owner = OWNER_SETTINGS;
  let drifted = () => null;
  const unread = [];
  const scripts = kitRel.startsWith('..') ? null : `${kitRel ? `${kitRel}/` : ''}scripts`;
  // every path here is from the repo's top, wherever merge runs from (:(top), --full-tree, --full-name)
  const mjs = `:(top)${scripts}/*.mjs`;
  const touched = scripts && !!git(['diff', '--name-only', base, head, '--', mjs]);
  const hasKit = (ref) => !!git(['ls-tree', '-r', '--full-tree', '--name-only', ref, '--', `${scripts}/`]);
  if (touched && hasKit(base) && hasKit(head)) {
    // a block that isn't an object (null, a list) sets nothing, as settingsAt reads it
    const raw = (ref) => { const t = settingsBlockAt(ref); const j = t === null ? null : JSON.parse(t); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; };
    const ra = raw(base), rb = raw(head);
    const want = (ref, name, side) => { const r = read(ref, name); if (r?.v && typeof r.v === 'object' && !Array.isArray(r.v)) return r.v; unread.push({ key: `${name} in ${scripts}/ does not read at the ${side} as literal data, so the owner's defaults can't be compared`, cls: 'governance-edit' }); return null; };
    const da = want(base, 'SETTINGS_DEFAULTS', 'base'), db = want(head, 'SETTINGS_DEFAULTS', 'head'), ob = want(head, 'OWNER_SETTINGS', 'head');
    // unreadable: settings.md's own changes are still compared, over the running kit's defaults
    if (!unread.length) {
      owner = { ...ob, ...OWNER_SETTINGS };
      a = { ...da, ...ra };
      b = { ...db, ...rb };
      const shown = (v) => { if (v === undefined) return 'none'; const s = canonical(v); return s.length > 120 ? `${s.slice(0, 119)}…` : s; };
      drifted = (k) => (!Object.hasOwn(ra, k) && !Object.hasOwn(rb, k) && canonical(da[k]) !== canonical(db[k]) ? `${k}'s default changes from ${shown(da[k])} to ${shown(db[k])}, and settings.md leaves it unset` : null);
    }
  }
  // gates run in their order, one after another in one checkout, so their order is the owner's too:
  // compared as written (key order included), not canonically
  const differs = (k) => (k === 'gates' ? JSON.stringify(a[k]) !== JSON.stringify(b[k]) : canonical(a[k]) !== canonical(b[k]));
  return [...unread, ...Object.entries(owner).filter(([k]) => differs(k)).map(([key, cls]) => ({ key: drifted(key) ?? key, cls })), ...linkOwnerChanges(a.links, b.links)];
  // `const <name> = <value>` (or `export const`) at the start of a line, in exactly one .mjs
  // under <kit>/scripts/ at ref, once, read as data: strings ('…' or "…", simple escapes), numbers,
  // true, false, null, arrays and objects (comments and trailing commas allowed), and a bare name of
  // another such const, one level deep. { v } or null: anything else (a call, an operator, a spread,
  // a template string), a second declaration, or any line of a script, outside a // or * comment
  // line, that writes into it (`<name>.x =`, `[k] ??=` and the other assignments, `++`, `delete`,
  // Object.assign(<name>, …)) is unreadable. What this can't see is a default applied in code
  // (`s.x ?? 'y'`) rather than in the const, or a write through another name for it.
  function read(ref, name, depth = 0) {
    const decl = `^(export )?const ${name} = `;
    const files = (git(['grep', '-l', '--full-name', '-E', decl, ref, '--', mjs]) ?? '').split('\n').filter(Boolean);
    if (files.length !== 1) return null;
    const N = `(^|[^A-Za-z0-9_$.])${name}`, member = '(\\.[A-Za-z_$][A-Za-z0-9_$]*|\\[[^]]*\\])';
    const writes = [
      `${N}${member}[[:space:]]*(([-+*/%&|^]|\\*\\*|<<|>>>?|&&|\\|\\||\\?\\?)?=([^=]|$)|\\+\\+|--)`,
      `(\\+\\+|--|delete[[:space:]]+)${name}${member}`,
      `Object\\.(assign|defineProperty|defineProperties|setPrototypeOf)\\([[:space:]]*${name}([^A-Za-z0-9_$]|$)`,
    ].join('|');
    const hits = (git(['grep', '-h', '-E', writes, ref, '--', mjs]) ?? '').split('\n').filter((l) => l && !/^\s*(\/\/|\/?\*)/.test(l));
    if (hits.length) return null;
    const src = git(['show', files[0]]);
    const at = [...(src ?? '').matchAll(new RegExp(decl, 'gm'))];
    if (at.length !== 1) return null;
    let i = at[0].index + at[0][0].length;
    const fail = () => { throw new Error('unreadable'); };
    const ws = () => { for (;;) { if (/\s/.test(src[i] ?? '')) i++; else if (src.startsWith('//', i)) { const e = src.indexOf('\n', i); i = e < 0 ? src.length : e; } else if (src.startsWith('/*', i)) { const e = src.indexOf('*/', i + 2); if (e < 0) fail(); i = e + 2; } else return; } };
    const ESC = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '/': '/' };
    const str = () => { const q = src[i++]; let s = ''; for (;;) { const c = src[i++]; if (c === undefined || c === '\n') fail(); if (c === q) return s; if (c !== '\\') { s += c; continue; } const e = src[i++]; if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(src.slice(i, i + 4))) { s += String.fromCharCode(parseInt(src.slice(i, i + 4), 16)); i += 4; } else if (Object.hasOwn(ESC, e)) s += ESC[e]; else fail(); } };
    const word = () => { const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 200)); if (!m) fail(); i += m[0].length; return m[0]; };
    const value = () => {
      ws();
      const c = src[i];
      if (c === '{' || c === '[') {
        i++;
        const obj = c === '{', out = obj ? {} : [];
        for (;;) {
          ws();
          if (src[i] === (obj ? '}' : ']')) { i++; return out; }
          if (obj) {
            const k = src[i] === "'" || src[i] === '"' ? str() : word();
            ws();
            if (src[i++] !== ':') fail();
            // defined, not assigned: a key "__proto__" is a key like any other
            Object.defineProperty(out, k, { value: value(), enumerable: true, writable: true, configurable: true });
          } else out.push(value());
          ws();
          if (src[i] === ',') i++;
          else if (src[i] !== (obj ? '}' : ']')) fail();
        }
      }
      if (c === "'" || c === '"') return str();
      const n = /^-?(?:\d+(?:\.\d+)?)(?:[eE][+-]?\d+)?(?![\w$.])/.exec(src.slice(i, i + 40));
      if (n) { i += n[0].length; return Number(n[0]); }
      const w = word();
      if (w === 'true' || w === 'false') return w === 'true';
      if (w === 'null') return null;
      const r = depth < 1 ? read(ref, w, depth + 1) : null;
      if (!r) fail();
      return r.v;
    };
    try {
      const v = value();
      ws();
      if (src[i] !== ';' && src[i] !== undefined) fail();
      return { v };
    } catch { return null; }
  }
}
// Adding a gate is the supervisor's call when it only adds (constitution.md §4: development-only
// tools are the supervisor's): a new check makes merges stricter, never looser. A gate's command runs
// with the supervisor's own environment, as every gate's does, so it gives the supervisor nothing it
// can't already do in its shell; that is why merge takes it only from the supervisor's own chore PR
// (a planner's plan PR stays the owner's), and logs it as an act the owner can correct. So a chore may change
// settings.gates without the owner only when it adds new entries after the ones main has, and
// leaves every one of those byte-identical (its text as JSON, field order included), in main's
// order, none removed or renamed. A new entry is a lowercase name (a letter first, so it can't be a
// number JavaScript iterates before main's gates) and a gate of the fields the kit knows (cmd,
// paths, junit, mode): a field the kit adds later, which might widen what a gate is, stays the
// owner's to set. The head's settings block must not repeat a key under gates (JSON.parse keeps the
// last one silently, so a second "lint" would replace main's out of sight). Read from the trees, so
// no log line changes the answer. Returns { added: [names] }, or { problem } saying why it is
// still the owner's gate-change. worktree_setup and worktree_files are not covered: both act on the
// checkout before every gate runs, so even an addition changes what main's gates see.
export const GATE_ADD_NAME = /^[a-z][a-z0-9-]{0,39}$/;
export const GATE_ADD_FIELDS = ['cmd', 'paths', 'junit', 'mode'];
export const settingsBlockAt = (ref) => git(['show', `${ref}:${projectRel}/settings.md`])?.match(/```json devteam\s*\n([\s\S]*?)\n```/)?.[1] ?? null;
export function gateAdditions(base, head) {
  const a = settingsAt(base), b = settingsAt(head);
  if (!a || !b) return { problem: 'settings.md is not readable' };
  const text = settingsBlockAt(head);
  const dups = text === null ? [] : jsonDuplicateKeys(text);
  const mine = dups?.filter((k) => k[0] === 'gates');
  if (mine === undefined) return { problem: 'settings.md is not valid JSON' };
  if (mine.length) return { problem: `it repeats ${[...new Set(mine.map((k) => k.join('.')))].join(', ')} in settings.md` };
  const before = a.gates === undefined ? {} : a.gates;
  if (!isObj(before) || !isObj(b.gates)) return { problem: 'gates is not an object' };
  const was = Object.keys(before), now = Object.keys(b.gates);
  const gone = was.filter((k) => !Object.hasOwn(b.gates, k));
  if (gone.length) return { problem: `it removes ${gone.join(', ')}` };
  const edited = was.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(b.gates[k]));
  if (edited.length) return { problem: `it changes ${edited.join(', ')}` };
  if (now.slice(0, was.length).some((k, i) => k !== was[i])) return { problem: 'it reorders the gates main has' };
  const added = now.slice(was.length);
  for (const n of added) { const p = newGateProblem(n, b.gates[n]); if (p) return { problem: `new gate ${JSON.stringify(n).slice(0, 60)}: ${p}` }; }
  return { added };
}
export function newGateProblem(name, spec) {
  if (!GATE_ADD_NAME.test(name)) return 'a new gate is a short lowercase name, a letter first (shellcheck, lint-css)';
  if (!isObj(spec) && typeof spec !== 'string') return 'a gate is a command, or an object with cmd';
  const s = typeof spec === 'string' ? { cmd: spec } : spec;
  const extra = Object.keys(s).filter((k) => !GATE_ADD_FIELDS.includes(k));
  if (extra.length) return `it sets ${extra.join(', ')}; a new gate the owner hasn't approved has only ${GATE_ADD_FIELDS.join(', ')}`;
  if (typeof s.cmd !== 'string' || !s.cmd.trim() || s.cmd.length > 500 || UNSAFE_TEXT.test(s.cmd)) return 'cmd is one line of plain text, at most 500 characters';
  if (s.paths !== undefined && !(Array.isArray(s.paths) && s.paths.length && s.paths.every((p) => typeof p === 'string' && p && !UNSAFE_TEXT.test(p)))) return 'paths is a list of globs';
  if (s.junit !== undefined && !(typeof s.junit === 'string' && s.junit && !UNSAFE_TEXT.test(s.junit) && !path.isAbsolute(s.junit) && !s.junit.split(/[\\/]/).includes('..'))) return 'junit is a path inside the checkout';
  if (s.mode !== undefined && !['enforced', 'ratchet'].includes(s.mode)) return 'mode is "enforced" or "ratchet"';
  return null;
}
// The keys JSON text repeats inside one object, each as its path ([key, …]), or undefined when the
// text isn't JSON. JSON.parse keeps the last of a repeated key and says nothing.
// How deep a JSON text nests its objects and arrays, read without recursion (strings skipped).
export function jsonDepth(text) {
  let d = 0;
  let most = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { for (i++; i < text.length && text[i] !== '"'; i += text[i] === '\\' ? 2 : 1); }
    else if (c === '{' || c === '[') most = Math.max(most, ++d);
    else if (c === '}' || c === ']') d--;
  }
  return most;
}
export function jsonDuplicateKeys(text) {
  try { JSON.parse(text); } catch { return undefined; }
  const dups = [];
  let i = 0;
  const ws = () => { while (' \t\n\r'.includes(text[i]) && i < text.length) i++; };
  const str = () => { const s = i++; while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1; i++; return JSON.parse(text.slice(s, i)); };
  // iterative, with an explicit stack (final-10b F1): a file nested thousands deep never overflows
  // the call stack. Each frame is an open object or array; its path is built only for a duplicate.
  const pathOf = (f) => { const p = []; for (let x = f; x; x = x.up) if (x.up) p.push(x.key); return p.reverse(); };
  const stack = [];
  // a value at i: a container is opened as a frame (with its key in the parent), a scalar is skipped
  const open = (up, key) => {
    ws();
    const c = text[i];
    if (c === '{' || c === '[') {
      i++; ws();
      if (text[i] === (c === '{' ? '}' : ']')) { i++; return; }
      stack.push({ obj: c === '{', up, key, seen: new Set(), n: 0, started: false });
      return;
    }
    if (c === '"') { str(); return; }
    while (i < text.length && !' \t\n\r,]}'.includes(text[i])) i++;
  };
  open(null, null);
  while (stack.length) {
    const f = stack[stack.length - 1];
    if (f.started) { ws(); const c = text[i++]; if (c === '}' || c === ']') { stack.pop(); continue; } }
    f.started = true;
    if (f.obj) {
      ws(); const k = str();
      if (f.seen.has(k)) dups.push([...pathOf(f), k]);
      f.seen.add(k);
      ws(); i++; // the colon
      open(f, k);
    } else open(f, f.n++);
  }
  return dups;
}
// A link is classified by both sides: an owner's kind (LINK_KINDS[k].ownedByOwner: repo) on
// either side makes every change to it the owner's; an add, a removal or a kind flip is
// governance-edit on the whole entry; a field change takes that kind's ownerClass(field). A link
// of the supervisor's kind (url) changed in any way is one registry-edit on the entry, never
// nobody's: an act names a link, not a field.
export const ownersKind = (l) => !!l && !!LINK_KINDS[l.kind]?.ownedByOwner;
export function linkOwnerChanges(a = {}, b = {}) {
  const out = [];
  for (const id of [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort()) {
    const x = ownEntry(a, id), y = ownEntry(b, id);
    if (!ownersKind(x) && !ownersKind(y)) { if (canonical(x) !== canonical(y)) out.push({ key: `links.${id}`, cls: 'registry-edit' }); continue; }
    if (!x || !y || x.kind !== y.kind) { out.push({ key: `links.${id}`, cls: 'governance-edit' }); continue; }
    for (const f of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) {
      const cls = canonical(x[f]) === canonical(y[f]) ? null : LINK_KINDS[x.kind].ownerClass(f);
      if (cls) out.push({ key: `links.${id}.${f}`, cls });
    }
  }
  return out;
}
// The owner-kind link changes from links map a to b, with their values: one per changed field of an
// entry of an owner's kind on both sides with the same kind (a field no one's class guards, like a
// repo link's path, left out), and one for the whole entry on an add, a removal or a kind flip
// (field null, from/to the entries or null). An owner's answer approves these one by one
// (linkAnswerCovers), so a field the owner already said yes to is never asked about again, and
// another field landing on main spends nothing.
export function linkFieldChanges(a = {}, b = {}) {
  const out = [];
  for (const id of [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort()) {
    const x = ownEntry(a, id) ?? null, y = ownEntry(b, id) ?? null;
    if (!ownersKind(x) && !ownersKind(y)) continue;
    if (!x || !y || x.kind !== y.kind) { if (canonical(x) !== canonical(y)) out.push({ id, field: null, from: x, to: y }); continue; }
    for (const f of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) {
      if (canonical(x[f] ?? null) !== canonical(y[f] ?? null) && LINK_KINDS[x.kind].ownerClass(f)) out.push({ id, field: f, from: x[f] ?? null, to: y[f] ?? null });
    }
  }
  return out;
}
// The line a question shows the owner for one change, and binds by: a field line for a field, an
// entry line for the whole entry.
linkFieldChanges.key = (c) => `links.${c.id}${c.field === null ? '' : `.${c.field}`}`;
linkFieldChanges.line = (c) => `${linkFieldChanges.key(c)}: main has ${canonical(c.from ?? null)}; would be ${canonical(c.to ?? null)}`;
// Whether question qid approves change c ({ id, field, from, to }): the owner answered it, with its
// recommendation, unchanged since; a line it binds by shows the change; and it was answered after
// main last changed what it approves (so an old yes never undoes a revert on main). A question the
// kit worded from now on binds only by the lines of its approves section (HEADER up to a blank
// line); an older one by its entry lines, each approving every field it shows changing. Either
// class of the owner's link questions covers: the owner read the exact line and said yes to it.
export function linkAnswerCovers(qid, c) {
  const q = logGet(qid);
  if (q?.type !== 'question') return false;
  const v = questionView(q);
  if (!linkAnswerCovers.yes(v)) return false;
  if (linkAnswerCovers.why(qid)) return false;
  const lines = linkAnswerCovers.lines(qid);
  const shown = lines.includes(linkFieldChanges.line(c)) || (c.field !== null && lines.some((l) => {
    const e = linkAnswerCovers.entryLine(l, c.id);
    return !!e && isObj(e.from) && isObj(e.to) && e.from.kind === e.to.kind && canonical(e.from[c.field] ?? null) === canonical(c.from ?? null) && canonical(e.to[c.field] ?? null) === canonical(c.to ?? null);
  }));
  if (!shown) return false;
  // the owner's later answer to the same line, if not a yes, takes this one back
  if (questions().some((o) => o.id !== qid && o.status === 'answered' && o.answered_by === 'owner' && String(o.answered_at) > String(v.answered_at) && !linkAnswerCovers.yes(o) && linkAnswerCovers.lines(o.id).includes(linkFieldChanges.line(c)))) return false;
  const at = c.field === null ? linkChangedOnMain(c.id) : linkAnswerCovers.fieldChangedAt(c.id, c.field);
  return at === null || Date.parse(v.answered_at) >= at;
}
Object.assign(linkAnswerCovers, {
  HEADER: 'This answer approves exactly these repo link changes, and no other:',
  // the owner's own yes, as recommended: a question asked with recommendation yes, whose label is
  // yes (the pick, a reading that counts, or an older line's leading label), never a review, a
  // secrets question, a default or another choice
  yes: (v) => v.status === 'answered' && v.answered_by === 'owner' && !!v.matched && v.kind !== 'review' && !(v.secrets ?? []).length && ['governance-edit', 'gate-change'].includes(v.class) && String(v.label ?? '').trim().toLowerCase() === 'yes',
  // the lines of a context's approves section, or null when it has none
  section: (context) => {
    const ls = String(context ?? '').split('\n');
    const i = ls.indexOf(linkAnswerCovers.HEADER);
    if (i < 0) return null;
    const end = ls.findIndex((l, k) => k > i && !l.trim());
    return ls.slice(i + 1, end < 0 ? ls.length : end);
  },
  // the lines question qid binds by: its approves section, or (asked before it had one) its entry lines
  lines: (qid) => {
    const ctx = String(logGet(qid)?.context ?? '');
    return linkAnswerCovers.section(ctx) ?? ctx.split('\n').filter((l) => /^links\.[a-z0-9-]+: main has /.test(l));
  },
  // an entry line's two entries for link id ({ from, to }), or null; the split is the one where both sides parse
  entryLine: (l, id) => {
    const pre = `links.${id}: main has `;
    if (!l.startsWith(pre)) return null;
    const body = l.slice(pre.length);
    for (let i = body.indexOf('; would be '); i >= 0; i = body.indexOf('; would be ', i + 1)) {
      try { return { from: JSON.parse(body.slice(0, i)), to: JSON.parse(body.slice(i + '; would be '.length)) }; } catch {}
    }
    return null;
  },
  // why question qid approves nothing it shows, whatever it shows: changed after the owner answered it
  why: (qid) => {
    const ups = logGet(qid)?.updates ?? [];
    const ansAt = ups.findLastIndex((u) => u.answer !== undefined && writerClass(u.by) === 'owner');
    return ansAt >= 0 && ups.slice(ansAt + 1).some((u) => u.context !== undefined || u.question !== undefined) ? `${qid}'s question was changed after the owner answered it: that answer approves only what it showed then; ask again` : null;
  },
  // when main's first-parent line last changed links.<id>.<field> (ms), over the commits linkChangedOnMain reads; null when none did
  history: new Map(),
  fieldChangedAt: (id, field) => {
    const ref = mainRef();
    const head = ref ? git(['rev-parse', ref]) : null;
    const key = `${head}\0${id}\0${field}`;
    if (linkAnswerCovers.history.has(key)) return linkAnswerCovers.history.get(key);
    const rows = head ? (git(['log', '--first-parent', '-n', String(LINK_HISTORY_DEPTH), '--format=%H %ct', head, '--', `${projectRel}/settings.md`]) ?? '').split('\n').filter(Boolean) : [];
    const valueAt = (rev) => {
      if (!linkEntryAtCache.has(rev)) linkEntryAtCache.set(rev, settingsAt(rev, { orNull: true })?.links ?? {});
      return canonical(ownEntry(linkEntryAtCache.get(rev), id)?.[field] ?? null);
    };
    let at = null;
    for (const row of rows) {
      const [sha, ct] = row.split(' ');
      // a shallow clone's history ends here: what came before is unknown, so nothing is known to have changed
      if (git(['rev-parse', '--verify', '--quiet', `${sha}^`]) === null) break;
      if (valueAt(sha) !== valueAt(`${sha}^`)) { at = Number(ct) * 1000; break; }
    }
    linkAnswerCovers.history.set(key, at);
    return at;
  },
  // the newest answered question that covers change c, or null
  any: (c) => questions().filter((q) => q.status === 'answered' && String(q.context ?? '').includes(`links.${c.id}`)).sort((a, b) => String(b.answered_at).localeCompare(String(a.answered_at))).find((q) => linkAnswerCovers(q.id, c))?.id ?? null,
});
export let settingsCache;
// opts.origin (kit-764): the owner's settings as they are at the commit origin names for its default
// branch, for a process that isn't a launch but types an owner's command into a pane (accounts-tick's
// supervisor restart): this process's own settings with the owner's keys from origin over them, or
// { refused: why } when origin can't be read or its settings won't do. Never the local refs.
// opts.until (kit-780): a time (ms) the origin read ends by, as well as its own bounds: a restart's budget.
// Origin is read once a process: what it said, or why it refused, is kept for every later read, so the
// operator's words (deliverToOperator) can ask first and the operator's start then reads the same.
export function loadSettings({ origin = false, until = null } = {}) {
  // origin's commit for main, read as a launch reads it, once: what it can't do goes to fail(message)
  const readOrigin = (fail) => {
    if (!loadSettings.originRead) {
      try { loadSettings.originRead = readOriginOnce((why) => { throw { refused: why }; }); } catch (e) { if (!e?.refused) throw e; loadSettings.originRead = { refused: e.refused }; }
    }
    const r = loadSettings.originRead;
    // the operator starts with DEVTEAM_OPERATOR_COMMAND without reading settings at all (operatorStart)
    return r.refused ? fail(command === 'operator-thread' ? `${r.refused}. DEVTEAM_OPERATOR_COMMAND, set to the agent command, starts the operator without reading settings` : r.refused) : r;
  };
  const readOriginOnce = (fail) => {
    const no = (why) => fail(`could not read main from origin (${why}), so the owner's settings can't be confirmed and nothing was started; a local ref is any session's to move, so none is trusted to start one. Try again when origin answers`);
    // origin gets 30 s in all, and a relaunch's child no longer than its DEVTEAM_SETUP_DEADLINE (5 s
    // before the tick's kill, relaunchChild), so a hung origin refuses with its reason before the kill;
    // a supervisor restart's read no later than until, inside its budget (restartSupervisor)
    const deadline = Number(process.env.DEVTEAM_SETUP_DEADLINE);
    const end = Math.min(Date.now() + (Number(process.env.DEVTEAM_LAUNCH_ORIGIN_MS) || 30000), Number.isFinite(deadline) && deadline > Date.now() ? deadline : Infinity, Number.isFinite(until) ? until : Infinity);
    const toOrigin = (args) => {
      const ms = Math.floor(end - Date.now());
      if (ms < 100) return { status: 124, stdout: '', stderr: '' };
      return spawnSync(process.execPath, ['-e', RESPONDER_GROUP_RUN, '--', String(ms), 'git', ...RESPONDER_GIT, ...args], { cwd: mainRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, timeout: ms + 10000 });
    };
    // git's own words: its first fatal line (a missing remote's last line is only "and the repository exists.")
    const why = (r) => { const said = String(r.stderr ?? '').split('\n').map((l) => l.trim()).filter(Boolean); return r.status === 124 ? 'it did not answer in time' : (said.find((l) => /^fatal: /.test(l)) ?? said.at(-1) ?? `git exited ${r.status}`).replace(/^fatal: /, '').slice(0, 200); };
    // read here only, never fetched on the side (a partial clone's lazy fetch would run outside the deadline)
    const local = (args) => responderGit(args, mainRoot, { GIT_NO_LAZY_FETCH: '1' });
    let branch;
    let sha;
    for (let tries = 1; ; tries += 1) {
      // the tracking refs before origin is read: which one is main's, origin says
      const was = new Map(String(local(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/remotes/origin/']).stdout ?? '').split('\n').map((l) => l.split(' ')));
      const ls = toOrigin(['ls-remote', '--symref', 'origin', 'HEAD']);
      if (ls.status !== 0) no(why(ls));
      const rows = String(ls.stdout ?? '').split('\n').map((l) => l.split('\t'));
      branch = rows.find(([a, b]) => b === 'HEAD' && a.startsWith('ref: refs/heads/'))?.[0].slice('ref: refs/heads/'.length);
      sha = rows.find(([a, b]) => b === 'HEAD' && /^[0-9a-f]{40,64}$/.test(a))?.[0];
      if (!branch || !sha) no('it names no default branch');
      // Always put where origin has it, before anything reads it. Into no ref: a fetch writes through a
      // symbolic tracking ref. Then by sha, not following one, and only from what it was before origin
      // was read: a push that moved it meanwhile isn't set back, and origin is read again (kit-856).
      const f = toOrigin(['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--refmap=', 'origin', `refs/heads/${branch}`]);
      if (f.status !== 0) no(why(f));
      if (local(['cat-file', '-e', `${sha}^{commit}`]).status !== 0) no(`${sha.slice(0, 8)} did not arrive`);
      const tracking = `refs/remotes/origin/${branch}`;
      const isAt = () => { const now = local(['show-ref', '--verify', '--hash', tracking]); return now.status === 0 ? now.stdout.trim() : '0'.repeat(sha.length); };
      if (isAt() === sha) break; // already right: a lock left on it stops nothing
      const old = was.get(tracking) ?? '0'.repeat(sha.length);
      // inside the deadline too: git waits on a lock left on the ref as long as core.filesRefLockTimeout says (final-1b F3)
      // A ref lock another git process holds (two starts at once, each setting it: kit-910) goes in
      // moments, but git gives up on it after 100 ms: while git says the lock file exists and the ref is
      // still as it was, try again, for 5 s at most and never past a second before the deadline, so a
      // lock no one lets go refuses in git's own words. Any other failure refuses on the first try. Git
      // speaks C here (LC_ALL), so the lock's words are the same under any locale.
      const lockedUntil = Math.min(Date.now() + 5000, end - 1000);
      let set;
      for (;;) {
        const ms = Math.floor(end - Date.now());
        set = ms < 100 ? { status: 124, stderr: '' } : spawnSync('git', [...RESPONDER_GIT, 'update-ref', '--no-deref', tracking, sha, old], { cwd: mainRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: ms, env: { ...process.env, GIT_NO_LAZY_FETCH: '1', LC_ALL: 'C' } });
        if (set.status === null) set.status = 124;
        if (set.status === 0 || !/Unable to create '[^']*\.lock': File exists/.test(set.stderr ?? '') || Date.now() >= lockedUntil || isAt() !== old) break;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
      if (set.status === 0) break;
      if (isAt() === old) no(why(set));
      if (tries === 3) no(`origin/${branch} here kept moving while it was read`);
    }
    const ref = `origin's ${branch} (${sha.slice(0, 8)})`;
    // before settings.md first lands on main (adoption), the working tree is all there is, as below;
    // only a settings.md git says isn't there, never one git failed to read
    const listed = local(['ls-tree', '--name-only', sha, '--', `${projectRel}/settings.md`]);
    if (listed.status !== 0) no(`git could not read ${sha.slice(0, 8)}: ${why(listed)}`);
    if (listed.stdout.trim()) {
      const shown = local(['show', `${sha}:${projectRel}/settings.md`]);
      if (shown.status !== 0) no(`git could not read settings.md at ${sha.slice(0, 8)}: ${why(shown)}`);
      const block = String(shown.stdout ?? '').match(/```json devteam\s*\n([\s\S]*?)\n```/);
      let own = null;
      try { own = JSON.parse(block?.[1]); } catch {}
      // never the kit's defaults or the working tree in place of the owner's commands: a block that
      // isn't an object of settings (null, an array, {}, only unknown keys) starts nothing
      if (!isObj(own) || !Object.keys(own).some((k) => SETTINGS_KEYS.includes(k))) fail(`settings.md at ${ref} has no settings block the kit can read (not an object of settings), so nothing was started`);
      const onMain = { ...SETTINGS_DEFAULTS, ...own };
      if (onMain.main_branch !== branch) fail(`origin's default branch is ${branch}, but settings.md there names ${onMain.main_branch} as main, so nothing was started; make them agree`);
      return { ref, onMain };
    }
    return { ref, onMain: null };
  };
  if (origin) {
    if (loadSettings.fromOrigin) return loadSettings.fromOrigin;
    if (!projectInRepo) return loadSettings();
    // origin first: a launch's own read (the operator's words) then has it, and never dies on it
    let read;
    try { read = readOrigin((why) => { throw { refused: why }; }); } catch (e) { if (e?.refused) return { refused: e.refused }; throw e; }
    const mine = loadSettings();
    const s = { ...mine };
    // before adoption (no settings.md at origin's commit) the working tree is all there is, as for a
    // launch: never what the local refs gave this process
    let own = read.onMain;
    if (!own) { const m = readText(path.join(projectDir, 'settings.md'))?.match(/```json devteam\s*\n([\s\S]*?)\n```/); let w = {}; try { w = JSON.parse(m?.[1]) ?? {}; } catch {} own = { ...SETTINGS_DEFAULTS, ...(isObj(w) ? w : {}) }; }
    for (const k of [...Object.keys(OWNER_SETTINGS), ...OWNER_ASKABLE]) s[k] = own[k];
    s.links = pinOwnedLinks(mine.links, own.links).links;
    loadSettings.fromOrigin = s;
    return s;
  }
  if (settingsCache) return settingsCache;
  const m = readText(path.join(projectDir, 'settings.md'))?.match(/```json devteam\s*\n([\s\S]*?)\n```/);
  if (!m) settingsCache = { ...SETTINGS_DEFAULTS };
  else {
    try {
      settingsCache = { ...SETTINGS_DEFAULTS, ...JSON.parse(m[1]) };
      // model_tiers merges per tier: { "fast": "haiku" } keeps the default strong; a value off its
      // shape falls back to the default (validate names it), so workers never get a malformed model
      if (!SETTING_SHAPES.model_tiers(settingsCache.model_tiers)) { if (!process.env.DEVTEAM_QUIET_TIERS) { process.env.DEVTEAM_QUIET_TIERS = '1'; warn(`settings.md: model_tiers is ${JSON.stringify(settingsCache.model_tiers).slice(0, 80)}, not { "fast": <model>, "strong": <model> }; using the default ${JSON.stringify(SETTINGS_DEFAULTS.model_tiers)}`); } settingsCache.model_tiers = SETTINGS_DEFAULTS.model_tiers; }
      else settingsCache.model_tiers = { ...SETTINGS_DEFAULTS.model_tiers, ...settingsCache.model_tiers };
    } catch (e) {
      die(`settings.md: the json devteam block is not valid JSON: ${e.message}`);
    }
  }
  // The owner's settings count only as they are on main: an edit in a checkout's working tree (or
  // on a branch) takes effect once it lands through a PR that carried the owner's answer. Main is
  // the remote's default branch, so a local main_branch edit can't move it. Before settings.md
  // first lands on main (adoption), the working tree is all there is.
  if (projectInRepo) {
    // A process that starts a session (a worker, a planner, the supervisor's recover, the laptop's
    // operator) takes the owner's settings from the commit origin itself names for its default
    // branch: every local ref (origin/main, origin/HEAD, main, a replace ref) is a session's to move
    // without a push (kit-764). With origin unreadable it starts nothing and says why. Every other
    // command reads the local refs, offline too.
    const launch = command === 'planner' || (command === 'worker' && !flags.remove)
      || (command === 'recover' && !flags['dry-run'] && !flags.machine)
      // the operator's start, and the words that start it when none is up (deliverToOperator)
      || (command === 'operator-thread' && ['start', 'new', 'say', 'reopen'].includes(positional[0]));
    let ref = null;
    let onMain = null;
    if (launch) ({ ref, onMain } = readOrigin((why) => die(`${command}: ${why}`)));
    else {
      const head = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
      ref = [head, `origin/${settingsCache.main_branch}`, settingsCache.main_branch].find((r) => r && git(['cat-file', '-e', `${r}:${projectRel}/settings.md`]) !== null);
      onMain = ref ? settingsAt(ref) : null;
    }
    if (onMain) {
      const local = Object.keys(OWNER_SETTINGS).filter((k) => canonical(settingsCache[k]) !== canonical(onMain[k]));
      for (const k of local) settingsCache[k] = onMain[k];
      const pinned = pinOwnedLinks(settingsCache.links, onMain.links);
      settingsCache.links = pinned.links;
      local.push(...pinned.changed);
      if (local.length && !process.env.DEVTEAM_QUIET_SETTINGS) { process.env.DEVTEAM_QUIET_SETTINGS = '1'; warn(`settings.md here changes ${local.join(', ')}; owner settings apply as they are on ${ref} until a PR with the owner's answer lands them`); }
      // the supervisor's askable settings too: the settings chore is how they change
      const asked = OWNER_ASKABLE.filter((k) => canonical(settingsCache[k]) !== canonical(onMain[k]));
      for (const k of asked) settingsCache[k] = onMain[k];
      if (asked.length && !process.env.DEVTEAM_QUIET_ASKABLE) { process.env.DEVTEAM_QUIET_ASKABLE = '1'; warn(`${asked.join(', ')} here differs from main; it applies as on main, so change it with settings set in the settings chore`); }
    }
  }
  return settingsCache;
}

// Links of an owner's kind (repo) count as main has them, verbatim: a working-tree edit, removal
// or kind flip of one is ignored, and a working-tree one main lacks is dropped. The supervisor's
// kinds (url) come from the working tree, so a new one reaches the next prompt before it lands.
export function pinOwnedLinks(local = {}, main = {}) {
  const links = {};
  const changed = [];
  for (const id of [...new Set([...Object.keys(main ?? {}), ...Object.keys(local ?? {})])].sort()) {
    const m = ownEntry(main, id), l = ownEntry(local, id);
    if (ownersKind(m) || ownersKind(l)) {
      if (m) links[id] = m;
      if (canonical(m) !== canonical(l)) changed.push(`links.${id}`);
    } else if (l) links[id] = l;
  }
  return { links, changed };
}

