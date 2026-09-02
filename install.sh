#!/usr/bin/env bash
# Install the cost framework into a Claude Code config directory (default ~/.claude).
# Idempotent: safe to re-run after every change to this repo.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${FRAMEWORK_HOME:-$HOME/.claude}"
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "node not found on PATH; install Node 20+ first" >&2
  exit 1
fi

mkdir -p "$DEST/hooks/lib" "$DEST/agents" "$DEST/skills/handoff" "$DEST/framework/ledger"

cp "$REPO"/hooks/*.js "$DEST/hooks/"
cp "$REPO"/hooks/lib/*.js "$DEST/hooks/lib/"
cp "$REPO"/agents/*.md "$DEST/agents/"
cp "$REPO"/skills/handoff/SKILL.md "$DEST/skills/handoff/SKILL.md"
chmod +x "$DEST"/hooks/*.js

if [ ! -f "$DEST/framework.json" ]; then
  cp "$REPO/settings/framework.defaults.json" "$DEST/framework.json"
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

CLAUDE_MD="$DEST/CLAUDE.md"
"$NODE" "$REPO/bin/install-claude-md.js" "$CLAUDE_MD" "$REPO/claude-md/framework-block.md"

echo "Installed cost framework into $DEST"
echo "Settings backup: $BAK"
echo "Next: turn ultracode off in the session UI, restart Claude Code, run bin/measure.sh in a project."
