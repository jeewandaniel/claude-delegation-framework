#!/usr/bin/env node
'use strict';
// SessionStart (startup|resume|clear|compact): inject the project's handoff file if present.
const fs = require('fs');
const lib = require('./lib/framework-lib');

const stdinTimeout = setTimeout(() => process.exit(0), 10000);

(async () => {
  const raw = await lib.readStdin();
  clearTimeout(stdinTimeout);
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  if (lib.isSubagent(input) || !input.transcript_path) return;

  const hp = lib.handoffPath(input.transcript_path);
  let content;
  let stat;
  try {
    content = fs.readFileSync(hp, 'utf8');
    stat = fs.statSync(hp);
  } catch { return; }

  const ageDays = (Date.now() - stat.mtimeMs) / 86400000;
  const age = ageDays < 1 ? `${Math.round(ageDays * 24)}h old` : `${Math.round(ageDays)}d old`;
  const stale = ageDays > 14
    ? ' This handoff is older than 14 days; confirm with the user that it is still current before acting on it.'
    : '';
  const header = `HANDOFF loaded from ${hp} (written ${stat.mtime.toISOString()}, ${age}). `
    + 'Open your first reply with one line confirming what was resumed, then continue from "Next steps". Ask before deviating.'
    + stale;
  lib.emit('SessionStart', `${header}\n\n${content}`);
})().catch(() => { /* silent */ });
