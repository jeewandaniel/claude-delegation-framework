#!/bin/sh
# Resolve a node binary and exec the given hook script with it.
#
# GUI-launched apps (e.g. the Claude desktop app) often start with a minimal
# PATH that omits node even though a shell PATH would find it, so this tries
# a few common install locations before giving up. A hook must never block a
# session: if no node can be found, exit 0 silently rather than error.
#
# Only shell builtins are used to locate node (no dirname/ls/sort/tail), so
# this keeps working even when PATH is empty or missing those external tools.
#
# Usage: run-node.sh <script.js> [args...]
# <script.js> is resolved relative to this file's own directory.
#
# The two OS-global install paths are overridable via env vars so tests can
# point them at a location that is guaranteed not to exist, without touching
# the real system paths; unset (the normal case) uses the real locations.

: "${RUN_NODE_HOMEBREW_PATH:=/opt/homebrew/bin/node}"
: "${RUN_NODE_USRLOCAL_PATH:=/usr/local/bin/node}"

NODE_BIN=""

if command -v node >/dev/null 2>&1; then
  NODE_BIN=$(command -v node)
fi

if [ -z "$NODE_BIN" ]; then
  for candidate in "$RUN_NODE_HOMEBREW_PATH" "$RUN_NODE_USRLOCAL_PATH" "$HOME/.volta/bin/node"; do
    if [ -x "$candidate" ]; then
      NODE_BIN="$candidate"
      break
    fi
  done
fi

if [ -z "$NODE_BIN" ]; then
  # Newest-looking nvm-installed node. Plain alphabetical pick (no `sort -V`
  # dependency) is good enough for the common case; best-effort only.
  for candidate in "$HOME"/.nvm/versions/node/*/bin/node; do
    if [ -x "$candidate" ]; then
      NODE_BIN="$candidate"
    fi
  done
fi

if [ -z "$NODE_BIN" ]; then
  for candidate in "$HOME"/.fnm/node-versions/*/installation/bin/node \
                   "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node; do
    if [ -x "$candidate" ]; then
      NODE_BIN="$candidate"
      break
    fi
  done
fi

if [ -z "$NODE_BIN" ]; then
  exit 0
fi

# Resolve this script's own directory without calling out to `dirname`.
SCRIPT_PATH="$0"
case "$SCRIPT_PATH" in
  */*) SCRIPT_DIR="${SCRIPT_PATH%/*}" ;;
  *) SCRIPT_DIR="." ;;
esac

SCRIPT="$1"
shift

exec "$NODE_BIN" "$SCRIPT_DIR/$SCRIPT" "$@"
