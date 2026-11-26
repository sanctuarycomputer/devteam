// The gateway's source as the single file had it, from the generated tree's modules (written by
// test/split/overlay/gateway, kit-894): the shebang, the header, the import lines as written, then every
// module's body in the manifest's order with its imports region and each export the split added taken
// off, then the command line from the entry. Tests that read cloud/gateway.mjs's text read this.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODULES = ["cloud/gateway/base.mjs","cloud/gateway/assets.mjs","cloud/gateway/server.mjs","cloud/gateway/pages.mjs"];
const SHEBANG = "#!/usr/bin/env node";
const HEAD = 89;
const IMPORTS = ["import crypto from 'node:crypto';","import fs from 'node:fs';","import http from 'node:http';","import net from 'node:net';","import path from 'node:path';","import { pipeline } from 'node:stream';","import { fileURLToPath } from 'node:url';","import zlib from 'node:zlib';"];
const EXPORTED = new Set(["cborDecode","coseToJwk","parseAuthData","verifySignature","boxImage","threadKey","redactClaimLinks","hubSignature","paneSignature","ownerSettingSignature","termSignature","encryptPush","vapidToken","pushSubscription","HOST_LABEL","RESERVED_LABELS","RESERVED_SEGMENTS","PREVIEW_NAME","previewLinks","PREVIEW_LENS","previewLensCsp","alertNews","inboxNews","iconPng","PUBLIC_TYPES","PUBLIC_CDNS","publicPathOk","publicCsp","replaceFrameAncestors","LINK_ID","PROJECT","TREE","FILE_MAX","ARTIFACT_MAX","canonicalJson","manifestProblem","gitBlobId","gitTreeId","publicStore","UPLOAD_RULES","safeUploadName","shellQuote","dropPaste","isDropImage","dropSpace","dropNote","createGateway"]);
const DECL = /^export ((?:async\s+)?function\*?\s*|class\s+|(?:const|let|var)\s+)([A-Za-z_$][\w$]*)/;

export function gatewaySource() {
  const body = [];
  for (const f of MODULES) {
    const lines = fs.readFileSync(path.join(root, f), 'utf8').split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    const e = lines[0] === '/* imports start */' ? lines.indexOf('/* imports end */') : -1;
    for (const l of lines.slice(e + 1)) { const m = DECL.exec(l); body.push(m && !EXPORTED.has(m[2]) ? l.slice('export '.length) : l); }
  }
  const entry = fs.readFileSync(path.join(root, 'cloud', 'gateway.mjs'), 'utf8');
  const at = entry.indexOf('\n// --- command line ');
  const tail = at < 0 ? [] : entry.slice(at + 1).replace(/\n$/, '').split('\n');
  return `${[...(SHEBANG ? [SHEBANG] : []), ...body.slice(0, HEAD), ...IMPORTS, ...body.slice(HEAD), ...tail].join('\n')}\n`;
}
