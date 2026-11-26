/* imports start */
import fs from 'node:fs';
import path from 'node:path';
import { GITLEAKS_FILE } from './links.mjs';
import { HARNESS_RUNTIME } from './goals.mjs';
import { KIT_GITLEAKS } from './links.mjs';
import { devteamDir } from './state.mjs';
import { die } from './base.mjs';
import { flagStr } from './base.mjs';
import { git } from './base.mjs';
import { gitleaksStub } from './links.mjs';
import { mainRoot } from './state.mjs';
import { out } from './base.mjs';
import { projectDir } from './state.mjs';
import { readText } from './base.mjs';
import { repoRoot } from './state.mjs';
import { runDir } from './state.mjs';
/* imports end */
export const ARCHITECTURE_MD = `# Architecture

The whole system as planned now: the sum of every design so far. Written at bootstrap (from the code when adopting an existing codebase), then updated by every plan PR that changes something described here. Every design's research starts here. A feature's changes appear here when its plan lands; whether they have landed in code is computed from its tickets.

## 1. Components

| Component | Path | Stack | Owns | Talks to |
|---|---|---|---|---|

## 2. Contracts

| Contract | Provider | Consumers | Defined in | Versioned? |
|---|---|---|---|---|

## 3. Persistence

| Domain | Store | Tier (code-style.md §4) | Notes |
|---|---|---|---|

## 4. Dependencies and deployment

| Dependency or vendor | Used for | One-way door? |
|---|---|---|

## 5. Distance from the code rules

| Component | Laws met | Laws violated (how widely) | Gate mode |
|---|---|---|---|

## 6. Hotspots

| Path | Why it is hot |
|---|---|

## 7. Tests and CI

## 8. In flight at adoption

| PR / branch | Files | Decision |
|---|---|---|

## 9. Changed by

| Feature | Design | Date | What changed |
|---|---|---|---|
`;

// project/strategy.md as init makes it: why the project exists and how it wins, the owner's. The
// supervisor drafts it at adoption and judges each goal's impact against it; the kit reads it only
// for whether it links self.md (`linksSelf`), beside missing, this template, or written.
export const STRATEGY_TEMPLATE_MARK = 'devteam:strategy-template';
// The template links self.md in its opening lines. The kit reads it for one thing, beside missing,
// template or written: whether it carries the link to self.md (`linksSelf`).
export const STRATEGY_MD = `# Strategy

<!-- ${STRATEGY_TEMPLATE_MARK}: delete this line when you write the strategy -->

What the project is, what it makes and its parts are in [self.md](./self.md); this page says why it exists, who it serves and how it wins.

Why this project exists and how it wins. The supervisor drafts it; only the owner approves a change (class strategy-change).
Goals are judged against it (planning.md §1). Keep it to one page.

## Why it exists
<two or three sentences: the problem, and what is true in the world if this works>

## Who it serves
<the people who use it and the people who pay, and the job each hires it for>

## How it wins, in order
<two to four lines, ranked: when two pull apart, the higher one wins>
- **W1** <e.g. People adopt it without help> : <how this project moves it, and the number that shows it>
- **W2** <e.g. It earns money> : <how, and the number>

## Values
<at most seven; each a rule and a yes/no check a reviewer can answer from a design or a spec>
- **V1** <rule>. Check: <question>

## Refusals
<what we won't do whatever it pays; each one checkable>
- **R1** <refusal>. Check: <question>

## Not known yet
<what the supervisor could not work out; each becomes a question to the owner>
`;

// init [--name project] [--upstream-base vX.Y.Z]: the project folders,
// settings, .gitignore entries, the AGENTS.md pointer; optionally the GitHub check and agent config.
// The section init adds to the project's AGENTS.md: every agent reads this first, then its doc.
export const AGENTS_SECTION = `## devteam

This repository runs on [devteam](https://github.com/sanctuarycomputer/devteam), materialized at \`docs/devteam/\` and owned here. Read the one doc for your role; do not read every doc up front.

| You are | Read |
|---|---|
| the **supervisor** (the owner's foreground agent session; plans, schedules, rules, merges; writes no production code) | \`docs/devteam/process/supervisor.md\` |
| a **worker** on one ticket, in its own worktree and tmux window, running superpowers | \`docs/devteam/process/worker.md\` |
| a **planner** turning a goal into a design, a roadmap and a graph of tickets | \`docs/devteam/process/planning.md\` |
| a **reviewer** (never the author; default verdict: not approved) | \`docs/devteam/governance/quality.md\` §3 |
| the **owner**, deciding what to delegate | \`docs/devteam/governance/constitution.md\` §2 |

The work, largest to smallest: **goal** (owner-approved outcome with a measure and a date) → **design** (\`project/designs/<goal>.md\`) → **feature** (stories, each with a target release) → **ticket** (one PR, one worker; a **wave** is the tickets that can run in parallel) → **task** (one step of a ticket's plan).

The record is the log (\`node docs/devteam/scripts/devteam.mjs log | history | questions | status\`; one append-only JSON Lines log, typed by \`docs/devteam/schema/log.schema.json\`) and the tracked files under \`docs/devteam/project/\`. Chat and scrollback are not the record. \`node docs/devteam/scripts/devteam.mjs help\` lists the commands.

Where rules conflict: the owner's explicit instruction, then enforcing configuration (lint, gates, branch protection), then \`project/settings.md\`, then \`governance/\`, then \`process/\`, then the framework's conventions and your judgment (\`constitution.md\` §6).
`;

export function cmdInit() {
  // From the main checkout only: a worktree's kit folder is the branch's, so project/ would land
  // there while AGENTS.md, .gitignore and the rest went to the main checkout.
  if (repoRoot !== mainRoot) die(`run init from the main checkout (${mainRoot}), not a worktree`);
  const root = mainRoot;
  const made = [];
  const put = (p, text) => { if (!fs.existsSync(p)) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); made.push(path.relative(root, p)); } };
  // main is the remote's default branch: origin/HEAD, or the remote itself where a repo was made
  // with git init (no origin/HEAD); never the branch the checkout happens to be on.
  const remoteHead = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])?.replace(/^origin\//, '')
    ?? (git(['ls-remote', '--symref', 'origin', 'HEAD']) ?? '').match(/^ref: refs\/heads\/(\S+)\s+HEAD/m)?.[1]
    ?? null;
  const block = { project: flagStr('name') ?? path.basename(root), upstream_base: flagStr('upstream-base') ?? null, upstream_sync: 'adopt', ...(remoteHead && remoteHead !== 'main' && remoteHead !== 'HEAD' ? { main_branch: remoteHead } : {}), components: {}, gates: {} };
  put(path.join(projectDir, 'settings.md'), `# Project settings\n\nOnly what this project changes; every setting has a default in scripts/devteam.mjs (\`devteam.mjs settings\` shows the result). Below the block, record project-specific answers to the decisions the governance docs leave open (components and stacks, persistence tiers, one-way doors, release tags, how to notify the owner), each with its date.\n\n\`\`\`json devteam\n${JSON.stringify(block, null, 2)}\n\`\`\`\n`);
  put(path.join(projectDir, 'designs', 'architecture.md'), ARCHITECTURE_MD);
  put(path.join(projectDir, 'strategy.md'), STRATEGY_MD);
  // retros/ and reviews/ hold placeholders; log/ and tickets/ fill as the fleet writes, and merge
  // refuses anything in them that isn't the fleet's (a .gitkeep included).
  for (const d of ['retros', 'reviews']) put(path.join(projectDir, d, '.gitkeep'), '');
  const gi = path.join(root, '.gitignore');
  const giText = readText(gi) ?? '';
  const want = [`${path.relative(root, runDir).split(path.sep).join('/')}/`, '.worktrees/', ...HARNESS_RUNTIME];
  const add = want.filter((w) => !giText.split('\n').includes(w));
  if (add.length) { fs.writeFileSync(gi, `${giText}${giText && !giText.endsWith('\n') ? '\n' : ''}${add.join('\n')}\n`); made.push('.gitignore'); }
  // gitleaks over the history (quality.md, Secrets) would read the log's source_key as a key: a
  // project with no gitleaks config gets one that extends the kit's; one it has already is its own.
  const leaks = path.join(root, GITLEAKS_FILE);
  const leaksText = readText(leaks);
  if (leaksText === null && fs.existsSync(path.join(devteamDir, 'gitleaks.toml'))) put(leaks, gitleaksStub());
  else if (leaksText !== null && !leaksText.includes(KIT_GITLEAKS)) out(`${GITLEAKS_FILE} is this project's and doesn't extend ${KIT_GITLEAKS}, so gitleaks will read the log's source_key values as keys: extend it (governance/quality.md, Secrets)`);
  const agents = path.join(root, 'AGENTS.md');
  if (!fs.existsSync(agents)) { fs.writeFileSync(agents, `# Agents\n\n${AGENTS_SECTION}`); made.push('AGENTS.md'); }
  else if (!readText(agents).includes('docs/devteam/process/supervisor.md')) { fs.appendFileSync(agents, `\n${AGENTS_SECTION}`); made.push('AGENTS.md'); }
  // Claude Code reads CLAUDE.md, not AGENTS.md: where a CLAUDE.md exists, it imports AGENTS.md.
  const claude = path.join(root, 'CLAUDE.md');
  if (fs.existsSync(claude) && !/@AGENTS\.md\b/.test(readText(claude))) { fs.appendFileSync(claude, `\n## devteam\n\n@AGENTS.md\n`); made.push('CLAUDE.md'); }
  out(made.length ? `created:\n${made.map((m) => `  ${m}`).join('\n')}` : 'nothing to create');
  out('next: fill settings (components and their owns, links to sibling repos and design files, agent_command, gates, worktree_files), write designs/architecture.md from the code, then start the supervisor: it drafts strategy.md with you before the first goal, then keeps its loop: devteam.mjs wait in the background, a tick when it returns, never a turn ended without a wait running (the upstream README, Setup)');
}

