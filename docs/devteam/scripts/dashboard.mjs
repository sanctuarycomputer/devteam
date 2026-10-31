#!/usr/bin/env node
// devteam dashboard: a zero-dependency local web page for the owner.
//   node docs/devteam/scripts/dashboard.mjs [--port 4321] [--host 127.0.0.1]
// Run from the main checkout. Serves docs/devteam/dashboard/index.html, the data from
// `devteam.mjs dashboard-data`, and answers to owner questions (`devteam.mjs answer`).
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

const run = (args) =>
  new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ ok: !err, stdout, stderr }));
  });

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
  if (req.method === 'POST' && req.url === '/api/answer') {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 20000) req.destroy();
    });
    req.on('end', async () => {
      let id;
      let answer;
      try {
        ({ id, answer } = JSON.parse(body));
      } catch {
        return send(res, 400, 'application/json', JSON.stringify({ error: 'bad json' }));
      }
      if (!/^q-[0-9]{8}-[0-9]{6}-[a-z0-9-]+$/.test(id ?? '') || typeof answer !== 'string' || !answer.trim()) {
        return send(res, 400, 'application/json', JSON.stringify({ error: 'need a question id and an answer' }));
      }
      const r = await run(['answer', id, answer.trim()]);
      return send(res, r.ok ? 200 : 400, 'application/json', JSON.stringify(r.ok ? { ok: true } : { error: r.stderr.trim() }));
    });
    return;
  }
  send(res, 404, 'text/plain', 'not found');
});

server.listen(port, host, () => process.stdout.write(`devteam dashboard on http://${host}:${port}\n`));
