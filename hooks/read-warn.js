#!/usr/bin/env node
'use strict';
// PostToolUse on Read (main loop only): warn when the main loop reads a large file itself.
const fs = require('fs');
const lib = require('./lib/framework-lib');

const stdinTimeout = setTimeout(() => process.exit(0), 10000);

(async () => {
  const raw = await lib.readStdin();
  clearTimeout(stdinTimeout);
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  if (lib.isSubagent(input) || input.tool_name !== 'Read') return;
  const session = lib.safeSession(input.session_id);
  if (!session) return;
  const fp = input.tool_input && input.tool_input.file_path;
  if (!fp) return;

  let lines;
  try {
    const text = fs.readFileSync(fp, 'utf8');
    lines = text.length ? text.split('\n').length : 0;
  } catch { return; }

  const cfg = lib.loadConfig(input.cwd);
  if (lines <= cfg.readWarnLines) return;

  const aux = lib.readAux(session, 'read');
  aux.bigReads = (aux.bigReads || 0) + 1;
  const fire = aux.bigReads === 1 || aux.bigReads > cfg.readWarnEvery + 1;
  if (fire) aux.bigReads = 1;
  lib.writeAux(session, 'read', aux);
  if (!fire) return;

  lib.emit('PostToolUse', `Main loop read ${lines} lines of ${fp}. Reads this size belong to scout; delegate the next one and ask for a compact report.`);
})().catch(() => { /* silent */ });
