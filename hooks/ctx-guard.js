#!/usr/bin/env node
'use strict';
// Edit guard: PreToolUse on Edit|Write|MultiEdit|NotebookEdit.
// In the hard state, before the handoff is written, only writes inside the memory dir are allowed.
const path = require('path');
const lib = require('./lib/framework-lib');

const stdinTimeout = setTimeout(() => process.exit(0), 10000);

(async () => {
  const raw = await lib.readStdin();
  clearTimeout(stdinTimeout);
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  if (lib.isSubagent(input)) return;
  if (!/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(input.tool_name || '')) return;
  const session = lib.safeSession(input.session_id);
  if (!session || !input.transcript_path) return;

  const st = lib.readState(session);
  if (st.level !== 'hard' || st.handoffWrittenAt) return;

  const ti = input.tool_input || {};
  const target = ti.file_path || ti.notebook_path || '';
  const memDir = lib.memoryDir(input.transcript_path);
  if (target) {
    const rel = path.relative(memDir, path.resolve(input.cwd || process.cwd(), target));
    const inMemory = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
    if (inMemory) return;
  }

  const hp = lib.handoffPath(input.transcript_path);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Context hard limit reached (${lib.k(st.ctx)}). Write the handoff first: ${hp}. Run /handoff; edits are allowed again once it is written.`,
    },
  }));
})().catch(() => { /* fail open */ });
