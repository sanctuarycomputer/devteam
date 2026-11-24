#!/bin/sh
# a Chrome whose pipe answers until its page is made, and which then dies before the attach
echo "$@" >> "$0.log"
exec "$FAKE_NODE" -e '
const fs = require("fs"); const out = fs.createWriteStream(null, { fd: 4 }); let buf = "";
fs.createReadStream(null, { fd: 3 }).on("data", (c) => { buf += c; const parts = buf.split("\0"); buf = parts.pop(); for (const p of parts) { const m = JSON.parse(p); if (m.method === "Target.attachToTarget") process.exit(1); out.write(JSON.stringify({ id: m.id, result: { targetId: "T" } }) + "\0"); } });
'
