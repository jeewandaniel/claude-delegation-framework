#!/usr/bin/env bash
# Regenerate every copied file under plugins/ from its canonical source.
# The plugin directories are packaging, not a second copy to maintain by hand:
# edit the source, run this, commit both.
#
# Hand-written files under plugins/ (plugin.json, hooks.json, session-start.js,
# README.md) are never touched here.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEL="$ROOT/plugins/delegation"
CTX="$ROOT/plugins/context-hygiene"

mkdir -p "$DEL/agents" "$DEL/skills/handoff" "$DEL/hooks/lib" "$CTX/hooks/lib"

# 1. Agents, verbatim.
rm -f "$DEL"/agents/*.md
for f in "$ROOT"/agents/*.md; do
  cp "$f" "$DEL/agents/$(basename "$f")"
done

# 2. Handoff skill. A plugin has no install-time text substitution for skills, so
#    {{NAME}} is resolved here, once, to a neutral phrase.
FRAMEWORK_NAME="the user" node "$ROOT/bin/subst-name.js" \
  "$ROOT/skills/handoff/SKILL.md" "$DEL/skills/handoff/SKILL.md"

# 3. The rules block. {{NAME}} is kept: hooks/session-start.js substitutes it at
#    runtime from CLAUDE_PLUGIN_OPTION_NAME.
cp "$ROOT/claude-md/framework-block.md" "$DEL/framework-block.md"

# 4. Ledger hook and the shared lib.
cp "$ROOT/hooks/ledger.js" "$DEL/hooks/ledger.js"
cp "$ROOT/hooks/lib/framework-lib.js" "$DEL/hooks/lib/framework-lib.js"

# 5. Context-hygiene module hooks, its lib, and its rules text ({{NAME}} kept).
for f in ctx-guard.js ctx-meter.js read-warn.js handoff-load.js; do
  cp "$ROOT/modules/context-hygiene/hooks/$f" "$CTX/hooks/$f"
done
cp "$ROOT/hooks/lib/framework-lib.js" "$CTX/hooks/lib/framework-lib.js"
cp "$ROOT/modules/context-hygiene/context-rules.md" "$CTX/context-rules.md"

# 6. node-resolving shell wrapper, so hooks.json never invokes a bare `node`
#    that a GUI-launched app's minimal PATH might not contain.
cp "$ROOT/bin/run-node.sh" "$DEL/hooks/run-node.sh"
cp "$ROOT/bin/run-node.sh" "$CTX/hooks/run-node.sh"
chmod +x "$DEL/hooks/run-node.sh" "$CTX/hooks/run-node.sh"

echo "synced plugins/ from canonical sources"
