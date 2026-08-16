#!/bin/sh
# Fix ownership of app-owned volumes, then drop to node user.
# Do not chown the projects bind mount: on Docker Desktop a recursive ownership
# pass over a host projects directory can make startup appear hung.
if [ "$(id -u)" = "0" ]; then
  install -d -o node -g node /data /home/node/.claude /home/node/.codex 2>/dev/null || true
  chown -R node:node /data /home/node/.claude /home/node/.codex /home/node/.npm 2>/dev/null || true
  if [ -e /home/node/.claude.json ]; then
    chown node:node /home/node/.claude.json 2>/dev/null || true
  fi
  # Project bind mounts (e.g. /home/www/chrona) may be owned by a host uid
  # that doesn't match the node user, which makes git refuse to operate
  # ("dubious ownership"). Mark it trusted on every start since this is not
  # persisted anywhere else across container recreation.
  gosu node git config --global --add safe.directory /home/www/chrona 2>/dev/null || true
  # git/gh credentials are not persisted in any volume (unlike claude-auth/codex-auth),
  # so a manual `gh auth login` inside a running container is lost on recreation.
  # Wire the credential helper from GH_TOKEN/GITHUB_TOKEN (set in .env) on every
  # start instead, so `git push` and `gh` keep working across rebuilds/restarts.
  if [ -n "$GH_TOKEN$GITHUB_TOKEN" ]; then
    gosu node gh auth setup-git 2>/dev/null || true
  fi
  export HOME=/home/node
  exec gosu node "$@"
else
  exec "$@"
fi
