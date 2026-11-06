# syntax=docker/dockerfile:1.7
# devteam in the cloud: one container that is the owner's dev box. Its only public listener is the
# gateway (gateway.mjs), which lets in a passkey registered when the box is claimed and passes the
# owner to the machine's devteam hub, a terminal on the box's tmux server (where supervisors and
# workers run), and each repo's dashboard on a subdomain of its own. What lasts lives on /data.
#
# It needs a name and a wildcard under it, e.g. box.example.com and *.box.example.com: each
# dashboard keeps an origin of its own (4321.box.example.com), as on a laptop, and signing in is on
# auth.box.example.com, which serves nothing else.
#
# Render: New > Web Service > this repo (or a fork), Language: Docker, Dockerfile path:
#   cloud/Dockerfile, build context: the repo root. Instance: Pro (4 GB) or larger; a free one
#   sleeps, and sleeping stops every agent. Auto-Deploy: Off (a deploy restarts the box, which
#   stops every agent; deploy when the fleet is parked). Disk: mounted at /data. Health check
#   path: /healthz. Environment: DEVTEAM_PUBLIC_URL=https://box.example.com. Custom domains:
#   box.example.com and *.box.example.com, with every DNS record Render lists for them (a wildcard
#   needs its own name pointed at Render too, plus the _acme-challenge and _cf-custom-hostname
#   CNAMEs; remove any AAAA records). If Render won't take a wildcard under a subdomain, give the
#   box a domain of its own (example.com and *.example.com). The *.onrender.com address is refused:
#   the box answers only on its own names. Then deploy: the log prints the claim link,
#   https://auth.box.example.com/auth/claim#<token>.
# fly.io: fly launch --no-deploy --dockerfile cloud/Dockerfile --internal-port 8080; in fly.toml
#   set auto_stop_machines = "off", min_machines_running = 1, [env] DEVTEAM_PUBLIC_URL, and
#   [mounts] source = "data", destination = "/data"; fly volumes create data; fly certs add for
#   both names; fly deploy.
# Lost every passkey: in a shell on the box as root (Render's Shell tab, fly ssh console), run
#   devteam-reclaim, which prints a new claim link (as another user, setpriv fails: use root).
FROM node:22-bookworm-slim

ENV LANG=C.UTF-8 SHELL=/bin/bash DISABLE_AUTOUPDATER=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends git tmux tini curl ca-certificates gnupg openssh-client procps less vim-tiny jq unzip build-essential python3 \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

# ttyd 1.7.7, the web terminal, checked against the release's published sums
RUN case "$(uname -m)" in \
      x86_64) sum=8a217c968aba172e0dbf3f34447218dc015bc4d5e59bf51db2f2cd12b7be4f55 ;; \
      aarch64) sum=b38acadd89d1d396a0f5649aa52c539edbad07f4bc7348b27b4f4b7219dd4165 ;; \
      *) echo "no ttyd for $(uname -m)" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /usr/local/bin/ttyd "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.$(uname -m)" \
 && echo "$sum  /usr/local/bin/ttyd" | sha256sum -c - && chmod 755 /usr/local/bin/ttyd

# Both pins below are bumped by editing them here and redeploying.
# mise, for the toolchains a repo pins (.tool-versions, .mise.toml); its installs land in $HOME, on the volume
ARG MISE_VERSION=v2026.10.17
RUN curl -fsSL https://mise.run | MISE_VERSION=$MISE_VERSION MISE_INSTALL_PATH=/usr/local/bin/mise sh

# Claude Code, pinned, and updated by changing this and redeploying (its own updater can't write to /usr/local)
ARG CLAUDE_CODE_VERSION=2.1.307
RUN npm install -g @anthropic-ai/claude-code@$CLAUDE_CODE_VERSION && npm cache clean --force

# Two users. dev is the owner at the terminal, and every agent: home on the volume. gw runs only
# the gateway and alone can read its passkeys and sessions, so no agent can add itself a way in.
RUN usermod -l dev -d /data/home node && groupmod -n dev node \
 && groupadd --system --gid 990 gw && useradd --system --uid 990 --gid 990 --home-dir /data/gateway --shell /usr/sbin/nologin gw

COPY --chmod=644 cloud/gateway.mjs /opt/devteam/gateway.mjs

# Under tini, as root only to set up /data, then the gateway, and only once it holds the public
# port, dev's side: dev's shells read files any agent can write, and nothing of dev's may get the
# port first. If the gateway stops, the box restarts. A stop (a deploy) closes the tmux server
# first, so agents get a hangup, not a kill.
COPY --chmod=755 <<'EOF' /usr/local/bin/devteam-box
#!/bin/sh
set -eu
mkdir -p /data/home /data/gateway
[ "$(stat -c %U /data/home)" = dev ] || chown dev:dev /data/home
chown -R gw:gw /data/gateway
chmod 700 /data/gateway
as_dev() { setpriv --reuid=dev --regid=dev --init-groups env -u DEVTEAM_CLAIM_TOKEN HOME=/data/home "$@"; }
setpriv --reuid=gw --regid=gw --init-groups env HOME=/data/gateway DEVTEAM_GATEWAY_DIR=/data/gateway /usr/local/bin/node /opt/devteam/gateway.mjs serve &
gw=$!
until curl -fsS -o /dev/null "http://127.0.0.1:${PORT:-8080}/healthz" 2>/dev/null; do
  kill -0 "$gw" 2>/dev/null || exit 1
  sleep 0.2
done
as_dev /usr/local/bin/devteam-dev &
trap 'as_dev tmux kill-server 2>/dev/null; sleep 2; kill -TERM "$gw" 2>/dev/null; exit 0' TERM INT
wait "$gw"
EOF

COPY --chmod=755 <<'EOF' /usr/local/bin/devteam-reclaim
#!/bin/sh
exec setpriv --reuid=gw --regid=gw --init-groups env HOME=/data/gateway DEVTEAM_GATEWAY_DIR=/data/gateway /usr/local/bin/node /opt/devteam/gateway.mjs reclaim
EOF

# dev's side: the shell's first-run notes, the tmux session the terminal opens, every repo's
# dashboard again after a restart (each supervisor resumes its own fleet), and ttyd on loopback.
COPY --chmod=755 <<'EOF' /usr/local/bin/devteam-dev
#!/bin/sh
cd "$HOME"
mkdir -p code
# tmux starts login shells, which read .profile, and Debian's reads .bashrc
[ -f .profile ] || cp /etc/skel/.profile .profile
[ -f .tmux.conf ] || printf 'set -g mouse on\nset -g history-limit 50000\nset -g default-terminal tmux-256color\nset -g default-shell /bin/bash\n' > .tmux.conf
if [ ! -f .bashrc ]; then
  cp /etc/skel/.bashrc .bashrc
  cat >> .bashrc <<'RC'
eval "$(mise activate bash)"
[ -f ~/.devteam-quiet ] || cat <<'MOTD'
devteam box. First time here:
  claude                                   # log in to Claude Code
  claude plugin marketplace add obra/superpowers-marketplace && claude plugin install superpowers@superpowers-marketplace
  gh auth login && gh auth setup-git       # GitHub, and git over HTTPS with it
  git config --global user.name '…' && git config --global user.email '…'
Add a repo:  cd ~/code && gh repo clone <owner/repo> && cd <repo> && claude "Use github.com/sanctuarycomputer/devteam to set up a fleet in this repo"
tmux: C-b s lists every session (each repo's supervisor and its workers); C-b d leaves one. touch ~/.devteam-quiet hides this.
MOTD
RC
fi
tmux has-session -t home 2>/dev/null || tmux new-session -d -s home -n shell -c "$HOME"
for k in "$HOME"/code/*/docs/devteam/scripts/devteam.mjs; do
  [ -f "$k" ] || continue
  r=${k%/docs/devteam/scripts/devteam.mjs}
  tmux new-window -d -t home -n "dash-$(basename "$r")" -c "$r" "while :; do /usr/local/bin/node docs/devteam/scripts/devteam.mjs dashboard; sleep 5; done"
done
while :; do ttyd -d 3 -i lo -p 7681 -b /term -W -t fontSize=14 -t titleFixed=devteam tmux new-session -A -s home; sleep 1; done
EOF

VOLUME /data
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/devteam-box"]
