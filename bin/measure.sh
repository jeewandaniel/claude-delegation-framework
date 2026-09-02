#!/usr/bin/env bash
# Print the first-turn context size (tokens) of a headless Claude Code session started in the cwd.
# Usage: measure.sh [--no-mcp] [--bare]
#   --no-mcp  disable local MCP servers
#   --bare    also ignore user settings (plugins, hooks, skills)
set -euo pipefail

ARGS=()
for a in "$@"; do
  case "$a" in
    --no-mcp) ARGS+=(--strict-mcp-config --mcp-config '{"mcpServers":{}}') ;;
    --bare)   ARGS+=(--setting-sources project --strict-mcp-config --mcp-config '{"mcpServers":{}}') ;;
    *) echo "unknown flag: $a" >&2; exit 1 ;;
  esac
done

env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT claude -p "Reply with the single word ok." \
  --model haiku --output-format json --max-turns 1 ${ARGS[@]+"${ARGS[@]}"} 2>/dev/null \
| node -e '
let raw = "";
process.stdin.on("data", (c) => { raw += c; }).on("end", () => {
  let d;
  try { d = JSON.parse(raw); } catch { console.error("could not parse claude output"); process.exit(1); }
  const u = d.usage || {};
  const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  console.log(`first-turn context: ${ctx} tokens (${process.cwd()})`);
});'
