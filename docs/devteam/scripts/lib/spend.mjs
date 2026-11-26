/* imports start */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendLog } from './log-sync.mjs';
import { asList } from './base.mjs';
import { byTime } from './log-sync.mjs';
import { clauseBounds } from './decide.mjs';
import { correctionOf } from './log-sync.mjs';
import { isObj } from './artifact-notes.mjs';
import { loadSettings } from './settings.mjs';
import { logCache } from './log-sync.mjs';
import { logGet } from './log-sync.mjs';
import { logObjects } from './log-sync.mjs';
import { mainRoot } from './state.mjs';
import { median } from './base.mjs';
import { out } from './base.mjs';
import { questionNamed } from './decide.mjs';
import { questions } from './log-sync.mjs';
import { readLog } from './log-sync.mjs';
import { realPath } from './state.mjs';
import { remediationAnswers } from './remediation.mjs';
import { runDir } from './state.mjs';
import { sh } from './base.mjs';
import { slug } from './base.mjs';
import { spansOverlap } from './decide.mjs';
import { supervisorOnly } from './log.mjs';
import { supervisorTranscript } from './accounts.mjs';
import { tickets } from './graph.mjs';
import { turnBindings } from './decide.mjs';
import { writerClass } from './log.mjs';
/* imports end */
export function readJunit(file) {
  if (!file || !fs.existsSync(file)) return [];
  const xml = fs.readFileSync(file, 'utf8');
  const res = [];
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attr = (k) => m[1].match(new RegExp(`\\b${k}="([^"]*)"`))?.[1] ?? '';
    res.push({ name: [attr('classname'), attr('name')].filter(Boolean).join(' › ').slice(0, 120), ms: Math.round(Number(attr('time') || 0) * 1000), failed: /<(failure|error)\b/.test(m[3] ?? '') });
  }
  return res;
}
// Failed tests plus the ten slowest: enough for flakiness and hotspots, small enough for one line.
export const keepTests = (tests) => [...tests.filter((t) => t.failed).slice(0, 30), ...tests.filter((t) => !t.failed).sort((a, b) => b.ms - a.ms).slice(0, 10)];

export const GATE_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
export function gateStats(runs) {
  runs = runs.filter((r) => GATE_NAME.test(r.gate ?? ''));
  const byGate = new Map();
  for (const r of runs) (byGate.get(r.gate) ?? byGate.set(r.gate, []).get(r.gate)).push(r);
  const gates = [];
  const flakyGates = [];
  for (const [g, rs] of byGate) {
    const bySha = new Map();
    for (const r of rs.filter((x) => !x.dirty)) (bySha.get(r.sha) ?? bySha.set(r.sha, []).get(r.sha)).push(r);
    const flips = [...bySha.values()].filter((x) => x.some((r) => r.ok) && x.some((r) => !r.ok));
    if (flips.length) flakyGates.push({ gate: g, commits: flips.length, last_flip: flips.flat().map((r) => r.created_at).sort().pop() ?? null });
    gates.push({ gate: g, runs: rs.length, fail_rate: +(rs.filter((r) => !r.ok && !r.preexisting).length / rs.length).toFixed(2), preexisting_fails: rs.filter((r) => r.preexisting).length, median_seconds: +(median(rs.map((r) => r.ms)) / 1000).toFixed(1), max_seconds: +(Math.max(...rs.map((r) => r.ms)) / 1000).toFixed(1) });
  }
  const flakyTests = new Map();
  const testMs = new Map();
  for (const r of runs) for (const t of r.tests ?? []) {
    if (!t.failed) (testMs.get(t.name) ?? testMs.set(t.name, []).get(t.name)).push(t.ms);
    if (t.failed && !r.dirty && runs.some((o) => o !== r && !o.dirty && o.gate === r.gate && o.sha === r.sha && o.ok && o.created_at >= r.created_at)) {
      const p = flakyTests.get(t.name) ?? { times: 0, last: '' };
      flakyTests.set(t.name, { times: p.times + 1, last: r.created_at > p.last ? r.created_at : p.last });
    }
  }
  return {
    gates: gates.sort((a, b) => b.median_seconds - a.median_seconds), flaky_gates: flakyGates,
    flaky_tests: [...flakyTests.entries()].sort((a, b) => b[1].times - a[1].times).map(([name, x]) => ({ name, times: x.times, last_flip: x.last || null })),
    slowest_tests: [...testMs.entries()].map(([name, xs]) => ({ name, median_seconds: +(median(xs) / 1000).toFixed(1) })).sort((a, b) => b.median_seconds - a.median_seconds).slice(0, 10),
  };
}

// ===== spend: measured from the agent harnesses' own session logs =====
// A session can't see its own cost, so asking agents to report it recorded nothing. Every harness
// already logs token usage per response, with the directory it ran in: the kit reads those logs
// (usage numbers and model names only, never content), attributes each response to the ticket,
// planner, reviewer or supervisor whose checkout it ran in, and prices it.
// $ per million tokens: [input, output, cache-read multiple of input]. Cache writes cost 1.25x input
// (5-minute) or 2x (1-hour). Claude list prices; settings.model_prices overrides or adds models.
export const MODEL_PRICES = {
  'claude-fable-5-1': [10, 50, 0.025], 'claude-mythos-5-1': [10, 50, 0.025], 'claude-fable-5': [10, 50, 0.1], 'claude-mythos-5': [10, 50, 0.1],
  'claude-opus-5-5': [4, 20, 0.05], 'claude-opus-5': [5, 25, 0.1], 'claude-opus-4-8': [5, 25, 0.1], 'claude-opus-4-7': [5, 25, 0.1], 'claude-opus-4-6': [5, 25, 0.1],
  'claude-sonnet-5-5': [2, 10, 0.1], 'claude-sonnet-5': [2, 10, 0.1], 'claude-sonnet-4-6': [3, 15, 0.1],
  'claude-haiku-5-5': [0.1, 0.5, 0.1, { over: 100000, input: 0.5, output: 2.5 }], 'claude-haiku-4-5': [1, 5, 0.1],
};
export const modelKey = (m) => String(m ?? '').toLowerCase().replace(/\[.*$/, '').replace(/^(anthropic\.|us\.anthropic\.)/, '').replace(/[-@]\d{8}$/, '');
export function priceFor(model) {
  const k = modelKey(model);
  const own = loadSettings().model_prices?.[k] ?? loadSettings().model_prices?.[model];
  if (own && typeof own.input === 'number' && typeof own.output === 'number') return { input: own.input, output: own.output, read: own.cache_read ?? own.input * 0.1, write: own.cache_write ?? own.input * 1.25, write1h: own.cache_write_1h ?? own.input * 2 };
  const known = MODEL_PRICES[k] ?? MODEL_PRICES[Object.keys(MODEL_PRICES).filter((x) => k.startsWith(x)).sort((a, b) => b.length - a.length)[0]];
  if (!known) return null;
  const [input, output, rf, tier] = known;
  return { input, output, read: input * rf, write: input * 1.25, write1h: input * 2, tier: tier && { over: tier.over, input: tier.input, output: tier.output, read: tier.input * rf, write: tier.input * 1.25, write1h: tier.input * 2 } };
}
// One record: [atMs, model, input, output, cacheRead, cacheWrite5m, cacheWrite1h, usd|null].
export function recordUsd(r) {
  if (typeof r[7] === 'number') return r[7];
  let p = priceFor(r[1]);
  if (!p) return null;
  if (p.tier && r[2] + r[4] + r[5] + r[6] > p.tier.over) p = p.tier;
  return (r[2] * p.input + r[3] * p.output + r[4] * p.read + r[5] * p.write + r[6] * p.write1h) / 1e6;
}
export const realOrSelf = realPath;
// Whose work ran in a directory: a ticket's worktree, a planner's, a reviewer's (charged to its
// ticket), the thread responder's (.worktrees/responder), and the main checkout or a chore's (the supervisor's).
export function spenderFor(cwd, ts) {
  // a subagent the supervisor ran for one ticket (a reviewer): "ticket:<id>:<phase>"
  const sub = /^ticket:(.+):([a-z-]+)$/.exec(cwd ?? '');
  if (sub) return ts.has(sub[1]) ? { who: sub[1], role: 'reviewer', phase: sub[2] } : { who: 'supervisor', role: 'supervisor' };
  const main = realOrSelf(mainRoot);
  const at = realOrSelf(cwd ?? '');
  if (at === main) return { who: 'supervisor', role: 'supervisor' };
  const wtRoot = path.join(main, '.worktrees') + path.sep;
  if (!at.startsWith(wtRoot)) return at.startsWith(main + path.sep) ? { who: 'supervisor', role: 'supervisor' } : null;
  const name = at.slice(wtRoot.length).split(path.sep)[0];
  // the thread responder's own worktree (kit-103); no ticket id is ever `responder` (a keyed id has a -NN-)
  if (name === 'responder') return { who: 'responder', role: 'responder' };
  if (ts.has(name)) return { who: name, role: 'worker' };
  if (name.startsWith('plan-')) return { who: name, role: 'planner' };
  const rv = /^review-(.+?-\d+)-[0-9a-f]{8}/.exec(name);
  if (rv) { const t = [...ts.keys()].find((id) => id === rv[1] || id.startsWith(`${rv[1]}-`)); return t ? { who: t, role: 'reviewer' } : null; }
  const old = /^review-(.+)-[0-9a-f]{12}/.exec(name);
  if (old && ts.has(old[1])) return { who: old[1], role: 'reviewer' };
  return { who: 'supervisor', role: 'supervisor' };
}
// Each source returns Map<cwd, records>. Parsed files are cached in run/cache by size and mtime.
export function usageCache() {
  const file = path.join(runDir, 'cache', 'usage.json');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  // the box's operator only reads, so it parses again next time rather than write a cache
  return { data, save: () => { if (process.env.DEVTEAM_ROLE === 'operator') return; try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data)); } catch {} } };
}
export const USAGE_PARSE_V = 2;
export function cachedParse(cache, f, parse) {
  let st;
  try { st = fs.statSync(f); } catch { return null; }
  const hit = cache.data[f];
  if (hit && hit.size === st.size && hit.mtime === st.mtimeMs && hit.v === USAGE_PARSE_V) return hit;
  let v;
  try { v = parse(fs.readFileSync(f, 'utf8')); } catch { v = { byCwd: {} }; }
  return (cache.data[f] = { size: st.size, mtime: st.mtimeMs, v: USAGE_PARSE_V, ...v });
}
export const walkJsonl = (dir, out = []) => { let es = []; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; } for (const e of es) { const p = path.join(dir, e.name); if (e.isDirectory()) walkJsonl(p, out); else if (e.name.endsWith('.jsonl')) out.push(p); } return out; };
export const USAGE_SOURCES = {
  // Claude Code: ~/.claude/projects/<the directory, slugged>/<session>.jsonl and its subagents;
  // a response's usage repeats on each line of that message, so it counts once per message id.
  'claude-code': (cache) => {
    const root = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'projects');
    const slug = realOrSelf(mainRoot).replace(/[^a-zA-Z0-9]/g, '-');
    let dirs = [];
    try { dirs = fs.readdirSync(root).filter((d) => d === slug || d.startsWith(`${slug}--worktrees-`)); } catch { return []; }
    // The folder is the checkout the session started in (a later cd doesn't move it). A subagent
    // of the main checkout's session that was given one ticket's work (a reviewer: its task names
    // the ticket) is charged to that ticket, in the phase its task names.
    const ids = [...tickets().keys()];
    return dirs.flatMap((d) => walkJsonl(path.join(root, d)).map((f) => cachedParse(cache, f, (text) => {
      const byCwd = {};
      let cwdOf = d === slug ? mainRoot : path.join(mainRoot, '.worktrees', d.slice(`${slug}--worktrees-`.length));
      if (d === slug && f.includes(`${path.sep}subagents${path.sep}`)) {
        const task = subagentTask(text);
        const named = ids.filter((id) => new RegExp(`(^|[^a-z0-9-])${id.replace(/[-]/g, '\\-')}(?![a-z0-9-])`).test(task));
        const viaTree = /\.worktrees\/review-([a-z0-9]+-\d+)-/.exec(task)?.[1];
        const tid = named.length === 1 ? named[0] : viaTree ? ids.find((id) => id.startsWith(`${viaTree}-`)) : null;
        if (tid) cwdOf = `ticket:${tid}:${/final/i.test(task) ? 'final-review' : /\bplan\b/i.test(task) ? 'plan' : /\bspec\b/i.test(task) ? 'spec' : 'review'}`;
      }
      const seen = new Set();
      for (const line of text.split('\n')) {
        if (!line.includes('"usage"')) continue;
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        const m = o.message, u = m?.usage;
        if (!u || o.type !== 'assistant' || m.model === '<synthetic>') continue;
        const key = m.id ?? o.requestId ?? o.uuid;
        if (seen.has(key)) continue;
        seen.add(key);
        const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
        const w = u.cache_creation_input_tokens ?? 0;
        (byCwd[cwdOf] ??= []).push([Date.parse(o.timestamp), m.model, u.input_tokens ?? 0, u.output_tokens ?? 0, u.cache_read_input_tokens ?? 0, Math.max(0, w - w1h), w1h, null]);
      }
      return { byCwd };
    })).filter(Boolean));
  },
  // Codex: ~/.codex/sessions/**/rollout-*.jsonl: the session's cwd up front, turn_context lines
  // name the model, token_count events carry running totals (cached input is part of input).
  codex: (cache) => {
    const root = path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'sessions');
    const main = realOrSelf(mainRoot);
    return walkJsonl(root).map((f) => cachedParse(cache, f, (text) => {
      const lines = text.split('\n');
      let cwd = null;
      try { cwd = JSON.parse(lines[0]).payload?.cwd ?? null; } catch {}
      if (!cwd || !(realOrSelf(cwd) === main || realOrSelf(cwd).startsWith(main + path.sep))) return { byCwd: {} };
      const recs = [];
      let model = null, prev = null;
      for (const line of lines) {
        if (!line.includes('turn_context') && !line.includes('token_count')) continue;
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        if (o.type === 'turn_context') { model = o.payload?.model ?? model; continue; }
        const t = o.payload?.type === 'token_count' ? o.payload.info?.total_token_usage : null;
        if (!t) continue;
        const d = (k) => Math.max(0, (t[k] ?? 0) - (prev?.[k] ?? 0));
        const cached = d('cached_input_tokens');
        if (d('input_tokens') || d('output_tokens')) recs.push([Date.parse(o.timestamp), model, Math.max(0, d('input_tokens') - cached), d('output_tokens'), cached, d('cache_write_input_tokens'), 0, null]);
        prev = t;
      }
      return { byCwd: { [cwd]: recs } };
    })).filter(Boolean);
  },
};
// A subagent transcript's task: the text of its first user message.
export function subagentTask(text) {
  for (const line of text.split('\n')) {
    if (!line.includes('"user"')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== 'user') continue;
    const c = o.message?.content;
    return typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x?.text ?? '').join(' ') : '';
  }
  return '';
}
// usage_command (any other harness: OpenCode, a gateway's export…): runs from the main checkout and
// prints one JSON object per line: {"at", "cwd", "model", "input_tokens", "output_tokens",
// "cache_read_tokens", "cache_write_tokens", "usd" (optional, used as given)}.
export function commandUsage(cmd) {
  const out = sh('sh', ['-c', cmd], { cwd: mainRoot }) ?? '';
  const byCwd = {};
  for (const line of out.split('\n')) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || typeof o !== 'object' || !o.cwd) continue;
    (byCwd[o.cwd] ??= []).push([Date.parse(o.at), o.model ?? null, o.input_tokens ?? 0, o.output_tokens ?? 0, o.cache_read_tokens ?? 0, o.cache_write_tokens ?? 0, 0, typeof o.usd === 'number' ? o.usd : null]);
  }
  return [{ byCwd }];
}
export let spendMemo = null;
// Every response's usage, attributed: [{ who, role, at, model, tokens…, usd }], plus what couldn't
// be priced. Memoised per process; parsed files are cached on disk between processes.
export function measuredSpend() {
  if (spendMemo) return spendMemo;
  const s = loadSettings();
  const ts = tickets();
  const cache = usageCache();
  const parsed = [];
  for (const src of s.usage_sources ?? []) if (USAGE_SOURCES[src]) parsed.push(...USAGE_SOURCES[src](cache));
  cache.save();
  if (s.usage_command) parsed.push(...commandUsage(s.usage_command));
  const recs = [];
  const unpriced = new Map();
  for (const p of parsed) for (const [cwd, rs] of Object.entries(p.byCwd ?? {})) {
    const sp = spenderFor(cwd, ts);
    if (!sp) continue;
    for (const r of rs) {
      const usd = recordUsd(r);
      if (usd === null) unpriced.set(r[1] ?? 'unknown', (unpriced.get(r[1] ?? 'unknown') ?? 0) + r[2] + r[3] + r[4] + r[5] + r[6]);
      recs.push({ ...sp, at: r[0], model: r[1], input: r[2], output: r[3], cache_read: r[4], cache_write: r[5] + r[6], usd: usd ?? 0, priced: usd !== null });
    }
  }
  return (spendMemo = { recs, unpriced: Object.fromEntries(unpriced) });
}
// The phase a response is charged to: a worker's phase at that moment; a planner's planning, a
// reviewer's review, the supervisor's its own.
export function phaseAtFor(role, who, at, phaseLines) {
  if (role !== 'worker') return { supervisor: 'supervisor', planner: 'planning', reviewer: 'review' }[role] ?? role;
  let phase = 'starting';
  for (const l of phaseLines.get(who) ?? []) { if (Date.parse(l.created_at) <= at) phase = l.to; else break; }
  return phase;
}
export const phaseLinesMap = () => { const m = new Map(); for (const l of logObjects('phase')) (m.get(l.created_by) ?? m.set(l.created_by, []).get(l.created_by)).push(l); for (const ls of m.values()) ls.sort(byTime); return m; };
// Spend, as items { who, role, phase, at, usd, tokens…, by_model }: the log's spend lines (durable),
// then whatever the harness logs show since each agent's last line (not yet observed).
export let spendItemsMemo = null;
export function spendItems() {
  if (spendItemsMemo) return spendItemsMemo;
  const phaseLines = phaseLinesMap();
  const items = [];
  const through = new Map();
  for (const l of logObjects('spend')) {
    const at = Date.parse(l.through);
    through.set(l.who, Math.max(through.get(l.who) ?? 0, at));
    items.push({ who: l.who, role: l.role, phase: l.phase, at, usd: l.usd ?? 0, input: l.input_tokens ?? 0, output: l.output_tokens ?? 0, cache_read: l.cache_read_tokens ?? 0, cache_write: l.cache_write_tokens ?? 0, by_model: l.by_model ?? {}, logged: true });
  }
  for (const r of measuredSpend().recs) {
    if (r.at <= (through.get(r.who) ?? -Infinity)) continue;
    items.push({ who: r.who, role: r.role, phase: r.phase ?? phaseAtFor(r.role, r.who, r.at, phaseLines), at: r.at, usd: r.usd, input: r.input, output: r.output, cache_read: r.cache_read, cache_write: r.cache_write, by_model: { [r.model ?? 'unknown']: { usd: r.usd, output_tokens: r.output, ...(r.priced === false ? { unpriced_tokens: r.input + r.output + r.cache_read + r.cache_write } : {}) } }, logged: false });
  }
  return (spendItemsMemo = items);
}
// observe-spend (each tick, with observe-metrics): turn the not-yet-observed tail into spend lines,
// one per agent and phase, so the log holds spend after the harness logs are cleaned up.
export function observeSpend() {
  const groups = new Map();
  for (const it of spendItems().filter((x) => !x.logged)) {
    const k = `${it.who}\0${it.phase}`;
    const g = groups.get(k) ?? { who: it.who, role: it.role, phase: it.phase, at: 0, usd: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, by_model: {} };
    g.at = Math.max(g.at, it.at);
    for (const f of ['usd', 'input', 'output', 'cache_read', 'cache_write']) g[f] += it[f];
    for (const [mdl, v] of Object.entries(it.by_model)) { const b = (g.by_model[mdl] ??= { usd: 0, output_tokens: 0 }); b.usd += v.usd; b.output_tokens += v.output_tokens; if (v.unpriced_tokens) b.unpriced_tokens = (b.unpriced_tokens ?? 0) + v.unpriced_tokens; }
    groups.set(k, g);
  }
  // one agent's lines share one `through` (its latest response), so the next tick resumes after all of them
  const latest = new Map();
  for (const g of groups.values()) latest.set(g.who, Math.max(latest.get(g.who) ?? 0, g.at));
  for (const g of groups.values()) appendLog({ type: 'spend', who: g.who, role: g.role, phase: g.phase, through: new Date(latest.get(g.who)).toISOString(), usd: +g.usd.toFixed(4), input_tokens: g.input, output_tokens: g.output, cache_read_tokens: g.cache_read, cache_write_tokens: g.cache_write, by_model: Object.fromEntries(Object.entries(g.by_model).map(([k, v]) => [k, { ...v, usd: +v.usd.toFixed(4) }])) }, 'supervisor');
  spendItemsMemo = null; spendWhoMemo = null; logCache = null;
  return groups.size;
}
export function cmdObserveSpend() {
  supervisorOnly('observe-spend');
  out(`recorded ${observeSpend()} spend line(s)`);
}
export let spendWhoMemo = null;
export const spendByWho = () => { if (spendWhoMemo) return spendWhoMemo; const m = new Map(); for (const r of spendItems()) { const x = m.get(r.who) ?? { usd: 0, input_tokens: 0, output_tokens: 0 }; x.usd += r.usd; x.input_tokens += r.input + r.cache_read + r.cache_write; x.output_tokens += r.output; m.set(r.who, x); } return (spendWhoMemo = m); };

// Chat answers of the last week whose quoted words aren't in an owner-typed line of the supervisor's
// own transcript (Claude Code's only; real owner lines are userType "external"). Only what the tail
// read by supervisorTranscript covers is checked: no transcript, or an older answer, says nothing.
export const CHAT_QUOTE_WINDOW_MS = 7 * 24 * 3600000;
export function chatQuotesNotFound() {
  if (!/^claude(\s|$)/.test(loadSettings().resume_command)) return [];
  const recent = [...questions().filter((q) => q.channel === 'chat' && q.said && Date.now() - Date.parse(q.answered_at) < CHAT_QUOTE_WINDOW_MS), ...logObjects('question').filter((q) => q.owner_said && !q.owner_said_turn && Date.now() - Date.parse(q.created_at) < CHAT_QUOTE_WINDOW_MS).map((q) => ({ id: q.id, said: q.owner_said, answered_at: q.created_at })),
    // the owner's correction recorded from chat (correct --from-chat): its words, as an answer's (a hold
    // lifted from a turn is checked against its turn instead, in threadAnswersUnbound)
    ...[...logObjects('decision'), ...logObjects('act')].map((o) => ({ o, x: correctionOf(o) })).filter(({ x }) => x?.channel === 'chat' && typeof x.said === 'string' && writerClass(x.by) === 'owner' && Date.now() - Date.parse(x.at) < CHAT_QUOTE_WINDOW_MS).map(({ o, x }) => ({ id: o.id, said: x.said, answered_at: x.at }))];
  const t = recent.length ? supervisorTranscript() : null;
  if (!t) return [];
  const from = Date.parse(t.entries.find((o) => o?.timestamp)?.timestamp);
  const norm = (x) => x.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, ' ').trim();
  const typed = t.entries.filter((o) => o?.type === 'user' && o.userType === 'external' && !o.isMeta && !o.isSidechain).map((o) => { const c = o.message?.content; return norm(typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x?.type === 'text').map((x) => x.text).join(' ') : ''); });
  // typed while the agent was mid-turn: the transcript has these as queued attachments
  typed.push(...t.entries.filter((o) => o?.type === 'attachment' && o.attachment?.type === 'queued_command' && o.origin?.kind === 'human' && typeof o.attachment.prompt === 'string').map((o) => norm(o.attachment.prompt)));
  // what the box's operator typed in (box-tell) arrives the same way, and isn't the owner
  const owners = typed.filter((x) => !x.startsWith('from the operator ('));
  return recent.filter((q) => { const said = norm(q.said).replace(/^["'\s]+|["'.!?\s]+$/g, ''); return Date.parse(q.answered_at) >= from && !owners.some((x) => x.includes(said)); });
}
// Everything the owner's words in a thread bound, checked after the fact for lines written some other
// way than the writers (checkLine checks only their shape). Each line gives its first failing reason.
// A whole-turn answer (answer --from-turn): the turn is the owner's, its words are what the line says,
// it is in the question's thread, newer than the question, an Inbox question was named in the turn's
// thread before it (questionNamed), the turn has no clause binding before it, and no whole-turn answer
// cites it before. A clause answer (said_at), a hold lifted from a turn (owner_said_turn) and a
// correction from a thread (corrected.turn): the turn is the owner's, in the right thread, its raw
// slice is the words and whole clauses (clauseBounds), and no binding before it on the turn overlaps
// it; then a clause answer's answer_seen is the newest owner turn at the answer, a lifted hold's turn
// is newer than the no, and a correction's thread is about its record or the act that carried it out.
export function threadAnswersUnbound() {
  const { objects, lines: all } = readLog();
  const order = new Map(all.map((l, i) => [l, i]));
  const sorted = [...all].sort((a, b) => String(a.at).localeCompare(String(b.at)) || order.get(a) - order.get(b));
  const before = (a, b) => String(a.at) < String(b.at) || (a.at === b.at && order.get(a) < order.get(b));
  const bindings = new Map();
  const boundBefore = (l, uid) => (bindings.get(uid) ?? (bindings.set(uid, turnBindings(sorted, uid)), bindings.get(uid))).filter((b) => before(b.line, l));
  // slice clamps, so the span must also lie inside the turn (final-1b F2)
  const sliceWhy = (u, said, at, what) => (!Array.isArray(at) || typeof said !== 'string' || at[1] > u.text.length || u.text.slice(at[0], at[1]) !== said ? `gives words that aren't what the turn says${what}`
    : !clauseBounds(u.text, at[0], at[1]) ? `binds part of a clause${what}, not whole clauses` : null);
  const overlapWhy = (l, uid, span) => { const b = boundBefore(l, uid).find((x) => spansOverlap(x.span, span)); return b ? `overlaps words of the turn that already bound ${b.id}` : null; };
  const turnWhy = (uid) => { const u = typeof uid === 'string' ? logGet(uid) : null; return u?.type !== 'turn' ? [null, `names no turn that exists (${uid ?? 'none'})`] : u.created_by !== 'owner' ? [u, "cites a turn that is the supervisor's, not the owner's"] : [u, null]; };
  // the newest owner turn in the thread before the line, by the log's order (a turn in the same
  // millisecond, appended after it, wasn't there to read)
  const newestOwnerTurn = (thread, l) => sorted.filter((x) => x.type === 'turn' && x.op === 'new' && x.thread === thread && writerClass(x.by) === 'owner' && before(x, l)).pop()?.id ?? null;
  const afterWhy = (u, l) => (u.created_at > l.at ? `cites a turn written after it (${u.id})` : null);
  const found = [];
  for (const l of sorted) {
    let why = null;
    if (l.type === 'question' && l.op === 'set' && l.channel === 'thread' && Array.isArray(l.said_at)) {
      const q = logGet(l.id);
      const [u, w] = turnWhy(l.turn);
      why = w ?? (q?.thread !== u.thread ? 'cites a turn from another thread than the one the question was asked in'
        : q.about_turn !== u.id ? `answers a question asked about another turn (${q.about_turn ?? 'none'})`
          : afterWhy(u, l) ?? sliceWhy(u, l.said, l.said_at, '') ?? overlapWhy(l, u.id, l.said_at)
            ?? (l.answer_seen !== newestOwnerTurn(u.thread, l) ? `gives answer_seen ${l.answer_seen ?? 'none'}, not the newest owner turn the answer should have read (${newestOwnerTurn(u.thread, l)})` : null));
    } else if (l.type === 'question' && l.op === 'set' && l.channel === 'thread') {
      const q = logGet(l.id);
      const [u, w] = turnWhy(l.turn);
      const earlier = w ? [] : boundBefore(l, u.id);
      const clause = earlier.find((b) => b.span);
      const whole = earlier.find((b) => !b.span && b.kind === 'answer');
      why = w ?? (l.said !== u.text ? "gives words that aren't what the turn says"
        : q?.thread && u.thread !== q.thread ? 'cites a turn from another thread than the one the question was asked in'
          : q && u.created_at <= q.created_at ? 'cites a turn from before the question was asked'
            : q && !q.thread && !questionNamed(objects, u.thread, q.id, u.created_at) ? "cites a turn in a thread where the supervisor hadn't named the question before it"
              : clause ? `settles a whole turn that also has a clause binding (${clause.id})`
                : whole ? `cites a turn that already settled ${whole.id}` : null);
    } else if (l.type === 'question' && l.op === 'new' && l.owner_said_turn !== undefined) {
      const [u, w] = turnWhy(l.owner_said_turn);
      const rem = asList(l.blocks).find((b) => String(b).startsWith('remediation:'));
      const no = !w && rem ? remediationAnswers(rem, asList(l.blocks).find((b) => String(b).startsWith('release:')) ?? null).filter((a) => !a.run && a.at < l.at).pop() : null;
      why = w ?? (u.thread !== l.thread ? 'lifts a hold with a turn from another thread than the question\'s'
        : afterWhy(u, l) ?? sliceWhy(u, l.owner_said, l.owner_said_at, ' to lift a hold')
          ?? (no && !(u.created_at > no.at) ? `lifts a hold with a turn older than the no it lifts (the owner's, ${no.id})` : null));
    } else if (['decision', 'act'].includes(l.type) && l.op === 'set' && l.channel === 'thread' && isObj(l.corrected) && l.corrected.turn !== undefined) {
      const [u, w] = turnWhy(l.corrected.turn);
      const ref = w ? null : logGet(u.thread)?.subject?.ref ?? null;
      const via = ref?.startsWith('act:') ? logGet(ref.slice(4)) : null;
      why = w ?? (ref !== `${l.type}:${l.id}` && !(via?.type === 'act' && via.decision === l.id) ? `corrects from a thread about another record (${ref ?? 'nothing in particular'})`
        : l.type === 'act' && logGet(l.id)?.decision ? `corrects an act that carried out ${logGet(l.id).decision}; the decision is what's corrected`
          : afterWhy(u, l) ?? sliceWhy(u, l.corrected.said, l.corrected.said_at, '') ?? overlapWhy(l, u.id, l.corrected.said_at));
    }
    if (why) found.push({ id: l.id, why });
  }
  return found;
}
// ===== the Efficiency Score's data (the dashboard design's Efficiency section; kit-173) =====

