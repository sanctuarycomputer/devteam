#!/usr/bin/env node
// devteam dashboard: a zero-dependency local web page for the owner.
//   node docs/devteam/scripts/dashboard.mjs [--port 4321] [--host 127.0.0.1]
// Run from the main checkout. Serves docs/devteam/dashboard/index.html, the data from
// `devteam.mjs dashboard-data`, and the owner's actions: answers (with autonomy direction and
// standing rules), corrections, marking the act feed seen, approving goals, accepting knowledge.
// Binds to localhost by default: anyone who can reach it can answer as the owner.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, 'devteam.mjs');
const page = path.join(here, '..', 'dashboard', 'index.html');
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const port = Number(arg('port', 4321));
const host = arg('host', '127.0.0.1');

// Owner actions run as the owner: no agent role, and every line records the dashboard channel.
const ownerEnv = { ...process.env, DEVTEAM_CHANNEL: 'dashboard' };
delete ownerEnv.DEVTEAM_ROLE;
delete ownerEnv.DEVTEAM_TICKET;
const run = (args) =>
  new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { maxBuffer: 64 * 1024 * 1024, env: ownerEnv }, (err, stdout, stderr) => resolve({ ok: !err, stdout, stderr }));
  });

const ID = /^[a-z]-\d{8}-\d{6}(\d{3})?-[a-z0-9]+(-[a-z0-9]+)*$/;
const text = (x, max = 4000) => typeof x === 'string' && x.trim() && x.length <= max;

// Each POST action: validate the body, then the CLI arguments to run as the owner.
const ACTIONS = {
  answer: (b) => {
    if (!ID.test(b.id ?? '') || !text(b.answer)) return null;
    const args = ['answer', b.id, b.answer.trim()];
    if (b.matched === true) args.push('--matched');
    if ([1, 2, 3].includes(b.autonomy)) args.push('--autonomy', String(b.autonomy), ...(text(b.scope, 100) ? ['--scope', b.scope.trim()] : []));
    if (text(b.rule, 600)) args.push('--rule', b.rule.trim());
    return args;
  },
  correct: (b) => (ID.test(b.id ?? '') && text(b.reason, 600) ? ['correct', b.id, '--reason', b.reason.trim(), ...(['undo', 'fix-ticket', 'none'].includes(b.repair) ? ['--repair', b.repair] : [])] : null),
  seen: (b) => (b.upto === undefined || !Number.isNaN(Date.parse(b.upto)) ? ['seen', ...(b.upto ? ['--upto', b.upto] : [])] : null),
  'goal-approve': (b) => (ID.test(b.id ?? '') ? ['goal', 'approve', b.id] : null),
  knowledge: (b) => (ID.test(b.id ?? '') && ['accepted', 'retired', 'stale'].includes(b.status) ? ['knowledge', 'set', b.id, '--status', b.status, '--owner'] : null),
};

const send = (res, code, type, body) => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(page));
  }
  if (req.method === 'GET' && req.url.startsWith('/api/data')) {
    const r = await run(['dashboard-data', '--json']);
    return r.ok ? send(res, 200, 'application/json', r.stdout) : send(res, 500, 'application/json', JSON.stringify({ error: r.stderr.trim() }));
  }
  const action = req.method === 'POST' && req.url.startsWith('/api/') ? ACTIONS[req.url.slice('/api/'.length)] : null;
  if (action) {
    // Only this page may act as the owner: no cross-site form posts, no other hosts (DNS rebinding).
    const okHost = [`127.0.0.1:${port}`, `localhost:${port}`, `${host}:${port}`].includes(req.headers.host ?? '');
    const site = req.headers['sec-fetch-site'];
    const origin = req.headers.origin;
    const sameOrigin = (!site || site === 'same-origin') && (!origin || origin === `http://${req.headers.host}`);
    if (!okHost || !sameOrigin || !(req.headers['content-type'] ?? '').startsWith('application/json')) {
      return send(res, 403, 'application/json', JSON.stringify({ error: 'refused: owner actions only from this dashboard page' }));
    }
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 20000) req.destroy();
    });
    req.on('end', async () => {
      let parsed;
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        return send(res, 400, 'application/json', JSON.stringify({ error: 'bad json' }));
      }
      const args = action(parsed);
      if (!args) return send(res, 400, 'application/json', JSON.stringify({ error: 'missing or invalid fields' }));
      const r = await run(args);
      return send(res, r.ok ? 200 : 400, 'application/json', JSON.stringify(r.ok ? { ok: true, out: r.stdout.trim() } : { error: r.stderr.split('\n').filter((l) => l && !l.startsWith('devteam: warning:')).join(' ').replace(/^devteam: /, '') }));
    });
    return;
  }
  send(res, 404, 'text/plain', 'not found');
});

server.listen(port, host, () => process.stdout.write(`devteam dashboard on http://${host}:${port}\n`));
