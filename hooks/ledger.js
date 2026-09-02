#!/usr/bin/env node
'use strict';
// SubagentStart / SubagentStop: append one record per event to the daily ledger.
const fs = require('fs');
const path = require('path');
const lib = require('./lib/framework-lib');

const stdinTimeout = setTimeout(() => process.exit(0), 10000);

(async () => {
  const raw = await lib.readStdin();
  clearTimeout(stdinTimeout);
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  const cfg = lib.loadConfig(input.cwd);
  if (!cfg.ledger) return;

  const now = new Date();
  const rec = {
    ts: now.toISOString(),
    event: input.hook_event_name || null,
    session_id: input.session_id || null,
    agent_id: input.agent_id || null,
    agent_type: input.agent_type || null,
    model: input.model || null,
    cwd: input.cwd || null,
  };
  // Only the subagent's own transcript is meaningful for token counts.
  const tp = input.agent_transcript_path || null;
  if (rec.event === 'SubagentStop' && tp) {
    const m = lib.measureContext(tp);
    if (m.ok) rec.context_tokens = m.ctx;
    const out = lib.sumOutputTokens(tp);
    if (out !== null) rec.output_tokens = out;
  }

  const dir = path.join(lib.HOME, 'framework', 'ledger');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, `${now.toISOString().slice(0, 10)}.jsonl`), JSON.stringify(rec) + '\n');
})().catch(() => { /* silent */ });
