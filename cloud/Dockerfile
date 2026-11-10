# syntax=docker/dockerfile:1.7
# devteam in the cloud: one container that is the owner's dev box. Its only public listener is the
# gateway (gateway.mjs), which lets in a passkey registered when the box is claimed and passes the
# owner to the machine's devteam hub, a terminal on the box's tmux server (where supervisors and
# workers run), and each repo's dashboard on a subdomain of its own. What lasts lives on /data.
#
# It needs a name and a wildcard under it, e.g. box.example.com and *.box.example.com: each
# dashboard keeps an origin of its own (4321.box.example.com), as on a laptop, and the terminal has
# its own too (term.box.example.com). Signing in is at box.example.com/auth.
# public.box.example.com, under the same wildcard, serves the artifacts the owner published, to
# anyone, from the gateway's own copy (DEVTEAM_PUBLIC_MAX caps it, in bytes; 500 MB by default).
# A session's running dev server gets a name of its own under the same wildcard, cool-tiger.box.example.com,
# behind the owner's session; box.example.com/dev/ lists them. DEVTEAM_PREVIEWS=1 says this image's
# gateway serves them, so the kit prints a link only then.
#
# Render: New > Web Service > this repo (or a fork), Language: Docker, Dockerfile path:
#   cloud/Dockerfile, build context: the repo root. Instance: Pro (4 GB) or larger; a free one
#   sleeps, and sleeping stops every agent. Auto-Deploy: Off; the box deploys at each release
#   instead (.github/workflows/box-deploy.yml, with the service's Deploy Hook as the secret
#   RENDER_DEPLOY_HOOK of the GitHub environment "box", never a repo secret, and that environment
#   needing the owner's approval; the README's "deploy gate" says why. Agents share the owner's gh
#   login, so this raises the bar and isn't a hard boundary). A deploy restarts the box; each
#   supervisor that was running comes back through the operator (window 0), and brings back its
#   fleet; what couldn't start is in ~/operator/NOTES.md. Disk: mounted at /data. Health check path: /healthz. Environment: DEVTEAM_PUBLIC_URL=https://box.example.com. Custom domains:
#   box.example.com and *.box.example.com, with every DNS record Render lists for them (a wildcard
#   needs its own name pointed at Render too, plus the _acme-challenge and _cf-custom-hostname
#   CNAMEs; remove any AAAA records). Best on a domain used for nothing else, or if Render won't
#   take a wildcard under a subdomain: example.com and *.example.com. The *.onrender.com address is refused:
#   the box answers only on its own names. Then deploy: the log prints the claim link,
#   https://box.example.com/auth/claim#<token>, good for a day (after that, a restart prints a new one).
# fly.io: fly launch --no-deploy --dockerfile cloud/Dockerfile --internal-port 8080; in fly.toml
#   set auto_stop_machines = "off", min_machines_running = 1, [env] DEVTEAM_PUBLIC_URL, and
#   [mounts] source = "data", destination = "/data"; fly volumes create data; fly certs add for
#   both names; fly deploy.
# Lost every passkey: in a shell on the box as root (Render's Shell tab, fly ssh console), run
#   devteam-reclaim, which prints a new claim link (as another user, setpriv fails: use root).
FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d

ENV LANG=C.UTF-8 SHELL=/bin/bash DISABLE_AUTOUPDATER=1 MISE_YES=1 DEVTEAM_PREVIEWS=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends git tmux tini curl ca-certificates gnupg openssh-client procps less vim-tiny jq unzip build-essential python3 \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

# A general-purpose dev machine, like the owner's Mac, without a container per project. Everything
# outside /data resets on a deploy, so only what needs root lives here: system libraries, and things
# worth having prebuilt. Languages and their versions are per project, with mise, on the disk.
# Postgres 14, 16 and 17 with pgvector, as on the owner's Mac; `box-pg` runs a server of any of them.
RUN curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/keyrings/pgdg.asc \
 && echo "deb [signed-by=/usr/share/keyrings/pgdg.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-common \
 && sed -i 's/^#\?create_main_cluster.*/create_main_cluster = false/' /etc/postgresql-common/createcluster.conf \
 && apt-get install -y --no-install-recommends \
      postgresql-14 postgresql-16 postgresql-17 postgresql-14-pgvector postgresql-16-pgvector postgresql-17-pgvector libpq-dev \
      redis-server sqlite3 \
      pkg-config autoconf automake libtool bison flex re2c cmake ninja-build \
      libssl-dev libyaml-dev zlib1g-dev libffi-dev libreadline-dev libgmp-dev libncurses-dev libbz2-dev liblzma-dev \
      libsqlite3-dev default-libmysqlclient-dev libxml2-dev libxslt1-dev libcurl4-openssl-dev uuid-dev libicu-dev \
      libvips-dev libjpeg-dev libpng-dev libwebp-dev libcairo2-dev libpango1.0-dev libgif-dev librsvg2-dev libgomp1 libopenblas-dev \
      ffmpeg imagemagick ghostscript poppler-utils tesseract-ocr pandoc \
      chromium chromium-driver fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcups2 libdrm2 libgbm1 libnspr4 libnss3 libxcomposite1 libxdamage1 libxfixes3 libxkbcommon0 libxrandr2 \
      watchman inotify-tools ripgrep fd-find tree htop file zip rsync wget lsof dnsutils netcat-openbsd iputils-ping nano \
 && rm -rf /var/lib/apt/lists/*

# ttyd 1.7.7, the web terminal, checked against the release's published sums
RUN case "$(uname -m)" in \
      x86_64) sum=8a217c968aba172e0dbf3f34447218dc015bc4d5e59bf51db2f2cd12b7be4f55 ;; \
      aarch64) sum=b38acadd89d1d396a0f5649aa52c539edbad07f4bc7348b27b4f4b7219dd4165 ;; \
      *) echo "no ttyd for $(uname -m)" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /usr/local/bin/ttyd "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.$(uname -m)" \
 && echo "$sum  /usr/local/bin/ttyd" | sha256sum -c - && chmod 755 /usr/local/bin/ttyd

# These pins are bumped by editing them here and redeploying.
# mise, for the toolchains a repo pins (.tool-versions, .mise.toml); its installs land in $HOME, on the volume
RUN case "$(uname -m)" in \
      x86_64) arch=x64; sum=fe6dd17e68e09682b31d2e7bb7bb755d22636ac1af5d94621e300f2ca9e9fe8a ;; \
      aarch64) arch=arm64; sum=e90904144ba4377c5fbe385f429830282c68f3b4f9c690bf6c5a2ae9b74a809b ;; \
      *) echo "no mise for $(uname -m)" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /usr/local/bin/mise "https://github.com/jdx/mise/releases/download/v2026.10.17/mise-v2026.10.17-linux-$arch" \
 && echo "$sum  /usr/local/bin/mise" | sha256sum -c - && chmod 755 /usr/local/bin/mise

# Claude Code, pinned, and updated by changing this and redeploying (its own updater can't write to /usr/local)
ARG CLAUDE_CODE_VERSION=2.1.307
RUN npm install -g @anthropic-ai/claude-code@$CLAUDE_CODE_VERSION && npm cache clean --force

# claude-swap, pinned: with it devteam rotates this box's Claude accounts on its own. uv brings the
# Python 3.12 it needs (Debian's is older); its logins land in $HOME, on the volume.
ARG CLAUDE_SWAP_VERSION=1.0.0
RUN case "$(uname -m)" in \
      x86_64) sum=c5221ff41b7892bfc223543883600125f6a47fe845093e0f5bdff4f359196d83 ;; \
      aarch64) sum=71279f8d3c67241e807b9d8db872d1bf541579fb9f08b7d1eb1682196d1e57dc ;; \
      *) echo "no uv for $(uname -m)" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /tmp/uv.tgz "https://github.com/astral-sh/uv/releases/download/0.13.7/uv-$(uname -m)-unknown-linux-gnu.tar.gz" \
 && echo "$sum  /tmp/uv.tgz" | sha256sum -c - && tar -xzf /tmp/uv.tgz -C /usr/local/bin --strip-components=1 && rm /tmp/uv.tgz \
 && UV_PYTHON_INSTALL_DIR=/opt/uv/python UV_TOOL_DIR=/opt/uv/tools UV_TOOL_BIN_DIR=/usr/local/bin uv tool install --python 3.12 "claude-swap==$CLAUDE_SWAP_VERSION" \
 && chmod -R a+rX /opt/uv

# Two users. dev is the owner at the terminal, and every agent: home on the volume. gw runs only
# the gateway and alone can read its passkeys and sessions, so no agent can add itself a way in.
RUN usermod -l dev -d /data/home node && groupmod -n dev node \
 && groupadd --system --gid 990 gw && useradd --system --uid 990 --gid 990 --home-dir /data/gateway --shell /usr/sbin/nologin gw

# What the gateway serves, root's and read-only: an agent can change a checkout or take a port, not these.
# Its folder made first, and its modes set after: a builder may give a folder COPY creates the
# file's own mode (Render's did, so the gateway's user couldn't reach its own file).
RUN install -d -m 755 /opt/devteam
COPY --chmod=644 cloud/gateway.mjs /opt/devteam/gateway.mjs
COPY --chmod=644 docs/devteam/dashboard/hub.html /opt/devteam/hub.html
# The kit, whole (it reads its schema beside it), as of the last release that changed this image:
# box-deploy.yml deploys only then, so a repo's kit can be newer than this one, or older. The box's
# own commands (box-status, box-tell, box-alert, box-recover) run it against every repo, and need it
# to be neither: what a repo says about itself comes from that repo's own kit (its help, hello,
# questions, settings, recover), and this one only reads tmux and the plain files a kit leaves. A
# repo on a kit older than recover comes back the way the box always brought it back.
COPY docs/devteam /opt/devteam/kit
RUN ttyd -d 0 -i lo -p 17681 true & p=$!; sleep 1; curl -fsS --compressed -o /opt/devteam/ttyd.html http://127.0.0.1:17681/; r=$?; kill $p; [ $r = 0 ] && grep -q xterm /opt/devteam/ttyd.html \
 && rm -rf /opt/devteam/kit/project /opt/devteam/kit/run \
 && chown -R root:root /opt/devteam && chmod -R u=rwX,go=rX /opt/devteam

# Under tini, as root only to set up /data, then the gateway, and only once it holds the public
# port, dev's side: dev's shells read files any agent can write, and nothing of dev's may get the
# port first. If the gateway stops, the box restarts. A stop (a deploy) closes the tmux server
# first, so agents get a hangup, not a kill.
COPY --chmod=755 <<'EOF' /usr/local/bin/devteam-box
#!/bin/sh
# Every step says so, on both streams, so a boot that fails names where. A failed boot then waits
# (DEVTEAM_BOX_HOLD_SECONDS) so the platform can still show its log and open a shell.
say() { echo "box: $*"; echo "box(stderr): $*" >&2; }
step=start
say "boot: $(date -u +%FT%TZ) pid=$$"
report() {
  rc=$?
  [ "$rc" != 0 ] || exit 0
  say "BOOT FAILED at step '$step' (exit $rc); holding ${DEVTEAM_BOX_HOLD_SECONDS:-900}s so a shell can look"
  diagnose
  sleep "${DEVTEAM_BOX_HOLD_SECONDS:-900}"
  exit "$rc"
}
diagnose() {
  say "id: $(id 2>&1)"
  say "kernel: $(uname -srm 2>&1)"
  say "limits: $(grep -E '^(CapEff|CapBnd|NoNewPrivs|Seccomp):' /proc/self/status 2>&1 | tr -s '\t\n' ' ')"
  say "data: $(ls -ld /data /data/home /data/gateway /data/uploads 2>&1 | tr '\n' ';')"
  say "mount: $(grep ' /data ' /proc/mounts 2>&1)"
  say "space: $(df -h /data 2>&1 | tail -1)"
  say "port: ${PORT:-unset}; public url: ${DEVTEAM_PUBLIC_URL:-unset}; node: $(/usr/local/bin/node --version 2>&1)"
  say "env names: $(awk 'BEGIN{for(k in ENVIRON)print k}' | sort | tr '\n' ' ')"   # a value can run over lines, and env would print them
  say "gateway files: $(ls -ld /opt/devteam /opt/devteam/* 2>&1 | tr '\n' ';')"
}
# Whether a process lives, without signalling it: a platform may give root no CAP_KILL (Render
# doesn't), and then kill -0 on another user's process fails though it runs.
alive() { [ -r "/proc/$1/status" ] && ! grep -q '^State:[[:space:]]*Z' "/proc/$1/status"; }
# Says what a step's check printed, and fails the step if the check did.
check() { what=$1; shift; rc=0; out=$("$@" 2>&1) || rc=$?; say "$what: $out"; return "$rc"; }
trap report EXIT
set -eu
diagnose
step='make /data'
mkdir -p /data/home /data/gateway
[ "$(stat -c %U /data/home)" = dev ] || chown dev:dev /data/home
chown -R gw:gw /data/gateway
chmod 700 /data/gateway
# Files the owner drops on the terminal: the gateway writes them, dev (the owner's shells and every
# agent) can only read. setgid, so what gw makes in here is dev's group without gw being in it.
[ ! -L /data/uploads ] || rm -f /data/uploads
mkdir -p /data/uploads
chown gw:dev /data/uploads
chmod 2750 /data/uploads
as_gw() { setpriv --reuid=gw --regid=gw --init-groups env HOME=/data/gateway DEVTEAM_GATEWAY_DIR=/data/gateway "$@"; }
# mise's shims first for dev alone: root and gw must never search a folder an agent can write to
as_dev() { setpriv --reuid=dev --regid=dev --init-groups env -u DEVTEAM_CLAIM_TOKEN HOME=/data/home PATH="/data/home/.local/share/mise/shims:$PATH" "$@"; }
step='drop to gw'
check 'as gw' as_gw id
step='drop to dev'
check 'as dev' as_dev id
step='start the gateway'
say "starting the gateway on ${PORT:-8080}"
# not through as_gw: a function sent to the background is a subshell, and $! would be root's
setpriv --reuid=gw --regid=gw --init-groups env HOME=/data/gateway DEVTEAM_GATEWAY_DIR=/data/gateway /usr/local/bin/node /opt/devteam/gateway.mjs serve &
gw=$!
step='wait for the gateway'
until curl -fsS -o /dev/null "http://127.0.0.1:${PORT:-8080}/healthz" 2>/dev/null; do
  if ! alive "$gw"; then
    rc=0; wait "$gw" || rc=$?
    say "the gateway exited with $rc before answering"
    exit 1
  fi
  sleep 0.2
done
say "gateway answers; starting dev's side"
# The boot is over, and so is the hold: agents would outlive the gateway, and one could take the port.
trap - EXIT
install -d -o dev -g dev -m 2775 /var/run/postgresql
as_dev /usr/local/bin/devteam-dev >/dev/null 2>&1 &   # not the platform's log: no agent can write a fake claim link there
# each user stops its own (root may not signal theirs)
trap 'say "stopping"; as_dev tmux kill-server 2>/dev/null || true; sleep 2; as_gw kill -TERM "$gw" 2>/dev/null || true; exit 0' TERM INT
say "up"
rc=0; wait "$gw" || rc=$?
say "the gateway exited with $rc; the box stops"
exit "$rc"
EOF

# box-pg [major]: this box's `brew services start postgresql@N`. One server per major version, on
# the disk, trusting whoever is on the box: 17 on the default port (so postgres:/// just works),
# the others on 5400 + major (5416, 5414). Safe to run again.
COPY --chmod=644 docs/devteam/process/operator.md /opt/devteam/
# The operator's commands (operator.md): the image's kit, for every repo in ~/code and any other the
# machine has recorded. box-recover brings back what was up before a restart (the list devteam-dev
# keeps), each repo by its own kit's recover, in tmux session home as sup-<repo>.
COPY --chmod=755 <<'EOF' /usr/local/bin/box-recover
#!/bin/sh
exec /usr/local/bin/node /opt/devteam/kit/scripts/devteam.mjs recover --machine --in "$HOME/code" --session home --was-up "$HOME/.devteam-supervisors.boot" "$@"
EOF
COPY --chmod=755 <<'EOF' /usr/local/bin/box-status
#!/bin/sh
exec /usr/local/bin/node /opt/devteam/kit/scripts/devteam.mjs machine status --in "$HOME/code" --notes "$HOME/operator/NOTES.md" "$@"
EOF
# after --, the words are the message, whatever they start with
COPY --chmod=755 <<'EOF' /usr/local/bin/box-tell
#!/bin/sh
exec /usr/local/bin/node /opt/devteam/kit/scripts/devteam.mjs machine tell --in "$HOME/code" -- "$@"
EOF
COPY --chmod=755 <<'EOF' /usr/local/bin/box-alert
#!/bin/sh
exec /usr/local/bin/node /opt/devteam/kit/scripts/devteam.mjs machine alert -- "$@"
EOF
COPY --chmod=755 <<'EOF' /usr/local/bin/box-pg
#!/bin/sh
set -eu
v=${1:-17}
bin=/usr/lib/postgresql/$v/bin
[ -x "$bin/pg_ctl" ] || { echo "box-pg: no Postgres $v in this image (it has: $(ls /usr/lib/postgresql | tr '\n' ' '))" >&2; exit 2; }
d="$HOME/.pg/$v"
if [ "$v" = 17 ]; then port=5432; else port=$((5400 + v)); fi
if [ ! -f "$d/PG_VERSION" ]; then
  mkdir -p "$HOME/.pg"
  "$bin/initdb" -D "$d" -U dev -A trust -E UTF8 --locale=C.UTF-8 >/dev/null
  printf "port = %s\nlisten_addresses = '127.0.0.1'\nunix_socket_directories = '/var/run/postgresql'\nsynchronous_commit = off\n" "$port" >> "$d/postgresql.conf"
  new=1
fi
"$bin/pg_ctl" -D "$d" status >/dev/null 2>&1 || "$bin/pg_ctl" -D "$d" -l "$d/server.log" -w start >/dev/null
if [ "${new:-}" = 1 ]; then
  "$bin/createdb" -h /var/run/postgresql -p "$port" dev
  "$bin/createuser" -h /var/run/postgresql -p "$port" -s postgres
fi
echo "box-pg: Postgres $v on port $port"
EOF

# The checklists and habits that say asdf work here: mise reads the same .tool-versions.
COPY --chmod=755 <<'EOF' /usr/local/bin/asdf
#!/bin/sh
exec mise "$@"
EOF

COPY --chmod=755 <<'EOF' /usr/local/bin/devteam-reclaim
#!/bin/sh
exec setpriv --reuid=gw --regid=gw --init-groups env HOME=/data/gateway DEVTEAM_GATEWAY_DIR=/data/gateway /usr/local/bin/node /opt/devteam/gateway.mjs reclaim
EOF

# macOptionClickForcesSelection: tmux owns the mouse, so scrolling works, and on a Mac the terminal
# lets a selection past it only with Option held (Shift, elsewhere), and only with this set.
# dev's side: the shell's first-run notes, the tmux session the terminal opens, every repo's
# dashboard again after a restart (in that repo's own tmux session), the operator in window 0 (which brings back the supervisors),
# and ttyd on loopback. What it says goes to ~/box.log, on the volume: its output is kept off the
# platform's log (devteam-box says why).
COPY --chmod=755 <<'EOF' /usr/local/bin/devteam-dev
#!/bin/sh
cd "$HOME"
mkdir -p code
note() { echo "$(date -u +%FT%TZ) $*" >> "$HOME/box.log"; }
# Nothing runs git yet, so a lock in a repo is one a process killed by the restart left. Pane ids
# start again at %0, so one noted before this boot could be another program's by now.
find "$HOME/code" -path '*/.git/*' -name '*.lock' -type f -delete 2>/dev/null
# so is a Postgres pid file: its old pid is often held by another process by now, and it wouldn't start
rm -f "$HOME"/.pg/*/postmaster.pid
rm -f "$HOME"/code/*/docs/devteam/run/supervisor-pane
# tmux starts login shells, which read .profile, and Debian's reads .bashrc
[ -f .profile ] || cp /etc/skel/.profile .profile
[ -f .tmux.conf ] || printf 'set -g mouse on\nset -g history-limit 50000\nset -g default-terminal tmux-256color\nset -g default-shell /bin/bash\n' > .tmux.conf
# copying in tmux, or in a program in it, reaches the browser's clipboard (the gateway's terminal page takes OSC 52)
grep -q set-clipboard .tmux.conf || printf "set -g set-clipboard on\nset -as terminal-features ',xterm-256color:clipboard'\n" >> .tmux.conf
# Claude Code asks for it in every pane: without it, it can't tell when its pane gains or loses focus
grep -q focus-events .tmux.conf || echo 'set -g focus-events on' >> .tmux.conf
if [ ! -f .bashrc ]; then
  cp /etc/skel/.bashrc .bashrc
  cat >> .bashrc <<'RC'
eval "$(mise activate bash)"
[ -f ~/.devteam-quiet ] || cat <<'MOTD'
devteam box. Window 0 (operator) looks after the box: tell it what you want. First time here:
  in window 0, log in to Claude Code
  claude plugin marketplace add obra/superpowers-marketplace && claude plugin install superpowers@superpowers-marketplace
  gh auth login && gh auth setup-git       # GitHub, and git over HTTPS with it
  git config --global user.name '…' && git config --global user.email '…'
Add a repo:  cd ~/code && gh repo clone <owner/repo> && cd <repo> && claude "Use github.com/sanctuarycomputer/devteam to set up a fleet in this repo"
Tools: languages per project with mise (mise install; asdf works too). box-pg 16 starts another Postgres. ~/.box/boot.sh is what starts at boot.
Expo: npx expo start --tunnel for your phone; eas build for builds.
Heroku: heroku login -i, with a token from heroku authorizations:create --expires-in <seconds> --scope <scopes> on your laptop as the password. It lands in ~/.netrc, readable by every agent here, so keep it narrow and short. (The browser login is refused from another IP.)
tmux: C-b s lists every session (each repo's supervisor and its workers); C-b d leaves one. touch ~/.devteam-quiet hides this.
MOTD
RC
fi
# What was up before this boot, for the operator's box-recover. Only a list with something in it:
# a boot that never got as far as bringing them back must not lose them to the next.
up="$HOME/.devteam-supervisors"
# An older image's ages, kept beside the list: they are the list's own lines now, for the roots
# still on it. That file was rewritten at every boot and never pruned, so it also names
# supervisors stopped since: those stay stopped.
if [ -f "$up.boot.at" ]; then [ -f "$up.boot" ] && awk 'NR == FNR { r = $0; sub(/^[0-9]+ /, "", r); b[r]; next } { r = $0; sub(/^[0-9]+ /, "", r) } (r in b)' "$up.boot" "$up.boot.at" > "$up.boot.was"; [ -s "$up.boot.was" ] && cat "$up.boot.was" >> "$up.boot"; rm -f "$up.boot.at" "$up.boot.was"; fi
# Added to what is there, each with when it was listed: a supervisor the last restore could not
# start stays listed, and one up just before this boot is new again. An entry no restore has used
# for 3 days is out of date (whoever it held has been stopped or restarted since): the kit's
# recover --machine leaves it out, and drops it from the list.
if [ -s "$up" ]; then now=$(date +%s); sed "s/^/$now /" "$up" >> "$up.boot"; fi
rm -f "$up"
# Window 0 is the operator (operator.md): the first thing the Terminal shows, and what restores the fleet.
mkdir -p operator
if ! tmux has-session -t home 2>/dev/null; then
  tmux new-session -d -s home -n operator -c "$HOME/operator"
  tmux new-window -d -t home -n shell -c "$HOME"
  ask='You are the sanctuarycomputer/devteam operator for this box. Ensure your supervisors are all up and running.'
  if ls .claude/projects/-data-home-operator/*.jsonl >/dev/null 2>&1; then c='--continue'; ask="The box restarted. $ask"; else c=''; fi
  # its job is in its system prompt, so what it's told, and what the owner tells it, stays plain English
  tmux send-keys -t home:operator -l "export DEVTEAM_ROLE=operator; claude $c --dangerously-skip-permissions --append-system-prompt \"\$(cat /opt/devteam/operator.md)\" '$ask'"
  tmux send-keys -t home:operator Enter
fi
# The operator's tick: typed into its window every 30 minutes. Never over someone's half-typed line, a
# dialog (Enter would answer it), a usage limit, or into whatever else has the pane (a shell, vim, psql:
# the kit's machine pane-state says which). Held back, it tries again each minute for 10 minutes, then
# waits for the next one, and after three in a row it raises an alert (one, however long it lasts), so a held
# operator can't go quiet.
# Claude Code queues what's typed during a turn, so a busy operator just gets it after.
tick='Check on the box and your supervisors.'
( held=0; raised=
  while :; do
    sleep "${DEVTEAM_OPERATOR_TICK_SECONDS:-1800}"
    n=0; s=
    while [ "$n" -lt "${DEVTEAM_OPERATOR_TICK_RETRIES:-10}" ]; do
      p=$(tmux display-message -p -t home:operator '#{pane_id}' 2>/dev/null) && s=$(/usr/local/bin/node /opt/devteam/kit/scripts/devteam.mjs machine pane-state "$p" 2>/dev/null) || s=gone
      case $s in ready|busy) tmux send-keys -t "$p" -l "$tick"; tmux send-keys -t "$p" Enter; s=; break ;; esac
      n=$((n + 1))
      sleep "${DEVTEAM_OPERATOR_TICK_RETRY_SECONDS:-60}"
    done
    if [ -z "$s" ]; then
      # only what this loop raised: the operator's own alert is the operator's to clear
      if [ -n "$raised" ] && [ "$(cat "$HOME/.box/alert" 2>/dev/null)" = "$raised" ]; then box-alert --clear >/dev/null; fi
      held=0; raised=
    else
      held=$((held + 1))
      note "the operator's check-in was held back: its pane is at $s ($held in a row)"
      if [ "$held" -ge "${DEVTEAM_OPERATOR_TICK_ALERT_AFTER:-3}" ]; then
        raised="The operator's check-ins are being held back: its pane is at $s. Look at window 0 of the terminal."
        box-alert "$raised" >/dev/null
      fi
    fi
  done ) &
# The box's global tools, on the disk: edit the file to change them, and they come back each boot.
mkdir -p .box .config/mise
[ -f .config/mise/config.toml ] || cat > .config/mise/config.toml <<'TOML'
# .ruby-version, .python-version and .nvmrc pin a repo's versions as they do with asdf or rbenv; mise
# ignores them unless told, and then a repo gets no Ruby at all and box-status still says tools=ok
[settings]
idiomatic_version_file_enable_tools = ["ruby", "python", "node"]

[tools]
node = "22"
python = "3.12"
uv = "latest"
pnpm = "latest"
gitleaks = "latest"
shellcheck = "latest"
sops = "latest"
age = "latest"
"npm:eas-cli" = "latest"
# the CLIs production sensors read through (CLI_LOGIN in devteam.mjs), besides heroku below
sentry-cli = "latest"
vercel = { version = "latest", allow_builds = ["esbuild"], trust_policy_excludes = ["undici"] }

# Heroku's standalone CLI brings its own Node (the npm one runs on a repo's pinned Node, and refuses
# one older than 20). Only heroku is exposed: bin/ also holds that node, which must not stand in for a repo's.
[tools."http:heroku"]
version = "11.12.1"
bin_path = "exposed"
strip_components = 1
postinstall = "mkdir -p \"$MISE_TOOL_INSTALL_PATH/exposed\" && ln -sf ../bin/heroku \"$MISE_TOOL_INSTALL_PATH/exposed/heroku\""

[tools."http:heroku".platforms]
linux-x64 = { url = "https://cli-assets.heroku.com/versions/11.12.1/41f59c1/heroku-v11.12.1-41f59c1-linux-x64.tar.gz", checksum = "sha256:84bde36a3fa91df7832e2af5308591571d9d2a2efd80d6c7031aaf36bd2b4af7" }
linux-arm64 = { url = "https://cli-assets.heroku.com/versions/11.12.1/41f59c1/heroku-v11.12.1-41f59c1-linux-arm64.tar.gz", checksum = "sha256:ea38ad6e5bbe90380cf9b8e3ad8f6cf6bc23b913008814432902e9d26ce8786e" }
TOML
( mise install ) >> .box/mise.log 2>&1 &
# What this box starts at boot, before any supervisor comes back: its `brew services`, on the disk.
[ -f .box/boot.sh ] || cat > .box/boot.sh <<'BOOT'
#!/bin/sh
# Runs at every boot, as dev, before the supervisors resume. Add what your projects need running.
box-pg 17                  # the default Postgres, port 5432
# box-pg 16                # port 5416
# box-pg 14                # port 5414
# redis-server --daemonize yes --bind 127.0.0.1 --dir "$HOME/.box"
BOOT
timeout 120 sh .box/boot.sh >> box.log 2>&1 || note "boot.sh failed (exit $?): see box.log"
for k in "$HOME"/code/*/docs/devteam/scripts/devteam.mjs; do
  [ -f "$k" ] || continue
  r=${k%/docs/devteam/scripts/devteam.mjs}
  # adopted repos only, as the kit counts them: a checkout of devteam itself has the kit but
  # no settings, and its dashboard would only fail every 5s in a window of its own
  [ -f "$r/docs/devteam/project/settings.md" ] || continue
  # In the project's own tmux session, as the window named dashboard: where the kit keeps it
  # (supervisor.md, the dashboard), so a supervisor that resumes finds it there and starts no
  # second one on another port. A kit too old to name its session keeps it in home.
  c="while :; do /usr/local/bin/node docs/devteam/scripts/devteam.mjs dashboard; sleep 5; done"
  s=$(cd "$r" && /usr/local/bin/node docs/devteam/scripts/devteam.mjs settings --get tmux_session 2>/dev/null) || s=
  if [ -z "$s" ] || [ "$s" = null ]; then
    tmux new-window -d -t home -n "dash-$(basename "$r")" -c "$r" "$c"
  elif tmux has-session -t "=$s" 2>/dev/null; then
    tmux new-window -d -t "=$s" -n dashboard -c "$r" "$c"
  else
    tmux new-session -d -s "$s" -n dashboard -c "$r" "$c"
  fi
done
# The operator (window 0) is what brings the supervisors back: box-recover reads the list saved above.
# Which supervisors are up, kept on the volume each minute: a machine that dies writes nothing at
# the end, and one the owner stopped (its pane gone, or back at a shell) is off the list by then.
# tmux not answering (the box stopping) leaves the list as it was.
while :; do
  sleep 60
  panes=$(tmux list-panes -a -F '#{pane_id} #{pane_current_command}' 2>/dev/null) || continue
  for k in "$HOME"/code/*/docs/devteam/scripts/devteam.mjs; do
    r=${k%/docs/devteam/scripts/devteam.mjs}
    p=$(cat "$r/docs/devteam/run/supervisor-pane" 2>/dev/null) || continue
    case "$(printf '%s\n' "$panes" | awk -v p="$p" '$1 == p { print $2 }')" in
      ''|bash|-bash|sh|dash|zsh|fish) ;;
      *) echo "$r" ;;
    esac
  done > "$up.new" && mv "$up.new" "$up"
  # A supervisor back up is settled: it comes off the restore list, so stopping it later keeps it stopped.
  [ -s "$up" ] && [ -f "$up.boot" ] && {
    awk 'NR == FNR { u[$0]; next } { r = $0; sub(/^[0-9]+ /, "", r) } !(r in u)' "$up" "$up.boot" > "$up.left" 2>/dev/null
    if [ -s "$up.left" ]; then mv "$up.left" "$up.boot"; else rm -f "$up.boot" "$up.left"; fi
  }
done &
while :; do ttyd -d 3 -i lo -p 7681 -W -t macOptionClickForcesSelection=true -t fontSize=14 -t titleFixed=devteam tmux new-session -A -s home; sleep 1; done
EOF

VOLUME /data
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/devteam-box"]
