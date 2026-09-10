#!/usr/bin/env bash
# Install the delegation framework into a Claude Code config directory (default ~/.claude).
# Idempotent: safe to re-run after every change to this repo.
#
#   ./install.sh                             delegation-only (the default)
#   ./install.sh --with-context-hygiene      also install the context-hygiene module
#   ./install.sh --without-context-hygiene   remove the context-hygiene module
#
# FRAMEWORK_CONTEXT_HYGIENE=1 is the same as --with-context-hygiene. With no flag and no env
# var, a re-install keeps whichever mode is already installed (marker: framework/context-hygiene.on).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${FRAMEWORK_HOME:-$HOME/.claude}"
MODULE="$REPO/modules/context-hygiene"
MARKER="$DEST/framework/context-hygiene.on"
MODULE_HOOKS="ctx-meter.js ctx-guard.js read-warn.js handoff-load.js"

CTX_MODE=""
for arg in "$@"; do
  case "$arg" in
    --with-context-hygiene) CTX_MODE=on ;;
    --without-context-hygiene) CTX_MODE=off ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done
if [ -z "$CTX_MODE" ]; then
  if [ "${FRAMEWORK_CONTEXT_HYGIENE:-0}" = "1" ]; then
    CTX_MODE=on
  elif [ -f "$MARKER" ]; then
    CTX_MODE=on   # keep the installed mode on a plain re-run
  else
    CTX_MODE=off
  fi
fi

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "node not found on PATH; install Node 20+ first" >&2
  exit 1
fi

mkdir -p "$DEST/hooks/lib" "$DEST/agents" "$DEST/skills/handoff" "$DEST/framework/ledger"

cp "$REPO/hooks/ledger.js" "$DEST/hooks/"
cp "$REPO"/hooks/lib/*.js "$DEST/hooks/lib/"
cp "$REPO"/agents/*.md "$DEST/agents/"

if [ "$CTX_MODE" = on ]; then
  cp "$MODULE"/hooks/*.js "$DEST/hooks/"
  cp "$MODULE/handoff-SKILL.md" "$DEST/skills/handoff/SKILL.md"
else
  for h in $MODULE_HOOKS; do rm -f "$DEST/hooks/$h"; done
  cp "$REPO/skills/handoff/SKILL.md" "$DEST/skills/handoff/SKILL.md"
fi
chmod +x "$DEST"/hooks/*.js

if [ ! -f "$DEST/framework.json" ]; then
  cp "$REPO/settings/framework.defaults.json" "$DEST/framework.json"
fi
if [ "$CTX_MODE" = on ]; then
  "$NODE" "$REPO/bin/merge-defaults.js" "$DEST/framework.json" "$MODULE/framework.defaults.json"
fi

SETTINGS="$DEST/settings.json"
if [ ! -f "$SETTINGS" ]; then
  echo '{}' > "$SETTINGS"
fi
if ! "$NODE" -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$SETTINGS" 2>/dev/null; then
  echo "$SETTINGS is not valid JSON; refusing to touch it" >&2
  exit 1
fi
BAK="$SETTINGS.bak-$(date +%Y%m%d-%H%M%S)-$$"
cp "$SETTINGS" "$BAK"
"$NODE" "$REPO/bin/merge-settings.js" "$SETTINGS" "$REPO/settings/settings.patch.json" "$DEST/hooks" "$NODE"
if [ "$CTX_MODE" = on ]; then
  "$NODE" "$REPO/bin/merge-settings.js" "$SETTINGS" "$MODULE/settings.patch.json" "$DEST/hooks" "$NODE"
else
  "$NODE" "$REPO/bin/merge-settings.js" --remove "$SETTINGS" "$MODULE/settings.patch.json" "$DEST/hooks" "$NODE"
fi

CLAUDE_MD="$DEST/CLAUDE.md"
if [ "$CTX_MODE" = on ]; then
  "$NODE" "$REPO/bin/install-claude-md.js" "$CLAUDE_MD" "$REPO/claude-md/framework-block.md" "$MODULE/context-rules.md"
  touch "$MARKER"
else
  "$NODE" "$REPO/bin/install-claude-md.js" "$CLAUDE_MD" "$REPO/claude-md/framework-block.md"
  rm -f "$MARKER"
fi

echo "Installed delegation framework into $DEST"
if [ "$CTX_MODE" = on ]; then
  echo "Context hygiene module: ON (hooks: $MODULE_HOOKS). Turn off with ./install.sh --without-context-hygiene"
else
  echo "Context hygiene module: off (delegation-only). Turn on with ./install.sh --with-context-hygiene"
fi
echo "Settings backup: $BAK"
echo "Next: restart Claude Code, then run bin/ledger.sh to see subagent usage for today."
