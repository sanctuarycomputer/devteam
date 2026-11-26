#!/usr/bin/env node
// bash-ok: a Claude Code PreToolUse hook on Bash, in every session the kit starts (devteam.mjs's
// claudePolicy and supervisorPolicy). An inline rm whose path is built from a variable, a glob, a
// brace or $(…) is refused, with worker.md's "Scripts go in files" as the reason, before Claude Code
// stops on its permission prompt ("Dangerous rm operation") in a window nobody watches; a
// subagent's prompt stops its whole session behind it. The session reads the reason and writes the
// script file instead. Its own small file, so the hook doesn't parse all of devteam.mjs on every
// command; it needs no repo, settings or log. It only ever refuses: anything it can't read goes through.
//
// It reads the line as a shell would, enough to find command words: quotes, comments, heredoc
// bodies and redirections are not commands, so `rm` in a grep pattern, a commit message or a PR
// body passes. Separators: ; & | newlines ( ). Wrappers it looks through: sudo, env, timeout,
// nice, nohup, command, builtin, exec, time, stdbuf, ionice, and the shell's own then/do/else/!.
// sh -c / bash -c and eval are read again as commands. Not covered: xargs rm (its paths come on
// stdin), find -delete and find -exec rm (no variable path in the line); Claude Code doesn't prompt
// on those for a variable path.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const INLINE_RM_WHY = 'Run any multi-step shell command, heredoc, or `rm` of a variable, glob or `$(…)` as a script file you write with your file tool and then run, never inline: a permission prompt stops the whole session. In that file, delete only paths built with `${VAR:?}` on every part, under a directory the script made or names literally, and never a path read from a file or from `$(…)`.';

// The line as simple commands, each a list of words { text, expands } (text unquoted; expands: a
// part of it the shell would expand into a path: $, `, or an unquoted glob or brace).
export function simpleCommands(src) {
  const s = String(src ?? '');
  const cmds = [];
  let words = [];
  let w = null;
  let redirect = false;
  const heredocs = [];
  const endWord = () => {
    if (w) { if (redirect) redirect = false; else words.push(w); }
    w = null;
  };
  const endCmd = () => { endWord(); if (words.length) cmds.push(words); words = []; };
  const cur = () => (w ??= { text: '', expands: false });
  // $( … ) or ` … `: skipped whole, with nesting and quotes inside it
  const skipSubst = (i, close) => {
    let depth = 1;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (c === '\\') { j++; continue; }
      if (c === "'" && close === ')') { const k = s.indexOf("'", j + 1); if (k < 0) return s.length; j = k; continue; }
      if (close === ')' && c === '(') depth++;
      if (c === close && --depth === 0) return j + 1;
    }
    return s.length;
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\n') {
      endCmd();
      i++;
      // heredoc bodies start on the next line and end at their delimiter's own line
      while (heredocs.length) {
        const { delim, tabs } = heredocs.shift();
        for (;;) {
          if (i >= s.length) break;
          const nl = s.indexOf('\n', i);
          const line = s.slice(i, nl < 0 ? s.length : nl);
          i = nl < 0 ? s.length : nl + 1;
          if ((tabs ? line.replace(/^\t+/, '') : line) === delim) break;
        }
      }
      continue;
    }
    if (c === ' ' || c === '\t') { endWord(); i++; continue; }
    if (c === '\\') { if (s[i + 1] === '\n') { i += 2; continue; } cur().text += s[i + 1] ?? ''; i += 2; continue; }
    if (c === '#' && !w) { const nl = s.indexOf('\n', i); i = nl < 0 ? s.length : nl; continue; }
    if (c === ';' || c === '&' || c === '|' || c === '(' || c === ')') {
      if (c === '&' && (s[i - 1] === '>' || s[i + 1] === '>')) { i++; continue; } // >&2, &>file
      endCmd(); i++; continue;
    }
    if (c === '<' && s[i + 1] === '<' && s[i + 2] !== '<') {
      endWord();
      let j = i + 2;
      const tabs = s[j] === '-';
      if (tabs) j++;
      while (s[j] === ' ' || s[j] === '\t') j++;
      let d = '';
      while (j < s.length && !/[\s;&|<>()]/.test(s[j])) { if (!`'"\\`.includes(s[j])) d += s[j]; j++; }
      if (d) heredocs.push({ delim: d, tabs });
      i = j;
      continue;
    }
    if (c === '<' || c === '>') {
      // a redirection: its operator, then its target, never an argument (a bare fd number before it is dropped)
      if (w && /^\d+$/.test(w.text) && !w.expands) w = null;
      endWord();
      let j = i;
      while (s[j] === '<' || s[j] === '>' || s[j] === '&' || s[j] === '|') j++;
      if (/^[0-9-]/.test(s[j] ?? '') && s[j - 1] === '&') { while (/[0-9-]/.test(s[j] ?? '')) j++; i = j; continue; }
      redirect = true;
      i = j;
      continue;
    }
    if (c === "'") {
      const k = s.indexOf("'", i + 1);
      cur().text += s.slice(i + 1, k < 0 ? s.length : k);
      i = k < 0 ? s.length : k + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') {
        if (s[j] === '\\') { cur().text += s[j + 1] ?? ''; j += 2; continue; }
        if (s[j] === '$' || s[j] === '`') {
          cur().expands = true;
          if (s[j] === '$' && s[j + 1] === '(') { const e = skipSubst(j + 2, ')'); cur().text += s.slice(j, e); j = e; continue; }
          if (s[j] === '`') { const e = skipSubst(j + 1, '`'); cur().text += s.slice(j, e); j = e; continue; }
        }
        cur().text += s[j];
        j++;
      }
      cur();
      i = j + 1;
      continue;
    }
    if (c === '$' || c === '`') {
      cur().expands = true;
      if (c === '$' && s[i + 1] === '(') { const e = skipSubst(i + 2, ')'); cur().text += s.slice(i, e); i = e; continue; }
      if (c === '`') { const e = skipSubst(i + 1, '`'); cur().text += s.slice(i, e); i = e; continue; }
      cur().text += c;
      i++;
      continue;
    }
    if ('*?[{'.includes(c)) cur().expands = true;
    cur().text += c;
    i++;
  }
  endCmd();
  return cmds;
}

// Wrappers and their options that take a value, looked through to the command they run.
const WRAPPERS = {
  sudo: /^-[ugpCDhrtTUR]$/, env: /^-[uSC]$/, timeout: /^-[sk]$/, nice: /^-n$/, ionice: /^-[cnpP]$/, stdbuf: /^-[ioe]$/,
  nohup: null, command: null, builtin: null, exec: /^-a$/, time: null, '!': null, then: null, do: null, else: null, elif: null, if: null, while: null, until: null, '{': null, '}': null,
};
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

// The first rm in the line that removes a path built from a variable, a glob, a brace or $(…): its words, or null.
export function inlineRiskyRm(command, depth = 0) {
  if (depth > 3) return null;
  for (const words of simpleCommands(command)) {
    let i = 0;
    for (;;) {
      const t = words[i]?.text;
      if (t === undefined) break;
      if (ASSIGN.test(t)) { i++; continue; }
      if (!Object.hasOwn(WRAPPERS, t)) break;
      const takesValue = WRAPPERS[t];
      i++;
      // its options (and an option's value), then for timeout its duration
      while (words[i] && /^-/.test(words[i].text) && words[i].text !== '--') { if (takesValue?.test(words[i].text)) i++; i++; }
      if (words[i]?.text === '--') i++;
      if (t === 'env') while (words[i] && ASSIGN.test(words[i].text)) i++;
      if (t === 'timeout' && words[i] && /^[\d.]+[smhd]?$/.test(words[i].text)) i++;
    }
    const cmd = words[i]?.text ?? '';
    const rest = words.slice(i + 1);
    if (/^(?:\S*\/)?(?:ba|z|da)?sh$/.test(cmd)) {
      const k = rest.findIndex((x) => /^-\w*c\w*$/.test(x.text));
      if (k >= 0 && rest[k + 1]) { const hit = inlineRiskyRm(rest[k + 1].text, depth + 1); if (hit) return hit; }
      continue;
    }
    if (cmd === 'eval') { const hit = inlineRiskyRm(rest.map((x) => x.text).join(' '), depth + 1); if (hit) return hit; continue; }
    if (!/^(?:\S*\/)?rm$/.test(cmd)) continue;
    let opts = true;
    for (const a of rest) {
      if (opts && a.text === '--') { opts = false; continue; }
      if (opts && /^-/.test(a.text) && !a.expands) continue;
      if (a.expands) return words.map((x) => x.text).join(' ');
    }
  }
  return null;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  let input = null;
  if (!process.stdin.isTTY) try { input = JSON.parse(fs.readFileSync(0, 'utf8') || 'null'); } catch {}
  let hit = null;
  try { hit = input?.tool_name && input.tool_name !== 'Bash' ? null : inlineRiskyRm(input?.tool_input?.command); } catch { hit = null; }
  if (hit) process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `devteam: refused before it could stop on a permission prompt nobody answers: \`${hit.slice(0, 160)}\` removes a path built from a variable, glob or $(…). ${INLINE_RM_WHY}` } })}\n`);
  process.exit(0);
}
