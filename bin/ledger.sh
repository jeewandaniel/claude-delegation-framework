#!/usr/bin/env bash
# Summarise one day of the subagent usage ledger. Usage: ledger.sh [YYYY-MM-DD]
set -euo pipefail
DIR="${FRAMEWORK_HOME:-$HOME/.claude}/framework/ledger"
# Default day is the LOCAL calendar date, matching the ledger file names hooks/ledger.js writes.
DAY="${1:-$(date +%Y-%m-%d)}"
FILE="$DIR/$DAY.jsonl"
if [ ! -f "$FILE" ]; then
  echo "no ledger for $DAY at $FILE"
  exit 0
fi
node -e '
const fs = require("fs");
const rows = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const starts = new Map();
const agg = {};
for (const r of rows) {
  if (r.event === "SubagentStart" && r.agent_id) starts.set(r.agent_id, r);
  if (r.event === "SubagentStop") {
    const t = r.agent_type || "unknown";
    const a = agg[t] = agg[t] || { runs: 0, secs: 0, out: 0, ctx: 0 };
    a.runs++;
    const s = r.agent_id && starts.get(r.agent_id);
    if (s) a.secs += (Date.parse(r.ts) - Date.parse(s.ts)) / 1000;
    a.out += r.output_tokens || 0;
    a.ctx += r.context_tokens || 0;
  }
}
console.log(["agent", "runs", "avg_s", "output_tok", "context_tok"].join("\t"));
for (const [t, a] of Object.entries(agg)) console.log([t, a.runs, (a.secs / a.runs).toFixed(0), a.out, a.ctx].join("\t"));
' "$FILE"
