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
  if (lib.isSubagent(input)) return;

  // The context window is fresh at every SessionStart (startup|resume|clear|compact), so any
  // level a reused session_id carries is stale and would deny the first edits. Drop the ctx
  // state; the meter recomputes it from the next measurement.
  const session = lib.safeSession(input.session_id);
  if (session) {
    try { fs.unlinkSync(lib.auxPath(session, 'ctx')); } catch { /* nothing to reset */ }

    if (input.source === 'compact') {
      // A compaction summary already carries the live state as of "now" — the transcript's
      // usage lines up to this point describe the *pre-compaction* session and must never be
      // read as the current size. Record where the old content ends so the meter can skip it.
      let ignoreBefore = null;
      if (input.transcript_path) {
        try { ignoreBefore = fs.statSync(input.transcript_path).size; } catch { /* leave null */ }
      }
      if (ignoreBefore !== null) {
        const st = lib.readState(session); // fresh defaults: the file was just unlinked
        st.ignoreBefore = ignoreBefore;
        st.floorReported = true; // no "Session floor" line for a session that didn't start now
        lib.writeState(session, st);
      }
    }
  }

  // A compaction summary already carries the live state; injecting a (possibly day-old, for a
  // different job) handoff on top of it would be actively misleading. Nothing else to do here.
  if (input.source === 'compact') return;

  if (!input.transcript_path) return;

  const hp = lib.handoffPath(input.transcript_path);
  let content;
  let stat;
  try {
    content = fs.readFileSync(hp, 'utf8');
    stat = fs.statSync(hp);
  } catch { return; }

  const ageDays = Math.max(0, (Date.now() - stat.mtimeMs) / 86400000);
  const age = ageDays < 1 ? `${Math.round(ageDays * 24)}h old` : `${Math.round(ageDays)}d old`;
  const stale = ageDays > 14
    ? ' This handoff is older than 14 days; confirm with the user that it is still current before acting on it.'
    : '';
  const header = `HANDOFF loaded from ${hp} (written ${stat.mtime.toISOString()}, ${age}). `
    + 'Open your first reply with one line confirming what was resumed, then continue from "Next steps". Ask before deviating.'
    + stale;
  lib.emit('SessionStart', `${header}\n\n${content}`);
})().catch(() => { /* silent */ });
